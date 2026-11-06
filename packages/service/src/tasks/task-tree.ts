import type { DatabaseServices } from "@repo/database/core/query";
import { readTaskHeader, type TaskStoreFailure } from "@repo/database/models/task-store";
import {
  CODE_PATH_MAX_CHARS,
  isSecretFile,
  TASK_FILE_REFUSAL,
  TASK_TREE_BOUNDS,
  TASK_TREE_ENTRY,
  type TaskTreeAnswer,
  type TaskTreeRequest,
} from "@repo/features/task-wire";
import { Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { type GitHubApp, markRefusedToken } from "../github/github-app.js";
import { logGitHubReadFailure } from "../github/github-refusal.js";
import { GIT_ENTRY, readRepositoryFolder } from "../github/repository-folder.js";
import { reachTaskRepository, refused } from "./task-file.js";

function withinSecret(path: string): boolean {
  return path.split("/").some(isSecretFile);
}

function insideSecret(path: string): boolean {
  return withinSecret(path.split("/").slice(0, -1).join("/"));
}

export function readTaskTree(
  userId: string,
  taskId: string,
  request: TaskTreeRequest,
): Effect.Effect<
  Option.Option<TaskTreeAnswer>,
  TaskStoreFailure,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  return Effect.gen(function* () {
    const stored = yield* readTaskHeader(userId, taskId);
    if (Option.isNone(stored)) return Option.none();
    const repository = stored.value.repository;
    if (repository === null) return Option.some(refused(TASK_FILE_REFUSAL.NO_REPOSITORY));
    return Option.some(
      yield* readRepositoryTree(stored.value.workspaceId, repository, userId, request),
    );
  });
}

export function readRepositoryTree(
  workspaceId: string,
  repository: string,
  member: string,
  request: TaskTreeRequest,
): Effect.Effect<TaskTreeAnswer, never, DatabaseServices | HttpClient.HttpClient | GitHubApp> {
  if (withinSecret(request.path)) return Effect.succeed(refused(TASK_FILE_REFUSAL.SECRET));
  return readFolder(workspaceId, repository, member, request).pipe(
    Effect.catchTag("GitHubUnavailable", (failure) =>
      Effect.as(logGitHubReadFailure(failure), refused(TASK_FILE_REFUSAL.UNAVAILABLE)),
    ),
  );
}

const readFolder = /* @__PURE__ */ Effect.fn("web/taskTreeFolder")(function* (
  organizationId: string,
  repository: string,
  member: string,
  request: TaskTreeRequest,
) {
  const reach = yield* reachTaskRepository(organizationId, repository, member);
  if ("refused" in reach) return reach.refused;
  const { token, repository: confirmed, access } = reach.reached;
  const recursive = request.recursive === true;
  const folder = yield* readRepositoryFolder(token, confirmed, request.path, recursive).pipe(
    markRefusedToken(access),
  );
  if (!folder.found) {
    return {
      refusal: TASK_FILE_REFUSAL.MISSING,
      branch: confirmed.defaultBranch,
    } satisfies TaskTreeAnswer;
  }
  const bound = recursive ? TASK_TREE_BOUNDS.MAX_RECURSIVE_ENTRIES : TASK_TREE_BOUNDS.MAX_ENTRIES;
  const shown = recursive
    ? folder.entries.filter((entry) => !insideSecret(entry.name))
    : folder.entries;
  const listed = shown.filter((entry) => entry.name.length <= CODE_PATH_MAX_CHARS);
  const entries = listed.slice(0, bound).map((entry) => ({
    name: entry.name,
    kind: entry.type === GIT_ENTRY.TREE ? TASK_TREE_ENTRY.FOLDER : TASK_TREE_ENTRY.FILE,
  }));
  return {
    folder: {
      path: request.path,
      repository,
      branch: confirmed.defaultBranch,
      entries,
      truncated: folder.truncated || listed.length < shown.length || listed.length > bound,
    },
  } satisfies TaskTreeAnswer;
});
