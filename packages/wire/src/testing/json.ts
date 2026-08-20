import type { WireRecord, WireValue } from "../json.js";

/** JSON values used by fake HTTP bodies and transcript fixtures. */
export type JsonPrimitive = string | number | boolean | null;

/**
 * An absent property is spelled `undefined` because that is what a fixture
 * builder produces for a field its scenario leaves out, and what
 * `JSON.stringify` then drops — so the type says what the fake actually sends.
 */
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

/** Readonly, because a fixture hands its array over rather than lending it. */
export type JsonArray = readonly JsonValue[];

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/**
 * A wire record still being built. The same values a parsed one carries — no
 * absent-field `undefined` — but writable, so a fixture can add the fields its
 * scenario calls for and then hand the record on.
 */
export interface MutableWireRecord {
  [key: string]: WireValue;
}

/**
 * A JSON object parsed from a realtime or transcript fixture line. It is the
 * wire record itself rather than a copy of its shape: a fixture line stands in
 * for what a provider actually sent, and every consumer takes it as such.
 */
export type ParsedJsonObject = WireRecord;
