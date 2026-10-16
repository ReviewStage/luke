import {
  HTTP_METHOD,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Result, type Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
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
  type CodingAgentChangesAnswerView,
  type CodingAgentDefaultAnswer,
  type CodingAgentInboxAnsweredView,
  type CodingAgentInboxAnswerView,
  type CodingAgentInboxAttachmentView,
  type CodingAgentListAnswer,
  type CodingAgentMessagesAnswerView,
  type CodingAgentModelsAnswer,
  type CodingAgentPageAnswerView,
  type CodingAgentPullRequestAnswerView,
  type CodingAgentWorkspaceListParams,
  type DictationTranscribeAnswerView,
  type DictationTranscribeParams,
  type PlanTemplateAnswerView,
  type PlanTemplateRevisionAnswerView,
  type PlanTemplateRevisionParams,
  type PlanTemplateRevisionsAnswerView,
  type PlanTemplateRevisionsParams,
  type PlanTemplateWriteParams,
  type ProviderKeyRemoveParams,
  type ProviderKeySaveParams,
  type ProviderKeysAnswerView,
} from "./coding-agent-view.js";
import {
  CODING_AGENT_CURSOR_START,
  CODING_AGENT_LIST_ARCHIVED,
  CODING_AGENT_LIST_QUERY,
  CODING_AGENT_WORKSPACE_QUERY,
  type CodingAgentArchiveRequest,
  type CodingAgentMessageRequest,
  type CodingAgentPinRequest,
  type CodingAgentRenameRequest,
  type CodingAgentServersRequest,
  type CodingAgentStartRequest,
  codingAgentAnswerSchema,
  codingAgentChangesAnswerSchema,
  codingAgentListAnswerSchema,
  codingAgentMessageRequestSchema,
  codingAgentMessagesAnswerSchema,
  codingAgentPageAnswerSchema,
  codingAgentPullRequestAnswerSchema,
  codingAgentRenameRequestSchema,
  codingAgentServersRequestSchema,
  codingAgentStartRequestOnWire,
} from "./coding-agent-wire.js";
import { dictationAnswerSchema, dictationRequestSchema } from "./dictation-wire.js";
import { imageBodyOf } from "./image-body.js";
import {
  type InboxAnswerRequest,
  inboxAnsweredSchema,
  inboxAnswerRequestSchema,
  inboxAnswerSchema,
  inboxImageTypeSchema,
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
  planTemplateRevisionAnswerSchema,
  planTemplateRevisionsAnswerSchema,
  planTemplateWriteRequestSchema,
} from "./plan-document-template.js";
import {
  PROVIDER_KEY_QUERY,
  providerKeySaveRequestSchema,
  providerKeysAnswerSchema,
} from "./provider-key-wire.js";
import { type RepositoryUnreached, repositoryNotReachableSchema } from "./repository-reach-wire.js";
import {
  agentChangesPath,
  agentInboxPath,
  agentMessagesPath,
  agentPath,
  agentPicturePath,
  agentPullRequestPath,
  agentStopPath,
  agentSubagentMessagesPath,
  HOSTED_SERVICE_PATH,
  inboxAttachmentPath,
  inboxItemPath,
  planTemplateRestorePath,
  planTemplateRevisionPath,
  taskAgentsPath,
  taskInboxPath,
  taskMessagesPath,
  taskSubagentMessagesPath,
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

type Failed = {
  readonly failure: CodingAgentCallFailure;
  readonly unreached?: RepositoryUnreached;
};

/** The refusals a call may answer with, by the service's own word for each. */
type NamedRefusals = Readonly<Partial<Record<HostedApiError, CodingAgentCallFailure>>>;

/** The refusals a Start can answer with. */
const START_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: CODING_AGENT_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.NO_REPOSITORY]: CODING_AGENT_CALL_FAILURE.NO_REPOSITORY,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
  [HOSTED_API_ERROR.GITHUB_UNANSWERED]: CODING_AGENT_CALL_FAILURE.GITHUB_UNANSWERED,
  [HOSTED_API_ERROR.INVALID_REQUEST]: CODING_AGENT_CALL_FAILURE.INVALID_CHOICE,
  [HOSTED_API_ERROR.TASK_ARCHIVED]: CODING_AGENT_CALL_FAILURE.TASK_ARCHIVED,
} satisfies NamedRefusals;

/** The refusals a call that names one row can answer with. */
const ROW_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: CODING_AGENT_CALL_FAILURE.NOT_FOUND,
} satisfies NamedRefusals;

/** The refusals an archive can answer with: the agent gone, or one still starting or awaiting its turn, which has no turn to stop yet. */
const ARCHIVE_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: CODING_AGENT_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.AGENT_NOT_READY]: CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY,
} satisfies NamedRefusals;

