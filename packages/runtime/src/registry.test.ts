import assert from "node:assert/strict";
import test from "node:test";
import { agentId } from "@sidecar/runtime-contracts";
import {
  CONFIGURATION_REFUSAL,
  ConfigurationStore,
  CREDENTIAL_REFERENCE_KIND,
  defaultAgentConfiguration,
  resolveConfiguration,
} from "./configuration.js";
import {
  type ContextEngineDescriptor,
  createRuntimeRegistries,
  type ItemFormatIdentity,
  MEMORY_CAPABILITY,
  REGISTRATION_REFUSAL,
  RegistrationError,
  type RegistrationRefusal,
  type RuntimeRegistries,
  TOOL_EFFECT,
  TOOL_EXECUTION,
  type ToolDescriptor,
} from "./registry.js";

const RESPONSES = { format: "responses", version: 1 } as const;
const OTHER = { format: "other", version: 1 } as const;

/** The refusal a registration threw, or nothing when it was accepted or threw something else. */
function refusalOf(register: () => void): RegistrationRefusal | undefined {
  try {
    register();
    return undefined;
  } catch (error) {
    return error instanceof RegistrationError ? error.refusal : undefined;
  }
}

function tool(id: string, effect: ToolDescriptor["effect"] = TOOL_EFFECT.READ): ToolDescriptor {
  return {
    id,
    schema: { name: id, description: id, parameters: {} },
    execution: TOOL_EXECUTION.HOST,
    effect,
    groups: [effect],
  };
}

function engine(id: string, itemFormat: ItemFormatIdentity = RESPONSES): ContextEngineDescriptor {
  return {
    id,
    itemFormat,
    create: () => {
      throw new Error("not built in this test");
    },
    checkpointFormatFor: (runtime) => ({
      runtime: runtime.id,
      runtimeVersion: runtime.version,
      format: itemFormat.format,
      formatVersion: itemFormat.version,
    }),
  };
}

function populated(): RuntimeRegistries {
  const registries = createRuntimeRegistries();
  registries.agentRuntimes.register({
    id: "loop",
    itemFormat: RESPONSES,
    create: () => {
      throw new Error("not built in this test");
    },
  });
  registries.contextEngines.register(engine("responses-engine"));
  registries.contextEngines.register(engine("other-engine", OTHER));
  registries.modelAdapters.register({
    id: "keyed",
    itemFormat: RESPONSES,
    credentialKind: CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY,
    fixedToolCatalog: false,
  });
  registries.modelAdapters.register({
    id: "hosted",
    itemFormat: RESPONSES,
    credentialKind: CREDENTIAL_REFERENCE_KIND.HOSTED_ACCOUNT,
    fixedToolCatalog: true,
  });
  registries.tools.register(tool("read_thing"));
  return registries;
}

function configuration(overrides: Partial<Parameters<typeof defaultAgentConfiguration>[0]> = {}) {
  return defaultAgentConfiguration({
    agentRuntimeId: "loop",
    modelAdapterId: "keyed",
    contextEngineId: "responses-engine",
    credential: { kind: CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY, providerId: "openai" },
    workspaceDirectory: "/tmp/workspace",
    ...overrides,
  });
}

test("a registry refuses a duplicate id, an empty id, and an incompatible entry, and keeps what it held", () => {
  const registries = populated();
  assert.equal(
    refusalOf(() => registries.tools.register(tool("read_thing"))),
    REGISTRATION_REFUSAL.DUPLICATE_ID,
  );
  assert.equal(
    refusalOf(() => registries.tools.register(tool(""))),
    REGISTRATION_REFUSAL.EMPTY_ID,
  );
  assert.equal(
    refusalOf(() =>
      registries.tools.register({
        ...tool("mismatch"),
        schema: { name: "another", description: "", parameters: {} },
      }),
    ),
    REGISTRATION_REFUSAL.INCOMPATIBLE,
  );
  assert.equal(
    refusalOf(() =>
      registries.tools.register({
        ...tool("speaking_performer", TOOL_EFFECT.SPEAK),
        execution: TOOL_EXECUTION.PERFORMER,
      }),
    ),
    REGISTRATION_REFUSAL.INCOMPATIBLE,
  );
  assert.equal(
    refusalOf(() =>
      registries.memoryProviders.register({
        id: "vectors",
        capabilities: [MEMORY_CAPABILITY.VECTOR],
      }),
    ),
    REGISTRATION_REFUSAL.INCOMPATIBLE,
  );
  registries.memoryProviders.register({
    id: "vectors",
    capabilities: [MEMORY_CAPABILITY.VECTOR],
    embeddingAdapterId: "embed",
  });
  assert.deepEqual(registries.tools.ids(), ["read_thing"]);
  assert.deepEqual(registries.memoryProviders.ids(), ["vectors"]);
});

