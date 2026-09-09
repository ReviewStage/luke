import assert from "node:assert/strict";
import test from "node:test";
import { hostedProjectsAnswerSchema } from "./projects-wire.js";

const PROJECT = {
  providerId: "conductor",
  providerProjectId: "repo-1",
  repository: "luke",
  taskSupport: "optional",
};

test("an answer that listed no agent choices still lists its projects", () => {
  assert.deepEqual(hostedProjectsAnswerSchema.parse({ projects: [PROJECT] }), {
    projects: [PROJECT],
    agentModels: [],
  });
  assert.deepEqual(hostedProjectsAnswerSchema.parse({ projects: [], agentModels: "none" }), {
    projects: [],
    agentModels: [],
  });
  assert.equal(hostedProjectsAnswerSchema.parse({ agentModels: [] }), undefined);
});

test("an agent offered without the models it runs under is no choice, so its row goes", () => {
  const answer = hostedProjectsAnswerSchema.parse({
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
