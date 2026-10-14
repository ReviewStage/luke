/**
 * workspace-repository.ts -- a repository a workspace's plan may use: one the account reaches, through the workspace's installation where it has one.
 *
 * A plan names its repository at its start or in a change, and an agent is
 * started on the repository its plan names, so the rule is read at each of
 * those moments rather than once when the plan is written: an installation
 * connected or replaced after the plan named its repository still decides
 * whether an agent may start on it. A workspace with no installation, a
 * personal one among them, takes any repository the account reaches.
 */

import type { DatabaseServices } from "@sidecar/database/core/query";
import { Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { GitHubRepository } from "../core.js";
import { GitHubApp } from "../github/github-app.js";
import { githubUserReadOrRefusal } from "../github/github-refusal.js";
import { installationOfWorkspace } from "./github-installations.js";
import { HOSTED_REFUSAL, type HostedRefusal, hostedStoreOrUnavailable } from "./http-effect.js";

/**
 * The repository as GitHub spells it, where the account reaches it through
 * the App and, in the workspace of an installation, through that
 * installation, compared by GitHub's id rather than a login a rename moves.
 * One of another installation is refused as one not reached, since the
 * workspace does not reach it; the refusal otherwise names the account's
 * token or an outage.
 */
export const workspaceRepository = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  organizationId: string,
  repository: string,
): Effect.fn.Return<
  GitHubRepository,
  HostedRefusal,
  GitHubApp | HttpClient.HttpClient | DatabaseServices
> {
  const installation = yield* hostedStoreOrUnavailable(installationOfWorkspace(organizationId));
  const app = yield* GitHubApp;
  const reached = yield* githubUserReadOrRefusal(
    app.userRepositoryInstallation(userId, repository),
  );
  if (Option.isNone(reached)) return yield* Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
  if (Option.isSome(installation) && installation.value !== reached.value.installationId) {
    return yield* Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
  }
  return reached.value.repository;
});
