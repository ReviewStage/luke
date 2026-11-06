import { Effect, type Redacted, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  GITHUB_HTTP_STATUS,
  type GitHubUnavailable,
  githubRead,
  readBody,
  send,
} from "./github-app.js";
import { repositorySegments } from "./repository-file.js";

export const GIT_ENTRY = {
  BLOB: "blob",
  TREE: "tree",
  COMMIT: "commit",
} as const;

const LINK_MODE = "120000";

type GitEntry = (typeof GIT_ENTRY)[keyof typeof GIT_ENTRY];

const TreeSchema = Schema.Struct({
  sha: Schema.optionalKey(Schema.String),
  tree: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      type: Schema.Literals(Object.values(GIT_ENTRY)),
      mode: Schema.optionalKey(Schema.String),
      size: Schema.optionalKey(Schema.Number),
    }),
  ),
  truncated: Schema.Boolean,
});

interface RepositoryEntry {
  readonly name: string;
  readonly type: GitEntry;
  readonly link?: true;
  readonly size?: number;
}

export type RepositoryFolder =
  | { readonly found: false }
  | {
      readonly found: true;
      readonly entries: readonly RepositoryEntry[];
      readonly truncated: boolean;
      readonly sha?: string;
    };

const NO_FOLDER: RepositoryFolder = { found: false };

export function readRepositoryFolder(
  token: Redacted.Redacted | null,
  repository: { readonly fullName: string; readonly defaultBranch: string },
  path: string,
  recursive = false,
): Effect.Effect<RepositoryFolder, GitHubUnavailable, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    if (path !== "" && repositorySegments(path) === undefined) return NO_FOLDER;
    const treeish = encodeURIComponent(`${repository.defaultBranch}:${path}`);
    const listing = `/repos/${repository.fullName}/git/trees/${treeish}`;
    const request = githubRead(recursive ? `${listing}?recursive=1` : listing, token);
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const response = yield* send(request);
        if (
          response.status === GITHUB_HTTP_STATUS.NOT_FOUND ||
          response.status === GITHUB_HTTP_STATUS.UNPROCESSABLE
        ) {
          return NO_FOLDER;
        }
        const answer = yield* readBody(response, TreeSchema);
        return {
          found: true,
          entries: answer.tree.map((entry) => ({
            name: entry.path,
            type: entry.type,
            ...(entry.mode === LINK_MODE ? { link: true as const } : undefined),
            ...(entry.size === undefined ? undefined : { size: entry.size }),
          })),
          truncated: answer.truncated,
          ...(answer.sha === undefined ? undefined : { sha: answer.sha }),
        } satisfies RepositoryFolder;
      }),
    );
  });
}
