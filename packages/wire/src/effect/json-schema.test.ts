import assert from "node:assert/strict";
import { Result, Schema } from "effect";
import { test } from "vitest";
import { emitJsonSchema, readEither, wireKeys } from "./index.js";

const SAID = Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(10));

const RENAMED = Schema.Struct({ taskId: SAID, note: Schema.optionalKey(SAID) }).pipe(
  wireKeys({ taskId: "planId" }),
);

test("a struct with wire keys reads and writes the wire's key, decoding each field once as it travels", () => {
  const read = readEither(RENAMED)({ planId: "  p-1 ", note: " hi " });

  assert.deepEqual(Result.getOrUndefined(read), { taskId: "p-1", note: "hi" });
  assert.deepEqual(Result.getOrUndefined(Schema.encodeUnknownResult(RENAMED)({ taskId: "p-1" })), {
    planId: "p-1",
  });
  assert.ok(Result.isFailure(readEither(RENAMED)({ taskId: "p-1" })), "the code's key is refused");
  assert.ok(Result.isFailure(readEither(RENAMED)({ planId: "eleven char" })), "a bound holds");
});

test("a struct with wire keys emits the wire's keys with every field's bounds", () => {
  const said = { type: "string", minLength: 1, maxLength: 10 };

  assert.deepEqual(emitJsonSchema(RENAMED), {
    type: "object",
    properties: { planId: said, note: said },
    required: ["planId"],
    additionalProperties: false,
  });
});
