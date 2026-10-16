/**
 * github-images.ts -- one image GitHub's rendering of a pull request names, read for the window on the App's token: an upload re-signed by its asset's id, or a public image on GitHub's own image proxy, as ReviewStage/stage's image proxy reads them.
 *
 * GitHub's rendering signs a private repository's uploads for about five
 * minutes, and names a public one at an address only a browser signed in
 * to GitHub may read, so neither is read as GitHub spelled it. An upload is
 * read by its asset's id alone (`@luke/features/github-image`): GitHub
 * renders a one-line image of that asset in the agent's repository on the
 * App's token for it, which answers a freshly signed address, and the image
 * is read from there only where that address names the very asset asked
 * for. A public image on GitHub's image proxy is read as it stands. Neither
 * read carries the token: a signed address is its own key, and GitHub's
 * image proxy needs none.
 *
 * Only an image of the types the window draws, within the bound, is
 * answered; anything else is none, and the window draws its link instead.
 * The signed address is never answered nor logged.
 */

import {
  GITHUB_IMAGE_BOUNDS,
  GITHUB_IMAGE_SOURCE,
  GITHUB_IMAGE_TYPE,
  type GitHubImage,
  type GitHubImageType,
  isUploadOf,
} from "@luke/features/github-image";
import { Effect, Option, type Redacted } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { type GitHubUnavailable, githubPost, send } from "./github-app.js";

/** An image read for the window: its bytes and the type GitHub served them as. */
export interface ReadImage {
  readonly bytes: Uint8Array;
  readonly contentType: GitHubImageType;
}

const IMAGE_TYPES: ReadonlyMap<string, GitHubImageType> = new Map(
  Object.values(GITHUB_IMAGE_TYPE).map((type) => [type, type]),
);

/** The first image address GitHub's rendering of a line names, its entities read back. */
const RENDERED_SOURCE = /<img\b[^>]*?\ssrc="([^"]+)"/iu;

const ENTITIES = new Map([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&#39;", "'"],
]);

const ENTITY = /&(?:amp|lt|gt|quot|#39);/gu;

/** The type an answer's `content-type` names, where it is one the window draws. */
function imageTypeOf(header: string | undefined): GitHubImageType | undefined {
  return IMAGE_TYPES.get(header?.split(";")[0]?.trim().toLowerCase() ?? "");
}

/**
 * A freshly signed address for the upload, as GitHub renders a one-line
 * image of it in the repository on the token; none where GitHub renders
 * no image of it, or names any other.
 */
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

/** The image at an address, read with no credential, where it is one the window draws within the bound. */
function imageAt(
  address: string,
): Effect.Effect<Option.Option<ReadImage>, GitHubUnavailable, HttpClient.HttpClient> {
  const request = HttpClientRequest.get(address).pipe(
    HttpClientRequest.setHeader("user-agent", "luke-github-app"),
  );
  return Effect.scoped(
    Effect.flatMap(send(request), (response) => {
      const contentType = imageTypeOf(response.headers["content-type"]);
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

/**
 * The image GitHub's rendering of a pull request in the repository names:
 * an upload re-signed on the token and read from its signed address, or a
 * public image read as it stands; none where GitHub answers none of the
 * types the window draws within the bound.
 */
export const githubImage = /* @__PURE__ */ Effect.fn("web/githubImage")(function* (
  token: Redacted.Redacted,
  fullName: string,
  image: GitHubImage,
): Effect.fn.Return<Option.Option<ReadImage>, GitHubUnavailable, HttpClient.HttpClient> {
  if (image.source === GITHUB_IMAGE_SOURCE.PUBLIC) return yield* imageAt(image.url);
  const signed = yield* signedUploadOf(token, fullName, image.assetId);
  if (Option.isNone(signed)) return Option.none();
  return yield* imageAt(signed.value);
});
