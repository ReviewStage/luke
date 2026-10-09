import {
  EXCESS_KEYS,
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
import type { AccountToken } from "./account-token.js";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
  type CodingAgentCallFailure,
  type CodingAgentDefaultAnswer,
  type CodingAgentListAnswer,
  type CodingAgentMessagesAnswerView,
  type CodingAgentModelsAnswer,
  type CodingAgentPullRequestAnswerView,
} from "./coding-agent-view.js";
import {
  type CodingAgentStartRequest,
  codingAgentAnswerSchema,
  codingAgentListAnswerSchema,
  codingAgentMessagesAnswerSchema,
  codingAgentPullRequestAnswerSchema,
  codingAgentStartRequestSchema,
} from "./coding-agent-wire.js";
import {
  codingAgentDefaultAnswerSchema,
  codingAgentDefaultWriteSchema,
  type ModelChoice,
  modelsAnswerSchema,
} from "./models-wire.js";
import {
  agentMessagesPath,
  agentPullRequestPath,
  agentStopPath,
  HOSTED_SERVICE_PATH,
  planAgentsPath,
} from "./service-paths.js";
import { HOSTED_API_ERROR, type HostedApiError, hostedErrorSchema } from "./service-wire.js";

/**
 * coding-agent-client.ts -- the window's side of a plan's coding agents, as the host asks the service for them.
 *
 * Every call is the one account call, so the bearer is read fresh per
 * attempt and a 401 is renewed and retried once. Each call answers one of
 * the view's shapes rather than failing, because every caller does the same
 * thing with a failure: draws why, and offers to try again. The transcript
 * read is the one call the service holds open, for as long as it waits on
 * the agent's next message, so it travels under a deadline of its own that
 * outlasts that hold; every other call keeps the account call's usual one.
 */

/** How long a transcript read may stand: the service's hold, and room for the answer to travel after it. */
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
} satisfies NamedRefusals;

/** The refusals a call that names one row can answer with. */
const ROW_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: CODING_AGENT_CALL_FAILURE.NOT_FOUND,
} satisfies NamedRefusals;

/** The refusals writing the default can answer with: a choice the catalog does not offer. */
const DEFAULT_REFUSALS = {
  [HOSTED_API_ERROR.INVALID_REQUEST]: CODING_AGENT_CALL_FAILURE.INVALID_CHOICE,
} satisfies NamedRefusals;

/** A response's body as JSON, or nothing where it is not JSON at all. */
function jsonOf(response: Response): Effect.Effect<WireBoundaryInput> {
  return Effect.promise((): Promise<WireBoundaryInput> => response.json().catch(() => undefined));
}

/** The refusal a refused answer carries, where it is one the caller names; unanswered otherwise. */
function refusedAs(payload: UnparsedWireValue, named: NamedRefusals): Failed {
  const refusal = Result.getOrUndefined(readEither(hostedErrorSchema)(payload));
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
    const read = Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(payload));
    return read === undefined ? UNANSWERED : read;
  });
}

/**
 * The window's reads and writes of a plan's coding agents: the models the
 * service offers and the account's default among them, a plan's agents,
 * one started, one's transcript past a cursor, one stopped, and what one
 * published.
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

  /** One agent's transcript past the cursor, held by the service while the agent runs and nothing new stands. */
  messages(
    agentId: string,
    after: string,
  ): Effect.Effect<CodingAgentMessagesAnswerView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#held.send({ method: HTTP_METHOD.GET, path: agentMessagesPath(agentId, after) }),
      (answer) => readAnswer(answer, codingAgentMessagesAnswerSchema, ROW_REFUSALS),
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
}
