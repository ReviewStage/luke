import type { DatabaseServices } from "@luke/database/core/query";
import { readTask, type TaskStoreFailure } from "@luke/database/models/task-store";
import {
  isSecretFile,
  TASK_FILE_REFUSAL,
  type TaskFileAnswer,
  type TaskFileRefusal,
  type TaskFileRequest,
} from "@luke/features/task-wire";
import { Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  GitHubApp,
  type GitHubRepositoryToken,
  type GitHubWorkspaceReadFailure,
  markRefusedToken,
} from "../github/github-app.js";
import { logGitHubReadFailure, logWorkspaceReadFailure } from "../github/github-refusal.js";
import { readBranchHead, readRepositoryFile } from "../github/repository-file.js";
import {
  fileLines,
  holdsNul,
  SHOWN_FILE_REFUSAL,
  type ShownFileRefusal,
  shownFileRefusal,
  shownLine,
} from "./shown-file.js";

/**
 * task-file.ts -- a whole file of a task's repository for the Mac's File tab, read a window at a time from GitHub as it stands now or at a commit.
 *
 * The Code tab shows the lines `show_code` read from the brain session's
 * checkout; the File tab opens the whole file they came from. Outside a
 * brain turn there is no handle on that session's sandbox, so the file is
 * read from GitHub instead, at the head of the repository's default branch,
 * through the same reach the checkout is made through: the task is read under
 * the account first, so a task another account owns reads as no task, then
 * the Luke GitHub App confirms the installation of the task's workspace
 * reaches the task's repository and mints a token for that one repository
 * with contents read (`github-app.ts`'s `repositoryReadToken`). The token is used for the one
 * read and goes nowhere else: not into the answer, a log line, or a trace.
 * What is shown is decided by the rule `show_code` is held to
 * (`shown-file.ts`), so a secret file is refused before anything is asked of
 * GitHub, and a link, a directory, a file too large, or one that is not text
 * reads as refused; each line travels cut as `show_code` cuts it. A raw
 * read, which a copy or a download of the file asks, carries the file's
 * whole text instead, its lines uncut, held to the same rule and the same
 * bound on the file's size.
 *
 * Note that GitHub's head may differ from the checkout the snippet was read
 * from, whose clone is the default branch as it stood when the session first
 * read the repository: the window is the file as it is now, and a file gone
 * since reads as missing, naming the branch GitHub found nothing on. A read
 * that names a commit, as an inbox item's code reference does so that the
 * lines it points at never move, is read at that commit instead, through the
 * same reach, and names the commit where it would name the branch.
 */

/** Each reason the shared rule refuses a file, as the File tab hears it. */
const FILE_REFUSAL_OF = {
  [SHOWN_FILE_REFUSAL.SECRET]: TASK_FILE_REFUSAL.SECRET,
  [SHOWN_FILE_REFUSAL.MISSING]: TASK_FILE_REFUSAL.MISSING,
  [SHOWN_FILE_REFUSAL.NOT_TEXT]: TASK_FILE_REFUSAL.NOT_TEXT,
} as const satisfies Record<ShownFileRefusal, TaskFileRefusal>;

/** Why the File tab's file is not shown, or its tree's folder not listed. */
export type TaskFileRefused = Extract<TaskFileAnswer, { readonly refusal: TaskFileRefusal }>;

export function refused(refusal: TaskFileRefusal): TaskFileRefused {
  return { refusal };
}

/** A failed reach as the File tab hears it: an outage, written down by its kind alone. */
function reachRefusal(failure: GitHubWorkspaceReadFailure): Effect.Effect<TaskFileRefused> {
  return Effect.as(logWorkspaceReadFailure(failure), refused(TASK_FILE_REFUSAL.UNAVAILABLE));
}

/**
 * The window of the file the request names, of the task's repository as
 * GitHub holds it now or at the commit it names, or why it is not shown; nothing where the account
 * owns no such task.
 */
export function readTaskFile(
  userId: string,
  taskId: string,
  request: TaskFileRequest,
): Effect.Effect<
  Option.Option<TaskFileAnswer>,
  TaskStoreFailure,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  return Effect.gen(function* () {
    const stored = yield* readTask(userId, taskId);
    if (Option.isNone(stored)) return Option.none();
    const repository = stored.value.task.repository;
    if (repository === null) return Option.some(refused(TASK_FILE_REFUSAL.NO_REPOSITORY));
    if (isSecretFile(request.path)) return Option.some(refused(TASK_FILE_REFUSAL.SECRET));
    const answer = yield* readWindow(
      stored.value.task.workspaceId,
      repository,
      userId,
      request,
    ).pipe(
      Effect.catchTag("GitHubUnavailable", (failure) =>
        Effect.as(logGitHubReadFailure(failure), refused(TASK_FILE_REFUSAL.UNAVAILABLE)),
      ),
    );
    return Option.some(answer);
  });
}

