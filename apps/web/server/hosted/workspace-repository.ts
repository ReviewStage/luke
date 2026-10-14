/**
 * workspace-repository.ts -- a repository a workspace's plan may use: one the workspace's GitHub installation reaches.
 *
 * A plan names its repository at its start or in a change, and an agent is
 * started on the repository its plan names, so the rule is read at each of
 * those moments rather than once when the plan is written: an installation
 * disconnected or replaced after the plan named its repository still decides
 * whether an agent may start on it. A workspace with no installation
 * reaches no repository at all.
 */

import type { DatabaseServices } from "@sidecar/database/core/query";
import { readPlan } from "@sidecar/database/models/plan-store";
import { Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { GitHubRepository } from "../core.js";
import { GitHubApp } from "../github/github-app.js";
import { githubReadOrRefusal } from "../github/github-refusal.js";
import { HOSTED_REFUSAL, type HostedRefusal } from "./http-effect.js";
import type { StoreFailure } from "./store-failure.js";

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
 * reaches it; refused as not reachable where it does not, and as
 * unavailable where GitHub or the store could not be read.
 */
export const workspaceRepository = /* @__PURE__ */ Effect.fnUntraced(function* (
  organizationId: string,
  repository: string,
): Effect.fn.Return<
  GitHubRepository,
  HostedRefusal,
  GitHubApp | HttpClient.HttpClient | DatabaseServices
> {
  const app = yield* GitHubApp;
  const reached = yield* githubReadOrRefusal(app.workspaceRepository(organizationId, repository));
  if (Option.isNone(reached)) return yield* Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
  return reached.value;
});
