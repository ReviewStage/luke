import assert from "node:assert/strict";
import test from "node:test";
import { APP_SETTING_ID } from "@sidecar/guide";
import {
  AGENT_CHOICE,
  PROVIDER_ID,
  SUPERSET_WORKSPACE_PROVIDER_ID,
  WORKSPACE_AGENT_CHOICE_PROVIDERS,
  WORKSPACE_PROVIDER_ID_LIST,
  workspaceAgentChoice,
} from "@sidecar/session";
import {
  APP_SETTING_DEFAULTS,
  APP_SETTING_SCHEMA,
  providerDefaultChoice,
  settingGuideEntries,
  WORKSPACE_AGENT_SETTING_ID,
  workspaceAgentSettingProvider,
} from "./schema.js";

test("every provider declaring an agent choice has setting ids of its own, and no other does", () => {
  const declared = WORKSPACE_PROVIDER_ID_LIST.filter(
    (providerId) => workspaceAgentChoice(providerId) !== AGENT_CHOICE.NONE,
  );
  assert.deepEqual(Object.keys(WORKSPACE_AGENT_SETTING_ID).sort(), [...declared].sort());
  const ids = Object.values(WORKSPACE_AGENT_SETTING_ID).flatMap((entry) => Object.values(entry));
  assert.equal(new Set(ids).size, ids.length, "setting ids are distinct per provider");
  for (const id of ids) {
    assert.ok(workspaceAgentSettingProvider(id), id);
  }
  assert.equal(workspaceAgentSettingProvider(APP_SETTING_ID.VOICE), undefined);
});

test("a setting id names its provider and the half of the choice it moves", () => {
  assert.deepEqual(workspaceAgentSettingProvider(APP_SETTING_ID.WORKSPACE_AGENT_MODEL), {
    providerId: PROVIDER_ID.CONDUCTOR,
    choice: AGENT_CHOICE.MODELS,
    half: "model",
  });
  assert.deepEqual(workspaceAgentSettingProvider(APP_SETTING_ID.WORKSPACE_AGENT_EFFORT), {
    providerId: PROVIDER_ID.CONDUCTOR,
    choice: AGENT_CHOICE.MODELS,
    half: "effort",
  });
  assert.deepEqual(workspaceAgentSettingProvider(APP_SETTING_ID.SUPERSET_AGENT), {
    providerId: SUPERSET_WORKSPACE_PROVIDER_ID,
    choice: AGENT_CHOICE.KINDS,
  });
});

test("the agent rows keep the labels the pages and the search grew up with", () => {
  const entries = settingGuideEntries(APP_SETTING_DEFAULTS);
  const labelOf = (id: string) => entries.find((entry) => entry.id === id)?.label;
  assert.equal(labelOf(APP_SETTING_ID.WORKSPACE_AGENT_MODEL), "New Conductor agents run");
  assert.equal(labelOf(APP_SETTING_ID.SUPERSET_AGENT), "New Superset sessions run");
  const model = entries.find((entry) => entry.id === APP_SETTING_ID.WORKSPACE_AGENT_MODEL);
  assert.equal(model?.value, "Conductor's default");
  assert.equal(
    model?.manual,
    `the Conductor row under Providers, in the panel's Settings tab, on its Connections page — drawn once Conductor is connected`,
  );
  assert.equal(providerDefaultChoice("Conductor"), "Conductor's default");
  // One model row per models provider, one kind row per kinds provider, and
  // no effort row while nothing is chosen.
  assert.equal(
    entries.filter((entry) => workspaceAgentSettingProvider(entry.id)).length,
    WORKSPACE_AGENT_CHOICE_PROVIDERS[AGENT_CHOICE.MODELS].length +
      WORKSPACE_AGENT_CHOICE_PROVIDERS[AGENT_CHOICE.KINDS].length,
  );
});

test("the default workspace provider offers every project-offering provider by its own name", () => {
  const entries = settingGuideEntries(APP_SETTING_DEFAULTS);
  const row = entries.find((entry) => entry.id === APP_SETTING_ID.DEFAULT_WORKSPACE_PROVIDER);
  assert.deepEqual(row?.choices, [
    "ask each time",
    "Codex",
    "Conductor",
    "Conductor (local)",
    "Superset",
  ]);
  assert.equal(APP_SETTING_SCHEMA.defaultWorkspaceProvider.settingsPage, "connections");
});
