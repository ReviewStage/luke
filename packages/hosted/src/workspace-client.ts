import {
  HTTP_METHOD,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Result, type Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type AccountCallEffects,
  accountBearer,
  accountCall,
  type CallRequest,
  callAnswered,
} from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import type { PlanCallResult } from "./plan-client.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import {
  HOSTED_API_ERROR,
  type HostedApiError,
  hostedErrorSchema,
  readServiceAnswer,
} from "./service-wire.js";
import {
  type Workspace,
  type WorkspacesAnswer,
  workspaceAnswerSchema,
  workspaceCreateRequestSchema,
  workspaceGithubConnectAnswerSchema,
  workspaceGithubRequestSchema,
  workspacesAnswerSchema,
} from "./workspace-wire.js";

/**
 * workspace-client.ts -- the account's workspaces as the host asks the service for them: the list, a workspace created, and a GitHub organization connected or disconnected.
 *
 * Every call is the account call, so the bearer is read fresh per attempt
 * and a 401 is renewed and retried once. A list that did not come back is
 * nothing, because the one thing a caller does without it is keep the
 * workspaces it last read; every other call answers a result, because its
 * caller draws why it did not happen: the account's role does not allow
 * it, the workspace is not one it is in, or no answer came.
 */

/** Why a workspace call did not happen. */
export const WORKSPACE_CALL_FAILURE = {
  /** The call never reached an answer: no credential, the network, a refusal not named here, a shape not read. */
  UNANSWERED: "unanswered",
  /** The account's role in the workspace does not allow it: connecting or disconnecting GitHub takes an owner or admin. */
  NOT_PERMITTED: "not-permitted",
  /** The workspace is not one the account is a member of. */
  NOT_FOUND: "not-found",
} as const;

export type WorkspaceCallFailure =
  (typeof WORKSPACE_CALL_FAILURE)[keyof typeof WORKSPACE_CALL_FAILURE];

/** One workspace call's answer, or why there is none. */
export type WorkspaceCallResult<Answer> = PlanCallResult<Answer, WorkspaceCallFailure>;

export interface HostedWorkspaceClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

const UNANSWERED = { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED } as const;

/** The refusals a workspace call names, by the service's own word for each. */
const REFUSALS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]: WORKSPACE_CALL_FAILURE.NOT_PERMITTED,
  [HOSTED_API_ERROR.NOT_FOUND]: WORKSPACE_CALL_FAILURE.NOT_FOUND,
} as const satisfies Readonly<Partial<Record<HostedApiError, WorkspaceCallFailure>>>;

/** A response's body as JSON, or nothing where it is not JSON at all. */
function jsonOf(response: Response): Effect.Effect<WireBoundaryInput> {
  return Effect.promise((): Promise<WireBoundaryInput> => response.json().catch(() => undefined));
}

/** The refusal a refused answer carries, where it is one named here; unanswered otherwise. */
function refusedAs(payload: UnparsedWireValue): WorkspaceCallResult<never> {
  const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
  const failure =
    refusal === HOSTED_API_ERROR.NOT_PERMITTED || refusal === HOSTED_API_ERROR.NOT_FOUND
      ? REFUSALS[refusal]
      : undefined;
  return failure === undefined ? UNANSWERED : { ok: false, failure };
}

export class HostedWorkspaceClient {
  readonly #call: AccountCallEffects;

  constructor(options: HostedWorkspaceClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /** Every workspace the account is a member of, its personal one first; nothing where the service refused or did not answer. */
  list(): Effect.Effect<WorkspacesAnswer | undefined, never, HttpClient.HttpClient> {
    return this.#call.ask(
      { method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACES },
      workspacesAnswerSchema,
    );
  }

  /** A workspace created with the name given, the account its owner; a name the service would refuse by shape never travels. */
  create(
    name: string,
  ): Effect.Effect<WorkspaceCallResult<Workspace>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(workspaceCreateRequestSchema)({ name }));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return this.#answered(
      {
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACES,
        body: JSON.stringify(admitted),
      },
      workspaceAnswerSchema,
      (answer) => answer.workspace,
    );
  }

  /** Where the browser goes to connect a GitHub organization to the workspace: the App's install address, carrying a single-use intent. */
  githubConnect(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<string>, never, HttpClient.HttpClient> {
    return this.#github(HOSTED_SERVICE_PATH.WORKSPACE_GITHUB_CONNECT, workspaceId, (body) =>
      this.#answered(body, workspaceGithubConnectAnswerSchema, (answer) => answer.url),
    );
  }

  /** The workspace's GitHub organization disconnected, answering the workspace as it then stands. */
  githubDisconnect(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<Workspace>, never, HttpClient.HttpClient> {
    return this.#github(HOSTED_SERVICE_PATH.WORKSPACE_GITHUB_DISCONNECT, workspaceId, (body) =>
      this.#answered(body, workspaceAnswerSchema, (answer) => answer.workspace),
    );
  }

  /** A connect or disconnect request for the workspace; an id the service would refuse by shape never travels. */
  #github<A>(
    path: string,
    workspaceId: string,
    send: (
      request: CallRequest,
    ) => Effect.Effect<WorkspaceCallResult<A>, never, HttpClient.HttpClient>,
  ): Effect.Effect<WorkspaceCallResult<A>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceGithubRequestSchema)({ workspaceId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return send({ method: HTTP_METHOD.POST, path, body: JSON.stringify(admitted) });
  }

  /** One call's answer read under its schema and picked, or its refusal named. */
  #answered<A, Encoded, Picked>(
    request: CallRequest,
    schema: Schema.Codec<A, Encoded>,
    pick: (answer: A) => Picked,
  ): Effect.Effect<WorkspaceCallResult<Picked>, never, HttpClient.HttpClient> {
    const call = this.#call;
    return Effect.gen(function* () {
      const answer = yield* call.send(request);
      if (!callAnswered(answer)) return UNANSWERED;
      const payload = unparsedWire(yield* jsonOf(answer.response));
      if (!answer.response.ok) return refusedAs(payload);
      const read = Result.getOrUndefined(readServiceAnswer(schema)(payload));
      return read === undefined ? UNANSWERED : { ok: true, answer: pick(read) };
    });
  }
}
