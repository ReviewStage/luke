import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { VOICE_SERVICE_PATH } from "@sidecar/hosted";

/**
 * A WebSocket connection to a Vercel Function lives as long as the function
 * may run, so the two voice functions carry the platform's longest generally
 * available duration, and each path the desktop opens is a function file
 * `vercel.json` names.
 */
const VOICE_FUNCTION_MAX_DURATION_SECONDS = 800;

const vercel: { functions: Record<string, { maxDuration?: number }> } = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
);

function functionFile(path: string): string {
  return `${path.replace(/^\//, "")}.ts`;
}

test("both voice functions carry the 800 second maximum duration", () => {
  for (const path of Object.values(VOICE_SERVICE_PATH)) {
    assert.equal(
      vercel.functions[functionFile(path)]?.maxDuration,
      VOICE_FUNCTION_MAX_DURATION_SECONDS,
    );
  }
});
