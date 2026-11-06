import type { DatabaseServices } from "@repo/database/core/query";
import {
  type Agent,
  readAgent,
  readVisibleAgentWorkspace,
} from "@repo/database/models/agent-store";
import { readTaskWorkspace } from "@repo/database/models/task-store";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { REPOSITORY_UNREACHED } from "@repo/features/repository-reach-wire";
import { Effect, Option, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type HostedRefusal,
  hostedStoreOrUnavailable,
  repositoryNotReachable,
} from "../http/http-effect.js";
import type { StoreFailure } from "../http/store-failure.js";
import { GitHubApp, type ReachedRepository } from "./github-app.js";
import { memberWorkspaceOnOwner } from "./github-installations.js";
import { githubReachOrRefusal, logWorkspaceReadFailure } from "./github-refusal.js";

export function taskWorkspace(
  userId: string,
  taskId: string,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> {
  return readTaskWorkspace(userId, taskId);
}

export function agentWorkspace(
  userId: string,
  agent: Pick<Agent, "id">,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> {
  return readVisibleAgentWorkspace(userId, agent.id);
}

export function ownAgentWorkspace(
  userId: string,
  agent: Pick<Agent, "id">,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> {
  return Effect.map(
    readAgent(userId, agent.id),
    Option.map((found) => found.organizationId),
  );
}

export function agentMember(agent: Pick<Agent, "githubAccess" | "userId">): string | undefined {
  return agent.githubAccess === GITHUB_ACCESS.TOKEN ? agent.userId : undefined;
}

export const workspaceRepository = /* @__PURE__ */ Effect.fnUntraced(function* (
  organizationId: string,
  repository: string,
  member: string | undefined,
  mover?: string,
): Effect.fn.Return<
  ReachedRepository,
  HostedRefusal,
  GitHubApp | HttpClient.HttpClient | DatabaseServices
> {
  const app = yield* GitHubApp;
  const reach = yield* githubReachOrRefusal(
    app.repositoryReach(organizationId, repository, member),
  );
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
  const reachedThere =
    Option.isSome(elsewhere) &&
    Result.isSuccess(
      yield* app.repositoryReach(elsewhere.value.id, repository, undefined).pipe(
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
