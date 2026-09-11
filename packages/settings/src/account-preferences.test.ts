import assert from "node:assert/strict";
import { LIVE_VOICE } from "@sidecar/live";
import { PROVIDER_ID, SUPERSET_WORKSPACE_PROVIDER_ID } from "@sidecar/session";
import { test } from "vitest";
import { APP_SETTING_SCHEMA } from "./schema.js";
import {
  ACCOUNT_PREFERENCE_FIELDS,
  accountPreferencesFromStored,
  accountPreferencesFromWire,
} from "./schema-access.js";

test("the account preference allowlist contains only cross-device preferences", () => {
  assert.deepEqual(ACCOUNT_PREFERENCE_FIELDS, [
    "voice",
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
      voice: LIVE_VOICE.MARIN,
      defaultWorkspaceProvider: PROVIDER_ID.CONDUCTOR,
      workspaceProjectDefaults: { conductor: "project-1" },
      workspaceAgentDefaults: {
        conductor: { agent: "codex", model: "gpt-5.6-sol", effort: "high" },
        [SUPERSET_WORKSPACE_PROVIDER_ID]: { agent: "composer" },
      },
    }),
    {
      voice: LIVE_VOICE.MARIN,
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
  // The phone's Realtime pace still travels in the shared snapshot; here it
  // is dropped rather than refused, so a phone's write stays readable.
  assert.deepEqual(accountPreferencesFromWire({ voice: LIVE_VOICE.MARIN, voiceSpeed: 1.5 }), {
    voice: LIVE_VOICE.MARIN,
  });
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
      voice: LIVE_VOICE.SAGE,
      futureSetting: "held by a newer build",
      workspaceAgentDefaults: { conductor: { agent: "codex", model: "no-such-model" } },
    }),
    { voice: LIVE_VOICE.SAGE },
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
