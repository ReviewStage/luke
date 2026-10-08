import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Result, Schema, SchemaGetter, SchemaIssue, SchemaTransformation } from "effect";
import { test } from "vitest";
import { SCHEMA_REFUSAL } from "../schema-vocabulary.js";
import { matchJsonSchemaGolden } from "../testing/json-schema-golden.js";
import {
  describeWire,
  emitJsonSchema,
  readEither,
  type SchemaRefusalError,
  wireRefusal,
} from "./json-schema.js";

/**
 * The emitter is measured against the goldens each package recorded: each
 * schema below is the Effect declaration of one another package declares
 * directly, and the bytes it emits have to be the bytes that package's own
 * test holds still. The goldens are read and never written from here.
 */

const PACKAGES = path.resolve(fileURLToPath(import.meta.url), "../../../..");

const GOLDEN_ROOT = {
  HOSTED: path.join(PACKAGES, "hosted/fixtures/json-schema"),
} as const;

/** A non-empty string, bounded where a `max` is declared, as a wire declaration reads one. */
const text = (max?: number) =>
  max === undefined
    ? Schema.String.check(Schema.isNonEmpty())
    : Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(max));

/** An integer at or above its minimum, as a wire declaration reads one. */
const wholeNumber = (minimum: number) => Schema.Int.check(Schema.isGreaterThanOrEqualTo(minimum));

/** A struct or a null literal: a claim that found no command answers null. */
const planCommandClaimAnswer = Schema.Struct({
  command: Schema.NullOr(Schema.Struct({ id: text(36), command: Schema.String })),
});

const HOSTED_GOLDENS = [
  ["plan-wire-planCommandClaimAnswerSchema", planCommandClaimAnswer],
] as const satisfies readonly (readonly [string, Schema.Top])[];

test.for(HOSTED_GOLDENS)(
  "%s is emitted byte for byte from its Effect declaration",
  async ([name, schema]) => {
    await matchJsonSchemaGolden(GOLDEN_ROOT.HOSTED, name, emitJsonSchema(schema));
  },
);

test("the outermost description wins and Effect's own descriptions are never read", () => {
  const inner = describeWire(Schema.String.check(Schema.isNonEmpty()), "Inner.");
  const outer = describeWire(inner.check(Schema.isMaxLength(3)), "Outer.");

  assert.deepEqual(emitJsonSchema(outer), {
    type: "string",
    minLength: 1,
    maxLength: 3,
    description: "Outer.",
  });
  assert.deepEqual(emitJsonSchema(Schema.String), { type: "string" });
});

test("bounds are emitted in a fixed key order whatever order they were piped in", () => {
  const piped = Schema.String.check(Schema.isMaxLength(9), Schema.isMinLength(2));

  assert.deepEqual(Object.keys(emitJsonSchema(piped)), ["type", "minLength", "maxLength"]);
});

test("an inexact optional drops the undefined its union carries", () => {
  const inexact = Schema.Struct({ field: Schema.optional(Schema.Number) });

  assert.deepEqual(emitJsonSchema(inexact), {
    type: "object",
    properties: { field: { type: "number" } },
    required: [],
    additionalProperties: false,
  });
});

test("a transformation emits the wire side it decodes from", () => {
  const length = Schema.String.check(Schema.isNonEmpty()).pipe(
    Schema.decodeTo(
      Schema.Number,
      SchemaTransformation.transform({
        decode: (value) => value.length,
        encode: (length) => "x".repeat(length),
      }),
    ),
  );

  assert.deepEqual(emitJsonSchema(length), { type: "string", minLength: 1 });
});

/**
 * A check's own identity is what says which bound it stands for, so the
 * contradiction below borrows a real length check's rather than spelling one.
 */
const MIN_LENGTH_REPRESENTATION = Schema.isMinLength(1).annotations?.representation;

