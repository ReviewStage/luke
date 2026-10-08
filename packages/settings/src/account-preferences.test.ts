import assert from "node:assert/strict";
import { LIVE_VOICE } from "@sidecar/live";
import { test } from "vitest";
import { APP_SETTING_SCHEMA } from "./schema.js";
import {
  ACCOUNT_PREFERENCE_FIELDS,
  accountPreferencesFromStored,
  accountPreferencesFromWire,
} from "./schema-access.js";

test("the account preference allowlist contains only cross-device preferences", () => {
  assert.deepEqual(ACCOUNT_PREFERENCE_FIELDS, ["voice"]);
  assert.equal(ACCOUNT_PREFERENCE_FIELDS.includes(APP_SETTING_SCHEMA.openAtLogin.field), false);
  assert.equal(ACCOUNT_PREFERENCE_FIELDS.includes(APP_SETTING_SCHEMA.voiceHotkey.field), false);
});

test("account preferences validate the shared fields and reject local-only payloads", () => {
  assert.deepEqual(accountPreferencesFromWire({ voice: LIVE_VOICE.MARIN }), {
    voice: LIVE_VOICE.MARIN,
  });

  assert.equal(accountPreferencesFromWire({ voiceHotkey: "Command+Space" }), undefined);
  assert.equal(accountPreferencesFromWire({ voice: "baritone" }), undefined);
  // The workspace defaults an earlier build synced are no preference of this one.
  assert.equal(accountPreferencesFromWire({ defaultWorkspaceProvider: "conductor" }), undefined);
});

test("null clears an account preference field in write payloads", () => {
  assert.deepEqual(accountPreferencesFromWire({ voice: null }), {});
});

test("account preferences reads ignore newer, retired, and corrupt stored fields", () => {
  assert.deepEqual(
    accountPreferencesFromStored({
      voice: LIVE_VOICE.SAGE,
      futureSetting: "held by a newer build",
      workspaceProjectDefaults: { conductor: "project-1" },
    }),
    { voice: LIVE_VOICE.SAGE },
  );
  assert.deepEqual(accountPreferencesFromStored({ voice: "baritone" }), {});
});
