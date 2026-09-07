import assert from "node:assert/strict";
import test from "node:test";
import { TranscriptCursors } from "./cursors.js";

const IDENTITY = { providerId: "claude-code", providerSessionId: "abc" };

test("a mark rolls the cursors back, the persisted shape round-trips, and unlisted sessions are forgotten", () => {
  const cursors = new TranscriptCursors();
  cursors.setCursor(IDENTITY, "10");
  const mark = cursors.mark();
  cursors.setCursor(IDENTITY, "20");
  cursors.rollback(mark);
  assert.equal(cursors.cursor(IDENTITY), "10");
  cursors.setCursor({ providerId: "codex", providerSessionId: "gone" }, "2");
  const restored = new TranscriptCursors(cursors.persisted());
  assert.equal(restored.cursor({ providerId: "codex", providerSessionId: "gone" }), "2");
  restored.retain([IDENTITY]);
  assert.deepEqual(restored.persisted(), { "claude-code": { abc: "10" } });
});
