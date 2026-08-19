import assert from "node:assert/strict";
import test from "node:test";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  decodeNonNegativeNumber,
  decodeOneLine,
  decodePositiveInteger,
  decodeRecord,
  decodeRecordFromJsonLine,
  decodeText,
  decodeWholeNumber,
  decodeWireNumber,
  decodeWireString,
  decodeWireValue,
  PlainWireRecordSchema,
  WireValueSchema,
} from "../../src/effect/wire-schema.js";
import { isRecord, type UnparsedWireValue } from "../../src/json.js";

test("decodeWireString accepts strings and rejects boxed or non-string values", () => {
  assert.equal(decodeWireString("hello"), "hello");
  assert.equal(decodeWireString(""), "");
  assert.equal(decodeWireString(1), undefined);
  assert.equal(decodeWireString(null), undefined);
  assert.equal(decodeWireString(Object("boxed")), undefined);
});

test("decodeWireNumber accepts numbers and rejects non-numbers", () => {
  assert.equal(decodeWireNumber(3), 3);
  assert.equal(decodeWireNumber(Number.NaN), Number.NaN);
  assert.equal(decodeWireNumber("3"), undefined);
  assert.equal(decodeWireNumber(Object(3)), undefined);
});

test("decodeRecord matches isRecord without validating nested values", () => {
  const plain = { a: 1, nested: { b: "two" } };
  const nullPrototype = Object.create(null);
  assert.equal(decodeRecord(plain), plain);
  assert.equal(decodeRecord(nullPrototype), nullPrototype);
  // SAFETY: test deliberately supplies an object with an undefined property value.
  const withUndefined = { a: undefined } as unknown as UnparsedWireValue;
  assert.equal(decodeRecord(withUndefined), withUndefined);
  assert.equal(decodeRecord([]), undefined);
  assert.equal(decodeRecord(null), undefined);
  // SAFETY: test deliberately supplies a non-plain object to prove rejection.
  assert.equal(decodeRecord(new Date() as unknown as UnparsedWireValue), undefined);
  assert.equal(isRecord(decodeRecord(plain)), true);
});

test("decodeText trims and drops empty strings", () => {
  assert.equal(decodeText("  hello  "), "hello");
  assert.equal(decodeText("   "), undefined);
  assert.equal(decodeText(4), undefined);
});

test("decodeWholeNumber keeps only finite numbers", () => {
  assert.equal(decodeWholeNumber(2), 2);
  assert.equal(decodeWholeNumber(Number.NaN), undefined);
  assert.equal(decodeWholeNumber(Number.POSITIVE_INFINITY), undefined);
  assert.equal(decodeWholeNumber("2"), undefined);
});

test("decodeOneLine collapses whitespace and truncates with an ellipsis", () => {
  assert.equal(decodeOneLine("  hello\nworld  ", 20), "hello world");
  assert.equal(decodeOneLine("   ", 10), undefined);
  assert.equal(decodeOneLine("abcdefghij", 5), "abcd…");
});

test("decodeRecordFromJsonLine parses plain objects and soft-fails on bad lines", () => {
  assert.deepEqual(decodeRecordFromJsonLine('{"a":1}'), { a: 1 });
  assert.equal(decodeRecordFromJsonLine("not json"), undefined);
  assert.equal(decodeRecordFromJsonLine("[1,2]"), undefined);
  assert.equal(decodeRecordFromJsonLine("{"), undefined);
});

test("decodePositiveInteger keeps the default for missing, infinite, or non-positive values", () => {
  assert.equal(decodePositiveInteger(undefined, 4), 4);
  assert.equal(decodePositiveInteger(Number.NaN, 4), 4);
  assert.equal(decodePositiveInteger(0, 4), 4);
  assert.equal(decodePositiveInteger(-1, 4), 4);
  assert.equal(decodePositiveInteger(3.9, 4), 3);
});

test("decodeNonNegativeNumber keeps the default for missing, infinite, or negative values", () => {
  assert.equal(decodeNonNegativeNumber(undefined, 4), 4);
  assert.equal(decodeNonNegativeNumber(Number.NaN, 4), 4);
  assert.equal(decodeNonNegativeNumber(-0.1, 4), 4);
  assert.equal(decodeNonNegativeNumber(0, 4), 0);
  assert.equal(decodeNonNegativeNumber(2.5, 4), 2.5);
});

test("WireValueSchema rejects undefined property values and accepts valid trees", () => {
  assert.deepEqual(decodeWireValue({ a: 1, b: [true, null] }), { a: 1, b: [true, null] });
  // SAFETY: test deliberately supplies an object with an undefined property value.
  assert.equal(decodeWireValue({ a: undefined } as unknown as UnparsedWireValue), undefined);
  assert.equal(Option.isNone(Schema.decodeUnknownOption(WireValueSchema)(Symbol("x"))), true);
});

test("PlainWireRecordSchema decodeUnknownOption matches decodeRecord", () => {
  const value = { keep: "me" };
  assert.deepEqual(
    Option.getOrUndefined(Schema.decodeUnknownOption(PlainWireRecordSchema)(value)),
    decodeRecord(value),
  );
});