/** The refusals a message can answer with: the agent gone, the words past the bound, a session still coming up or ended for good, its plan archived, and the repository the turn's checkout no longer reaches. */
const MESSAGE_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: CODING_AGENT_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.MESSAGE_TOO_LONG]: CODING_AGENT_CALL_FAILURE.MESSAGE_TOO_LONG,
  [HOSTED_API_ERROR.AGENT_NOT_READY]: CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY,
  [HOSTED_API_ERROR.AGENT_RETIRED]: CODING_AGENT_CALL_FAILURE.AGENT_RETIRED,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
  [HOSTED_API_ERROR.GITHUB_UNANSWERED]: CODING_AGENT_CALL_FAILURE.GITHUB_UNANSWERED,
  [HOSTED_API_ERROR.TASK_ARCHIVED]: CODING_AGENT_CALL_FAILURE.TASK_ARCHIVED,
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

/**
 * The refusal a refused answer carries, where it is one the caller names;
 * unanswered otherwise. A repository out of reach carries why where the
 * service said and the reason is one this build reads, and none otherwise.
 */
function refusedAs(payload: UnparsedWireValue, named: NamedRefusals): Failed {
  const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
  const failure = refusal === undefined ? undefined : named[refusal];
  if (failure === undefined) return UNANSWERED;
  if (failure !== CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE) return { failure };
  const reached = Result.getOrUndefined(readServiceAnswer(repositoryNotReachableSchema)(payload));
  return reached === undefined ? { failure } : { failure, unreached: reached.unreached };
}

