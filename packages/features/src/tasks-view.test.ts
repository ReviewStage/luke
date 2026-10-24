import assert from "node:assert/strict";
import { Schema as EffectSchema } from "effect";
import { test } from "vitest";
import { VOICE_PHASE, taskActivitySchema } from "./tasks-view.js";

test("a task call's activity parses whether or not it carries the notetaker's `notes`, which an older service still sent", () => {
  const decode = EffectSchema.decodeUnknownSync(taskActivitySchema);
  assert.deepEqual(decode({ planner: { action: "ls src" }, notes: true }), {
    planner: { action: "ls src" },
    notes: true,
  });
  assert.deepEqual(decode({ voice: VOICE_PHASE.HANDING_OFF, notes: false }), {
    voice: VOICE_PHASE.HANDING_OFF,
    notes: false,
  });
  assert.deepEqual(decode({ planner: {} }), { planner: {} });
});
