import assert from "node:assert/strict";
import test from "node:test";
import { CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID, WORKSPACE_PROVIDER_ID_LIST } from "./providers.js";
import {
  AGENT_CHOICE,
  WORKSPACE_AGENT_CHOICE,
  WORKSPACE_AGENT_CHOICE_PROVIDERS,
  WORKSPACE_AGENT_MODELS,
  workspaceAgentChoice,
  workspaceAgentModels,
} from "./workspace-agents.js";

test("the providers choosing a model are exactly the ones the models table documents", () => {
  assert.deepEqual(
    [...WORKSPACE_AGENT_CHOICE_PROVIDERS[AGENT_CHOICE.MODELS]].sort(),
    Object.keys(WORKSPACE_AGENT_MODELS).sort(),
  );
  for (const providerId of WORKSPACE_AGENT_CHOICE_PROVIDERS[AGENT_CHOICE.MODELS]) {
    assert.ok(workspaceAgentModels(providerId).length > 0, providerId);
  }
});

test("a provider choosing among observed kinds documents no models table", () => {
  for (const providerId of WORKSPACE_AGENT_CHOICE_PROVIDERS[AGENT_CHOICE.KINDS]) {
    assert.equal(Object.hasOwn(WORKSPACE_AGENT_MODELS, providerId), false, providerId);
    assert.deepEqual(workspaceAgentModels(providerId), []);
  }
});

test("every workspace provider declares one choice, in list order", () => {
  assert.deepEqual(
    Object.keys(WORKSPACE_AGENT_CHOICE).sort(),
    [...WORKSPACE_PROVIDER_ID_LIST].sort(),
  );
  const declared = WORKSPACE_PROVIDER_ID_LIST.filter(
    (providerId) => workspaceAgentChoice(providerId) !== AGENT_CHOICE.NONE,
  );
  assert.deepEqual(declared, [
    ...WORKSPACE_AGENT_CHOICE_PROVIDERS[AGENT_CHOICE.MODELS],
    ...WORKSPACE_AGENT_CHOICE_PROVIDERS[AGENT_CHOICE.KINDS],
  ]);
  assert.equal(workspaceAgentChoice(CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID), AGENT_CHOICE.NONE);
  assert.equal(workspaceAgentChoice("github"), AGENT_CHOICE.NONE);
});
