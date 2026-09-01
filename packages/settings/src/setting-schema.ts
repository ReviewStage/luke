import type { UnparsedWireValue } from "@sidecar/wire";
import * as Schema from "effect/Schema";
import type { SettingGuardResult } from "./schema.js";

/** Catalog guard semantics as a persisted-field schema decoder. */
export function settingSchemaFromGuard<Value>(
  guard: (value: UnparsedWireValue) => SettingGuardResult<Value>,
): Schema.Schema<Value, UnparsedWireValue> {
  return Schema.transform(Schema.Unknown, Schema.Unknown, {
    strict: true,
    decode: (input) => guard(input as UnparsedWireValue).value,
    encode: (value) => value,
  }) as Schema.Schema<Value, UnparsedWireValue>;
}
