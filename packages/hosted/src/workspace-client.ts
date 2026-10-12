import { HTTP_METHOD } from "@sidecar/wire";
import { Effect } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import { type AccountCallEffects, accountBearer, accountCall } from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
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
 * and a 401 is renewed and retried once. An answer that did not come back is
 * nothing rather than a failure, because the one thing a caller does
 * without it is keep the workspaces, or the members, it last read.
 */

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

  /** Joins the workspace of the installation, answered as the account now sees it; nothing where the service refused or did not answer. */
  join(installationId: number): Effect.Effect<Workspace | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask(
        {
          method: HTTP_METHOD.POST,
          path: HOSTED_SERVICE_PATH.WORKSPACES_JOIN,
          body: JSON.stringify({ installationId }),
        },
        workspaceJoinAnswerSchema,
      ),
      (answer) => answer?.workspace,
    );
  }

  /** One workspace's members; nothing where the service refused or did not answer. */
  members(
    workspaceId: string,
  ): Effect.Effect<readonly WorkspaceMember[] | undefined, never, HttpClient.HttpClient> {
    const query = new URLSearchParams({ [WORKSPACE_MEMBERS_QUERY.WORKSPACE_ID]: workspaceId });
    return Effect.map(
      this.#call.ask(
        { method: HTTP_METHOD.GET, path: `${HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS}?${query}` },
        workspaceMembersAnswerSchema,
      ),
      (answer) => answer?.members,
    );
  }

  /** Removes one member, answered with the members who remain; nothing where the service refused or did not answer. */
  removeMember(
    workspaceId: string,
    userId: string,
  ): Effect.Effect<readonly WorkspaceMember[] | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask(
        {
          method: HTTP_METHOD.POST,
          path: HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS_REMOVE,
          body: JSON.stringify({ workspaceId, userId }),
        },
        workspaceMembersAnswerSchema,
      ),
      (answer) => answer?.members,
    );
  }

  /** Leaves the workspace: whether the service answered that the account left it. */
  leave(workspaceId: string): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask(
        {
          method: HTTP_METHOD.POST,
          path: HOSTED_SERVICE_PATH.WORKSPACES_LEAVE,
          body: JSON.stringify({ workspaceId }),
        },
        workspaceLeaveAnswerSchema,
      ),
      (answer) => answer?.workspaceId === workspaceId,
    );
  }
}