test("resolution checks every name and pairing and answers a frozen configuration", () => {
  const registries = populated();
  const resolved = resolveConfiguration(configuration(), registries);
  assert.ok(resolved.ok);
  assert.ok(Object.isFrozen(resolved.configuration));
  assert.ok(Object.isFrozen(resolved.configuration.toolPolicy));

  const mismatched = resolveConfiguration(
    configuration({ contextEngineId: "other-engine" }),
    registries,
  );
  assert.ok(!mismatched.ok);
  assert.deepEqual(mismatched.refusals, [CONFIGURATION_REFUSAL.ITEM_FORMAT_MISMATCH]);

  const wrongCredential = resolveConfiguration(
    configuration({ modelAdapterId: "hosted" }),
    registries,
  );
  assert.ok(!wrongCredential.ok);
  assert.deepEqual(wrongCredential.refusals, [CONFIGURATION_REFUSAL.CREDENTIAL_KIND_MISMATCH]);

  const unknown = resolveConfiguration(
    configuration({ agentRuntimeId: "nope", modelAdapterId: "nope", contextEngineId: "nope" }),
    registries,
  );
  assert.ok(!unknown.ok);
  assert.deepEqual(unknown.refusals, [
    CONFIGURATION_REFUSAL.UNKNOWN_RUNTIME,
    CONFIGURATION_REFUSAL.UNKNOWN_MODEL_ADAPTER,
    CONFIGURATION_REFUSAL.UNKNOWN_CONTEXT_ENGINE,
  ]);
});

test("a store publishes atomically: a refused publish leaves the snapshot standing, an accepted one replaces it whole", () => {
  const registries = populated();
  const store = new ConfigurationStore(registries, configuration());
  const first = store.snapshot();
  const seen: number[] = [];
  store.subscribe((snapshot) => seen.push(snapshot.revision));

  const refused = store.publish(configuration({ contextEngineId: "other-engine" }));
  assert.ok(!refused.ok);
  assert.strictEqual(store.snapshot(), first);
  assert.deepEqual(seen, []);

  const accepted = store.publish(
    configuration({
      modelAdapterId: "hosted",
      credential: { kind: CREDENTIAL_REFERENCE_KIND.HOSTED_ACCOUNT },
      toolPolicy: { agent: { deny: ["read_thing"] } },
    }),
  );
  assert.ok(accepted.ok);
  const second = store.snapshot();
  assert.equal(second.revision, 2);
  assert.equal(second.configuration.modelAdapterId, "hosted");
  assert.deepEqual(second.configuration.toolPolicy, { agent: { deny: ["read_thing"] } });
  assert.deepEqual(first.configuration.toolPolicy, {});
  assert.deepEqual(seen, [2]);
  // The credential travels as a reference alone: no secret has a field to live in.
  assert.deepEqual(Object.keys(second.configuration.credential), ["kind"]);
});

test("two agents are two isolated stores over one set of registries", () => {
  const registries = populated();
  const main = new ConfigurationStore(registries, configuration());
  const other = new ConfigurationStore(
    registries,
    configuration({ agentId: agentId("other"), workspaceDirectory: "/tmp/other" }),
  );
  other.publish(
    configuration({
      agentId: agentId("other"),
      workspaceDirectory: "/tmp/other",
      toolPolicy: { agent: { deny: ["read_thing"] } },
    }),
  );
  assert.equal(main.snapshot().revision, 1);
  assert.deepEqual(main.snapshot().configuration.toolPolicy, {});
  assert.equal(other.snapshot().revision, 2);
  assert.equal(other.snapshot().configuration.agentId, "other");
  assert.equal(main.snapshot().configuration.agentId, "main");
});
