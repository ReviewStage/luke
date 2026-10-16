/**
 * repository-folder.ts -- one folder of a repository as GitHub holds it on a branch, listed through the git trees API on a token the App minted for that repository alone.
 *
 * The read answers facts, never a decision: whether a folder stands at the
 * path on the branch, and each entry's name and what git holds it as, which
 * `tasks/task-tree.ts` decides on. The folder is named to GitHub as the
 * tree-ish `<branch>:<path>`, the root as `<branch>:`, so the listing is of
 * the branch as it stands at the read, as `repository-file.ts` reads a file;
 * a path GitHub would resolve outside the repository (an empty, `.`, or `..`
 * segment) is asked nothing and reads as no folder. Git trees rather than
 * the contents API, because the contents API stops a folder's listing at a
 * thousand entries without saying so, and git trees says when it cut one.
 * Asked recursively, git trees lists everything under the folder in the one
 * read, each entry by its path from the folder, and says when it cut that
 * short too (past a hundred thousand entries or seven megabytes).
 * The request composes over the App module's own kit, so the token leaves
 * this module no more than it leaves that one.
 */

import { Effect, type Redacted, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import {
  GITHUB_FAILURE,
  GITHUB_HTTP_STATUS,
  GitHubUnavailable,
  githubRead,
  readBody,
} from "./github-app.js";
import { repositorySegments } from "./repository-file.js";

/** What git holds an entry of a tree as: a file or a link (a blob), a folder (a tree), or a submodule (a commit). */
export const GIT_ENTRY = {
  BLOB: "blob",
  TREE: "tree",
  COMMIT: "commit",
} as const;

type GitEntry = (typeof GIT_ENTRY)[keyof typeof GIT_ENTRY];

/** What GitHub answers for a tree: each entry by its name within the tree, and whether it cut the listing short. */
const TreeSchema = Schema.Struct({
  tree: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      type: Schema.Literals(Object.values(GIT_ENTRY)),
    }),
  ),
  truncated: Schema.Boolean,
});

/** One entry of a folder: its name, or its path from the folder in a recursive listing, and what git holds it as. */
interface RepositoryEntry {
  readonly name: string;
  readonly type: GitEntry;
}

/** A folder as GitHub holds it: none at the path on the branch, or its entries and whether GitHub cut them short. */
export type RepositoryFolder =
  | { readonly found: false }
  | {
      readonly found: true;
      readonly entries: readonly RepositoryEntry[];
      readonly truncated: boolean;
    };

const NO_FOLDER: RepositoryFolder = { found: false };

/**
 * The repository's folder at the path on the branch named, the root for an
 * empty path, as the git trees API lists it: its own entries, or with
 * `recursive` everything under it, each named by its path from the folder.
 */
export function readRepositoryFolder(
  token: Redacted.Redacted,
  repository: { readonly fullName: string; readonly defaultBranch: string },
  path: string,
  recursive = false,
): Effect.Effect<RepositoryFolder, GitHubUnavailable, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    if (path !== "" && repositorySegments(path) === undefined) return NO_FOLDER;
    const treeish = encodeURIComponent(`${repository.defaultBranch}:${path}`);
    const listing = `/repos/${repository.fullName}/git/trees/${treeish}`;
    const request = githubRead(recursive ? `${listing}?recursive=1` : listing, token);
    const client = yield* HttpClient.HttpClient;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const response = yield* Effect.mapError(
          client.execute(request),
          (error) =>
            new GitHubUnavailable({
              reason: GITHUB_FAILURE.TRANSPORT,
              status: error.response?.status,
            }),
        );
        // Note that GitHub answers a path naming a file as unprocessable,
        // since `<branch>:<file>` is a blob and no tree.
        if (
          response.status === GITHUB_HTTP_STATUS.NOT_FOUND ||
          response.status === GITHUB_HTTP_STATUS.UNPROCESSABLE
        ) {
          return NO_FOLDER;
        }
        const answer = yield* readBody(response, TreeSchema);
        return {
          found: true,
          entries: answer.tree.map((entry) => ({ name: entry.path, type: entry.type })),
          truncated: answer.truncated,
        } satisfies RepositoryFolder;
      }),
    );
  });
}
