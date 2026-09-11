import assert from "node:assert/strict";
import { test } from "vitest";
import { type UnparsedWireValue, unparsedWire } from "./json.js";
import {
  RECORD_EXTRA_KEYS,
  SCHEMA_REFUSAL,
  type Schema,
  s,
  TEXT_ENDS,
  TEXT_OVERFLOW,
} from "./schema.js";

function refusalOf(schema: Schema<unknown>, value: UnparsedWireValue): string {
  const read = schema.read(value);
  return read.ok ? "admitted" : read.refusal;
}

function pathOf(schema: Schema<unknown>, value: UnparsedWireValue): readonly (string | number)[] {
  const read = schema.read(value);
  return read.ok ? [] : read.path;
}

/** A wrapper object, as structured clone can deliver one where a primitive is expected. */
function boxed(value: string | number | boolean): UnparsedWireValue {
  // SAFETY: the wrapper object is the value under test, and an assertion is the only way to
  // put one where the boundary declares a primitive.
  return Object(value) as UnparsedWireValue;
}

test("a text is trimmed, and anything that is not a text is malformed", () => {
  assert.equal(s.text().parse("  hi  "), "hi");
  assert.equal(refusalOf(s.text(), 5), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(refusalOf(s.text(), null), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(refusalOf(s.text(), undefined), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(refusalOf(s.text(), ["hi"]), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(refusalOf(s.text(), boxed("hi")), SCHEMA_REFUSAL.MALFORMED);
});

test("a text of nothing but whitespace carries nothing, unless it is explicitly allowed", () => {
  assert.equal(refusalOf(s.text(), ""), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(refusalOf(s.text(), "   \n "), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(s.text({ allowEmpty: true }).parse(""), "");
  assert.equal(s.text({ allowEmpty: true }).parse("  "), "");
  assert.equal(s.text({ allowEmpty: true, ends: TEXT_ENDS.KEEP }).parse("  "), "  ");
});

test("a bounded text admits its bound and refuses one character past it", () => {
  const bounded = s.text({ max: 4 });
  assert.equal(bounded.parse("abcd"), "abcd");
  assert.equal(refusalOf(bounded, "abcde"), SCHEMA_REFUSAL.TOO_LARGE);
  assert.equal(bounded.parse("  abcd  "), "abcd");
});

test("a text kept as written is admitted with its own whitespace and lines", () => {
  const written = s.text({ ends: TEXT_ENDS.KEEP });
  assert.equal(written.parse("  hi\n\n\n there  "), "  hi\n\n\n there  ");
  assert.equal(refusalOf(written, "   "), SCHEMA_REFUSAL.MALFORMED);
});

test("a one-line text collapses its newlines and runs of spaces", () => {
  assert.equal(s.text({ oneLine: true }).parse("a\n\n  b   c\t"), "a b c");
  assert.equal(refusalOf(s.text({ oneLine: true }), " \n "), SCHEMA_REFUSAL.MALFORMED);
});

test("a one-line text cuts with an ellipsis only where it was declared to", () => {
  const cut = s.text({ max: 6, oneLine: true, overflow: TEXT_OVERFLOW.ELLIPSIS });
  assert.equal(cut.parse("one two three"), "one t…");
  assert.equal(cut.parse("one tw"), "one tw");
  assert.equal(
    refusalOf(s.text({ max: 6, oneLine: true }), "one two three"),
    SCHEMA_REFUSAL.TOO_LARGE,
  );
});

test("a text whose own rules contradict each other cannot be constructed", () => {
  assert.throws(() => s.text({ max: 6, overflow: TEXT_OVERFLOW.ELLIPSIS }), /ellipsis/u);
  assert.throws(() => s.text({ oneLine: true, overflow: TEXT_OVERFLOW.ELLIPSIS }), /ellipsis/u);
  assert.throws(
    () => s.text({ max: 0, oneLine: true, overflow: TEXT_OVERFLOW.ELLIPSIS }),
    /ellipsis/u,
  );
  assert.throws(() => s.text({ oneLine: true, ends: TEXT_ENDS.KEEP }), /ends/u);
  assert.throws(() => s.text({ oneLine: true, ends: TEXT_ENDS.TRIM }), /ends/u);
});

test("whole text settles its line endings and keeps the lines Markdown is written across", () => {
  assert.equal(
    s.wholeText().parse("## Done\r\n\r\nFixed it.  \n- a\n  - nested\n\n\n\n  end\n"),
    "## Done\n\nFixed it.\n- a\n  - nested\n\n  end",
  );
  assert.equal(refusalOf(s.wholeText(), "  \n\n \t"), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(refusalOf(s.wholeText({ max: 3 }), "abcd"), SCHEMA_REFUSAL.TOO_LARGE);
  assert.equal(s.wholeText({ max: 4 }).parse("abcd\n"), "abcd");
});

test("a number is finite, and a whole number is a safe integer", () => {
  assert.equal(s.number().parse(1.5), 1.5);
  assert.equal(refusalOf(s.number(), Number.NaN), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(refusalOf(s.number(), Number.POSITIVE_INFINITY), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(refusalOf(s.number(), "9"), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(refusalOf(s.number(), boxed(9)), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(s.wholeNumber().parse(9), 9);
  assert.equal(refusalOf(s.wholeNumber(), 1.5), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(refusalOf(s.wholeNumber(), Number.MAX_SAFE_INTEGER + 2), SCHEMA_REFUSAL.MALFORMED);
});

test("a number below its minimum is malformed and one above its maximum is too large", () => {
  const bounded = s.wholeNumber({ minimum: 0, maximum: 10 });
  assert.equal(bounded.parse(0), 0);
  assert.equal(bounded.parse(10), 10);
  assert.equal(refusalOf(bounded, -1), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(refusalOf(bounded, 11), SCHEMA_REFUSAL.TOO_LARGE);
});

test("a boolean, a literal, and an enum admit exactly what they name", () => {
  assert.equal(s.boolean().parse(false), false);
  assert.equal(refusalOf(s.boolean(), 0), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(refusalOf(s.boolean(), boxed(true)), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(s.literal(2).parse(2), 2);
  assert.equal(refusalOf(s.literal(2), 1), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(refusalOf(s.literal(2), "2"), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(s.literal(null).parse(null), null);
  assert.equal(refusalOf(s.literal(null), undefined), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(s.enumOf(["low", "high"]).parse("high"), "high");
  assert.equal(refusalOf(s.enumOf(["low", "high"]), "max"), SCHEMA_REFUSAL.MALFORMED);
});

test("an array reads its entries with one schema and refuses whole on a refused entry", () => {
  const texts = s.array(s.text());
  assert.deepEqual(texts.parse(["a", " b "]), ["a", "b"]);
  assert.deepEqual(texts.parse([]), []);
  assert.equal(refusalOf(texts, "a"), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(refusalOf(texts, ["a", 5]), SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(pathOf(texts, ["a", 5]), [1]);
});

test("an array's bounds read the way a number's do", () => {
  const bounded = s.array(s.text(), { minimum: 1, max: 2 });
  assert.equal(refusalOf(bounded, []), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(refusalOf(bounded, ["a", "b", "c"]), SCHEMA_REFUSAL.TOO_LARGE);
  assert.deepEqual(bounded.parse(["a", "b"]), ["a", "b"]);
});

test("an array told to skip a refused entry keeps the rest", () => {
  const skipping = s.array(s.text(), { skipRefused: true });
  assert.deepEqual(skipping.parse(["a", 5, " b "]), ["a", "b"]);
  assert.deepEqual(skipping.parse([5, null]), []);
});

test("the count that clears an array's minimum is the one admitted, not the one that arrived", () => {
  const atLeastOne = s.array(s.text(), { skipRefused: true, minimum: 1 });
  assert.deepEqual(atLeastOne.parse(["a", 5]), ["a"]);
  assert.equal(refusalOf(atLeastOne, [5, null]), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(refusalOf(atLeastOne, []), SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(atLeastOne.jsonSchema(), {
    type: "array",
    items: { type: "string", minLength: 1 },
    minItems: 1,
  });
});

test("a record admits exactly the keys it names", () => {
  const point = s.record({ x: s.wholeNumber(), y: s.wholeNumber() });
  assert.deepEqual(point.parse({ x: 1, y: 2 }), { x: 1, y: 2 });
  assert.equal(refusalOf(point, { x: 1, y: 2, z: 3 }), SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(pathOf(point, { x: 1, y: 2, z: 3 }), ["z"]);
  assert.equal(refusalOf(point, { x: 1 }), SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(pathOf(point, { x: 1 }), ["y"]);
  assert.equal(refusalOf(point, "x"), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(refusalOf(point, [1, 2]), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(
    refusalOf(point, JSON.parse('{"x":1,"y":2,"__proto__":{"polluted":true}}')),
    SCHEMA_REFUSAL.MALFORMED,
  );
});

test("a record told to ignore an unnamed key drops it", () => {
  const answer = s.record(
    { inputTokens: s.wholeNumber({ minimum: 0 }) },
    { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
  );
  assert.deepEqual(answer.parse({ inputTokens: 0, addedLater: "x" }), { inputTokens: 0 });
  assert.equal(refusalOf(answer, {}), SCHEMA_REFUSAL.MALFORMED);
});

test("an optional field may be absent, and an absent one is left out rather than written", () => {
  const options = s.record({ tokens: s.wholeNumber().optional(), effort: s.text().optional() });
  const absent = options.parse({});
  assert.ok(absent !== undefined);
  assert.ok(!("tokens" in absent));
  assert.ok(!("effort" in absent));
  const present = options.parse(unparsedWire({ tokens: 5, effort: undefined }));
  assert.deepEqual(present, { tokens: 5 });
  assert.ok(present !== undefined && !("effort" in present));
  assert.equal(refusalOf(options, { tokens: 1.5 }), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(options.optional().parse(undefined), undefined);
  assert.equal(s.text().optional().optional().parse(undefined), undefined);
});

test("a union admits the first member that reads the value", () => {
  const either = s.union([s.wholeNumber(), s.text()]);
  assert.equal(either.parse(4), 4);
  assert.equal(either.parse(" a "), "a");
  assert.equal(refusalOf(either, null), SCHEMA_REFUSAL.MALFORMED);
  const wider = s.union([s.text({ max: 1 }), s.text()]);
  assert.equal(wider.parse("ab"), "ab");
});

test("a brand parses through its inner schema and advertises the same node", () => {
  const branded = s.brand(s.text(), "SessionId");
  assert.equal(branded.parse(" s1 "), "s1");
  assert.equal(refusalOf(branded, 1), SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(branded.jsonSchema(), s.text().jsonSchema());
});

test("a registered value is its own refusal, apart from a malformed one", () => {
  const tool = s.registered(s.text({ ends: TEXT_ENDS.KEEP }), new Set(["announce"]));
  assert.equal(tool.parse("announce"), "announce");
  assert.equal(refusalOf(tool, "shell"), SCHEMA_REFUSAL.NOT_REGISTERED);
  assert.equal(refusalOf(tool, 5), SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(tool.jsonSchema(), { type: "string", minLength: 1 });
});

test("a refinement names its own refusal and a mapping keeps the node it read", () => {
  const unique = s.refine(
    s.array(s.text()),
    (names): names is string[] => new Set(names).size === names.length,
  );
  assert.deepEqual(unique.parse(["a", "b"]), ["a", "b"]);
  assert.equal(refusalOf(unique, ["a", "a"]), SCHEMA_REFUSAL.MALFORMED);
  const bounded = s.refine(
    s.wholeNumber(),
    (count): count is number => count % 2 === 0,
    SCHEMA_REFUSAL.TOO_LARGE,
  );
  assert.equal(refusalOf(bounded, 3), SCHEMA_REFUSAL.TOO_LARGE);
  const counted = s.map(s.array(s.text()), (names) => names.length);
  assert.equal(counted.parse(["a", "b"]), 2);
  assert.deepEqual(counted.jsonSchema(), s.array(s.text()).jsonSchema());
});

test("a reader is a schema over a rule no combinator holds", () => {
  const evens = s.reader<number[]>({
    read: (value) =>
      Array.isArray(value) && value.every((entry) => entry === 0)
        ? { ok: true, value: value.map(() => 0) }
        : { ok: false, refusal: SCHEMA_REFUSAL.MALFORMED, path: [] },
    jsonSchema: () => ({ type: "array", items: { type: "integer" } }),
  });
  assert.deepEqual(evens.parse([0, 0]), [0, 0]);
  assert.equal(refusalOf(evens, [1]), SCHEMA_REFUSAL.MALFORMED);
});

test("a nested refusal reports where in the value it happened", () => {
  const nested = s.record({ a: s.array(s.record({ b: s.text({ max: 1 }) })) });
  assert.deepEqual(pathOf(nested, { a: [{ b: "toolong" }] }), ["a", 0, "b"]);
  assert.equal(refusalOf(nested, { a: [{ b: "toolong" }] }), SCHEMA_REFUSAL.TOO_LARGE);
  assert.deepEqual(pathOf(nested, { a: [{ b: 1 }] }), ["a", 0, "b"]);
});

test("parse answers undefined for exactly the values read refuses", () => {
  const schemas: readonly Schema<unknown>[] = [
    s.text({ max: 3 }),
    s.wholeText(),
    s.wholeNumber({ minimum: 0, maximum: 2 }),
    s.boolean(),
    s.literal("x"),
    s.enumOf(["x", "y"]),
    s.array(s.text(), { max: 1 }),
    s.record({ a: s.text() }),
    s.union([s.text(), s.wholeNumber()]),
  ];
  const values: readonly UnparsedWireValue[] = [
    undefined,
    null,
    0,
    -1,
    1.5,
    Number.NaN,
    "",
    " ",
    "x",
    "toolong",
    true,
    [],
    ["x"],
    ["x", "y"],
    {},
    { a: "x" },
    { a: "x", b: 1 },
  ];
  for (const schema of schemas) {
    for (const value of values) {
      const read = schema.read(value);
      assert.deepEqual(
        schema.parse(value),
        read.ok ? read.value : undefined,
        `parse and read disagreed on ${JSON.stringify(value)}`,
      );
    }
  }
});

test("a record's node is the strict object form, with exactly its required keys", () => {
  const node = s
    .record({
      name: s.text({ max: 8 }).describe("what it is called"),
      effort: s.enumOf(["low", "high"]).optional(),
      counts: s.array(s.wholeNumber({ minimum: 0 }), { max: 4 }),
      done: s.boolean(),
    })
    .describe("one row")
    .jsonSchema();
  assert.deepEqual(node, {
    type: "object",
    description: "one row",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 8, description: "what it is called" },
      effort: { type: "string", enum: ["low", "high"] },
      counts: { type: "array", items: { type: "integer", minimum: 0 }, maxItems: 4 },
      done: { type: "boolean" },
    },
    required: ["name", "counts", "done"],
    additionalProperties: false,
  });
});

test("a union's node is an anyOf of its members', and a literal's names what it admits", () => {
  assert.deepEqual(s.union([s.text(), s.literal(2)]).jsonSchema(), {
    anyOf: [
      { type: "string", minLength: 1 },
      { type: "integer", enum: [2] },
    ],
  });
  assert.deepEqual(s.literal("done").jsonSchema(), { type: "string", enum: ["done"] });
  assert.deepEqual(s.literal(null).jsonSchema(), { type: "null" });
  assert.deepEqual(s.literal(true).jsonSchema(), { type: "boolean", enum: [true] });
  assert.deepEqual(s.literal(2).jsonSchema(), { type: "integer", enum: [2] });
  assert.deepEqual(s.literal(1.5).jsonSchema(), { type: "number", enum: [1.5] });
  assert.deepEqual(s.number({ maximum: 3 }).jsonSchema(), { type: "number", maximum: 3 });
});

test("describe leaves the schema it was called on alone", () => {
  const plain = s.text();
  const described = plain.describe("a name");
  assert.deepEqual(plain.jsonSchema(), { type: "string", minLength: 1 });
  assert.deepEqual(described.jsonSchema(), {
    type: "string",
    minLength: 1,
    description: "a name",
  });
  assert.equal(described.parse(" a "), "a");
});

test("describing an optional field leaves it optional", () => {
  const node = s.record({ a: s.text().optional().describe("maybe"), b: s.text() }).jsonSchema();
  assert.deepEqual(node, {
    type: "object",
    properties: {
      a: { type: "string", minLength: 1, description: "maybe" },
      b: { type: "string", minLength: 1 },
    },
    required: ["b"],
    additionalProperties: false,
  });
});

test("every bound a schema enforces is a bound its node carries", () => {
  assert.deepEqual(s.array(s.boolean(), { minimum: 2, max: 4 }).jsonSchema(), {
    type: "array",
    items: { type: "boolean" },
    minItems: 2,
    maxItems: 4,
  });
  assert.deepEqual(s.array(s.boolean(), { minimum: 2 }).jsonSchema(), {
    type: "array",
    items: { type: "boolean" },
    minItems: 2,
  });
  assert.deepEqual(s.wholeNumber({ minimum: 0 }).jsonSchema(), { type: "integer", minimum: 0 });
  assert.deepEqual(s.text({ allowEmpty: true }).jsonSchema(), { type: "string" });
  assert.deepEqual(s.wholeText({ max: 9 }).jsonSchema(), {
    type: "string",
    minLength: 1,
    maxLength: 9,
  });
});

test("a member set is stated exactly unless the declaration settles the ends first", () => {
  assert.equal(s.enumOf(["waiting", "working"]).parse(" waiting "), undefined);
  assert.equal(
    s.enumOf(["waiting", "working"], { ends: TEXT_ENDS.TRIM }).parse(" waiting "),
    "waiting",
  );
  assert.equal(s.enumOf(["waiting"], { ends: TEXT_ENDS.TRIM }).parse(" wait ing "), undefined);
  assert.equal(s.enumOf(["waiting"], { ends: TEXT_ENDS.TRIM }).parse(7), undefined);
  assert.deepEqual(s.enumOf(["waiting"], { ends: TEXT_ENDS.TRIM }).jsonSchema(), {
    type: "string",
    enum: ["waiting"],
  });
});

test("a dropped field leaves the key out rather than refusing what carried it", () => {
  const schema = s.record({
    id: s.text(),
    branch: s.dropRefused(s.text()),
    count: s.dropRefused(s.wholeNumber({ minimum: 0 })),
  });

  assert.deepEqual(schema.parse({ id: "a", branch: "main", count: 2 }), {
    id: "a",
    branch: "main",
    count: 2,
  });

  const dropped = schema.parse({ id: "a", branch: 7, count: -1 });
  assert.deepEqual(dropped, { id: "a" });
  assert.ok(dropped);
  assert.equal("branch" in dropped, false);
  assert.deepEqual(schema.parse({ id: "a" }), { id: "a" });
  // Only the field is forgiving: what carried it is refused as it always was.
  assert.equal(schema.parse({ branch: "main" }), undefined);
});

test("a dropped field is optional in the node it emits, and says what it would have carried", () => {
  const schema = s.record({ id: s.text(), count: s.dropRefused(s.wholeNumber({ minimum: 0 })) });
  assert.deepEqual(schema.jsonSchema(), {
    type: "object",
    properties: {
      id: { type: "string", minLength: 1 },
      count: { type: "integer", minimum: 0 },
    },
    required: ["id"],
    additionalProperties: false,
  });
});
