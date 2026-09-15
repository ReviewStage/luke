import assert from "node:assert/strict";
import { EXCESS_KEYS, type UnparsedWireValue } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { type Schema as EffectSchema, Result } from "effect";
import { test } from "vitest";
import { hostedProjectsAnswerSchema } from "./projects-wire.js";

/** An answer read: a key a newer service added is dropped rather than refused. */
function parse<S extends EffectSchema.ConstraintDecoder<unknown>>(
  schema: S,
  value: UnparsedWireValue,
): S["Type"] | undefined {
  return Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(value));
}

const PROJECT = {
  providerId: "conductor",
  providerProjectId: "repo-1",
  repository: "luke",
  taskSupport: "optional",
};

test("an answer that listed no agent choices still lists its projects", () => {
  assert.deepEqual(parse(hostedProjectsAnswerSchema, { projects: [PROJECT] }), {
    projects: [PROJECT],
    agentModels: [],
  });
  assert.deepEqual(parse(hostedProjectsAnswerSchema, { projects: [], agentModels: "none" }), {
    projects: [],
    agentModels: [],
  });
  assert.equal(parse(hostedProjectsAnswerSchema, { agentModels: [] }), undefined);
});

test("an agent offered without the models it runs under is no choice, so its row goes", () => {
  const answer = parse(hostedProjectsAnswerSchema, {
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
