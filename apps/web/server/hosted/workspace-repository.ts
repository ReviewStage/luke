/**
 * workspace-repository.ts -- a repository a workspace's plan may use: one the workspace's GitHub installation reaches.
 *
 * A plan names its repository at its start or in a change, and an agent is
 * started on the repository its plan names, so the rule is read at each of
 * those moments rather than once when the plan is written: an installation
 * disconnected or replaced after the plan named its repository still decides
 * whether an agent may start on it. A workspace with no installation
 * reaches no repository at all.
 *
 * A refusal says why (`@luke/features/repository-reach-wire`), and where
 * the owner's installation stands for another workspace the plan's owner is
 * in, it names that workspace, since one installation stands for one
 * workspace and moving the plan there is the one thing that reaches the
 * repository again: a plan written in a workspace before its repositories
 * came only from its own installation (#2524) is left that way.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { readPlan } from "@luke/database/models/plan-store";
import { REPOSITORY_UNREACHED } from "@luke/features/repository-reach-wire";
import type { GitHubRepository } from "@luke/service/core";
import { memberWorkspaceOnOwner } from "@luke/service/github/github-installations";
import {
  type HostedRefusal,
  hostedStoreOrUnavailable,
  repositoryNotReachable,
} from "@luke/service/http/http-effect";
import type { StoreFailure } from "@luke/service/http/store-failure";
import { Effect, Option, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { GitHubApp } from "../github/github-app.js";
import { githubReachOrRefusal, logWorkspaceReadFailure } from "../github/github-refusal.js";

/**
 * The workspace of a plan the account reaches, whose installation every
 * GitHub read of the plan's repository goes through; none where the account
 * reaches no such plan.
 */
export function planWorkspace(
  userId: string,
  planId: string,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> {
  return Effect.map(
    readPlan(userId, planId),
    Option.map((stored) => stored.plan.workspaceId),
  );
}

/**
 * The repository as GitHub spells it, where the workspace's installation
 * reaches it; refused as not reachable, with why, where it does not, as
 * GitHub unanswered where GitHub did not say, and as unavailable where the
 * store could not be read. `mover` is the account that may move the plan,
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
