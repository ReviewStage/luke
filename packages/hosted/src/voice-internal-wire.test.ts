import assert from "node:assert/strict";
import test from "node:test";
import { SCHEMA_REFUSAL } from "@sidecar/wire";
import {
  VOICE_INTERNAL_BOUNDS,
  VOICE_USAGE_RECORD,
  voiceAuthorizeAnswerSchema,
  voiceAuthorizeRequestSchema,
  voiceUsageAnswerSchema,
  voiceUsageRequestSchema,
} from "./voice-internal-wire.js";

test("an authorize request is the forwarded bearer and nothing beside it", () => {
  assert.deepEqual(voiceAuthorizeRequestSchema.parse({ bearer: " Bearer tok " }), {
    bearer: "Bearer tok",
  });
  assert.equal(voiceAuthorizeRequestSchema.parse({ bearer: "" }), undefined);
  assert.equal(voiceAuthorizeRequestSchema.parse({ bearer: "Bearer tok", userId: "u" }), undefined);
  const read = voiceAuthorizeRequestSchema.read({
    bearer: "x".repeat(VOICE_INTERNAL_BOUNDS.BEARER_CHARS + 1),
  });
  assert.equal(read.ok, false);
  if (!read.ok) assert.equal(read.refusal, SCHEMA_REFUSAL.TOO_LARGE);
});

test("an authorize answer carries the user and the quota and ignores a newer field", () => {
  const quota = { used: 2, limit: 5_000, resetsAt: 1_800_000_000_000 };
  assert.deepEqual(voiceAuthorizeAnswerSchema.parse({ userId: "user-1", quota, later: true }), {
    userId: "user-1",
    quota,
  });
  assert.equal(voiceAuthorizeAnswerSchema.parse({ userId: "user-1" }), undefined);
});

test("a usage report is one session's non-negative seconds under the day bound", () => {
  const report = { userId: "user-1", sessionId: "sess_1", seconds: 61.5 };
  assert.deepEqual(voiceUsageRequestSchema.parse(report), report);
  assert.equal(voiceUsageRequestSchema.parse({ ...report, seconds: -1 }), undefined);
  assert.equal(
    voiceUsageRequestSchema.parse({
      ...report,
      seconds: VOICE_INTERNAL_BOUNDS.SESSION_SECONDS + 1,
    }),
    undefined,
  );
  assert.equal(voiceUsageRequestSchema.parse({ ...report, sessionId: "" }), undefined);
  assert.equal(voiceUsageRequestSchema.parse({ ...report, extra: 1 }), undefined);
});

test("a usage answer names one of the two records", () => {
  for (const record of Object.values(VOICE_USAGE_RECORD)) {
    assert.deepEqual(voiceUsageAnswerSchema.parse({ record }), { record });
  }
  assert.equal(voiceUsageAnswerSchema.parse({ record: "billed" }), undefined);
  assert.equal(new Set(Object.values(VOICE_USAGE_RECORD)).size, 2);
});
