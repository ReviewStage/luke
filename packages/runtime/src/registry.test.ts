import assert from "node:assert/strict";
import { Either } from "effect";
import { test } from "vitest";
import { agentId } from "./identifiers.js";
import {
  BUILTIN_CONTEXT_ENGINE,
  BUILTIN_EMBEDDING_ADAPTER,
  BUILTIN_MEMORY_PROVIDER,
  BUILTIN_MODEL_ADAPTER,
  BUILTINS,
  CONFIGURATION_OUTCOME,
  CONFIGURATION_REFUSAL,
  type ConfigurationOutcome,
  ConfigurationStore,
  CREDENTIAL_REFERENCE_KIND,
  defaultAgentConfiguration,
  MEMORY_CAPABILITY,
  notebookMemoryProviderFor,
  RESPONSES_ITEM_FORMAT,
  resolveConfigurationEither,
  TOOL_EFFECT,
  TOOL_EXECUTION,
  TOOL_LOOP_RUNTIME,
  type ToolPlacement,
  UI_MESSAGE_ITEM_FORMAT,
} from "./registry.js";

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

test("the notebook index stands as a memory provider per embedding adapter, one per credential", () => {
  assert.deepEqual(
    Object.entries(BUILTINS.memoryProviders).map(([id, provider]) => [
      id,
      provider.embeddingAdapterId,
    ]),
    [
      [BUILTIN_MEMORY_PROVIDER.OPENAI, BUILTIN_EMBEDDING_ADAPTER.OPENAI],
      [BUILTIN_MEMORY_PROVIDER.HOSTED, BUILTIN_EMBEDDING_ADAPTER.HOSTED],
    ],
  );
  for (const provider of Object.values(BUILTINS.memoryProviders)) {
    assert.deepEqual(
      [...provider.capabilities],
      [MEMORY_CAPABILITY.KEYWORD, MEMORY_CAPABILITY.VECTOR, MEMORY_CAPABILITY.NOTEBOOK],
    );
  }
  assert.equal(
    notebookMemoryProviderFor(CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY),
    BUILTIN_MEMORY_PROVIDER.OPENAI,
  );
  assert.equal(
    notebookMemoryProviderFor(CREDENTIAL_REFERENCE_KIND.HOSTED_ACCOUNT),
    BUILTIN_MEMORY_PROVIDER.HOSTED,
  );
});

test("both context engines stand in the table, each under its own item format, and either resolves", () => {
  assert.deepEqual(
    Object.entries(BUILTINS.contextEngines).map(([id, engine]) => [id, engine.itemFormat]),
    [
      [BUILTIN_CONTEXT_ENGINE.RESPONSES, RESPONSES_ITEM_FORMAT],
      [BUILTIN_CONTEXT_ENGINE.UI_MESSAGES, UI_MESSAGE_ITEM_FORMAT],
    ],
  );
  assert.notDeepEqual(RESPONSES_ITEM_FORMAT, UI_MESSAGE_ITEM_FORMAT);
  for (const contextEngineId of Object.values(BUILTIN_CONTEXT_ENGINE)) {
    assert.ok(Either.isRight(resolveConfigurationEither(configuration({ contextEngineId }))));
  }
});

/** The refusal an outcome carries, or nothing when it resolved. */
function refusalOf(outcome: ConfigurationOutcome) {
  return outcome.outcome === CONFIGURATION_OUTCOME.REFUSED ? outcome.refusal : undefined;
}

/** The refusal a resolution answered, or nothing when it resolved. */
function refusalCodeOf(resolution: ReturnType<typeof resolveConfigurationEither>) {
  return Either.isLeft(resolution) ? resolution.left.code : undefined;
}

test("resolution checks every name and answers a frozen configuration", () => {
  const resolved = resolveConfigurationEither(configuration());
  assert.ok(Either.isRight(resolved));
  assert.ok(Object.isFrozen(resolved.right));
  assert.ok(Object.isFrozen(resolved.right.toolPolicy));

  assert.equal(
    refusalCodeOf(
      resolveConfigurationEither(configuration({ modelAdapterId: BUILTIN_MODEL_ADAPTER.HOSTED })),
    ),
    CONFIGURATION_REFUSAL.CREDENTIAL_KIND_MISMATCH,
  );
  assert.equal(
    refusalCodeOf(resolveConfigurationEither(configuration({ maximumOutputTokens: 0 }))),
    CONFIGURATION_REFUSAL.INVALID_OUTPUT_TOKENS,
  );
  assert.equal(
    refusalCodeOf(resolveConfigurationEither(configuration({ workspaceDirectory: "  " }))),
    CONFIGURATION_REFUSAL.EMPTY_WORKSPACE,
  );
});

