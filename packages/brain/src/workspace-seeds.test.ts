import assert from "node:assert/strict";
import test from "node:test";
import { BRAIN_PERSONA, BRAIN_WORKSPACE_SEEDS } from "./workspace-seeds.js";

test("no seed carries the persona: it is the build's own prompt section, never a workspace file", () => {
  // A seed is written once and never rewritten, so a persona seeded into a
  // file would fork every machine that already launched from the build.
  const opening = BRAIN_PERSONA.split("\n")[0] ?? "";
  assert.ok(opening.length > 0);
  for (const [name, seed] of Object.entries(BRAIN_WORKSPACE_SEEDS)) {
    assert.ok(!seed.includes(opening), name);
  }
});
