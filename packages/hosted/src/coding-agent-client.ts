import {
  HTTP_METHOD,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Result, type Schema } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import {
  type AccountCallEffects,
  accountBearer,
  accountCall,
  type CallAnswer,
  callAnswered,
} from "./account-call.js";
import { accountInboxAnswerSchema } from "./account-inbox-wire.js";
import type { AccountToken } from "./account-token.js";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAccountInboxAnswerView,
  type CodingAgentAgentAnswer,
  type CodingAgentCallFailure,
  type CodingAgentDefaultAnswer,
  type CodingAgentInboxAnsweredView,
  type CodingAgentInboxAnswerView,
  type CodingAgentListAnswer,
  type CodingAgentMessagesAnswerView,
  type CodingAgentModelsAnswer,
  type CodingAgentPullRequestAnswerView,
  type DictationTranscribeAnswerView,
  type DictationTranscribeParams,
  type PlanTemplateAnswerView,
  type PlanTemplateWriteParams,
  type ProviderKeyRemoveParams,
  type ProviderKeySaveParams,
  type ProviderKeysAnswerView,
} from "./coding-agent-view.js";
import {
  type CodingAgentMessageRequest,
  type CodingAgentRenameRequest,
  type CodingAgentStartRequest,
  codingAgentAnswerSchema,
  codingAgentListAnswerSchema,
  codingAgentMessageRequestSchema,
  codingAgentMessagesAnswerSchema,
  codingAgentPullRequestAnswerSchema,
  codingAgentRenameRequestSchema,
  codingAgentStartRequestSchema,
} from "./coding-agent-wire.js";
import { dictationAnswerSchema, dictationRequestSchema } from "./dictation-wire.js";
import {
  type InboxAnswerRequest,
  inboxAnsweredSchema,
  inboxAnswerRequestSchema,
  inboxAnswerSchema,
} from "./inbox-wire.js";
import {
  codingAgentDefaultAnswerSchema,
  codingAgentDefaultWriteSchema,
  type ModelChoice,
  modelChoiceSchema,
  modelsAnswerSchema,
} from "./models-wire.js";
import {
  planTemplateAnswerSchema,
  planTemplateWriteRequestSchema,
} from "./plan-document-template.js";
import {
  PROVIDER_KEY_QUERY,
  providerKeySaveRequestSchema,
  providerKeysAnswerSchema,
} from "./provider-key-wire.js";
import {
  agentMessagesPath,
  agentPath,
  agentPullRequestPath,
  agentStopPath,
  agentSubagentMessagesPath,
  HOSTED_SERVICE_PATH,
  inboxItemPath,
  planAgentsPath,
  planInboxPath,
} from "./service-paths.js";
import {
  HOSTED_API_ERROR,
  type HostedApiError,
  hostedErrorSchema,
  readServiceAnswer,
} from "./service-wire.js";

/**
 * coding-agent-client.ts -- the window's side of a plan's coding agents, as the host asks the service for them.
 *
 * Every call is the one account call, so the bearer is read fresh per
 * attempt and a 401 is renewed and retried once. Each call answers one of
 * the view's shapes rather than failing, because every caller does the same
 * thing with a failure: draws why, and offers to try again. The transcript
 * read and the two inbox reads, a plan's and the account's, are the calls
 * the service holds open, for as long as it waits on the agent's next
 * message or the inbox's next change, so they travel under a deadline of
 * their own that outlasts that hold; every other call keeps the account
 * call's usual one. The account's plan
 * template is read and written here too, as Settings asks for it beside
 * the default and the keys.
 */

/** How long a held read or a dictated clip may stand: the service's hold or the model's hearing, and room for the answer to travel after it. */
const HELD_READ_TIMEOUT_MS = 35_000;

export interface HostedCodingAgentClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

type Failed = { readonly failure: CodingAgentCallFailure };

/** The refusals a call may answer with, by the service's own word for each. */
type NamedRefusals = Readonly<Partial<Record<HostedApiError, CodingAgentCallFailure>>>;

/** The refusals a Start can answer with. */
const START_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: CODING_AGENT_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.NO_REPOSITORY]: CODING_AGENT_CALL_FAILURE.NO_REPOSITORY,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
  [HOSTED_API_ERROR.GITHUB_SIGN_IN_REQUIRED]: CODING_AGENT_CALL_FAILURE.GITHUB_SIGN_IN_REQUIRED,
  [HOSTED_API_ERROR.INVALID_REQUEST]: CODING_AGENT_CALL_FAILURE.INVALID_CHOICE,
  [HOSTED_API_ERROR.PLAN_ARCHIVED]: CODING_AGENT_CALL_FAILURE.PLAN_ARCHIVED,
} satisfies NamedRefusals;

