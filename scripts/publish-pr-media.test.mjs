import assert from "node:assert/strict";
import test from "node:test";
import {
  BASELINE_DIRECTORY,
  MEDIA_BRANCH,
  mediaPath,
  pullRequestDirectory,
  rawUrl,
} from "./publish-pr-media.mjs";

test("scopes pull-request media to the pull request and its commit", () => {
  const directory = pullRequestDirectory(17, "0123456789abcdef0123");

  assert.equal(directory, "pr-17/0123456789ab");
  assert.equal(
    mediaPath(directory, "artifacts/evidence/app-smoke-compact.png"),
    "pr-17/0123456789ab/app-smoke-compact.png",
  );
});

test("gives successive commits distinct paths so a refreshed image is not cached", () => {
  assert.notEqual(
    pullRequestDirectory(17, "aaaaaaaaaaaaaaaa"),
    pullRequestDirectory(17, "bbbbbbbbbbbbbbbb"),
  );
});

test("keeps the baseline at one stable path", () => {
  assert.equal(
    mediaPath(BASELINE_DIRECTORY, "artifacts/evidence/app-smoke-settings.png"),
    "baseline/app-smoke-settings.png",
  );
});

test("builds a raw URL on the durable media branch", () => {
  assert.equal(
    rawUrl("ReviewStage/luke", "pr-17/0123456789ab/shot.png"),
    `https://raw.githubusercontent.com/ReviewStage/luke/${MEDIA_BRANCH}/pr-17/0123456789ab/shot.png`,
  );
});
