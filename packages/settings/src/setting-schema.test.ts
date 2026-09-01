import assert from "node:assert/strict";
import test from "node:test";
import type { UnparsedWireValue } from "@sidecar/wire";
import { decodeUnknown } from "@sidecar/wire/schema";
import type * as Schema from "effect/Schema";
import { APP_SETTING_FIELDS, APP_SETTING_SCHEMA, type AppSettingField } from "./schema.js";

function decodeSettingSchema(
  schema: Schema.Schema<unknown, UnparsedWireValue>,
  value: UnparsedWireValue,
): unknown {
  return decodeUnknown(schema, value);
}

const SAMPLE_WIRE = {
  openAtLogin: false,
  showInDock: true,
  voice: "ash",
  voiceSpeed: 1.25,
  voiceCaptions: true,
  voiceHotkey: "Command+Shift+Space",
  askHotkey: "Command+Shift+A",
  stopHotkey: "Escape",
  duckOtherMedia: false,
  voiceSource: "account",
  preferBuiltInMicrophone: false,
  quietDuringMeetings: false,
  syncProviderKeys: false,
  showOnAllDisplays: true,
  formFactor: "bubble",
  sessionFilters: ["working"],
  sessionSearchQuery: "luke",
  defaultWorkspaceProvider: "codex",
  workspaceAgentDefaults: { codex: { agent: "codex", model: "gpt-5" } },
  workspaceProjectDefaults: { codex: "proj_123" },
} satisfies Record<AppSettingField, UnparsedWireValue>;

test("every APP_SETTING_SCHEMA entry carries a catalog-derived schema", () => {
  for (const field of APP_SETTING_FIELDS) {
    assert.ok("schema" in APP_SETTING_SCHEMA[field], `${field} has no schema member`);
  }
});

test("setting schemas agree with guards on representative wire values", () => {
  for (const field of APP_SETTING_FIELDS) {
    const definition = APP_SETTING_SCHEMA[field];
    const wire = SAMPLE_WIRE[field];
    const guarded = definition.guard(wire);
    const decoded = decodeSettingSchema(
      definition.schema as Schema.Schema<unknown, UnparsedWireValue>,
      wire,
    );
    assert.deepEqual(decoded, guarded.value, field);
  }
});

test("setting schemas fall back like guards on corrupt wire values", () => {
  for (const field of APP_SETTING_FIELDS) {
    const definition = APP_SETTING_SCHEMA[field];
    const guarded = definition.guard("not-a-valid-value");
    const decoded = decodeSettingSchema(
      definition.schema as Schema.Schema<unknown, UnparsedWireValue>,
      "not-a-valid-value",
    );
    assert.deepEqual(decoded, guarded.value, field);
  }
});

test("AppSettingValue types stay aligned with schema outputs", () => {
  type Guarded = ReturnType<(typeof APP_SETTING_SCHEMA)["openAtLogin"]["guard"]>["value"];
  type Decoded = Schema.Schema.Type<(typeof APP_SETTING_SCHEMA)["openAtLogin"]["schema"]>;
  const _parity: Guarded extends Decoded ? (Decoded extends Guarded ? true : never) : never = true;
  assert.equal(_parity, true);
});
