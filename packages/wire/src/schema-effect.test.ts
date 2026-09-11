import assert from "node:assert/strict";
import { Schema as EffectSchema, Either, SchemaAST } from "effect";
import { test } from "vitest";
import { declareReader, emitJsonSchema, readEither, refusalIssue } from "./effect/json-schema.js";
import { type UnparsedWireValue, unparsedWire } from "./json.js";
import {
  effectSchema,
  RECORD_EXTRA_KEYS,
  SCHEMA_REFUSAL,
  type Schema,
  s,
  TEXT_ENDS,
} from "./schema.js";

/**
 * The builder is a facade over Effect `Schema`, and these are the facts the
 * builder's own tests cannot state: that the Effect schema handed out of a
 * declaration admits what the declaration admits, and the rules the facade
 * has to carry itself because no Effect node equals them.
 */

const point = s.record({ x: s.wholeNumber(), y: s.wholeNumber().optional() });

test("effectSchema hands out a schema that decodes to the declaration's own type", () => {
  const decoded = readEither(effectSchema(point))({ x: 1, y: 2 });

  assert.deepEqual(decoded, Either.right({ x: 1, y: 2 }));
});

test("the Effect schema refuses with the same word and path the declaration answers", () => {
  const value: UnparsedWireValue = { x: 1, y: "two" };
  const declared = point.read(value);
  const effect = readEither(point.effect)(value);

  assert.ok(!declared.ok && Either.isLeft(effect));
  assert.equal(effect.left.refusal, declared.refusal);
  assert.deepEqual(effect.left.path, declared.path);
});

test("an optional declaration's Effect schema admits absence, and its node is the inner one's", () => {
  const optional = s.text().optional();

  assert.deepEqual(readEither(optional.effect)(undefined), Either.right(undefined));
  assert.deepEqual(readEither(optional.effect)(" a "), Either.right("a"));
  assert.deepEqual(optional.jsonSchema(), s.text().jsonSchema());
  assert.equal(optional.optional(), optional);
});

test("the node a declaration shows is the emitter's walk of its Effect schema", () => {
  const declared = s.record({
    name: s.text({ max: 8 }).describe("what it is called"),
    effort: s.enumOf(["low", "high"]).optional(),
    counts: s.array(s.wholeNumber({ minimum: 0 }), { max: 4, minimum: 1 }),
    done: s.boolean(),
    total: s.number({ maximum: 3 }),
    kind: s.literal(null),
    either: s.union([s.text(), s.literal(2)]),
  });

  assert.deepEqual(emitJsonSchema(effectSchema(declared)), declared.jsonSchema());
  assert.deepEqual(emitJsonSchema(effectSchema(declared.describe("one row"))), {
    ...declared.jsonSchema(),
    description: "one row",
  });
});

test("a record built from this builder's fields is a struct the emitter can walk", () => {
  const ast = effectSchema(point).ast;

  assert.ok(SchemaAST.isTransformation(ast));
  assert.ok(SchemaAST.isTypeLiteral(ast.from));
  assert.deepEqual(
    ast.from.propertySignatures.map((signature) => [signature.name, signature.isOptional]),
    [
      ["x", false],
      ["y", true],
    ],
  );
});

test("a field written as undefined is left out of the record, whether optional or a reader's answer", () => {
  const nothing = s.reader<string | undefined>({
    read: () => ({ ok: true, value: undefined }),
    jsonSchema: () => ({ type: "string" }),
  });
  const record = s.record({ id: s.text(), maybe: s.text().optional(), nothing });

  const parsed = record.parse(unparsedWire({ id: "a", maybe: undefined, nothing: "ignored" }));

  assert.deepEqual(parsed, { id: "a" });
  assert.ok(parsed !== undefined);
  assert.equal("maybe" in parsed, false);
  assert.equal("nothing" in parsed, false);
  const node = record.jsonSchema();
  assert.ok("required" in node);
  assert.deepEqual(node.required, ["id", "nothing"]);
});

