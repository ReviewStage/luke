import assert from "node:assert/strict";
import { Result, Schema } from "effect";
import { test } from "vitest";
import { emitJsonSchema, readEither, standardSchemaOf, wireKeys } from "./index.js";

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

test("a struct whose wire keys would put two fields under one key is refused as it is declared", () => {
  const both = Schema.Struct({ taskId: SAID, planId: SAID });

  assert.throws(
    () => both.pipe(wireKeys({ taskId: "planId" })),
    /two fields travel under one key/u,
  );
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

test("a standard schema validates as a read does, an unlisted key and a bound refused, and shows the emitted node", async () => {
  const standard = standardSchemaOf(RENAMED)["~standard"];

  assert.deepEqual(await standard.validate({ planId: " p-1 " }), { value: { taskId: "p-1" } });
  assert.ok(
    (await standard.validate({ planId: "p-1", extra: 1 })).issues,
    "an unlisted key is refused",
  );
  assert.ok((await standard.validate({ planId: "eleven char" })).issues, "a bound holds");
  const said = { type: "string", minLength: 1, maxLength: 10 };
  assert.deepEqual(standard.jsonSchema.input({ target: "draft-2020-12" }), {
    type: "object",
    properties: { planId: said, note: said },
    required: ["planId"],
    additionalProperties: false,
  });
});
