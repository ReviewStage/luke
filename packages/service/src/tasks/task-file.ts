import type { DatabaseServices } from "@repo/database/core/query";
import { readTaskHeader, type TaskStoreFailure } from "@repo/database/models/task-store";
import {
  isSecretFile,
  TASK_FILE_REFUSAL,
  type TaskFileAnswer,
  type TaskFileRefusal,
  type TaskFileRequest,
} from "@repo/features/task-wire";
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

const FILE_REFUSAL_OF = {
  [SHOWN_FILE_REFUSAL.SECRET]: TASK_FILE_REFUSAL.SECRET,
  [SHOWN_FILE_REFUSAL.MISSING]: TASK_FILE_REFUSAL.MISSING,
  [SHOWN_FILE_REFUSAL.NOT_TEXT]: TASK_FILE_REFUSAL.NOT_TEXT,
} as const satisfies Record<ShownFileRefusal, TaskFileRefusal>;

export type TaskFileRefused = Extract<TaskFileAnswer, { readonly refusal: TaskFileRefusal }>;

export function refused(refusal: TaskFileRefusal): TaskFileRefused {
  return { refusal };
}

function reachRefusal(failure: GitHubWorkspaceReadFailure): Effect.Effect<TaskFileRefused> {
  return Effect.as(logWorkspaceReadFailure(failure), refused(TASK_FILE_REFUSAL.UNAVAILABLE));
}

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
    const stored = yield* readTaskHeader(userId, taskId);
    if (Option.isNone(stored)) return Option.none();
    const repository = stored.value.repository;
    if (repository === null) return Option.some(refused(TASK_FILE_REFUSAL.NO_REPOSITORY));
    return Option.some(
      yield* readRepositoryFileWindow(stored.value.workspaceId, repository, userId, request),
    );
  });
}

export function readRepositoryFileWindow(
  workspaceId: string,
  repository: string,
  member: string,
  request: TaskFileRequest,
): Effect.Effect<TaskFileAnswer, never, DatabaseServices | HttpClient.HttpClient | GitHubApp> {
  if (isSecretFile(request.path)) return Effect.succeed(refused(TASK_FILE_REFUSAL.SECRET));
  return readWindow(workspaceId, repository, member, request).pipe(
    Effect.catchTag("GitHubUnavailable", (failure) =>
      Effect.as(logGitHubReadFailure(failure), refused(TASK_FILE_REFUSAL.UNAVAILABLE)),
    ),
  );
}

type TaskRepositoryReach =
  | { readonly reached: GitHubRepositoryToken }
  | { readonly refused: TaskFileRefused };

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

function rawText(content: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }).decode(content);
  } catch {
    return undefined;
  }
}

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
  if (refusal === SHOWN_FILE_REFUSAL.MISSING && !file.regular && file.notFound) {
    return { refusal: TASK_FILE_REFUSAL.MISSING, branch } satisfies TaskFileAnswer;
  }
  if (refusal !== undefined) return refused(FILE_REFUSAL_OF[refusal]);
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
