import assert from "node:assert/strict";
import { test } from "vitest";
import { HOSTED_API_ERROR, hostedErrorSchema, hostedQuotaSchema } from "./service-wire.js";

test("a quota is four counts at or above zero, and anything else is no quota", () => {
  const quota = { used: 1, limit: 5, resetsAt: 1_800_000_000_000 };
  assert.deepEqual(hostedQuotaSchema.parse({ ...quota, extra: "ignored" }), quota);
  assert.equal(hostedQuotaSchema.parse({ ...quota, used: -1 }), undefined);
  assert.equal(hostedQuotaSchema.parse({ ...quota, limit: "5" }), undefined);
  assert.equal(hostedQuotaSchema.parse({ used: 1, limit: 5 }), undefined);
});

test("a refusal reads as one of the reasons this build names, and nothing else", () => {
  assert.equal(
    hostedErrorSchema.parse({ error: HOSTED_API_ERROR.QUOTA_EXHAUSTED }),
    HOSTED_API_ERROR.QUOTA_EXHAUSTED,
  );
  assert.equal(hostedErrorSchema.parse({ error: "unknown-reason" }), undefined);
  assert.equal(hostedErrorSchema.parse({}), undefined);
  assert.equal(hostedErrorSchema.parse("invalid-token"), undefined);
});
