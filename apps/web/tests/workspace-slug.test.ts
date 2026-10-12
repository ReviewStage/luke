import assert from "node:assert/strict";
import { test } from "vitest";
import { slugTail, workspaceSlug } from "../src/workspaces/workspace-slug";

test("a workspace's name becomes a lowercase, dash-joined slug ending in its tail", () => {
  assert.equal(workspaceSlug("Acme Platform", "a1b2c3"), "acme-platform-a1b2c3");
  assert.equal(workspaceSlug("  R&D / Voice!  ", "a1b2c3"), "r-d-voice-a1b2c3");
  assert.equal(workspaceSlug("Café Señor", "a1b2c3"), "cafe-senor-a1b2c3");
});

test("a name with nothing address-safe in it still makes a slug", () => {
  assert.equal(workspaceSlug("", "a1b2c3"), "workspace-a1b2c3");
  assert.equal(workspaceSlug("🚀 ✨", "a1b2c3"), "workspace-a1b2c3");
});

test("a long name is cut to a bounded stem without a dangling dash", () => {
  const slug = workspaceSlug(`${"a".repeat(39)} b${"c".repeat(60)}`, "a1b2c3");
  assert.equal(slug, `${"a".repeat(39)}-a1b2c3`);
});

test("two workspaces given the same name are made under different slugs", () => {
  const tails = new Set(Array.from({ length: 20 }, () => slugTail()));
  assert.equal(tails.size, 20);
  for (const tail of tails) assert.match(workspaceSlug("Acme", tail), /^acme-[a-z0-9]{6}$/);
});
