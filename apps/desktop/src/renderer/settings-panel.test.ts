import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./settings-panel.tsx", import.meta.url), "utf8");

test("the Updates section keeps one place as update state changes", () => {
  const updates = [...source.matchAll(/<UpdatesSection\b/g)].map(({ index }) => index);
  const settingsIndex = source.indexOf('className="settings-section settings-index"');

  assert.equal(updates.length, 1, "Updates is not conditionally moved between two render sites");
  assert.ok((updates[0] ?? -1) > settingsIndex, "Updates stays below the settings page index");
  assert.match(source, /<WhatLukeRunsOnSection\s+rowIndex=\{1\}/);
  assert.match(source, /settings-index"\s+style=\{cssCustomProperties\(\{ "--row-index": 2 \}\)\}/);
  assert.match(source, /<UpdatesSection control=\{updates\} rowIndex=\{3\} \/>/);
});
