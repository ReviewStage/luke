import assert from "node:assert/strict";
import { test } from "vitest";
import { hostedProjectsAnswerFromWire } from "./projects-wire.js";

const PROJECT = {
  providerId: "conductor",
  providerProjectId: "repo-1",
  repository: "luke",
  taskSupport: "optional",
};

test("an answer that listed no agent choices still lists its projects", () => {
  assert.deepEqual(hostedProjectsAnswerFromWire({ projects: [PROJECT] }), {
    projects: [PROJECT],
    agentModels: [],
  });
  assert.deepEqual(hostedProjectsAnswerFromWire({ projects: [], agentModels: "none" }), {
    projects: [],
    agentModels: [],
  });
  assert.equal(hostedProjectsAnswerFromWire({ agentModels: [] }), undefined);
});

test("an agent offered without the models it runs under is no choice, so its row goes", () => {
  const answer = hostedProjectsAnswerFromWire({
    projects: [PROJECT],
    agentModels: [
      { providerId: "conductor", agent: "claude", models: [], efforts: [] },
      { providerId: "conductor", agent: "codex", models: [{ id: "o" }], efforts: [] },
      {
        providerId: "conductor",
        agent: "opencode",
        models: [{ id: "o", label: "O" }],
        efforts: ["", "high"],
      },
    ],
  });
  assert.deepEqual(answer?.agentModels, [
    {
      providerId: "conductor",
      agent: "opencode",
      models: [{ id: "o", label: "O" }],
      efforts: ["high"],
    },
  ]);
});
