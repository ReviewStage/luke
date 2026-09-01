import assert from "node:assert/strict";
import test from "node:test";
import {
  CURSOR_AGENT_EARLY_REFUSAL_WINDOW_MS,
  launchCursorAgentDetached,
} from "./cursor-agent-launch.js";

test("an early exit inside the refusal window is an answer", async () => {
  const refused = await launchCursorAgentDetached(process.execPath, ["-e", "process.exit(7)"], 100);
  assert.deepEqual(refused, { exitCode: 7 });
});

test("a launch that outlives the refusal window is delivered as running", async () => {
  const delivered = await launchCursorAgentDetached(
    process.execPath,
    ["-e", "setTimeout(() => {}, 60_000)"],
    50,
  );
  assert.equal(delivered, "running");
});

test("the default refusal window is eight seconds", () => {
  assert.equal(CURSOR_AGENT_EARLY_REFUSAL_WINDOW_MS, 8_000);
});

test("an absent binary answers with exit code one inside the window", async () => {
  const missing = await launchCursorAgentDetached("/definitely/not/cursor-agent", [], 100);
  assert.deepEqual(missing, { exitCode: 1 });
});
