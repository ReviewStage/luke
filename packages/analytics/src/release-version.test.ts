import assert from "node:assert/strict";
import test from "node:test";
import { parseReleaseVersion } from "./release-version.js";

test("release versions parse with or without the tag convention's v", () => {
  assert.deepEqual(parseReleaseVersion("0.1.0"), [0, 1, 0]);
  assert.deepEqual(parseReleaseVersion("v12.34.56"), [12, 34, 56]);
  assert.deepEqual(parseReleaseVersion(" v0.2.0 "), [0, 2, 0]);
});

test("anything but a plain three-part version does not parse", () => {
  assert.equal(parseReleaseVersion("0.1"), undefined);
  assert.equal(parseReleaseVersion("0.1.0-beta.1"), undefined);
  assert.equal(parseReleaseVersion("0.1.0.0"), undefined);
  assert.equal(parseReleaseVersion("latest"), undefined);
  assert.equal(parseReleaseVersion(""), undefined);
});