/** The refusals a call that names one row can answer with. */
const ROW_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: CODING_AGENT_CALL_FAILURE.NOT_FOUND,
} satisfies NamedRefusals;

/** The refusals a message can answer with: the agent gone, the words past the bound, a session still coming up or ended for good, its plan archived, and the two the turn's checkout needs mended first. */
const MESSAGE_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: CODING_AGENT_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.MESSAGE_TOO_LONG]: CODING_AGENT_CALL_FAILURE.MESSAGE_TOO_LONG,
  [HOSTED_API_ERROR.AGENT_NOT_READY]: CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY,
  [HOSTED_API_ERROR.AGENT_RETIRED]: CODING_AGENT_CALL_FAILURE.AGENT_RETIRED,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
  [HOSTED_API_ERROR.GITHUB_SIGN_IN_REQUIRED]: CODING_AGENT_CALL_FAILURE.GITHUB_SIGN_IN_REQUIRED,
  [HOSTED_API_ERROR.PLAN_ARCHIVED]: CODING_AGENT_CALL_FAILURE.PLAN_ARCHIVED,
} satisfies NamedRefusals;

/** The refusals an answer to the inbox can answer with: a message's own, since an answer the agent needs to hear reaches it as one. */
const INBOX_ANSWER_REFUSALS = MESSAGE_REFUSALS;

/** The refusals writing the default can answer with: a choice the catalog does not offer. */
const DEFAULT_REFUSALS = {
  [HOSTED_API_ERROR.INVALID_REQUEST]: CODING_AGENT_CALL_FAILURE.INVALID_CHOICE,
} satisfies NamedRefusals;

/** The refusals changing an agent's choice can answer with: the agent gone, or a choice the catalog does not offer. */
const CHOOSE_REFUSALS = {
  ...ROW_REFUSALS,
  ...DEFAULT_REFUSALS,
} satisfies NamedRefusals;

/** A response's body as JSON, or nothing where it is not JSON at all. */
function jsonOf(response: Response): Effect.Effect<WireBoundaryInput> {
  return Effect.promise((): Promise<WireBoundaryInput> => response.json().catch(() => undefined));
}

/** The refusal a refused answer carries, where it is one the caller names; unanswered otherwise. */
function refusedAs(payload: UnparsedWireValue, named: NamedRefusals): Failed {
  const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
  const failure = refusal === undefined ? undefined : named[refusal];
  return failure === undefined ? UNANSWERED : { failure };
}

/**
 * An answer read whole: the body the schema admits where the service
 * answered, a key a newer service added dropped rather than refused, the
 * refusal where it is one the caller names, and unanswered for everything
 * else.
 */
function readAnswer<Answer, Encoded>(
  answer: CallAnswer,
  schema: Schema.Codec<Answer, Encoded>,
  named: NamedRefusals,
): Effect.Effect<Answer | Failed> {
  if (!callAnswered(answer)) return Effect.succeed(UNANSWERED);
  return Effect.map(jsonOf(answer.response), (body): Answer | Failed => {
    const payload = unparsedWire(body);
    if (!answer.response.ok) return refusedAs(payload, named);
    const read = Result.getOrUndefined(readServiceAnswer(schema)(payload));
    return read === undefined ? UNANSWERED : read;
  });
}

/**
 * The window's reads and writes of a plan's coding agents: the models the
 * service offers and the account's default among them, a plan's agents,
 * one started, one's transcript past a cursor, one messaged, one's model
 * and effort changed, one stopped, what one published, the plan's inbox
 * of what its agents need of the developer, read past a cursor and
 * answered an item at a time, and what waits across the account's plans.
 */
export class HostedCodingAgentClient {
  readonly #call: AccountCallEffects;
  readonly #held: AccountCallEffects;

