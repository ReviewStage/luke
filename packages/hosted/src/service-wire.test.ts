import assert from "node:assert/strict";
import type { UnparsedWireValue } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { type Schema as EffectSchema, Either } from "effect";
import { test } from "vitest";
import { HOSTED_API_ERROR, hostedErrorSchema, hostedQuotaSchema } from "./service-wire.js";

function parse<Value, Encoded>(
  schema: EffectSchema.Schema<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Either.getOrUndefined(readEither(schema)(value));
}

test("a quota is four counts at or above zero, and anything else is no quota", () => {
  const quota = { used: 1, limit: 5, resetsAt: 1_800_000_000_000 };
  assert.deepEqual(parse(hostedQuotaSchema, { ...quota, extra: "ignored" }), quota);
  assert.equal(parse(hostedQuotaSchema, { ...quota, used: -1 }), undefined);
  assert.equal(parse(hostedQuotaSchema, { ...quota, limit: "5" }), undefined);
  assert.equal(parse(hostedQuotaSchema, { used: 1, limit: 5 }), undefined);
});

test("a refusal reads as one of the reasons this build names, and nothing else", () => {
  assert.equal(
    parse(hostedErrorSchema, { error: HOSTED_API_ERROR.QUOTA_EXHAUSTED }),
    HOSTED_API_ERROR.QUOTA_EXHAUSTED,
  );
  assert.equal(parse(hostedErrorSchema, { error: "unknown-reason" }), undefined);
  assert.equal(parse(hostedErrorSchema, {}), undefined);
  assert.equal(parse(hostedErrorSchema, "invalid-token"), undefined);
});