/** An image's bytes read whole and spelled in base64 under the type the service named, or unanswered where the type is none an image block may be or the body could not be read. */
function readImage(response: Response): Effect.Effect<CodingAgentInboxAttachmentView> {
  return Effect.map(imageBodyOf(response, inboxImageTypeSchema), (image) => image ?? UNANSWERED);
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

  /** A page of the account's plan template history, the newest or the one before a revision. */
  readPlanTemplateRevisions(
    params: PlanTemplateRevisionsParams,
  ): Effect.Effect<PlanTemplateRevisionsAnswerView, never, HttpClient.HttpClient> {
    const path = HOSTED_SERVICE_PATH.ACCOUNT_PLAN_TEMPLATE_REVISIONS;
    const query = new URLSearchParams(
      params.before === undefined ? {} : { before: String(params.before) },
    );
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.GET,
        path: query.size === 0 ? path : `${path}?${query}`,
      }),
      (answer) => readAnswer(answer, planTemplateRevisionsAnswerSchema, {}),
    );
  }

  /** One revision of the account's plan template beside the one before it. */
  readPlanTemplateRevision(
    params: PlanTemplateRevisionParams,
  ): Effect.Effect<PlanTemplateRevisionAnswerView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: planTemplateRevisionPath(params.seq) }),
      (answer) => readAnswer(answer, planTemplateRevisionAnswerSchema, {}),
    );
  }

  /** One revision of the account's plan template put back as the template, answering it as then kept. */
  restorePlanTemplate(
    params: PlanTemplateRevisionParams,
  ): Effect.Effect<PlanTemplateAnswerView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.POST, path: planTemplateRestorePath(params.seq) }),
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

  /** One plan's agents with their status, in the order they were started, the archived ones among them, each flagged, where `includeArchived` asks. */
  list(
    taskId: string,
    includeArchived = false,
  ): Effect.Effect<CodingAgentListAnswer, never, HttpClient.HttpClient> {
    const query = new URLSearchParams({
      [CODING_AGENT_LIST_QUERY.ARCHIVED]: CODING_AGENT_LIST_ARCHIVED.INCLUDE,
    });
    const path = includeArchived ? `${taskAgentsPath(taskId)}?${query}` : taskAgentsPath(taskId);
    return Effect.flatMap(this.#call.send({ method: HTTP_METHOD.GET, path }), (answer) =>
      readAnswer(answer, codingAgentListAnswerSchema, ROW_REFUSALS),
    );
  }

  /** A workspace's agents, newest started first, narrowed to one repository where one is named, the archived ones among them where `includeArchived` asks. */
  listWorkspace(
    params: CodingAgentWorkspaceListParams,
  ): Effect.Effect<CodingAgentListAnswer, never, HttpClient.HttpClient> {
    const query = new URLSearchParams({
      [CODING_AGENT_WORKSPACE_QUERY.WORKSPACE_ID]: params.workspaceId,
    });
    if (params.repository !== undefined) {
      query.set(CODING_AGENT_WORKSPACE_QUERY.REPOSITORY, params.repository);
    }
    if (params.includeArchived === true) {
      query.set(CODING_AGENT_WORKSPACE_QUERY.ARCHIVED, CODING_AGENT_LIST_ARCHIVED.INCLUDE);
    }
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: `${HOSTED_SERVICE_PATH.AGENTS}?${query}` }),
      (answer) => readAnswer(answer, codingAgentListAnswerSchema, ROW_REFUSALS),
    );
  }

  /**
   * Starts an agent on the plan under the request's own key, so a retry
   * carrying the same key answers the agent the first Start made; a request
   * the service would refuse by shape is refused here without traveling.
   */
  start(
    taskId: string,
    request: CodingAgentStartRequest,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(codingAgentStartRequestOnWire(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path: taskAgentsPath(taskId),
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
   * One plan's planning conversation as an agent's transcript is read, or a
   * planning worker's where the call that started it is named: past the
   * cursor, held by the service while a turn or the worker runs; with no
   * cursor, its newest turns; with `before`, the turns before that one.
   */
  taskMessages(
    taskId: string,
    page: { after?: string; before?: string },
    callId?: string,
  ): Effect.Effect<CodingAgentMessagesAnswerView, never, HttpClient.HttpClient> {
    const path =
      callId === undefined
        ? taskMessagesPath(taskId, page)
        : taskSubagentMessagesPath(taskId, callId, page.after ?? CODING_AGENT_CURSOR_START);
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

  /** Switches one agent's MCP servers for its next turn on, the whole list of those off, answering it as it then stands; a list past the bound is refused here without traveling. */
  switchServers(
    agentId: string,
    request: CodingAgentServersRequest,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(codingAgentServersRequestSchema)(request));
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

  /** Archives one agent, stopping a turn it still runs first, or brings it back, answering it as it then stands. */
  archive(
    agentId: string,
    request: CodingAgentArchiveRequest,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.PATCH,
        path: agentPath(agentId),
        body: JSON.stringify({ archived: request.archived }),
      }),
      (answer) => readAnswer(answer, codingAgentAnswerSchema, ARCHIVE_REFUSALS),
    );
  }

  /** Pins one agent for the account alone, or unpins it, answering it as it then stands. */
  pin(
    agentId: string,
    request: CodingAgentPinRequest,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.PATCH,
        path: agentPath(agentId),
        body: JSON.stringify({ pinned: request.pinned }),
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

  /** One agent read whole as its own page by its id, on a plan or with none. */
  agent(agentId: string): Effect.Effect<CodingAgentPageAnswerView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: agentPath(agentId) }),
      (answer) => readAnswer(answer, codingAgentPageAnswerSchema, ROW_REFUSALS),
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

  /** One agent's changes: the files of its pull request as GitHub holds them now. */
  changes(
    agentId: string,
  ): Effect.Effect<CodingAgentChangesAnswerView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: agentChangesPath(agentId) }),
      (answer) => readAnswer(answer, codingAgentChangesAnswerSchema, ROW_REFUSALS),
    );
  }

  /** One plan's inbox past the cursor: every item its agents posted, held by the service while nothing changed. */
  inbox(
    taskId: string,
    after: string,
  ): Effect.Effect<CodingAgentInboxAnswerView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#held.send({ method: HTTP_METHOD.GET, path: taskInboxPath(taskId, after) }),
      (answer) => readAnswer(answer, inboxAnswerSchema, ROW_REFUSALS),
    );
  }

  /** One agent's inbox past the cursor, an agent with no plan as much as one on a plan: every item it posted, held by the service while nothing changed. */
  agentInbox(
    agentId: string,
    after: string,
  ): Effect.Effect<CodingAgentInboxAnswerView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#held.send({ method: HTTP_METHOD.GET, path: agentInboxPath(agentId, after) }),
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
   * One picture a tool answered an agent, or one of its workers where
   * `callId` names the delegation call, fetched under the account: its
   * bytes in base64 under the media type the service kept, as an inbox
   * image is; not found where the agent is not one the account reaches or
   * its transcript keeps no such picture; unanswered for anything else.
   */
  agentPicture(
    agentId: string,
    pictureId: string,
    callId?: string,
  ): Effect.Effect<CodingAgentInboxAttachmentView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.GET,
        path: agentPicturePath(agentId, pictureId, callId),
      }),
      (answer) => {
        if (!callAnswered(answer)) return Effect.succeed(UNANSWERED);
        if (!answer.response.ok) {
          return Effect.map(jsonOf(answer.response), (body) =>
            refusedAs(unparsedWire(body), ROW_REFUSALS),
          );
        }
        return readImage(answer.response);
      },
    );
  }

  /**
   * One image of an inbox item, fetched under the account: its bytes in
   * base64 under the media type the service kept, where the service answered
   * with one of the types an image block may be; not found where the item or
   * the attachment is not the account's; unanswered for anything else,
   * another media type included, so nothing the window draws is a type it
   * did not expect.
   */
  inboxAttachment(
    itemId: string,
    attachmentId: string,
  ): Effect.Effect<CodingAgentInboxAttachmentView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: inboxAttachmentPath(itemId, attachmentId) }),
      (answer) => {
        if (!callAnswered(answer)) return Effect.succeed(UNANSWERED);
        if (!answer.response.ok) {
          return Effect.map(jsonOf(answer.response), (body) =>
            refusedAs(unparsedWire(body), ROW_REFUSALS),
          );
        }
        return readImage(answer.response);
      },
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
