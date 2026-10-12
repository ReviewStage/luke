import {
  PLAN_FILE_REFUSAL,
  type PlanFileAnswer,
  type PlanFileRefusal,
  type PlanFileRequest,
} from "@sidecar/hosted/plan-wire";
import { Effect, Option } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { SqlClient } from "effect/unstable/sql";
import {
  GitHubApp,
  type GitHubRepositoryToken,
  type GitHubUserReadFailure,
} from "../github/github-app.js";
import { logGitHubReadFailure } from "../github/github-refusal.js";
import { readRepositoryFile } from "../github/repository-file.js";
import { type PlanStoreFailure, readPlan } from "./plan-store.js";
import {
  fileLines,
  holdsNul,
  isSecretFile,
  SHOWN_FILE_REFUSAL,
  type ShownFileRefusal,
  shownFileRefusal,
  shownLine,
} from "./shown-file.js";
import { logStoreFailure } from "./store-failure.js";

/**
 * plan-file.ts -- a whole file of a plan's repository for the Mac's File tab, read a window at a time from GitHub as it stands now.
 *
 * The Code tab shows the lines `show_code` read from the planning session's
 * checkout; the File tab opens the whole file they came from. Outside a
 * planning turn there is no handle on that session's sandbox, so the file is
 * read from GitHub instead, at the head of the repository's default branch,
 * through the same reach the checkout is made through: the plan is read under
 * the account first, so a plan another account owns reads as no plan, then
 * the Luke GitHub App confirms the account reaches the plan's repository and
 * mints a token for that one repository with contents read
 * (`github-app.ts`'s `repositoryReadToken`). The token is used for the one
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
 * since reads as missing, naming the branch GitHub found nothing on.
 */

/** Each reason the shared rule refuses a file, as the File tab hears it. */
const FILE_REFUSAL_OF = {
  [SHOWN_FILE_REFUSAL.SECRET]: PLAN_FILE_REFUSAL.SECRET,
  [SHOWN_FILE_REFUSAL.MISSING]: PLAN_FILE_REFUSAL.MISSING,
  [SHOWN_FILE_REFUSAL.NOT_TEXT]: PLAN_FILE_REFUSAL.NOT_TEXT,
} as const satisfies Record<ShownFileRefusal, PlanFileRefusal>;

/** Why the File tab's file is not shown, or its tree's folder not listed. */
export type PlanFileRefused = Extract<PlanFileAnswer, { readonly refusal: PlanFileRefusal }>;

export function refused(refusal: PlanFileRefusal): PlanFileRefused {
  return { refusal };
}

/** A failed reach as the File tab hears it, written down by its kind alone where it is an outage. */
function reachRefusal(failure: GitHubUserReadFailure): Effect.Effect<PlanFileRefused> {
  switch (failure._tag) {
    case "GitHubSignInRequired":
      return Effect.succeed(refused(PLAN_FILE_REFUSAL.SIGN_IN_REQUIRED));
    case "GitHubAppNotConfigured":
    case "GitHubUnavailable":
      return Effect.as(logGitHubReadFailure(failure), refused(PLAN_FILE_REFUSAL.UNAVAILABLE));
    default:
      return Effect.as(logStoreFailure(failure), refused(PLAN_FILE_REFUSAL.UNAVAILABLE));
  }
}

/**
 * The window of the file the request names, of the plan's repository as
 * GitHub holds it now, or why it is not shown; nothing where the account
 * owns no such plan.
 */
export function readPlanFile(
  userId: string,
  planId: string,
  request: PlanFileRequest,
): Effect.Effect<
  Option.Option<PlanFileAnswer>,
  PlanStoreFailure,
  SqlClient.SqlClient | HttpClient.HttpClient | GitHubApp
> {
  return Effect.gen(function* () {
    const stored = yield* readPlan(userId, planId);
    if (Option.isNone(stored)) return Option.none();
    const repository = stored.value.plan.repository;
    if (repository === null) return Option.some(refused(PLAN_FILE_REFUSAL.NO_REPOSITORY));
    if (isSecretFile(request.path)) return Option.some(refused(PLAN_FILE_REFUSAL.SECRET));
    const answer = yield* readWindow(userId, repository, request).pipe(
      Effect.catchTag("GitHubUnavailable", (failure) =>
        Effect.as(logGitHubReadFailure(failure), refused(PLAN_FILE_REFUSAL.UNAVAILABLE)),
      ),
    );
    return Option.some(answer);
  });
}

/** The App's reach of a plan's repository: its token and the repository as GitHub confirmed it, or why it was not reached. */
type PlanRepositoryReach =
  | { readonly reached: GitHubRepositoryToken }
  | { readonly refused: PlanFileRefused };

/**
 * The Luke GitHub App's reach of the plan's repository for the account: a
 * token for that one repository with contents read, and the repository as
 * GitHub confirmed it, or the refusal a failed reach answers. The File
 * tab's file and its tree's folders are both read through it.
 */
export const reachPlanRepository = /* @__PURE__ */ Effect.fn("web/reachPlanRepository")(function* (
  userId: string,
  repository: string,
) {
  const app = yield* GitHubApp;
  return yield* app.repositoryReadToken(userId, repository).pipe(
    Effect.map((token) =>
      Option.isSome(token)
        ? ({ reached: token.value } satisfies PlanRepositoryReach)
        : ({ refused: refused(PLAN_FILE_REFUSAL.NOT_REACHABLE) } satisfies PlanRepositoryReach),
    ),
    Effect.catch((failure) =>
      Effect.map(
        reachRefusal(failure),
        (answer) => ({ refused: answer }) satisfies PlanRepositoryReach,
      ),
    ),
  );
});

/** The window read through the App's reach, or the refusal the reach or the rule answers. */
const readWindow = /* @__PURE__ */ Effect.fn("web/planFileWindow")(function* (
  userId: string,
  repository: string,
  request: PlanFileRequest,
) {
  const reach = yield* reachPlanRepository(userId, repository);
  if ("refused" in reach) return reach.refused;
  const { token, repository: confirmed } = reach.reached;
  const file = yield* readRepositoryFile(token, confirmed, request.path);
  const content = file.regular ? file.content : undefined;
  const refusal = shownFileRefusal({
    path: request.path,
    regular: file.regular,
    bytes: file.regular ? file.bytes : 0,
    binary: content === undefined || holdsNul(content),
  });
  // Note that a file GitHub found nothing at names the branch it was looked
  // for on, because the snippet's checkout may hold a file that branch no
  // longer does; a link or a directory there is missing on no branch.
  if (refusal === SHOWN_FILE_REFUSAL.MISSING && !file.regular && file.notFound) {
    return {
      refusal: PLAN_FILE_REFUSAL.MISSING,
      branch: confirmed.defaultBranch,
    } satisfies PlanFileAnswer;
  }
  if (refusal !== undefined) return refused(FILE_REFUSAL_OF[refusal]);
  // A regular file GitHub carried no bytes of is past the bound, which the rule refused above.
  const text = new TextDecoder().decode(content);
  // Note that a raw read carries the file as it is, its lines uncut, because
  // a copy or a download of it must not lose what the screen cuts.
  if (request.raw === true) {
    return {
      text: { path: request.path, repository, branch: confirmed.defaultBranch, text },
    } satisfies PlanFileAnswer;
  }
  const all = fileLines(text);
  const lines = all.slice(request.firstLine - 1, request.lastLine).map(shownLine);
  return {
    file: {
      path: request.path,
      repository,
      branch: confirmed.defaultBranch,
      firstLine: request.firstLine,
      lineCount: all.length,
      lines,
    },
  } satisfies PlanFileAnswer;
});
