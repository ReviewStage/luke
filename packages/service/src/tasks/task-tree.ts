import type { DatabaseServices } from "@luke/database/core/query";
import { readTask, type TaskStoreFailure } from "@luke/database/models/task-store";
import {
  CODE_PATH_MAX_CHARS,
  isSecretFile,
  TASK_FILE_REFUSAL,
  TASK_TREE_BOUNDS,
  TASK_TREE_ENTRY,
  type TaskTreeAnswer,
  type TaskTreeRequest,
} from "@luke/features/task-wire";
import { Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { GitHubApp } from "../github/github-app.js";
import { logGitHubReadFailure } from "../github/github-refusal.js";
import { GIT_ENTRY, readRepositoryFolder } from "../github/repository-folder.js";
import { reachTaskRepository, refused } from "./task-file.js";

/**
 * task-tree.ts -- one folder of a task's repository for the File tab's tree, listed from GitHub as it stands now.
 *
 * The tree beside a File tab browses the repository its file was read
 * from, a folder at a time as the developer opens one, so it is listed
 * exactly where and as the file is read (`task-file.ts`): the task is read
 * under the account first, so a task another account owns reads as no
 * task, then the Luke GitHub App confirms the account reaches the task's
 * repository and mints a token for that one repository, used for the one
 * listing and going nowhere else; the listing is of the head of the
 * repository's default branch, and names it. A secret file is listed by
 * its name, as GitHub and every editor list it, because the rule
 * `show_code` is held to (`shown-file.ts`) keeps a secret file's contents
 * off the screen, and the File tab refuses to read one when it is opened;
 * a folder named as a secret file is, or one inside it, is not listed, so
 * nothing held inside one is named either. A link and a submodule are listed as files,
 * which the File tab says are no regular file when they are opened.
 *
 * Asked recursively, the folder is listed whole in one read, which is what
 * the tree's search reads: every entry under it, by its path from the
 * folder, held to the same rule, so an entry inside a folder named as a
 * secret file is left out though the folder itself is named, and cut at a
 * bound of its own, larger than one folder's, saying so where it was cut.
 * An entry whose path is longer than the wire carries is left out too, the
 * listing saying it was cut, since it is then not the whole repository.
 */

/** Whether a folder is, or stands inside, one whose name is a secret file's. */
function withinSecret(path: string): boolean {
  return path.split("/").some(isSecretFile);
}

/** Whether an entry of a recursive listing stands inside a folder whose name is a secret file's: its name alone may be one. */
function insideSecret(path: string): boolean {
  return withinSecret(path.split("/").slice(0, -1).join("/"));
}

/**
 * The folder the request names, of the task's repository as GitHub holds
 * it now, or why it is not listed; nothing where the account owns no such
 * task.
 */
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
    const stored = yield* readTask(userId, taskId);
    if (Option.isNone(stored)) return Option.none();
    const repository = stored.value.task.repository;
    if (repository === null) return Option.some(refused(TASK_FILE_REFUSAL.NO_REPOSITORY));
    return Option.some(
      yield* readRepositoryTree(stored.value.task.workspaceId, repository, request),
    );
  });
}

/**
 * The folder the request names, of a repository the workspace's
 * installation reaches, as GitHub holds it now, or why it is not listed: a
 * plan's tree read by the place its plan names, and the read of a place no
 * plan names, such as an agent an automation started, whose caller has
 * already confirmed the account is a member of the workspace.
 */
export function readRepositoryTree(
  workspaceId: string,
  repository: string,
  request: TaskTreeRequest,
): Effect.Effect<TaskTreeAnswer, never, DatabaseServices | HttpClient.HttpClient | GitHubApp> {
  if (withinSecret(request.path)) return Effect.succeed(refused(TASK_FILE_REFUSAL.SECRET));
  return readFolder(workspaceId, repository, request).pipe(
    Effect.catchTag("GitHubUnavailable", (failure) =>
      Effect.as(logGitHubReadFailure(failure), refused(TASK_FILE_REFUSAL.UNAVAILABLE)),
    ),
  );
}

/** The folder listed through the App's reach, or the refusal the reach answers. */
const readFolder = /* @__PURE__ */ Effect.fn("web/taskTreeFolder")(function* (
  organizationId: string,
  repository: string,
  request: TaskTreeRequest,
) {
  const reach = yield* reachTaskRepository(organizationId, repository);
  if ("refused" in reach) return reach.refused;
  const { token, repository: confirmed } = reach.reached;
  const recursive = request.recursive === true;
  const folder = yield* readRepositoryFolder(token, confirmed, request.path, recursive);
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