const UNSHOWABLE = [
  ["a declaration with no verbatim node", Schema.instanceOf(Date)],
  ["a tuple with positions", Schema.Tuple([Schema.String, Schema.Number])],
  ["an object with an index signature", Schema.Record(Schema.String, Schema.Number)],
  [
    "a length bound on a boolean",
    Schema.Boolean.check(
      Schema.makeFilter(() => true, { representation: MIN_LENGTH_REPRESENTATION }),
    ),
  ],
  ["a bound declared twice", Schema.String.check(Schema.isMaxLength(1), Schema.isMaxLength(2))],
  ["a bigint literal", Schema.Literal(1n)],
] as const satisfies readonly (readonly [string, Schema.Top])[];

test.for(UNSHOWABLE)("%s throws at emission rather than emitting a node", ([, schema]) => {
  assert.throws(() => emitJsonSchema(schema), Error);
});

const bounded = Schema.Struct({
  name: text(3),
  count: wholeNumber(1),
  tags: Schema.Array(Schema.String).check(Schema.isMaxLength(2)),
  registered: Schema.String.check(
    Schema.makeFilter((value) => value === "known", wireRefusal(SCHEMA_REFUSAL.NOT_REGISTERED)),
  ),
});

const readBounded = readEither(bounded);

const WELL_FORMED = { name: "abc", count: 1, tags: ["a"], registered: "known" };

function refusalOf<A>(read: Result.Result<A, SchemaRefusalError>): SchemaRefusalError {
  assert.ok(Result.isFailure(read));
  return read.failure;
}

test("readEither answers the decoded value", () => {
  assert.deepEqual(Result.getOrThrow(readBounded(WELL_FORMED)), WELL_FORMED);
});

test("a text past its maximum is too large at its key", () => {
  const refused = refusalOf(readBounded({ ...WELL_FORMED, name: "abcd" }));

  assert.equal(refused.refusal, SCHEMA_REFUSAL.TOO_LARGE);
  assert.deepEqual(refused.path, ["name"]);
});

test("a number below its minimum is malformed", () => {
  const refused = refusalOf(readBounded({ ...WELL_FORMED, count: 0 }));

  assert.equal(refused.refusal, SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(refused.path, ["count"]);
});

test("an array past its count is too large", () => {
  const refused = refusalOf(readBounded({ ...WELL_FORMED, tags: ["a", "b", "c"] }));

  assert.equal(refused.refusal, SCHEMA_REFUSAL.TOO_LARGE);
  assert.deepEqual(refused.path, ["tags"]);
});

test("a refused entry is reported at its index", () => {
  const refused = refusalOf(readBounded({ ...WELL_FORMED, tags: ["a", 1] }));

  assert.equal(refused.refusal, SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(refused.path, ["tags", 1]);
});

test("a refinement carrying its own refusal answers that word", () => {
  const refused = refusalOf(readBounded({ ...WELL_FORMED, registered: "unknown" }));

  assert.equal(refused.refusal, SCHEMA_REFUSAL.NOT_REGISTERED);
  assert.deepEqual(refused.path, ["registered"]);
});

test("a missing key and an unlisted key are each malformed at that key", () => {
  const { name, ...missing } = WELL_FORMED;
  const missingRefusal = refusalOf(readBounded(missing));
  const unlistedRefusal = refusalOf(readBounded({ ...WELL_FORMED, extra: name }));

  assert.equal(missingRefusal.refusal, SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(missingRefusal.path, ["name"]);
  assert.equal(unlistedRefusal.refusal, SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(unlistedRefusal.path, ["extra"]);
});

test("a wrong type at the root is malformed with an empty path", () => {
  const refused = refusalOf(readBounded("not a record"));

  assert.equal(refused.refusal, SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(refused.path, []);
});

test("a failed transformation answers its own refusal annotation", () => {
  const parsed = Schema.String.pipe(
    Schema.decodeTo(Schema.Number, {
      decode: SchemaGetter.transformEffect((value: string) =>
        value === "one" ? Effect.succeed(1) : Effect.fail(new SchemaIssue.InvalidValue()),
      ),
      encode: SchemaGetter.transform(() => "one"),
    }),
  ).annotate(wireRefusal(SCHEMA_REFUSAL.TOO_LARGE));

  const refused = refusalOf(readEither(Schema.Struct({ value: parsed }))({ value: "two" }));

  assert.equal(refused.refusal, SCHEMA_REFUSAL.TOO_LARGE);
  assert.deepEqual(refused.path, ["value"]);
});
