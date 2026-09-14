import assert from "node:assert/strict";
import { ACTION_RESULT_STATUS, EXCESS_KEYS, type UnparsedWireValue } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { type Schema as EffectSchema, Result } from "effect";
import { test } from "vitest";
import { hostedActionAnswerSchema, hostedActionWorkspaceAnswerSchema } from "./action-wire.js";

/** An answer read: a key a newer service added is dropped rather than refused. */
function parse<S extends EffectSchema.ConstraintDecoder<unknown>>(
  schema: S,
  value: UnparsedWireValue,
): S["Type"] | undefined {
  return Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(value));
}

test("an action answer names one of the three outcomes and carries its reason as written", () => {
  assert.deepEqual(parse(hostedActionAnswerSchema, { result: ACTION_RESULT_STATUS.ACCEPTED }), {
    result: ACTION_RESULT_STATUS.ACCEPTED,
  });
  assert.deepEqual(
    parse(hostedActionAnswerSchema, {
      result: ACTION_RESULT_STATUS.REJECTED,
      reason: " not found ",
    }),
    { result: ACTION_RESULT_STATUS.REJECTED, reason: " not found " },
  );
  assert.equal(parse(hostedActionAnswerSchema, { result: "queued" }), undefined);
  assert.equal(parse(hostedActionAnswerSchema, {}), undefined);
});

test("a reason that says nothing is left out rather than refusing the outcome", () => {
  const answer = parse(hostedActionAnswerSchema, {
    result: ACTION_RESULT_STATUS.ACCEPTED,
    reason: "",
  });
  assert.deepEqual(answer, { result: ACTION_RESULT_STATUS.ACCEPTED });
  assert.deepEqual(
    parse(hostedActionAnswerSchema, { result: ACTION_RESULT_STATUS.ACCEPTED, reason: 7 }),
    {
      result: ACTION_RESULT_STATUS.ACCEPTED,
    },
  );
});

test("a creation answer carries the session id the provider named, when it named one", () => {
  assert.deepEqual(
    parse(hostedActionWorkspaceAnswerSchema, {
      result: ACTION_RESULT_STATUS.ACCEPTED,
      providerSessionId: "session-9",
    }),
    { result: ACTION_RESULT_STATUS.ACCEPTED, providerSessionId: "session-9" },
  );
  assert.deepEqual(
    parse(hostedActionWorkspaceAnswerSchema, {
      result: ACTION_RESULT_STATUS.ACCEPTED,
      providerSessionId: "",
    }),
    { result: ACTION_RESULT_STATUS.ACCEPTED },
  );
});
