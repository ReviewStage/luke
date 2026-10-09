import assert from "node:assert/strict";
import { CODING_AGENT_STATUS } from "@sidecar/hosted";
import { Option, Redacted, Result, Schema } from "effect";
import { test } from "vitest";
import { TURN_STATUS } from "../server/core";
import { CODER_REFUSAL } from "../server/hosted/coder-host/bounds";
import { coderModel, type ProviderKeys } from "../server/hosted/coder-host/model";
import { codingAgentStatusOf } from "../server/hosted/coder-host/status";

/**
 * The model one step of a coding agent runs on, as the host selects it from
 * the agent's row: each provider reached on Luke's own key at the
 * provider's own model id, with the effort in the provider's own word for
 * it, and the window the session is told; and where an agent stands, read
 * from its newest turn. Synthetic keys throughout.
 */

const KEYS: ProviderKeys = {
  anthropic: Redacted.make("sk-ant-fixture"),
  openAi: Redacted.make("sk-openai-fixture"),
};

const WINDOW = 400_000;

/** The provider's model as the step is told it: the id and the provider it runs at, read off the SDK's handle. */
const readModel = Schema.decodeUnknownOption(
  Schema.Struct({ modelId: Schema.String, provider: Schema.String }),
);

/** The model's id and provider, failing the test where the step was told a bare id rather than a provider's handle. */
function providerModel(model: unknown): { readonly modelId: string; readonly provider: string } {
  return Option.getOrElse(readModel(model), () =>
    assert.fail("the step was told no provider model"),
  );
}

test("an Anthropic choice runs the provider's own model id with the effort as Anthropic takes it", () => {
  const selected = coderModel({ model: "anthropic/claude-opus-5.5", effort: "max" }, KEYS, WINDOW);
  assert.ok(Result.isSuccess(selected));
  const { modelOptions, modelContextWindowTokens } = selected.success;
  const model = providerModel(selected.success.model);
  assert.equal(model.modelId, "claude-opus-5-5");
  assert.equal(model.provider.startsWith("anthropic"), true);
  assert.deepEqual(modelOptions, { providerOptions: { anthropic: { effort: "max" } } });
  assert.equal(modelContextWindowTokens, WINDOW);
});

test("an OpenAI choice runs the Responses model with the effort as OpenAI takes it", () => {
  const selected = coderModel({ model: "openai/gpt-6.1-sol", effort: "xhigh" }, KEYS, WINDOW);
  assert.ok(Result.isSuccess(selected));
  const { modelOptions } = selected.success;
  const model = providerModel(selected.success.model);
  assert.equal(model.modelId, "gpt-6.1-sol");
  assert.equal(model.provider.startsWith("openai"), true);
  assert.deepEqual(modelOptions, { providerOptions: { openai: { reasoningEffort: "xhigh" } } });
});

test("a provider Luke does not run, or a key the deployment does not hold, refuses the step by name", () => {
  assert.deepEqual(
    coderModel({ model: "google/gemini-3", effort: "high" }, KEYS, WINDOW),
    Result.fail(CODER_REFUSAL.UNKNOWN_PROVIDER),
  );
  assert.deepEqual(
    coderModel(
      { model: "anthropic/claude-opus-5.5", effort: "high" },
      { ...KEYS, anthropic: undefined },
      WINDOW,
    ),
    Result.fail(CODER_REFUSAL.NO_PROVIDER_KEY),
  );
  assert.deepEqual(
    coderModel(
      { model: "openai/gpt-6.1-sol", effort: "high" },
      { ...KEYS, openAi: undefined },
      WINDOW,
    ),
    Result.fail(CODER_REFUSAL.NO_PROVIDER_KEY),
  );
});

/** A newest turn as the store answers it, in the status given. */
function turn(status: string, cancelRequestedAt: Date | null = null) {
  return { conversationId: "c", id: "t", status, eveTurnId: "turn_0", cancelRequestedAt };
}

test("an agent's status is its newest turn's: starting before one, and a running turn with a Stop on it reads as cancelled", () => {
  assert.equal(codingAgentStatusOf(undefined), CODING_AGENT_STATUS.STARTING);
  assert.equal(codingAgentStatusOf(turn(TURN_STATUS.QUEUED)), CODING_AGENT_STATUS.RUNNING);
  assert.equal(codingAgentStatusOf(turn(TURN_STATUS.RUNNING)), CODING_AGENT_STATUS.RUNNING);
  assert.equal(codingAgentStatusOf(turn(TURN_STATUS.SETTLED)), CODING_AGENT_STATUS.COMPLETED);
  assert.equal(codingAgentStatusOf(turn(TURN_STATUS.FAILED)), CODING_AGENT_STATUS.FAILED);
  assert.equal(codingAgentStatusOf(turn(TURN_STATUS.CANCELLED)), CODING_AGENT_STATUS.CANCELLED);
  assert.equal(
    codingAgentStatusOf(turn(TURN_STATUS.RUNNING, new Date(0))),
    CODING_AGENT_STATUS.CANCELLED,
  );
  assert.equal(
    codingAgentStatusOf(turn(TURN_STATUS.SETTLED, new Date(0))),
    CODING_AGENT_STATUS.COMPLETED,
  );
});
