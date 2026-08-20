import assert from "node:assert/strict";
import test from "node:test";
import { isNewerVersion, parseReleaseVersion } from "./app-update.js";

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

test("a release is newer only when it is strictly newer, part by part", () => {
  assert.equal(isNewerVersion("0.1.1", "0.1.0"), true);
  assert.equal(isNewerVersion("0.2.0", "0.1.9"), true);
  assert.equal(isNewerVersion("1.0.0", "0.9.9"), true);
  assert.equal(isNewerVersion("v0.1.1", "0.1.0"), true);
  assert.equal(isNewerVersion("0.1.0", "0.1.0"), false);
  assert.equal(isNewerVersion("0.1.0", "0.1.1"), false);
  assert.equal(isNewerVersion("0.9.9", "1.0.0"), false);
});

test("an unparseable version never reads as newer", () => {
  assert.equal(isNewerVersion("0.2.0-beta.1", "0.1.0"), false);
  assert.equal(isNewerVersion("latest", "0.1.0"), false);
  assert.equal(isNewerVersion("0.2.0", "not-a-version"), false);
});
