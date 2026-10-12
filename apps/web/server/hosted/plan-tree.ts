import {
  PLAN_FILE_REFUSAL,
  PLAN_TREE_BOUNDS,
  PLAN_TREE_ENTRY,
  type PlanTreeAnswer,
  type PlanTreeRequest,
} from "@sidecar/hosted/plan-wire";
import { Effect, Option } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { SqlClient } from "effect/unstable/sql";
import type { GitHubApp } from "../github/github-app.js";
import { logGitHubReadFailure } from "../github/github-refusal.js";
import { GIT_ENTRY, readRepositoryFolder } from "../github/repository-folder.js";
import { reachPlanRepository, refused } from "./plan-file.js";
import { type PlanStoreFailure, readPlan } from "./plan-store.js";
import { isSecretFile } from "./shown-file.js";

/**
 * plan-tree.ts -- one folder of a plan's repository for the File tab's tree, listed from GitHub as it stands now.
 *
 * The tree beside a File tab browses the repository its file was read
 * from, a folder at a time as the developer opens one, so it is listed
 * exactly where and as the file is read (`plan-file.ts`): the plan is read
 * under the account first, so a plan another account owns reads as no
 * plan, then the Luke GitHub App confirms the account reaches the plan's
 * repository and mints a token for that one repository, used for the one
 * listing and going nowhere else; the listing is of the head of the
 * repository's default branch, and names it. A secret file is listed by
 * its name, as GitHub and every editor list it, because the rule
 * `show_code` is held to (`shown-file.ts`) keeps a secret file's contents
 * off the screen, and the File tab refuses to read one when it is opened;
 * a folder named as a secret file is, or one inside it, is not listed, so
 * nothing held inside one is named either. A link and a submodule are listed as files,
 * which the File tab says are no regular file when they are opened.
 */

/** Whether a folder is, or stands inside, one whose name is a secret file's. */
function withinSecret(path: string): boolean {
  return path.split("/").some(isSecretFile);
}

/**
 * The folder the request names, of the plan's repository as GitHub holds
 * it now, or why it is not listed; nothing where the account owns no such
 * plan.
 */
export function readPlanTree(
  userId: string,
  planId: string,
  request: PlanTreeRequest,
): Effect.Effect<
  Option.Option<PlanTreeAnswer>,
  PlanStoreFailure,
  SqlClient.SqlClient | HttpClient.HttpClient | GitHubApp
> {
  return Effect.gen(function* () {
    const stored = yield* readPlan(userId, planId);
    if (Option.isNone(stored)) return Option.none();
    const repository = stored.value.plan.repository;
    if (repository === null) return Option.some(refused(PLAN_FILE_REFUSAL.NO_REPOSITORY));
    if (withinSecret(request.path)) return Option.some(refused(PLAN_FILE_REFUSAL.SECRET));
    const answer = yield* readFolder(userId, repository, request).pipe(
      Effect.catchTag("GitHubUnavailable", (failure) =>
        Effect.as(logGitHubReadFailure(failure), refused(PLAN_FILE_REFUSAL.UNAVAILABLE)),
      ),
    );
    return Option.some(answer);
  });
}

/** The folder listed through the App's reach, or the refusal the reach answers. */
const readFolder = /* @__PURE__ */ Effect.fn("web/planTreeFolder")(function* (
  userId: string,
  repository: string,
  request: PlanTreeRequest,
) {
  const reach = yield* reachPlanRepository(userId, repository);
  if ("refused" in reach) return reach.refused;
  const { token, repository: confirmed } = reach.reached;
  const folder = yield* readRepositoryFolder(token, confirmed, request.path);
  if (!folder.found) {
    return {
      refusal: PLAN_FILE_REFUSAL.MISSING,
      branch: confirmed.defaultBranch,
    } satisfies PlanTreeAnswer;
  }
  const entries = folder.entries.slice(0, PLAN_TREE_BOUNDS.MAX_ENTRIES).map((entry) => ({
    name: entry.name,
    kind: entry.type === GIT_ENTRY.TREE ? PLAN_TREE_ENTRY.FOLDER : PLAN_TREE_ENTRY.FILE,
  }));
  return {
    folder: {
      path: request.path,
      repository,
      branch: confirmed.defaultBranch,
      entries,
      truncated: folder.truncated || folder.entries.length > PLAN_TREE_BOUNDS.MAX_ENTRIES,
    },
  } satisfies PlanTreeAnswer;
});
