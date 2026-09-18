import assert from "node:assert/strict";
import { LIVE_SCENE, sessionInstructions } from "@sidecar/live";
import { test } from "vitest";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set.js";

/** The lines of the delegation policy's capability list, each `- <label>: <tool>, <tool>.`. */
function listedTools(instructions: string): string[] {
  const block = instructions.split("Backend tools:")[1]?.split("\n\n")[0] ?? "";
  return block
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .flatMap((line) => line.slice(line.indexOf(":") + 1).split(","))
    .map((name) => name.trim().replace(/\.$/, ""))
    .filter(Boolean);
}

/**
 * The voice's delegation policy names the backend's tools one by one, so the
 * voice knows what one call can reach. `@sidecar/live` cannot read the
 * catalog — `@sidecar/actions` already imports that package, and the edge
 * back would be a cycle — so the two lists are held against each other from
 * here, where both are resolved already. A tool added to the catalog and not
 * to the policy is a capability the voice will never delegate for; one
 * dropped from the catalog and left in the policy is a promise it cannot
 * keep.
 */
test("the voice's delegation policy names every catalog tool and no other", () => {
  const listed = listedTools(sessionInstructions(LIVE_SCENE.DESKTOP));
  assert.deepEqual(listed.slice().sort(), Object.keys(CATALOG_TOOL_SET).sort());
  assert.equal(listed.length, new Set(listed).size);
});
