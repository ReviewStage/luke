import assert from "node:assert/strict";
import { test } from "vitest";
import { githubAvatarUrl, pinnedPictureUrl } from "./account-picture.js";

/**
 * account-picture.test.ts -- a person's picture is drawn only from the hosts the
 * renderer's image policy allows, and someone a pull request names on GitHub
 * only from GitHub's own avatar host. Synthetic addresses throughout.
 */

test("a GitHub avatar is kept only where GitHub's avatar host serves it over https", () => {
  assert.equal(
    githubAvatarUrl("https://avatars.githubusercontent.com/u/1001?v=4"),
    "https://avatars.githubusercontent.com/u/1001?v=4",
  );
  for (const refused of [
    "http://avatars.githubusercontent.com/u/1001?v=4",
    "https://lh3.googleusercontent.com/a/photo",
    "https://avatars.githubusercontent.com.evil.example/u/1",
    "https://evil.example.com/a.png",
    "not an address",
    "",
    null,
    undefined,
  ]) {
    assert.equal(githubAvatarUrl(refused), undefined, String(refused));
  }
});

test("a sign-in picture is kept from Google's and GitHub's hosts alike, and dropped from anywhere else", () => {
  assert.equal(
    pinnedPictureUrl("https://lh3.googleusercontent.com/a/photo"),
    "https://lh3.googleusercontent.com/a/photo",
  );
  assert.equal(
    pinnedPictureUrl("https://avatars.githubusercontent.com/u/1"),
    "https://avatars.githubusercontent.com/u/1",
  );
  assert.equal(pinnedPictureUrl("https://evil.example.com/a.png"), undefined);
});
