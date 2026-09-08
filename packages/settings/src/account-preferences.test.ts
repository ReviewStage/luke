import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_VOICE, REALTIME_VOICE_SPEED } from "@sidecar/realtime";
import { PROVIDER_ID, SUPERSET_WORKSPACE_PROVIDER_ID } from "@sidecar/session";
import {
  ACCOUNT_PREFERENCE_FIELDS,
  APP_SETTING_SCHEMA,
  accountPreferencesAnswerFromWire,
  accountPreferencesEmpty,
  accountPreferencesFromStored,
  accountPreferencesFromWire,
  isAccountPreferenceField,
  type StoredAppSettings,
  sameAccountPreferences,
  sameAccountPreferenceValue,
} from "./schema.js";

test("the account preference allowlist contains only cross-device preferences", () => {
  assert.deepEqual(ACCOUNT_PREFERENCE_FIELDS, [
    "voice",
    "voiceSpeed",
    "defaultWorkspaceProvider",
    "workspaceProjectDefaults",
    "workspaceAgentDefaults",
  ]);
  assert.equal(isAccountPreferenceField(APP_SETTING_SCHEMA.openAtLogin.field), false);
  assert.equal(isAccountPreferenceField(APP_SETTING_SCHEMA.voiceHotkey.field), false);
  assert.equal(isAccountPreferenceField(APP_SETTING_SCHEMA.sessionSearchQuery.field), false);
});

test("account preferences validate the shared fields and reject local-only payloads", () => {
  assert.deepEqual(
    accountPreferencesFromWire({
      voice: REALTIME_VOICE.MARIN,
      voiceSpeed: REALTIME_VOICE_SPEED.FAST,
      defaultWorkspaceProvider: PROVIDER_ID.CONDUCTOR,
      workspaceProjectDefaults: { conductor: "project-1" },
      workspaceAgentDefaults: {
        conductor: { agent: "codex", model: "gpt-5.6-sol", effort: "high" },
        [SUPERSET_WORKSPACE_PROVIDER_ID]: { agent: "composer" },
      },
    }),
    {
      voice: REALTIME_VOICE.MARIN,
      voiceSpeed: REALTIME_VOICE_SPEED.FAST,
      defaultWorkspaceProvider: PROVIDER_ID.CONDUCTOR,
      workspaceProjectDefaults: { conductor: "project-1" },
      workspaceAgentDefaults: {
        conductor: { agent: "codex", model: "gpt-5.6-sol", effort: "high" },
        [SUPERSET_WORKSPACE_PROVIDER_ID]: { agent: "composer" },
      },
    },
  );

  assert.equal(accountPreferencesFromWire({ voiceHotkey: "Command+Space" }), undefined);
  assert.equal(accountPreferencesFromWire({ voice: "baritone" }), undefined);
});

test("null clears an account preference field in write payloads", () => {
  assert.deepEqual(
    accountPreferencesFromWire({
      voice: null,
      workspaceProjectDefaults: { conductor: "project-1" },
    }),
    { workspaceProjectDefaults: { conductor: "project-1" } },
  );
});

test("account preferences reads ignore newer and corrupt stored fields", () => {
  assert.deepEqual(
    accountPreferencesFromWire(
      {
        voice: REALTIME_VOICE.SAGE,
        futureSetting: "held by a newer build",
        workspaceAgentDefaults: { conductor: { agent: "codex", model: "no-such-model" } },
      },
      { unknownFields: "ignore", invalidFields: "ignore" },
    ),
    { voice: REALTIME_VOICE.SAGE },
  );
});

test("an account preferences answer carries only validated fields plus its timestamp", () => {
  assert.deepEqual(
    accountPreferencesAnswerFromWire({
      preferences: {
        voice: REALTIME_VOICE.CORAL,
        openAtLogin: false,
      },
      updatedAt: 1_800_000_000_000,
    }),
    { preferences: { voice: REALTIME_VOICE.CORAL }, updatedAt: 1_800_000_000_000 },
  );
  assert.equal(accountPreferencesAnswerFromWire({ preferences: {}, updatedAt: -1 }), undefined);
});

test("account preferences are extracted from stored settings without resolved defaults", () => {
  // SAFETY: This fixture includes required stored fields beside optional hosted ones.
  const settings = {
    openAtLogin: true,
    showInDock: false,
    voice: undefined,
    voiceSpeed: REALTIME_VOICE_SPEED.SLOW,
    voiceHotkey: "Command+Shift+Space",
    defaultWorkspaceProvider: PROVIDER_ID.CODEX,
    workspaceProjectDefaults: undefined,
    workspaceAgentDefaults: { conductor: { agent: "codex", model: "gpt-5.6-terra" } },
  } as StoredAppSettings;

  assert.deepEqual(accountPreferencesFromStored(settings), {
    voiceSpeed: REALTIME_VOICE_SPEED.SLOW,
    defaultWorkspaceProvider: PROVIDER_ID.CODEX,
    workspaceAgentDefaults: { conductor: { agent: "codex", model: "gpt-5.6-terra" } },
  });
  assert.equal(accountPreferencesEmpty({}), true);
  assert.equal(accountPreferencesEmpty({ voice: REALTIME_VOICE.ASH }), false);
  assert.equal(
    sameAccountPreferenceValue(
      { conductor: { model: "gpt-5.6-sol", agent: "codex" } },
      { conductor: { agent: "codex", model: "gpt-5.6-sol" } },
    ),
    true,
  );
  assert.equal(
    sameAccountPreferences(
      {
        workspaceAgentDefaults: {
          conductor: { model: "gpt-5.6-sol", agent: "codex" },
        },
      },
      {
        workspaceAgentDefaults: {
          conductor: { agent: "codex", model: "gpt-5.6-sol" },
        },
      },
    ),
    true,
  );
});