  constructor(options: HostedCodingAgentClientOptions) {
    const credential = accountBearer(options);
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#held = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential,
      requestTimeoutMs: HELD_READ_TIMEOUT_MS,
    });
  }

  /** The models a coding agent may run on, as the service offers them now. */
  models(): Effect.Effect<CodingAgentModelsAnswer, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.MODELS }),
      (answer) => readAnswer(answer, modelsAnswerSchema, {}),
    );
  }

  /** The account's default model and effort, read off the preferences snapshot. */
  readDefault(): Effect.Effect<CodingAgentDefaultAnswer, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES }),
      (answer) =>
        Effect.map(readAnswer(answer, codingAgentDefaultAnswerSchema, {}), (read) =>
          "failure" in read ? read : { choice: read.codingAgent },
        ),
    );
  }

  /** The account's default written on its own, answering it as kept; a choice the service would refuse by shape is refused here without traveling at all. */
  writeDefault(
    choice: ModelChoice,
  ): Effect.Effect<CodingAgentDefaultAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(codingAgentDefaultWriteSchema)({ codingAgent: choice }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.PUT,
        path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES,
        body: JSON.stringify(admitted),
      }),
      (answer) =>
        Effect.map(readAnswer(answer, codingAgentDefaultAnswerSchema, DEFAULT_REFUSALS), (read) =>
          "failure" in read ? read : { choice: read.codingAgent },
        ),
    );
  }

  /** The account's plan template: its own, or the default while it keeps none. */
  readPlanTemplate(): Effect.Effect<PlanTemplateAnswerView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_PLAN_TEMPLATE }),
      (answer) => readAnswer(answer, planTemplateAnswerSchema, {}),
    );
  }

  /**
   * The template kept verbatim, or the default again for null, answering it
   * as then kept; a template past the bound is refused here without
   * traveling at all.
   */
  writePlanTemplate(
    params: PlanTemplateWriteParams,
  ): Effect.Effect<PlanTemplateAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(planTemplateWriteRequestSchema)(params));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.PUT,
        path: HOSTED_SERVICE_PATH.ACCOUNT_PLAN_TEMPLATE,
        body: JSON.stringify(admitted),
      }),
      (answer) => readAnswer(answer, planTemplateAnswerSchema, {}),
    );
  }

  /** The account's own provider keys, as hints and statuses. */
  readProviderKeys(): Effect.Effect<ProviderKeysAnswerView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_PROVIDER_KEYS }),
      (answer) => readAnswer(answer, providerKeysAnswerSchema, {}),
    );
  }

  /**
   * One key saved for its provider, answering the keys as they then stand
   * and, where the service kept nothing, why; a key the service would
   * refuse by shape is refused here without traveling at all.
   */
  saveProviderKey(
    params: ProviderKeySaveParams,
  ): Effect.Effect<ProviderKeysAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(providerKeySaveRequestSchema)(params));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.PUT,
        path: HOSTED_SERVICE_PATH.ACCOUNT_PROVIDER_KEYS,
        body: JSON.stringify(admitted),
      }),
      (answer) => readAnswer(answer, providerKeysAnswerSchema, {}),
    );
  }

  /**
   * One dictated clip's words, under the held deadline, since the service
   * answers only once the model has heard the clip through; a clip the
   * service would refuse by shape is refused here without traveling at all.
   */
  transcribeDictation(
    params: DictationTranscribeParams,
  ): Effect.Effect<DictationTranscribeAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(dictationRequestSchema)(params));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.flatMap(
      this.#held.send({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.DICTATION,
        body: JSON.stringify(admitted),
      }),
      (answer) => readAnswer(answer, dictationAnswerSchema, {}),
    );
  }

  /** One provider's key removed, answering the keys as they then stand. */
  removeProviderKey(
    params: ProviderKeyRemoveParams,
  ): Effect.Effect<ProviderKeysAnswerView, never, HttpClient.HttpClient> {
    // The provider rides in the query, since a DELETE carries no body.
    const query = new URLSearchParams({ [PROVIDER_KEY_QUERY.PROVIDER]: params.provider });
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.DELETE,
        path: `${HOSTED_SERVICE_PATH.ACCOUNT_PROVIDER_KEYS}?${query}`,
      }),
      (answer) => readAnswer(answer, providerKeysAnswerSchema, {}),
    );
  }

  /** One plan's agents with their status, in the order they were started. */
  list(planId: string): Effect.Effect<CodingAgentListAnswer, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: planAgentsPath(planId) }),
      (answer) => readAnswer(answer, codingAgentListAnswerSchema, ROW_REFUSALS),
    );
  }

  /**
   * Starts an agent on the plan under the request's own key, so a retry
   * carrying the same key answers the agent the first Start made; a request
   * the service would refuse by shape is refused here without traveling.
   */
  start(
    planId: string,
    request: CodingAgentStartRequest,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(codingAgentStartRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path: planAgentsPath(planId),
        body: JSON.stringify(admitted),
      }),
      (answer) => readAnswer(answer, codingAgentAnswerSchema, START_REFUSALS),
    );
  }

  /** One agent's transcript past the cursor, or a worker's where the delegation call that started it is named, held by the service while the agent or the worker runs and nothing new stands. */
  messages(
    agentId: string,
    after: string,
    callId?: string,
  ): Effect.Effect<CodingAgentMessagesAnswerView, never, HttpClient.HttpClient> {
    const path =
      callId === undefined
        ? agentMessagesPath(agentId, after)
        : agentSubagentMessagesPath(agentId, callId, after);
    return Effect.flatMap(this.#held.send({ method: HTTP_METHOD.GET, path }), (answer) =>
      readAnswer(answer, codingAgentMessagesAnswerSchema, ROW_REFUSALS),
    );
  }

  /**
   * Sends one agent a message under the key the window made for the send,
   * which a retry carries again, and answers the agent as it then stands,
   * which is running; a message the service would refuse by shape is
   * refused here without traveling.
   */
  message(
    agentId: string,
    request: CodingAgentMessageRequest,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(codingAgentMessageRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path: agentMessagesPath(agentId),
        body: JSON.stringify(admitted),
      }),
      (answer) => readAnswer(answer, codingAgentAnswerSchema, MESSAGE_REFUSALS),
    );
  }

  /** Changes one agent's model and effort for its next step, answering it as it then stands; a choice the service would refuse by shape is refused here without traveling. */
  choose(
    agentId: string,
    choice: ModelChoice,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(modelChoiceSchema)(choice));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.PATCH,
        path: agentPath(agentId),
        body: JSON.stringify(admitted),
      }),
      (answer) => readAnswer(answer, codingAgentAnswerSchema, CHOOSE_REFUSALS),
    );
  }

  /** Renames one agent, or clears its title with an empty one, answering it as it then stands; a title past the bound is refused here without traveling. */
  rename(
    agentId: string,
    request: CodingAgentRenameRequest,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(codingAgentRenameRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.PATCH,
        path: agentPath(agentId),
        body: JSON.stringify(admitted),
      }),
      (answer) => readAnswer(answer, codingAgentAnswerSchema, ROW_REFUSALS),
    );
  }

  /** Stops one agent, answering it as it then stands. */
  stop(agentId: string): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.POST, path: agentStopPath(agentId) }),
      (answer) => readAnswer(answer, codingAgentAnswerSchema, ROW_REFUSALS),
    );
  }

  /** What one agent published: the branch it pushed and the pull request from it, as GitHub holds them now. */
  pullRequest(
    agentId: string,
  ): Effect.Effect<CodingAgentPullRequestAnswerView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: agentPullRequestPath(agentId) }),
      (answer) => readAnswer(answer, codingAgentPullRequestAnswerSchema, ROW_REFUSALS),
    );
  }

  /** One plan's inbox past the cursor: every item its agents posted, held by the service while nothing changed. */
  inbox(
    planId: string,
    after: string,
  ): Effect.Effect<CodingAgentInboxAnswerView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#held.send({ method: HTTP_METHOD.GET, path: planInboxPath(planId, after) }),
      (answer) => readAnswer(answer, inboxAnswerSchema, ROW_REFUSALS),
    );
  }

  /** What waits on the developer across the account past the cursor: every open item, held by the service while nothing changed. */
  accountInbox(
    after: string,
  ): Effect.Effect<CodingAgentAccountInboxAnswerView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#held.send({
        method: HTTP_METHOD.GET,
        path: `${HOSTED_SERVICE_PATH.INBOX}?${new URLSearchParams({ after })}`,
      }),
      (answer) => readAnswer(answer, accountInboxAnswerSchema, {}),
    );
  }

  /**
   * Answers one item of the inbox against the revision the window drew,
   * under the key the window made for the answer, which a retry carries
   * again, and answers the item as it then stands with whether the answer
   * was taken; an answer the service would refuse by shape is refused here
   * without traveling.
   */
  answerInbox(
    itemId: string,
    request: InboxAnswerRequest,
  ): Effect.Effect<CodingAgentInboxAnsweredView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(inboxAnswerRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path: inboxItemPath(itemId),
        body: JSON.stringify(admitted),
      }),
      (answer) => readAnswer(answer, inboxAnsweredSchema, INBOX_ANSWER_REFUSALS),
    );
  }
}
