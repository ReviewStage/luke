import type { WireRecord } from "../json.js";

export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export type JsonValue = string | number | boolean | null | JsonObject | readonly JsonValue[];

export type ParsedJsonObject = WireRecord;

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  if (value === null || value === undefined) return false;
  if (Object.prototype.toString.call(value) !== "[object Object]") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
