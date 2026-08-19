/** JSON values used by fake HTTP bodies and transcript fixtures. */
export type JsonPrimitive = string | number | boolean | null;

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonArray = JsonValue[];

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/** Parsed JSON object from a realtime or transcript fixture line. */
export interface ParsedJsonObject {
  [key: string]: JsonValue;
}
