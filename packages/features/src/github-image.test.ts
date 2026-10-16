import assert from "node:assert/strict";
import { test } from "vitest";
import { GITHUB_IMAGE_SOURCE, githubImageOf, isUploadOf } from "./github-image.js";

/**
 * github-image.test.ts -- an upload in GitHub's rendering is asked for by its
 * asset's id, however GitHub spelled it, its signature never; a public image
 * on GitHub's image proxy as it stands; and anything else, or anything with
 * credentials in it, is no image the window draws. Synthetic addresses.
 */

const ID = "4f2c1a3b-5d6e-4f70-8a9b-0c1d2e3f4a5b";

test("an upload is asked for by its asset's id, however GitHub spelled it", () => {
  for (const address of [
    `https://github.com/user-attachments/assets/${ID}`,
    `https://github.com/acme/relay/assets/${ID}`,
    `https://private-user-images.githubusercontent.com/90001/418-${ID}.png?jwt=signed.token.here`,
    `https://github.com/user-attachments/assets/${ID.toUpperCase()}`,
  ]) {
    assert.deepEqual(githubImageOf(address), { source: GITHUB_IMAGE_SOURCE.ASSET, assetId: ID });
  }
});

test("a public image on GitHub's image proxy or older upload host is asked for as it stands", () => {
  const camo = "https://camo.githubusercontent.com/abc123/68747470733a2f2f";
  assert.deepEqual(githubImageOf(camo), { source: GITHUB_IMAGE_SOURCE.PUBLIC, url: camo });
  const old = "https://user-images.githubusercontent.com/1/2.png";
  assert.deepEqual(githubImageOf(old), { source: GITHUB_IMAGE_SOURCE.PUBLIC, url: old });
});

test("anything else, plain HTTP, credentials, or an upload with no asset id, is no image the window draws", () => {
  for (const address of [
    "https://evil.example.com/a.png",
    "http://camo.githubusercontent.com/abc",
    "https://user:pass@camo.githubusercontent.com/abc",
    "https://github.com/acme/relay/blob/main/a.png",
    "https://github.com/user-attachments/assets/not-an-id",
    `https://github.com/user-attachments/assets/${ID}/more`,
    "https://private-user-images.githubusercontent.com/90001/a.png",
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.equal(githubImageOf(address), undefined, address);
  }
});

test("a re-signing's answer is read only where it names the very upload asked for", () => {
  assert.ok(
    isUploadOf(`https://private-user-images.githubusercontent.com/9/1-${ID}.png?jwt=x`, ID),
  );
  assert.ok(isUploadOf(`https://github.com/user-attachments/assets/${ID}`, ID));
  assert.ok(
    !isUploadOf(
      `https://private-user-images.githubusercontent.com/9/1-${ID}.png`,
      "5f2c1a3b-5d6e-4f70-8a9b-0c1d2e3f4a5b",
    ),
  );
  assert.ok(!isUploadOf("https://evil.example.com/x.png", ID));
});
