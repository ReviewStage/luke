import assert from "node:assert/strict";
import { Schema } from "effect";
import { test } from "vitest";
import {
  HTTP_METHOD,
  HTTP_STATUS,
  HttpMethodSchema,
  HttpStatusSchema,
  isInstant,
  isOptionalWireString,
  isRecord,
  isUnitLevel,
  isWireBoolean,
  isWireNumber,
  isWireString,
  nonNegativeNumber,
  positiveInteger,
  resolveOptions,
  text,
  type UnparsedWireValue,
  valueFromJsonText,
  WireValueSchema,
} from "./json.js";

test("positiveInteger keeps the default for missing, infinite, or non-positive values", () => {
  assert.equal(positiveInteger(undefined, 4), 4);
  assert.equal(positiveInteger(Number.NaN, 4), 4);
  assert.equal(positiveInteger(0, 4), 4);
  assert.equal(positiveInteger(-1, 4), 4);
  assert.equal(positiveInteger(3.9, 4), 3);
});

test("nonNegativeNumber keeps the default for missing, infinite, or negative values", () => {
  assert.equal(nonNegativeNumber(undefined, 4), 4);
  assert.equal(nonNegativeNumber(Number.NaN, 4), 4);
  assert.equal(nonNegativeNumber(-0.1, 4), 4);
  assert.equal(nonNegativeNumber(0, 4), 0);
  assert.equal(nonNegativeNumber(2.5, 4), 2.5);
});

test("resolveOptions bounds each listed key and leaves the rest at their defaults", () => {
  const resolved = resolveOptions(
    { maximumSessions: 3.9, refreshMs: -1 },
    { maximumSessions: 12, refreshMs: 15_000, pageSize: 100 },
    {
      positive: ["maximumSessions", "pageSize"],
      nonNegative: ["refreshMs"],
    },
  );
  assert.deepEqual(resolved, {
    maximumSessions: 3,
    refreshMs: 15_000,
    pageSize: 100,
  });
});

/** A wrapper object, as structured clone can deliver one where a primitive is expected. */
function boxed(value: string | number | boolean): UnparsedWireValue {
  // SAFETY: the wrapper object is the value under test, and an assertion is the only way to
  // put one where the boundary declares a primitive.
  return Object(value) as UnparsedWireValue;
}

test("a boxed primitive is not the primitive it prints as", () => {
  assert.equal(isWireString(boxed("x")), false);
  assert.equal(isWireNumber(boxed(1)), false);
  assert.equal(isWireBoolean(boxed(true)), false);
  assert.equal(isRecord(boxed("x")), false);
  assert.equal(text(boxed("x")), undefined);
});

test("isOptionalWireString takes a string or its absence, and nothing else", () => {
  assert.equal(isOptionalWireString(undefined), true);
  assert.equal(isOptionalWireString(""), true);
  assert.equal(isOptionalWireString("a"), true);
  assert.equal(isOptionalWireString(null), false);
  assert.equal(isOptionalWireString(1), false);
  assert.equal(isOptionalWireString(boxed("x")), false);
});

test("isUnitLevel refuses anything outside the 0-to-1 scale", () => {
  assert.equal(isUnitLevel(0), true);
  assert.equal(isUnitLevel(1), true);
  assert.equal(isUnitLevel(0.5), true);
  assert.equal(isUnitLevel(-0.1), false);
  assert.equal(isUnitLevel(1.1), false);
  assert.equal(isUnitLevel(Number.POSITIVE_INFINITY), false);
  assert.equal(isUnitLevel(Number.NaN), false);
  assert.equal(isUnitLevel("1"), false);
  assert.equal(isUnitLevel(undefined), false);
  assert.equal(isUnitLevel(boxed(0.5)), false);
});

test("isInstant refuses anything not a finite, non-negative epoch", () => {
  assert.equal(isInstant(0), true);
  assert.equal(isInstant(1_700_000_000_000), true);
  assert.equal(isInstant(-1), false);
  assert.equal(isInstant(Number.POSITIVE_INFINITY), false);
  assert.equal(isInstant(Number.NaN), false);
  assert.equal(isInstant("1"), false);
  assert.equal(isInstant(undefined), false);
  assert.equal(isInstant(boxed(1)), false);
});

test("isRecord admits a record whose values are not themselves wire values", () => {
  // SAFETY: the values under test are deliberately not wire values, to prove isRecord checks shape alone.
  assert.equal(isRecord({ handler: () => {} } as unknown as UnparsedWireValue), true);
  assert.equal(isRecord([1, 2]), false);
  // SAFETY: see above.
  assert.equal(isRecord(new Date() as unknown as UnparsedWireValue), false);
  assert.equal(isRecord(Object.create(null)), true);
});

test("WireValueSchema admits nested primitives, records, and arrays, and refuses what is not wire data", () => {
  const readsWireValue = Schema.is(WireValueSchema);
  assert.equal(readsWireValue({ a: { b: [1, 2, "x"], c: null } }), true);
  assert.equal(readsWireValue([{ a: 1 }, { b: "x" }]), true);
  assert.equal(readsWireValue({ handler: () => {} }), false);
  assert.equal(readsWireValue(new Date()), false);
  assert.equal(readsWireValue(boxed("x")), false);
});

test("HttpMethodSchema and HttpStatusSchema admit exactly the declared set", () => {
  const readsHttpMethod = Schema.is(HttpMethodSchema);
  const readsHttpStatus = Schema.is(HttpStatusSchema);
  for (const method of Object.values(HTTP_METHOD)) {
    assert.equal(readsHttpMethod(method), true);
  }
  for (const status of Object.values(HTTP_STATUS)) {
    assert.equal(readsHttpStatus(status), true);
  }
  assert.equal(readsHttpMethod("PATCH"), false);
  assert.equal(readsHttpStatus(500), false);
});

test("valueFromJsonText reads JSON as the data it carries and keeps other text as text", () => {
  assert.deepEqual(valueFromJsonText('{"status":"unknown","reason":"lost"}'), {
    status: "unknown",
    reason: "lost",
  });
  assert.deepEqual(valueFromJsonText("[1,2]"), [1, 2]);
  assert.equal(valueFromJsonText("3"), 3);
  assert.equal(valueFromJsonText("{broken"), "{broken");
  assert.equal(valueFromJsonText(""), "");
});
