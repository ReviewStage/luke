/**
 * workspace-repository.ts -- a repository a workspace's task may use: one the workspace's GitHub installation on its owner reaches.
 *
 * A task names its repository at its start or in a change, and an agent is
 * started on the repository its task names, so the rule is read at each of
 * those moments rather than once when the task is written: an installation
 * suspended, removed, or reinstalled after the task named its repository
 * still decides whether an agent may start on it. A workspace with no
 * installation reaches no repository at all.
 *
 * A refusal says why (`@luke/features/repository-reach-wire`), and where
 * the owner's installation stands for another workspace the task's owner is
 * in, it names that workspace, since an installation stands for one
 * workspace alone and moving the task there is the one thing that reaches the
 * repository again: a task written in a workspace before its repositories
 * came only from its own installation (#2524) is left that way.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import type { CodingAgent } from "@luke/database/models/coding-agent-store";
import { readTaskWorkspace } from "@luke/database/models/task-store";
import { isWorkspaceMember } from "@luke/database/models/workspace-store";
import { REPOSITORY_UNREACHED } from "@luke/features/repository-reach-wire";
import { Effect, Option, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { GitHubRepository } from "../core.js";
import {
  type HostedRefusal,
  hostedStoreOrUnavailable,
  repositoryNotReachable,
} from "../http/http-effect.js";
import type { StoreFailure } from "../http/store-failure.js";
import { GitHubApp } from "./github-app.js";
import { memberWorkspaceOnOwner } from "./github-installations.js";
import { githubReachOrRefusal, logWorkspaceReadFailure } from "./github-refusal.js";

/**
 * The workspace of a task the account reaches, whose installation every
 * GitHub read of the task's repository goes through; none where the account
 * reaches no such task.
 */
export function taskWorkspace(
  userId: string,
  taskId: string,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> {
  return readTaskWorkspace(userId, taskId);
}

/**
 * The workspace an agent's repository is reached through: its task's, read
 * as the account, or for an agent with no task its own, where the account
 * is a member of it still; none otherwise.
 */
export function agentWorkspace(
  userId: string,
  agent: Pick<CodingAgent, "taskId" | "organizationId">,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> {
  if (agent.taskId !== null) return taskWorkspace(userId, agent.taskId);
  const { organizationId } = agent;
  return Effect.map(isWorkspaceMember(userId, organizationId), (member) =>
    member ? Option.some(organizationId) : Option.none(),
  );
}

/**
 * The repository as GitHub spells it, where the workspace's installation
 * reaches it; refused as not reachable, with why, where it does not, as
 * GitHub unanswered where GitHub did not say, and as unavailable where the
 * store could not be read. `mover` is the account that may move the task,
 * its owner, where that is the account asking: only then is another
 * workspace of theirs on the owner named.
 */
export const workspaceRepository = /* @__PURE__ */ Effect.fnUntraced(function* (
  organizationId: string,
  repository: string,
  mover?: string,
): Effect.fn.Return<
  GitHubRepository,
  HostedRefusal,
  GitHubApp | HttpClient.HttpClient | DatabaseServices
> {
  const app = yield* GitHubApp;
  const reach = yield* githubReachOrRefusal(app.repositoryReach(organizationId, repository));
  if (Result.isSuccess(reach)) return reach.success;
  const unreached = reach.failure;
  const movable =
    mover !== undefined &&
    (unreached.reason === REPOSITORY_UNREACHED.NOT_CONNECTED ||
      unreached.reason === REPOSITORY_UNREACHED.OTHER_OWNER);
  if (!movable) return yield* Effect.fail(repositoryNotReachable(unreached));
  const [owner = ""] = repository.split("/");
  const elsewhere = yield* hostedStoreOrUnavailable(
    memberWorkspaceOnOwner(mover, owner, organizationId),
  );
  // Note that the other workspace is named only where its installation lists the repository,
  // because one on the owner may not have been given it, and a GitHub that does not say names none.
  const reachedThere =
    Option.isSome(elsewhere) &&
    Result.isSuccess(
      yield* app.repositoryReach(elsewhere.value.id, repository).pipe(
        Effect.tapError(logWorkspaceReadFailure),
        Effect.orElseSucceed(() => reach),
      ),
    );
  return yield* Effect.fail(
    repositoryNotReachable(
      reachedThere && Option.isSome(elsewhere)
        ? { reason: REPOSITORY_UNREACHED.OTHER_WORKSPACE, repository, workspace: elsewhere.value }
        : unreached,
    ),
  );
});
