/**
 * repository-file.ts -- one file of a repository as GitHub holds it on a branch, read through the contents API on a token the App minted for that repository alone.
 *
 * The read answers facts and bytes, never a decision: whether the path is a
 * regular file of the tree, its size, and its bytes where GitHub carries
 * them, which `hosted/shown-file.ts` decides on exactly as it decides on the
 * planning checkout's probe. A path GitHub would resolve outside the
 * repository's contents (an empty, `.`, or `..` segment, which a URL folds
 * away) is asked nothing and reads as no file. A link, a directory, or a
 * submodule is no regular file. The request composes over the App
 * module's own kit (`githubRead`, `readBody`), so the token leaves this
 * module no more than it leaves that one.
 */

import { Effect, Encoding, type Redacted, Result, Schema } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import {
  GITHUB_FAILURE,
  GITHUB_HTTP_STATUS,
  GitHubUnavailable,
  githubRead,
  readBody,
} from "./github-app.js";

/** What GitHub answers for a regular file: its size, and its bytes in base64 where it carries them (up to a megabyte). */
const FileContentsSchema = Schema.Struct({
  type: Schema.Literal("file"),
  size: Schema.Number,
  encoding: Schema.String,
  content: Schema.String,
});

/** Any other answer of the contents API: a link, a submodule, or a directory's listing. */
const OtherContentsSchema = Schema.Union([
  Schema.Struct({ type: Schema.String }),
  Schema.Array(Schema.Unknown),
]);

const ContentsSchema = Schema.Union([FileContentsSchema, OtherContentsSchema]);

/** The encoding GitHub carries a file's bytes in. */
const BASE64 = "base64";

/**
 * One file of the tree as GitHub holds it: no regular file at the path, and
 * whether that is because GitHub found nothing there on the branch; or its
 * size and bytes, bytes absent where GitHub carries none.
 */
export type RepositoryFile =
  | { readonly regular: false; readonly notFound: boolean }
  | { readonly regular: true; readonly bytes: number; readonly content: Uint8Array | undefined };

/** Nothing at the path on the branch, as GitHub answered. */
const NOT_FOUND: RepositoryFile = { regular: false, notFound: true };

/** Something at the path that is no regular file, or a path nothing was asked of. */
const NOT_REGULAR: RepositoryFile = { regular: false, notFound: false };

/** The path's segments encoded for the URL, or nothing where a segment would leave the repository's contents. */
function contentsPath(path: string): string | undefined {
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return undefined;
  }
  return segments.map(encodeURIComponent).join("/");
}

/** The repository's file at the path on the branch named, as the contents API holds it. */
export function readRepositoryFile(
  token: Redacted.Redacted,
  repository: { readonly fullName: string; readonly defaultBranch: string },
  path: string,
): Effect.Effect<RepositoryFile, GitHubUnavailable, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const encoded = contentsPath(path);
    if (encoded === undefined) return NOT_REGULAR;
    const request = githubRead(`/repos/${repository.fullName}/contents/${encoded}`, token).pipe(
      HttpClientRequest.setUrlParams({ ref: repository.defaultBranch }),
    );
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
        if (response.status === GITHUB_HTTP_STATUS.NOT_FOUND) return NOT_FOUND;
        const answer = yield* readBody(response, ContentsSchema);
        if (!Schema.is(FileContentsSchema)(answer)) return NOT_REGULAR;
        const decoded =
          answer.encoding === BASE64
            ? Result.getOrUndefined(Encoding.decodeBase64(answer.content.replace(/\s/gu, "")))
            : undefined;
        return { regular: true, bytes: answer.size, content: decoded } satisfies RepositoryFile;
      }),
    );
  });
}
