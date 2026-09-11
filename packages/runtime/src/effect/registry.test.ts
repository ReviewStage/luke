import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import {
  BUILTIN_CONTEXT_ENGINE,
  BUILTIN_MODEL_ADAPTER,
  BUILTINS,
  CONFIGURATION_REFUSAL,
  CREDENTIAL_REFERENCE_KIND,
  defaultAgentConfiguration,
  TOOL_LOOP_RUNTIME,
} from "../registry.js";
import { Builtins, BuiltinsLive, resolveConfigurationEffect } from "./registry.js";

function configuration(overrides: Partial<Parameters<typeof defaultAgentConfiguration>[0]> = {}) {
  return defaultAgentConfiguration({
    agentRuntimeId: TOOL_LOOP_RUNTIME.ID,
    modelAdapterId: BUILTIN_MODEL_ADAPTER.OPENAI,
    contextEngineId: BUILTIN_CONTEXT_ENGINE.RESPONSES,
    credential: { kind: CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY, providerId: "openai" },
    workspaceDirectory: "/tmp/workspace",
    ...overrides,
  });
}

it.effect("BuiltinsLive hands down the same table the module constant holds", () =>
  Effect.gen(function* () {
    const table = yield* Effect.provide(Builtins, BuiltinsLive);
    assert.strictEqual(table, BUILTINS);
  }),
);

it.effect("resolveConfigurationEffect succeeds with the frozen configuration", () =>
  Effect.gen(function* () {
    const resolved = yield* resolveConfigurationEffect(configuration());
    assert.ok(Object.isFrozen(resolved));
    assert.equal(resolved.modelAdapterId, BUILTIN_MODEL_ADAPTER.OPENAI);
  }),
);

it.effect("resolveConfigurationEffect fails with the same refusal the Either carries", () =>
  Effect.gen(function* () {
    const wireShaped = { ...configuration(), contextEngineId: "someone-elses-engine" };
    const refusal = yield* Effect.flip(resolveConfigurationEffect(wireShaped));

    assert.equal(refusal._tag, "ConfigurationRefused");
    assert.equal(refusal.code, CONFIGURATION_REFUSAL.UNKNOWN_ID);
  }),
);
