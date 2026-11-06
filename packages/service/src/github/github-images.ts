import {
  GITHUB_IMAGE_BOUNDS,
  GITHUB_IMAGE_SOURCE,
  GITHUB_IMAGE_TYPE,
  type GitHubFileImage,
  type GitHubImage,
  type GitHubImageType,
  isUploadOf,
} from "@repo/features/github-image";
import { Effect, Option, type Redacted } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import {
  GITHUB_USER_AGENT,
  type GitHubUnavailable,
  githubPost,
  githubRead,
  send,
} from "./github-app.js";

export interface ReadImage {
  readonly bytes: Uint8Array;
  readonly contentType: GitHubImageType;
}

const IMAGE_TYPES: ReadonlyMap<string, GitHubImageType> = new Map(
  Object.values(GITHUB_IMAGE_TYPE).map((type) => [type, type]),
);

const RENDERED_SOURCE = /<img\b[^>]*?\ssrc="([^"]+)"/iu;

const ENTITIES = new Map([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&#39;", "'"],
]);

const ENTITY = /&(?:amp|lt|gt|quot|#39);/gu;

const ASCII = new TextEncoder();

const RAW_CONTENTS = "application/vnd.github.raw";

const SIGNATURES: ReadonlyMap<GitHubImageType, (bytes: Uint8Array) => boolean> = new Map([
  [
    GITHUB_IMAGE_TYPE.PNG,
    (bytes) => opensWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ],
  [GITHUB_IMAGE_TYPE.JPEG, (bytes) => opensWith(bytes, [0xff, 0xd8, 0xff])],
  [GITHUB_IMAGE_TYPE.GIF, (bytes) => opensWith(bytes, [...ASCII.encode("GIF8")])],
  [
    GITHUB_IMAGE_TYPE.WEBP,
    (bytes) =>
      opensWith(bytes, [...ASCII.encode("RIFF")]) &&
      opensWith(bytes.subarray(8), [...ASCII.encode("WEBP")]),
  ],
  [GITHUB_IMAGE_TYPE.SVG, (bytes) => new TextDecoder().decode(bytes).includes("<svg")],
]);

function opensWith(bytes: Uint8Array, opening: readonly number[]): boolean {
  return opening.every((byte, at) => bytes[at] === byte);
}

function mediaTypeOf(header: string | undefined): string {
  return header?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function imageTypeOf(header: string | undefined): GitHubImageType | undefined {
  return IMAGE_TYPES.get(mediaTypeOf(header));
}

function signedUploadOf(
  token: Redacted.Redacted,
  fullName: string,
  assetId: string,
): Effect.Effect<Option.Option<string>, GitHubUnavailable, HttpClient.HttpClient> {
  const request = githubPost("/markdown", token, {
    text: `![](https://github.com/user-attachments/assets/${assetId})`,
    mode: "gfm",
    context: fullName,
  });
  return Effect.scoped(
    Effect.flatMap(send(request), (response) =>
      response.status !== 200
        ? Effect.succeed(Option.none<string>())
        : Effect.map(
            Effect.orElseSucceed(response.text, () => ""),
            (html) => {
              const spelled = RENDERED_SOURCE.exec(html)?.[1];
              const address = spelled?.replace(ENTITY, (entity) => ENTITIES.get(entity) ?? entity);
              return address !== undefined && isUploadOf(address, assetId)
                ? Option.some(address)
                : Option.none<string>();
            },
          ),
    ),
  );
}

function imageOf(
  request: HttpClientRequest.HttpClientRequest,
  typeOf: (header: string | undefined) => GitHubImageType | undefined,
): Effect.Effect<Option.Option<ReadImage>, GitHubUnavailable, HttpClient.HttpClient> {
  return Effect.scoped(
    Effect.flatMap(send(request), (response) => {
      const contentType = typeOf(response.headers["content-type"]);
      const length = Number(response.headers["content-length"] ?? "0");
      if (response.status !== 200 || contentType === undefined)
        return Effect.succeed(Option.none());
      if (length > GITHUB_IMAGE_BOUNDS.MAX_BYTES) return Effect.succeed(Option.none());
      return Effect.map(
        Effect.orElseSucceed(response.arrayBuffer, () => new ArrayBuffer(0)),
        (buffer): Option.Option<ReadImage> =>
          buffer.byteLength === 0 || buffer.byteLength > GITHUB_IMAGE_BOUNDS.MAX_BYTES
            ? Option.none()
            : Option.some({ bytes: new Uint8Array(buffer), contentType }),
      );
    }),
  );
}

function imageAt(
  address: string,
): Effect.Effect<Option.Option<ReadImage>, GitHubUnavailable, HttpClient.HttpClient> {
  const request = HttpClientRequest.get(address).pipe(
    HttpClientRequest.setHeader("user-agent", GITHUB_USER_AGENT),
  );
  return imageOf(request, imageTypeOf);
}

function repositoryFile(
  token: Redacted.Redacted,
  fullName: string,
  file: GitHubFileImage,
): Effect.Effect<Option.Option<ReadImage>, GitHubUnavailable, HttpClient.HttpClient> {
  if (file.repository.toLowerCase() !== fullName.toLowerCase()) {
    return Effect.succeed(Option.none());
  }
  const path = file.path.map(encodeURIComponent).join("/");
  const ref = new URLSearchParams({ ref: file.ref });
  const request = githubRead(`/repos/${fullName}/contents/${path}?${ref}`, token).pipe(
    HttpClientRequest.setHeader("accept", RAW_CONTENTS),
  );
  const read = imageOf(request, (header) =>
    mediaTypeOf(header) === RAW_CONTENTS ? file.contentType : undefined,
  );
  return Effect.map(
    read,
    Option.filter((image) => SIGNATURES.get(image.contentType)?.(image.bytes) === true),
  );
}

export const githubImage = /* @__PURE__ */ Effect.fn("web/githubImage")(function* (
  token: Redacted.Redacted,
  fullName: string,
  image: GitHubImage,
): Effect.fn.Return<Option.Option<ReadImage>, GitHubUnavailable, HttpClient.HttpClient> {
  if (image.source === GITHUB_IMAGE_SOURCE.PUBLIC) return yield* imageAt(image.url);
  if (image.source === GITHUB_IMAGE_SOURCE.FILE) {
    return yield* repositoryFile(token, fullName, image);
  }
  const signed = yield* signedUploadOf(token, fullName, image.assetId);
  if (Option.isNone(signed)) return Option.none();
  return yield* imageAt(signed.value);
});