test("a name no built-in holds is refused, and the standing snapshot is unchanged", () => {
  const store = new ConfigurationStore(configuration());
  const first = store.snapshot();
  // Only a name that arrived over the wire can be one the table does not
  // hold; every name a build spells is checked by the derived id unions.
  const wireShaped = { ...configuration(), contextEngineId: "someone-elses-engine" };
  assert.equal(
    refusalCodeOf(resolveConfigurationEither(wireShaped)),
    CONFIGURATION_REFUSAL.UNKNOWN_ID,
  );
  assert.equal(refusalOf(store.publish(wireShaped)), CONFIGURATION_REFUSAL.UNKNOWN_ID);
  assert.strictEqual(store.snapshot(), first);
  assert.equal(
    refusalOf(store.publish({ ...configuration(), memoryProviderId: "someone-elses-index" })),
    CONFIGURATION_REFUSAL.UNKNOWN_ID,
  );
  assert.strictEqual(store.snapshot(), first);
});

test("a store publishes atomically: a refused publish leaves the snapshot standing, an accepted one replaces it whole", () => {
  const store = new ConfigurationStore(configuration());
  const first = store.snapshot();

  assert.equal(
    refusalOf(store.publish(configuration({ maximumOutputTokens: -1 }))),
    CONFIGURATION_REFUSAL.INVALID_OUTPUT_TOKENS,
  );
  assert.strictEqual(store.snapshot(), first);

  const accepted = store.publish(
    configuration({
      modelAdapterId: BUILTIN_MODEL_ADAPTER.HOSTED,
      credential: { kind: CREDENTIAL_REFERENCE_KIND.HOSTED_ACCOUNT },
      memoryProviderId: BUILTIN_MEMORY_PROVIDER.HOSTED,
      toolPolicy: { agent: { deny: ["read_thing"] } },
    }),
  );
  assert.equal(accepted.outcome, CONFIGURATION_OUTCOME.RESOLVED);
  const second = store.snapshot();
  assert.equal(second.revision, 2);
  assert.equal(second.configuration.modelAdapterId, BUILTIN_MODEL_ADAPTER.HOSTED);
  assert.deepEqual(second.configuration.toolPolicy, { agent: { deny: ["read_thing"] } });
  assert.deepEqual(first.configuration.toolPolicy, {});
  // The credential travels as a reference alone: no secret has a field to live in.
  assert.deepEqual(Object.keys(second.configuration.credential), ["kind"]);
});

test("the store's own publish and the Either door answer the same values", () => {
  const store = new ConfigurationStore(configuration());
  const published = store.publish(configuration());
  const either = resolveConfigurationEither(configuration());
  assert.ok(published.outcome === CONFIGURATION_OUTCOME.RESOLVED);
  assert.ok(Either.isRight(either));
  assert.deepEqual(either.right, published.configuration);

  const refused = resolveConfigurationEither(
    configuration({ modelAdapterId: BUILTIN_MODEL_ADAPTER.HOSTED }),
  );
  assert.ok(Either.isLeft(refused));
  assert.equal(refused.left._tag, "ConfigurationRefused");
  assert.equal(refused.left.code, CONFIGURATION_REFUSAL.CREDENTIAL_KIND_MISMATCH);
});

test("a duplicate id in a built-in table is a type error, never a run-time refusal", () => {
  const shapedLikeBuiltins = {
    [BUILTIN_MODEL_ADAPTER.OPENAI]: { credentialKind: CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY },
    // @ts-expect-error two model adapters cannot share an id: the object literal itself refuses it.
    [BUILTIN_MODEL_ADAPTER.OPENAI]: { credentialKind: CREDENTIAL_REFERENCE_KIND.HOSTED_ACCOUNT },
  };
  assert.deepEqual(Object.keys(shapedLikeBuiltins), [BUILTIN_MODEL_ADAPTER.OPENAI]);
});

test("a pairing the built-ins rule out is a type error, never a run-time refusal", () => {
  type NotebookProvider = (typeof BUILTINS.memoryProviders)[typeof BUILTIN_MEMORY_PROVIDER.OPENAI];
  // @ts-expect-error a vector provider must name the embedding adapter its vectors run on.
  const withoutAnEmbeddingAdapter: NotebookProvider = {
    capabilities: BUILTINS.memoryProviders[BUILTIN_MEMORY_PROVIDER.OPENAI].capabilities,
  };
  assert.deepEqual(Object.keys(withoutAnEmbeddingAdapter), ["capabilities"]);

  // @ts-expect-error only a host tool may speak; a performer carries acts and cannot claim it.
  const speakingPerformer: ToolPlacement = {
    execution: TOOL_EXECUTION.PERFORMER,
    effect: TOOL_EFFECT.SPEAK,
  };
  assert.equal(speakingPerformer.execution, TOOL_EXECUTION.PERFORMER);

  // @ts-expect-error a name no built-in holds is refused by the derived id union.
  const unknownAdapter = configuration({ modelAdapterId: "no-such-adapter" });
  assert.equal(resolveConfigurationEither(unknownAdapter).pipe(Either.isLeft), true);
});

test("two agents are two isolated stores", () => {
  const main = new ConfigurationStore(configuration());
  const other = new ConfigurationStore(
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