test("a strict record nested in a tolerant one keeps refusing the keys it did not name", () => {
  const nested = s.record(
    { inner: s.record({ a: s.text() }) },
    { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
  );

  assert.deepEqual(nested.parse({ inner: { a: "x" }, later: 1 }), { inner: { a: "x" } });
  const refused = nested.read({ inner: { a: "x", b: 1 } });
  assert.ok(!refused.ok);
  assert.equal(refused.refusal, SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(refused.path, ["inner", "b"]);
});

test("a record is a plain object and nothing else, however few fields it names", () => {
  const empty = s.record({}, { extraKeys: RECORD_EXTRA_KEYS.IGNORE });
  const strict = s.record({});
  const loose = s.record({ a: s.text().optional() });

  assert.deepEqual(empty.parse({}), {});
  assert.deepEqual(empty.parse({ later: 1 }), {});
  assert.equal(empty.parse("x"), undefined);
  assert.equal(empty.parse([]), undefined);
  assert.equal(strict.parse({ a: 1 }), undefined);
  assert.deepEqual(strict.read({ a: 1 }), {
    ok: false,
    refusal: SCHEMA_REFUSAL.MALFORMED,
    path: ["a"],
  });
  // SAFETY: a class instance is the value under test, and an assertion is the only way to put one
  // where the boundary declares JSON.
  assert.equal(loose.parse(new Date(0) as unknown as UnparsedWireValue), undefined);
  assert.deepEqual(loose.parse({}), {});
});

test("an array's count is read before its entries, over the entries that arrived", () => {
  const bounded = s.array(s.text(), { max: 2 });
  const skipping = s.array(s.text(), { max: 2, skipRefused: true });

  assert.deepEqual(bounded.read(["a", 5, "c"]), {
    ok: false,
    refusal: SCHEMA_REFUSAL.TOO_LARGE,
    path: [],
  });
  assert.deepEqual(bounded.read(["a", 5]), {
    ok: false,
    refusal: SCHEMA_REFUSAL.MALFORMED,
    path: [1],
  });
  assert.deepEqual(skipping.read([5, 5, "c"]), {
    ok: false,
    refusal: SCHEMA_REFUSAL.TOO_LARGE,
    path: [],
  });
  assert.deepEqual(skipping.parse([5, "c"]), ["c"]);
});

test("a union no member admits is malformed at the union itself", () => {
  const tagged = s.record({
    items: s.array(
      s.union([
        s.record({ kind: s.literal("a"), text: s.text({ max: 1 }) }),
        s.record({ kind: s.literal("b"), count: s.wholeNumber() }),
      ]),
    ),
  });

  assert.deepEqual(tagged.parse({ items: [{ kind: "b", count: 1 }] }), {
    items: [{ kind: "b", count: 1 }],
  });
  assert.deepEqual(tagged.read({ items: [{ kind: "a", text: "too long" }] }), {
    ok: false,
    refusal: SCHEMA_REFUSAL.MALFORMED,
    path: ["items", 0],
  });
  assert.deepEqual(tagged.read({ items: [{ kind: "c" }] }), {
    ok: false,
    refusal: SCHEMA_REFUSAL.MALFORMED,
    path: ["items", 0],
  });
});

test("a trimmed member set decodes from the settled text and still shows its members", () => {
  const trimmed = s.enumOf(["waiting", "working"], { ends: TEXT_ENDS.TRIM }).describe("state");

  assert.deepEqual(readEither(effectSchema(trimmed))(" waiting "), Either.right("waiting"));
  assert.deepEqual(emitJsonSchema(effectSchema(trimmed)), {
    type: "string",
    enum: ["waiting", "working"],
    description: "state",
  });
});

test("a declared reader's own refusal travels through readEither with its word and path", () => {
  const inner = s.record({ b: s.text({ max: 1 }) });
  const reader = declareReader((value) => inner.read(value), {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  });
  const outer = EffectSchema.Struct({ a: EffectSchema.Array(reader) });

  const refused = readEither(outer)({ a: [{ b: "toolong" }] });
  const malformed = readEither(outer)({ a: [{ b: 1 }] });

  assert.ok(Either.isLeft(refused) && Either.isLeft(malformed));
  assert.equal(refused.left.refusal, SCHEMA_REFUSAL.TOO_LARGE);
  assert.deepEqual(refused.left.path, ["a", 0, "b"]);
  assert.equal(malformed.left.refusal, SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(malformed.left.path, ["a", 0, "b"]);
  assert.deepEqual(readEither(outer)({ a: [{ b: "x" }] }), Either.right({ a: [{ b: "x" }] }));
});

test("refusalIssue is the inverse of the reading: each word comes back at its path", () => {
  const inverse = EffectSchema.declare([], {
    decode: () => (input) =>
      Either.left(refusalIssue(SCHEMA_REFUSAL.NOT_REGISTERED, ["k", 2], input)),
    encode: () => (input) => Either.right(input),
  });

  const refused = readEither(EffectSchema.Struct({ field: inverse }))({ field: "x" });

  assert.ok(Either.isLeft(refused));
  assert.equal(refused.left.refusal, SCHEMA_REFUSAL.NOT_REGISTERED);
  assert.deepEqual(refused.left.path, ["field", "k", 2]);
});

test("a schema combined here has to be one this builder declared", () => {
  const foreign: Schema<string> = {
    ...s.text(),
    effect: EffectSchema.make(EffectSchema.String.ast),
  };

  assert.throws(() => s.array(foreign), Error);
});
