import { EXCESS_KEYS, HTTP_METHOD, unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, type Schema as EffectSchema, Result } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import {
  type AccountCallEffects,
  accountBearer,
  accountCall,
  callAnswered,
} from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import type { PlanCallResult } from "./plan-client.js";
import { WORKSPACE_CALL_FAILURE, type WorkspaceCallFailure } from "./planning-view.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { HOSTED_API_ERROR, hostedErrorSchema } from "./service-wire.js";
import {
  WORKSPACE_MEMBERS_QUERY,
  type Workspace,
  type WorkspaceMember,
  type WorkspacesAnswer,
  workspaceJoinAnswerSchema,
  workspaceLeaveAnswerSchema,
  workspaceMembersAnswerSchema,
  workspacesAnswerSchema,
} from "./workspace-wire.js";

/**
 * workspace-client.ts -- the workspaces the signed-in account is a member of, and their members, as the host asks the service for them.
 *
 * Every call is the account call, so the bearer is read fresh per attempt
 * and a 401 is renewed and retried once. A list that did not come back is
 * nothing rather than a failure, because the one thing a caller does
 * without it is keep the workspaces it last read. A join, a members read, a
 * removal, and a leave answer a result instead, because a refusal the
 * account's role earned is the developer's to be told, apart from a service
 * that did not answer.
 */

/** A join, a members read, a removal, or a leave: its answer, or why there is none. */
export type WorkspaceCallResult<Answer> = PlanCallResult<Answer, WorkspaceCallFailure>;

const UNANSWERED = { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED } as const;

const NOT_PERMITTED = { ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED } as const;

function succeeded<Answer>(answer: Answer) {
  return { ok: true, answer } as const;
}

/** A response's body as JSON, or nothing where it is not JSON at all. */
function jsonOf(response: Response): Effect.Effect<WireBoundaryInput> {
  return Effect.promise((): Promise<WireBoundaryInput> => response.json().catch(() => undefined));
}

/** One call whose answer the schema reads, a refusal the service named not-permitted told apart from every other end. */
function refusable<Answer, Encoded>(
  call: AccountCallEffects,
  request: Parameters<AccountCallEffects["send"]>[0],
  schema: EffectSchema.Codec<Answer, Encoded>,
): Effect.Effect<WorkspaceCallResult<Answer>, never, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const answer = yield* call.send(request);
    if (!callAnswered(answer)) return UNANSWERED;
    const payload = unparsedWire(yield* jsonOf(answer.response));
    if (answer.response.ok) {
      // An answer ignores a key a newer service added, as the list read's does.
      const read = Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(payload));
      return read === undefined ? UNANSWERED : succeeded(read);
    }
    const refusal = Result.getOrUndefined(readEither(hostedErrorSchema)(payload));
    return refusal === HOSTED_API_ERROR.NOT_PERMITTED ? NOT_PERMITTED : UNANSWERED;
  });
}

export interface HostedWorkspaceClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
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

  /**
   * Every workspace the account is a member of, its personal one first, and
   * the ones it may join; nothing where the service refused or did not answer.
   */
  list(): Effect.Effect<WorkspacesAnswer | undefined, never, HttpClient.HttpClient> {
    return this.#call.ask(
      { method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACES },
      workspacesAnswerSchema,
    );
  }

  /** Joins the workspace of the installation, answered as the account now sees it; or why it did not. */
  join(
    installationId: number,
  ): Effect.Effect<WorkspaceCallResult<Workspace>, never, HttpClient.HttpClient> {
    return Effect.map(
      refusable(
        this.#call,
        {
          method: HTTP_METHOD.POST,
          path: HOSTED_SERVICE_PATH.WORKSPACES_JOIN,
          body: JSON.stringify({ installationId }),
        },
        workspaceJoinAnswerSchema,
      ),
      (result) => (result.ok ? succeeded(result.answer.workspace) : result),
    );
  }

  /** One workspace's members; or why there are none. */
  members(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<readonly WorkspaceMember[]>, never, HttpClient.HttpClient> {
    const query = new URLSearchParams({ [WORKSPACE_MEMBERS_QUERY.WORKSPACE_ID]: workspaceId });
    return Effect.map(
      refusable(
        this.#call,
        { method: HTTP_METHOD.GET, path: `${HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS}?${query}` },
        workspaceMembersAnswerSchema,
      ),
      (result) => (result.ok ? succeeded(result.answer.members) : result),
    );
  }

  /** Removes one member, answered with the members who remain; or why none was removed. */
  removeMember(
    workspaceId: string,
    userId: string,
  ): Effect.Effect<WorkspaceCallResult<readonly WorkspaceMember[]>, never, HttpClient.HttpClient> {
    return Effect.map(
      refusable(
        this.#call,
        {
          method: HTTP_METHOD.POST,
          path: HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS_REMOVE,
          body: JSON.stringify({ workspaceId, userId }),
        },
        workspaceMembersAnswerSchema,
      ),
      (result) => (result.ok ? succeeded(result.answer.members) : result),
    );
  }

  /** Leaves the workspace: the workspace left, or why the account did not leave it. */
  leave(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<string>, never, HttpClient.HttpClient> {
    return Effect.map(
      refusable(
        this.#call,
        {
          method: HTTP_METHOD.POST,
          path: HOSTED_SERVICE_PATH.WORKSPACES_LEAVE,
          body: JSON.stringify({ workspaceId }),
        },
        workspaceLeaveAnswerSchema,
      ),
      (result) =>
        !result.ok
          ? result
          : result.answer.workspaceId === workspaceId
            ? succeeded(workspaceId)
            : UNANSWERED,
    );
  }
}
