import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { GITHUB_IMAGE_BOUNDS, GITHUB_IMAGE_TYPE, githubImageOf } from "@luke/features/github-image";
import { Effect, Option, Redacted } from "effect";
import { fakeGitHub, type SentToGitHub } from "../testing/github-app-fake.js";
import { githubImage } from "./github-images.js";

/**
 * github-images.test.ts -- an image GitHub's rendering of a pull request
 * names is read for the window as ReviewStage/stage's proxy reads it: an
 * upload re-signed by its asset's id in the agent's repository on the App's
 * token, then read from the signed address with no credential; a file of
 * the agent's own repository read through its contents on the token, and
 * one of any other repository never asked for; a public image on GitHub's
 * image proxy read as it stands; and an answer naming
 * another asset, of a type the window does not draw, or past the bound,
 * read as none. A scripted GitHub; synthetic ids.
 */

const REPOSITORY = "acme/relay";
const TOKEN = Redacted.make("ghs_fixture_installation_token");
const ASSET = "4f2c1a3b-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const OTHER_ASSET = "5f2c1a3b-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const SIGNED = `https://private-user-images.githubusercontent.com/90001/418-${ASSET}.png?jwt=signed.token`;
const CAMO = "https://camo.githubusercontent.com/abc123/68747470733a2f2f";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/** GitHub's rendering of a one-line image, its address spelled with entities as GitHub spells it. */
function rendered(address: string): Response {
  const spelled = address.replaceAll("&", "&amp;");
  return new Response(`<p><a href="${spelled}"><img src="${spelled}" alt=""></a></p>`, {
    headers: { "content-type": "text/html;charset=utf-8" },
  });
}

/** An image answer of the type and size given. */
function image(type: string, bytes: Uint8Array<ArrayBuffer> = PNG): Response {
  return new Response(bytes, {
    headers: { "content-type": type, "content-length": String(bytes.byteLength) },
  });
}

/** The image the address names, read off the GitHub given, and every request it sent. */
const read = (address: string, answer: (sent: SentToGitHub) => Response) =>
  Effect.gen(function* () {
    const named = githubImageOf(address);
    assert.ok(named !== undefined, "the address names an image the window draws");
    const github = fakeGitHub(answer);
    const result = yield* githubImage(TOKEN, REPOSITORY, named).pipe(Effect.provide(github.layer));
    return { result, sent: github.sent };
  });

it.effect(
  "an upload is re-signed in the agent's repository on the App's token, then read from its signed address with no credential",
  () =>
    Effect.gen(function* () {
      const { result, sent } = yield* read(
        `https://github.com/user-attachments/assets/${ASSET}`,
        (request) => (request.url.endsWith("/markdown") ? rendered(SIGNED) : image("image/png")),
      );

      assert.ok(Option.isSome(result));
      assert.equal(result.value.contentType, GITHUB_IMAGE_TYPE.PNG);
      assert.deepEqual([...result.value.bytes], [...PNG]);
      const [render, fetched] = sent;
      assert.equal(render?.method, "POST");
      assert.equal(render?.headers.get("authorization"), "Bearer ghs_fixture_installation_token");
      assert.deepEqual(JSON.parse(render?.body ?? "{}"), {
        text: `![](https://github.com/user-attachments/assets/${ASSET})`,
        mode: "gfm",
        context: REPOSITORY,
      });
      assert.equal(fetched?.url, SIGNED, "the signed address is read as GitHub spelled it");
      assert.equal(
        fetched?.headers.get("authorization"),
        null,
        "the token never leaves for the image",
      );
    }),
);

it.effect(
  "a public image on GitHub's image proxy is read as it stands, GitHub's API asked nothing",
  () =>
    Effect.gen(function* () {
      const { result, sent } = yield* read(CAMO, () => image("image/gif"));
      assert.ok(Option.isSome(result));
      assert.equal(result.value.contentType, GITHUB_IMAGE_TYPE.GIF);
      assert.deepEqual(
        sent.map((request) => request.url),
        [CAMO],
      );
    }),
);

it.effect(
  "a re-signing naming another asset, an answer of a type the window does not draw, or one past the bound, is none",
  () =>
    Effect.gen(function* () {
      const elsewhere = yield* read(
        `https://github.com/user-attachments/assets/${ASSET}`,
        (request) =>
          request.url.endsWith("/markdown")
            ? rendered(SIGNED.replace(ASSET, OTHER_ASSET))
            : image("image/png"),
      );
      assert.ok(Option.isNone(elsewhere.result));
      assert.equal(
        elsewhere.sent.length,
        1,
        "nothing is read from an address naming another asset",
      );

      const html = yield* read(CAMO, () => image("text/html"));
      assert.ok(Option.isNone(html.result));

      const large = yield* read(CAMO, () =>
        image("image/png", new Uint8Array(GITHUB_IMAGE_BOUNDS.MAX_BYTES + 1)),
      );
      assert.ok(Option.isNone(large.result));
    }),
);

/** A whole PNG file's signature, as a repository's file must open to be read as one. */
const PNG_FILE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

/** A repository's file as the contents API answers its raw bytes, under GitHub's own type. */
function raw(bytes: Uint8Array<ArrayBuffer> = PNG_FILE): Response {
  return new Response(bytes, {
    headers: {
      "content-type": "application/vnd.github.raw; charset=utf-8",
      "content-length": String(bytes.byteLength),
    },
  });
}

it.effect(
  "a file of the agent's repository is read through its contents on the App's token, as its extension's type",
  () =>
    Effect.gen(function* () {
      const { result, sent } = yield* read(
        "https://raw.githubusercontent.com/acme/relay/pr-assets/pr-42/before%20and%20after.png",
        () => raw(),
      );

      assert.ok(Option.isSome(result));
      assert.equal(result.value.contentType, GITHUB_IMAGE_TYPE.PNG);
      assert.deepEqual([...result.value.bytes], [...PNG_FILE]);
      const [contents] = sent;
      assert.equal(
        contents?.url,
        "https://api.github.com/repos/acme/relay/contents/pr-42/before%20and%20after.png?ref=pr-assets",
      );
      assert.equal(contents?.headers.get("accept"), "application/vnd.github.raw");
      assert.equal(contents?.headers.get("authorization"), "Bearer ghs_fixture_installation_token");
    }),
);

it.effect(
  "a file of another repository is never asked for, and a contents answer that is not the file's bytes, or bytes of another kind than its extension names, is none",
  () =>
    Effect.gen(function* () {
      const elsewhere = yield* read(
        "https://raw.githubusercontent.com/acme/vault/main/secret.png",
        () => raw(),
      );
      assert.ok(Option.isNone(elsewhere.result));
      assert.deepEqual(elsewhere.sent, [], "GitHub is asked nothing for another repository");

      const listing = yield* read("https://github.com/acme/relay/raw/main/shots.png", () =>
        Response.json([{ name: "a.png" }]),
      );
      assert.ok(Option.isNone(listing.result));

      const large = yield* read("https://github.com/acme/relay/raw/main/shot.png", () =>
        raw(new Uint8Array(GITHUB_IMAGE_BOUNDS.MAX_BYTES + 1)),
      );
      assert.ok(Option.isNone(large.result));

      const page = new TextEncoder().encode("<html><script>alert(1)</script></html>");
      for (const name of ["shot.png", "shot.svg", "shot.webp"]) {
        const disguised = yield* read(`https://github.com/acme/relay/raw/main/${name}`, () =>
          raw(page),
        );
        assert.ok(Option.isNone(disguised.result), name);
      }
    }),
);