/** The App's reach of a task's repository: its token and the repository as GitHub confirmed it, or why it was not reached. */
type TaskRepositoryReach =
  | { readonly reached: GitHubRepositoryToken }
  | { readonly refused: TaskFileRefused };

/**
 * The Luke GitHub App's reach of the task's repository through the
 * installation of the task's workspace: a token for that one repository
 * with contents read, and the repository as GitHub confirmed it, or the
 * refusal a failed reach answers; or, where no installation reaches it,
 * the member's own token. The File tab's file and its tree's folders are
 * both read through it.
 */
export const reachTaskRepository = /* @__PURE__ */ Effect.fn("web/reachTaskRepository")(function* (
  organizationId: string,
  repository: string,
  member: string,
) {
  const app = yield* GitHubApp;
  return yield* app.repositoryReadToken(organizationId, repository, member).pipe(
    Effect.map((token) =>
      Option.isSome(token)
        ? ({ reached: token.value } satisfies TaskRepositoryReach)
        : ({ refused: refused(TASK_FILE_REFUSAL.NOT_REACHABLE) } satisfies TaskRepositoryReach),
    ),
    Effect.catch((failure) =>
      Effect.map(
        reachRefusal(failure),
        (answer) => ({ refused: answer }) satisfies TaskRepositoryReach,
      ),
    ),
  );
});

/**
 * A file's bytes as text that writes back to the same bytes: a leading
 * byte-order mark kept, and nothing where the bytes are not UTF-8, since a
 * decoder's replacement would save a file other than the one GitHub holds.
 */
function rawText(content: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }).decode(content);
  } catch {
    return undefined;
  }
}

/** The window read through the App's reach, or the refusal the reach or the rule answers. */
const readWindow = /* @__PURE__ */ Effect.fn("web/taskFileWindow")(function* (
  organizationId: string,
  repository: string,
  member: string,
  request: TaskFileRequest,
) {
  const reach = yield* reachTaskRepository(organizationId, repository, member);
  if ("refused" in reach) return reach.refused;
  const { token, repository: confirmed, access } = reach.reached;
  const branch = request.ref ?? confirmed.defaultBranch;
  // Note that a read of the default branch reads at the commit its head
  // stands at, and names it, so lines picked from the read are pinned to the
  // commit they were read at; a head GitHub did not name leaves the read on
  // the branch, naming none, since the file is still worth showing.
  const commit =
    request.ref ??
    (yield* readBranchHead(token, confirmed, confirmed.defaultBranch).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
    ));
  const at = commit ?? branch;
  const file = yield* readRepositoryFile(token, confirmed, at, request.path).pipe(
    markRefusedToken(access),
  );
  const content = file.regular ? file.content : undefined;
  const refusal = shownFileRefusal({
    path: request.path,
    regular: file.regular,
    bytes: file.regular ? file.bytes : 0,
    binary: content === undefined || holdsNul(content),
  });
  // Note that a file GitHub found nothing at names the branch or the commit
  // it was looked for at, because the snippet's checkout may hold a file that
  // branch no longer does; a link or a directory there is missing on no branch.
  if (refusal === SHOWN_FILE_REFUSAL.MISSING && !file.regular && file.notFound) {
    return { refusal: TASK_FILE_REFUSAL.MISSING, branch } satisfies TaskFileAnswer;
  }
  if (refusal !== undefined) return refused(FILE_REFUSAL_OF[refusal]);
  // A regular file GitHub carried no bytes of is past the bound, which the rule refused above.
  // Note that a raw read carries the file as it is, its lines uncut, because
  // a copy or a download of it must not lose what the screen cuts.
  if (request.raw === true) {
    const raw = content === undefined ? undefined : rawText(content);
    if (raw === undefined) return refused(TASK_FILE_REFUSAL.NOT_TEXT);
    return {
      text: { path: request.path, repository, branch, text: raw },
    } satisfies TaskFileAnswer;
  }
  const all = fileLines(new TextDecoder().decode(content));
  const lines = all.slice(request.firstLine - 1, request.lastLine).map(shownLine);
  const window = {
    path: request.path,
    repository,
    branch,
    firstLine: request.firstLine,
    lineCount: all.length,
    lines,
  };
  return { file: commit === undefined ? window : { ...window, commit } } satisfies TaskFileAnswer;
});
