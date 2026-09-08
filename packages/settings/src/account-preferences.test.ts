import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_VOICE, REALTIME_VOICE_SPEED } from "@sidecar/realtime";
import { PROVIDER_ID, SUPERSET_WORKSPACE_PROVIDER_ID } from "@sidecar/session";
import {
  ACCOUNT_PREFERENCE_FIELDS,
  APP_SETTING_SCHEMA,
  accountPreferencesFromStored,
  accountPreferencesFromWire,
} from "./schema.js";

test("the account preference allowlist contains only cross-device preferences", () => {
  assert.deepEqual(ACCOUNT_PREFERENCE_FIELDS, [
    "voice",
    "voiceSpeed",
    "defaultWorkspaceProvider",
    "workspaceProjectDefaults",
    "workspaceAgentDefaults",
  ]);
  assert.equal(ACCOUNT_PREFERENCE_FIELDS.includes(APP_SETTING_SCHEMA.openAtLogin.field), false);
  assert.equal(ACCOUNT_PREFERENCE_FIELDS.includes(APP_SETTING_SCHEMA.voiceHotkey.field), false);
  assert.equal(
    ACCOUNT_PREFERENCE_FIELDS.includes(APP_SETTING_SCHEMA.sessionSearchQuery.field),
    false,
  );
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
    accountPreferencesFromStored({
      voice: REALTIME_VOICE.SAGE,
      futureSetting: "held by a newer build",
      workspaceAgentDefaults: { conductor: { agent: "codex", model: "no-such-model" } },
    }),
    { voice: REALTIME_VOICE.SAGE },
  );
});

test("strict account preferences parsing rejects map entries it would otherwise trim", () => {
  assert.deepEqual(accountPreferencesFromWire({ workspaceProjectDefaults: {} }), {});
  assert.equal(
    accountPreferencesFromWire({
      workspaceProjectDefaults: { conductor: "project-1", future: "project-2" },
    }),
    undefined,
  );
  assert.equal(
    accountPreferencesFromWire({
      workspaceAgentDefaults: { conductor: { agent: "codex", model: "missing" } },
    }),
    undefined,
  );
});
