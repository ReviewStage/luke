import assert from "node:assert/strict";
import test from "node:test";
import { isActResult } from "./act-result.js";
import { ACT_RESULT_STATUS } from "./act-result-vocabulary.js";
import { isRecord, type UnparsedWireValue } from "./json.js";
import {
  ActResultSchema,
  decodeActResult,
  decodeRecord,
  decodeReleaseVersion,
  decodeStructuredCloneInput,
  decodeUnknown,
  decodeWireValue,
  PlainWireRecordSchema,
  ReleaseVersionSchema,
  STRICT_EXCESS_PROPERTY,
  StructuredCloneInputSchema,
  WireValueSchema,
} from "./schema.js";

const actResultCorpus: ReadonlyArray<{
  label: string;
  value: UnparsedWireValue;
  accepted: boolean;
}> = [
  { label: "accepted", value: { status: ACT_RESULT_STATUS.ACCEPTED }, accepted: true },
  {
    label: "rejected",
    value: { status: ACT_RESULT_STATUS.REJECTED, reason: "Not now." },
    accepted: true,
  },
  {
    label: "unsupported",
    value: { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: "Not here." },
    accepted: true,
  },
  {
    label: "accepted with contradiction",
    value: { status: ACT_RESULT_STATUS.ACCEPTED, reason: "contradiction" },
    accepted: false,
  },
  {
    label: "accepted with extra field",
    value: { status: ACT_RESULT_STATUS.ACCEPTED, setting: "Captions" },
    accepted: false,
  },
  {
    label: "rejected without reason",
    value: { status: ACT_RESULT_STATUS.REJECTED },
    accepted: false,
  },
  {
    label: "rejected with extra field",
    value: { status: ACT_RESULT_STATUS.REJECTED, reason: "Not now.", extra: true },
    accepted: false,
  },
  {
    label: "unsupported without reason",
    value: { status: ACT_RESULT_STATUS.UNSUPPORTED },
    accepted: false,
  },
  { label: "unknown status", value: { status: "sent" }, accepted: false },
  { label: "not a record", value: { ok: false }, accepted: false },
];

test("ActResult schema matches the hand guard corpus", () => {
  for (const sample of actResultCorpus) {
    assert.equal(isActResult(sample.value), sample.accepted, sample.label);
    assert.equal(decodeActResult(sample.value) !== undefined, sample.accepted, sample.label);
    assert.equal(
      decodeUnknown(ActResultSchema, sample.value, STRICT_EXCESS_PROPERTY) !== undefined,
      sample.accepted,
      sample.label,
    );
  }
});

test("plain records reject arrays, boxed primitives, and class instances", () => {
  assert.equal(decodeRecord({ a: 1 }) !== undefined, true);
  assert.equal(decodeRecord([]), undefined);
  assert.equal(decodeRecord(null), undefined);
  assert.equal(decodeRecord(new String("x") as unknown as UnparsedWireValue), undefined);
  assert.equal(decodeRecord(new Date() as unknown as UnparsedWireValue), undefined);
});

test("JSON wire values exclude undefined; structured clone keeps it", () => {
  const json = { items: [1, "x", null, { nested: true }] };
  assert.deepEqual(decodeWireValue(json), json);
  assert.equal(decodeWireValue(undefined), undefined);

  const clone = { gap: undefined, items: [undefined, "held"] };
  assert.deepEqual(decodeStructuredCloneInput(clone), clone);
  assert.equal(decodeStructuredCloneInput(undefined), undefined);
  assert.equal(decodeUnknown(WireValueSchema, clone), undefined);
  assert.equal(decodeUnknown(StructuredCloneInputSchema, json) !== undefined, true);
});

test("release version schema matches parseReleaseVersion", () => {
  for (const [value, accepted] of [
    ["0.1.0", true],
    ["v12.34.56", true],
    [" v0.2.0 ", true],
    ["0.1", false],
    ["0.1.0-beta.1", false],
    ["/Users/me/luke", false],
  ] as const) {
    assert.equal(decodeReleaseVersion(value) !== undefined, accepted, value);
    assert.equal(decodeUnknown(ReleaseVersionSchema, value) !== undefined, accepted, value);
  }
});

test("malformed JSONL records stay isolated through plain record decode", () => {
  assert.equal(isRecord(JSON.parse('{"a":1}')), true);
  assert.equal(isRecord(JSON.parse("[]")), false);
  assert.equal(decodeUnknown(PlainWireRecordSchema, JSON.parse("[]")), undefined);
});
