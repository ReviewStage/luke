import assert from "node:assert/strict";
import { CODING_AGENT_FAILURE, CODING_AGENT_STATUS } from "@sidecar/hosted/coding-agent-wire";
import { Duration, Option, Redacted, Result, Schema } from "effect";
import { test } from "vitest";
import { BRAIN_REQUEST_FAILURE, TURN_STATUS } from "../server/core";
import { CODER, CODER_REFUSAL } from "../server/hosted/coder-host/bounds";
import {
  type CoderModelSelection,
  coderModel,
  type ProviderKeys,
} from "../server/hosted/coder-host/model";
import { codingAgentFailureOf, codingAgentStatusOf } from "../server/hosted/coder-host/status";
import { REPOSITORY_REFUSAL } from "../server/hosted/repository-shell";

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
function providerModel(model: CoderModelSelection["model"]): {
  readonly modelId: string;
  readonly provider: string;
} {
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
  return {
    conversationId: "c",
    id: "t",
    status,
    eveTurnId: "turn_0",
    failure: null,
    failureDetail: null,
    cancelRequestedAt,
  };
}

/** An agent started at the epoch, read this long after. */
const started = (sinceStartMs: number) => ({ createdAt: new Date(0), now: sinceStartMs });

test("an agent's status is its newest turn's: starting before one, and a running turn with a Stop on it reads as cancelled", () => {
  const just = started(1_000);
  assert.equal(codingAgentStatusOf(undefined, just), CODING_AGENT_STATUS.STARTING);
  assert.equal(codingAgentStatusOf(turn(TURN_STATUS.QUEUED), just), CODING_AGENT_STATUS.RUNNING);
  assert.equal(codingAgentStatusOf(turn(TURN_STATUS.RUNNING), just), CODING_AGENT_STATUS.RUNNING);
  assert.equal(codingAgentStatusOf(turn(TURN_STATUS.SETTLED), just), CODING_AGENT_STATUS.COMPLETED);
  assert.equal(codingAgentStatusOf(turn(TURN_STATUS.FAILED), just), CODING_AGENT_STATUS.FAILED);
  assert.equal(
    codingAgentStatusOf(turn(TURN_STATUS.CANCELLED), just),
    CODING_AGENT_STATUS.CANCELLED,
  );
  assert.equal(
    codingAgentStatusOf(turn(TURN_STATUS.RUNNING, new Date(0)), just),
    CODING_AGENT_STATUS.CANCELLED,
  );
  assert.equal(
    codingAgentStatusOf(turn(TURN_STATUS.SETTLED, new Date(0)), just),
    CODING_AGENT_STATUS.COMPLETED,
  );
});

test("an agent with no turn row reads as starting inside the grace and as failed past it, so nothing reads starting forever", () => {
  const grace = Duration.toMillis(CODER.STARTING_GRACE);
  assert.equal(codingAgentStatusOf(undefined, started(grace)), CODING_AGENT_STATUS.STARTING);
  assert.equal(codingAgentStatusOf(undefined, started(grace + 1)), CODING_AGENT_STATUS.FAILED);
  // A turn that lands late is still the agent's status.
  assert.equal(
    codingAgentStatusOf(turn(TURN_STATUS.RUNNING), started(grace + 1)),
    CODING_AGENT_STATUS.RUNNING,
  );
});

/**
 * Why a failed turn failed, as the one word the wire carries: read off the
 * turn row's failure word and the host's own sentences in its detail, so
 * nothing eve or a provider said is what the window hears.
 */

const failed = (failure: string | null, failureDetail: string | null) => ({
  status: TURN_STATUS.FAILED,
  failure,
  failureDetail,
});

test.for([
  [
    "the model call",
    failed(BRAIN_REQUEST_FAILURE.MODEL, "MODEL_CALL_FAILED 529 overloaded"),
    CODING_AGENT_FAILURE.MODEL,
  ],
  [
    "a step refused for its provider",
    failed(BRAIN_REQUEST_FAILURE.MODEL, `MODEL_CALL_FAILED ${CODER_REFUSAL.NO_PROVIDER_KEY}`),
    CODING_AGENT_FAILURE.MODEL,
  ],
  [
    "GitHub refusing the repository",
    failed(BRAIN_REQUEST_FAILURE.MODEL, `SANDBOX_FAILED ${CODER_REFUSAL.NOT_REACHABLE}`),
    CODING_AGENT_FAILURE.GITHUB,
  ],
  [
    "GitHub unreachable at the checkout",
    failed(BRAIN_REQUEST_FAILURE.MODEL, `Not run: ${REPOSITORY_REFUSAL.GITHUB_UNAVAILABLE}`),
    CODING_AGENT_FAILURE.GITHUB,
  ],
  [
    "the checkout failing in the sandbox",
    failed(
      BRAIN_REQUEST_FAILURE.MODEL,
      `Not run: ${REPOSITORY_REFUSAL.CHECKOUT_FAILED} fatal: early EOF`,
    ),
    CODING_AGENT_FAILURE.SANDBOX,
  ],
  [
    "the sweep settling the turn",
    failed(BRAIN_REQUEST_FAILURE.ABANDONED, null),
    CODING_AGENT_FAILURE.ABANDONED,
  ],
  [
    "a record the store could not write",
    failed(BRAIN_REQUEST_FAILURE.PERSISTENCE, null),
    CODING_AGENT_FAILURE.OTHER,
  ],
  ["a word this build does not know", failed("eclipse", null), CODING_AGENT_FAILURE.OTHER],
] as const)("%s reads as its one word", ([, turn, word]) => {
  assert.equal(codingAgentFailureOf(turn), word);
});

test("a turn that did not fail, or no turn, says nothing", () => {
  assert.equal(codingAgentFailureOf(undefined), undefined);
  assert.equal(
    codingAgentFailureOf({ status: TURN_STATUS.SETTLED, failure: null, failureDetail: null }),
    undefined,
  );
  assert.equal(
    codingAgentFailureOf({
      status: TURN_STATUS.CANCELLED,
      failure: BRAIN_REQUEST_FAILURE.MODEL,
      failureDetail: null,
    }),
    undefined,
  );
});
