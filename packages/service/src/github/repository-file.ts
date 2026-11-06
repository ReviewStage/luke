import { Effect, type Redacted, Result, Schema } from "effect";
import { Base64 } from "effect/encoding";
import type * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import {
  GITHUB_HTTP_STATUS,
  type GitHubUnavailable,
  githubRead,
  readBody,
  readText,
  send,
} from "./github-app.js";

const FileContentsSchema = Schema.Struct({
  type: Schema.Literal("file"),
  size: Schema.Number,
  encoding: Schema.String,
  content: Schema.String,
});

const OtherContentsSchema = Schema.Union([
  Schema.Struct({ type: Schema.String }),
  Schema.Array(Schema.Unknown),
]);

const ContentsSchema = Schema.Union([FileContentsSchema, OtherContentsSchema]);

const BASE64 = "base64";

export type RepositoryFile =
  | { readonly regular: false; readonly notFound: boolean }
  | { readonly regular: true; readonly bytes: number; readonly content: Uint8Array | undefined };

const NOT_FOUND: RepositoryFile = { regular: false, notFound: true };

const NOT_REGULAR: RepositoryFile = { regular: false, notFound: false };

export function repositorySegments(path: string): readonly string[] | undefined {
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return undefined;
  }
  return segments;
}

function contentsPath(path: string): string | undefined {
  return repositorySegments(path)?.map(encodeURIComponent).join("/");
}

export function readRepositoryFile(
  token: Redacted.Redacted | null,
  repository: { readonly fullName: string },
  ref: string,
  path: string,
): Effect.Effect<RepositoryFile, GitHubUnavailable, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const encoded = contentsPath(path);
    if (encoded === undefined) return NOT_REGULAR;
    const request = githubRead(`/repos/${repository.fullName}/contents/${encoded}`, token).pipe(
      HttpClientRequest.setUrlParams({ ref }),
    );
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const response = yield* send(request);
        if (response.status === GITHUB_HTTP_STATUS.NOT_FOUND) return NOT_FOUND;
        const answer = yield* readBody(response, ContentsSchema);
        if (!Schema.is(FileContentsSchema)(answer)) return NOT_REGULAR;
        const decoded =
          answer.encoding === BASE64
            ? Result.getOrUndefined(Base64.decode(answer.content.replace(/\s/gu, "")))
            : undefined;
        return { regular: true, bytes: answer.size, content: decoded } satisfies RepositoryFile;
      }),
    );
  });
}

const BranchRefSchema = Schema.Struct({
  object: Schema.Struct({ type: Schema.Literal("commit"), sha: Schema.String }),
});

export function readBranchHead(
  token: Redacted.Redacted,
  repository: { readonly fullName: string },
  branch: string,
): Effect.Effect<string | undefined, GitHubUnavailable, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const ref = branch.split("/").map(encodeURIComponent).join("/");
    const request = githubRead(`/repos/${repository.fullName}/git/ref/heads/${ref}`, token);
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const response = yield* send(request);
        if (response.status === GITHUB_HTTP_STATUS.NOT_FOUND) return undefined;
        const answer = yield* readBody(response, BranchRefSchema);
        return answer.object.sha;
      }),
    );
  });
}

const COMMIT_SHA_MEDIA_TYPE = "application/vnd.github.sha";

export function readCommitSha(
  token: Redacted.Redacted | null,
  repository: { readonly fullName: string },
  ref: string,
): Effect.Effect<string | undefined, GitHubUnavailable, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const request = githubRead(
      `/repos/${repository.fullName}/commits/${encodeURIComponent(ref)}`,
      token,
    ).pipe(HttpClientRequest.setHeader("accept", COMMIT_SHA_MEDIA_TYPE));
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const response = yield* send(request);
        if (
          response.status === GITHUB_HTTP_STATUS.NOT_FOUND ||
          response.status === GITHUB_HTTP_STATUS.UNPROCESSABLE
        ) {
          return undefined;
        }
        return (yield* readText(response)).trim();
      }),
    );
  });
}
