import assert from "node:assert/strict";
import { PROVIDER_KEY_UNREADABLE } from "@sidecar/database/models/provider-key-seal";
import { CODING_AGENT_FAILURE, CODING_AGENT_STATUS } from "@sidecar/hosted/coding-agent-wire";
import { PROVIDER_KEY_STATUS } from "@sidecar/hosted/provider-key-wire";
import { jsonResponse } from "@sidecar/wire/testing";
import { generateText } from "ai";
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
  anthropic: { key: Redacted.make("sk-ant-fixture") },
  openAi: { key: Redacted.make("sk-openai-fixture") },
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

test("an Anthropic choice runs the provider's own model id with the effort as Anthropic takes it, its thinking shown", () => {
  const selected = coderModel({ model: "anthropic/claude-opus-5.5", effort: "max" }, KEYS, WINDOW);
  assert.ok(Result.isSuccess(selected));
  const { modelOptions, modelContextWindowTokens } = selected.success;
  const model = providerModel(selected.success.model);
  assert.equal(model.modelId, "claude-opus-5-5");
  assert.equal(model.provider.startsWith("anthropic"), true);
  assert.deepEqual(modelOptions, {
    providerOptions: {
      anthropic: { effort: "max", thinking: { type: "adaptive", display: "summarized" } },
    },
  });
  assert.equal(modelContextWindowTokens, WINDOW);
});

/** What a step on the catalog's Anthropic model is told, at the effort every choice below takes. */
function optionsOf(model: string): CoderModelSelection["modelOptions"] {
  const selected = coderModel({ model, effort: "high" }, KEYS, WINDOW);
  assert.ok(Result.isSuccess(selected));
  return selected.success.modelOptions;
}

test("a Claude 5 model that thinks unasked is asked to show it, and an older Claude is not asked to think", () => {
  const shown = { effort: "high", thinking: { type: "adaptive", display: "summarized" } };
  for (const model of [
    "anthropic/claude-opus-5",
    "anthropic/claude-sonnet-5.5",
    "anthropic/claude-haiku-5.5",
    "anthropic/claude-fable-5.1",
  ]) {
    assert.deepEqual(optionsOf(model), { providerOptions: { anthropic: shown } }, model);
  }
  for (const model of ["anthropic/claude-opus-4.8", "anthropic/claude-sonnet-4.6"]) {
    assert.deepEqual(
      optionsOf(model),
      { providerOptions: { anthropic: { effort: "high" } } },
      model,
    );
  }
});

test("an OpenAI choice runs the Responses model with the effort as OpenAI takes it, its reasoning summarised", () => {
  const selected = coderModel({ model: "openai/gpt-6.1-sol", effort: "xhigh" }, KEYS, WINDOW);
  assert.ok(Result.isSuccess(selected));
  const { modelOptions } = selected.success;
  const model = providerModel(selected.success.model);
  assert.equal(model.modelId, "gpt-6.1-sol");
  assert.equal(model.provider.startsWith("openai"), true);
  assert.deepEqual(modelOptions, {
    providerOptions: { openai: { reasoningEffort: "xhigh", reasoningSummary: "auto" } },
  });
});

test("a provider Luke does not run, an account's key that cannot be read, or no key at all refuses the step by name", () => {
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
  assert.deepEqual(
    coderModel(
      { model: "openai/gpt-6.1-sol", effort: "high" },
      { ...KEYS, openAi: PROVIDER_KEY_UNREADABLE },
      WINDOW,
    ),
    Result.fail(CODER_REFUSAL.ACCOUNT_KEY_UNREADABLE),
  );
});

/** What reached Anthropic's API: the request's body and its beta header. */
const readAnthropicRequest = Schema.decodeUnknownSync(
  Schema.Struct({
    model: Schema.String,
    speed: Schema.optional(Schema.String),
    output_config: Schema.Struct({ effort: Schema.String }),
  }),
);

/** Runs one step of the choice against an Anthropic that answers every request, answering what each request asked for. */
async function anthropicRequestsOf(model: string) {
  const requests: { readonly body: unknown; readonly betas: string }[] = [];
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    requests.push({
      body: JSON.parse(String(init?.body)),
      betas: new Headers(init?.headers).get("anthropic-beta") ?? "",
    });
    return jsonResponse({
      id: "msg_fixture",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [{ type: "text", text: "Done." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  };
  const selected = coderModel({ model, effort: "high" }, { ...KEYS, fetch }, WINDOW);
  if (Result.isFailure(selected)) return assert.fail(`no model: ${selected.failure}`);
  const { providerOptions } = selected.success.modelOptions;
  await generateText({
    model: selected.success.model,
    prompt: "Go.",
    maxRetries: 0,
    ...(providerOptions === undefined ? undefined : { providerOptions }),
  });
  return requests.map((request) => ({
    ...readAnthropicRequest(request.body),
    betas: request.betas,
  }));
}

test("a fast version runs at Anthropic as its base model asked for fast speed, with fast mode's beta, never as the gateway's slug", async () => {
  const [fast] = await anthropicRequestsOf("anthropic/claude-opus-5.5-fast");
  assert.equal(fast?.model, "claude-opus-5-5");
  assert.equal(fast?.speed, "fast");
  assert.equal(fast?.output_config.effort, "high");
  assert.ok(fast?.betas.split(",").includes("fast-mode-2026-02-01"), fast?.betas);
  const [standard] = await anthropicRequestsOf("anthropic/claude-opus-5.5");
  assert.equal(standard?.model, "claude-opus-5-5");
  assert.equal(standard?.speed, undefined);
  assert.equal(standard?.betas.includes("fast-mode"), false);
});

/**
 * Anthropic as an organization outside fast mode's research preview meets
 * it, as production met an account's own key: a standard request answered,
 * and a fast one refused with the 429 Anthropic sent, against a fast limit
 * of 0.
 */
const outsideFastPreview: typeof globalThis.fetch = async (_input, init) => {
  const asked = readAnthropicRequest(JSON.parse(String(init?.body)));
  if (asked.speed !== undefined) {
    return jsonResponse(
      {
        type: "error",
        error: {
          type: "rate_limit_error",
          message: `This request would exceed your organization's rate limit of 0 fast mode input tokens per minute (model: ${asked.model}).`,
        },
      },
      429,
    );
  }
  return jsonResponse({
    id: "msg_fixture",
    type: "message",
    role: "assistant",
    model: asked.model,
    content: [{ type: "text", text: `Done on ${asked.model}.` }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  });
};

/** The account's own Anthropic key, verified, its reports dropped. */
const OWN_ANTHROPIC: ProviderKeys["anthropic"] = {
  key: Redacted.make("sk-ant-own-fixture"),
  account: { status: PROVIDER_KEY_STATUS.VERIFIED, report: async () => undefined },
};

/** What one step of the choice comes to against that Anthropic: the host's refusal, the step's answer, or why the step failed. */
async function stepOutcome(model: string, anthropic: ProviderKeys["anthropic"]): Promise<string> {
  const keys = { ...KEYS, anthropic, fetch: outsideFastPreview };
  const selected = coderModel({ model, effort: "high" }, keys, WINDOW);
  if (Result.isFailure(selected)) return selected.failure;
  const { providerOptions } = selected.success.modelOptions;
  try {
    const answer = await generateText({
      model: selected.success.model,
      prompt: "Go.",
      maxRetries: 0,
      ...(providerOptions === undefined ? undefined : { providerOptions }),
    });
    return answer.text;
  } catch (failure) {
    return failure instanceof Error ? failure.message : String(failure);
  }
}

test("a fast version on the account's own key is refused in words before any request, and its base model still runs there", async () => {
  assert.equal(
    await stepOutcome("anthropic/claude-opus-5.5-fast", OWN_ANTHROPIC),
    CODER_REFUSAL.FAST_ON_OWN_KEY,
  );
  assert.equal(
    await stepOutcome("anthropic/claude-opus-5.5", OWN_ANTHROPIC),
    "Done on claude-opus-5-5.",
  );
});

test("Anthropic refusing fast mode for the organization of Luke's key fails the step in words saying so, never as a bare rate limit", async () => {
  assert.equal(
    await stepOutcome("anthropic/claude-opus-5.5-fast", KEYS.anthropic),
    CODER_REFUSAL.FAST_NOT_ENABLED,
  );
});

test("a fast version whose provider's fast option Luke cannot confirm is refused in words saying so, never run as the slug", () => {
  assert.deepEqual(
    coderModel({ model: "openai/gpt-5.5-fast", effort: "high" }, KEYS, WINDOW),
    Result.fail(CODER_REFUSAL.NO_FAST_VERSION),
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
    queuedAt: new Date(0),
    startedAt: null,
    settledAt: null,
    model: null,
    usage: null,
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

/** Why a failed turn failed, as the one word the wire carries: the turn row's failure word and the host's own sentences in its detail, never eve's or a provider's words. */
const failed = (failure: string, failureDetail: string | null = null) => ({
  status: TURN_STATUS.FAILED,
  failure,
  failureDetail,
});
const { MODEL, ABANDONED, PERSISTENCE } = BRAIN_REQUEST_FAILURE;

test.for([
  [failed(MODEL, "MODEL_CALL_FAILED 529 overloaded"), CODING_AGENT_FAILURE.MODEL],
  [failed(MODEL, `SANDBOX_FAILED ${CODER_REFUSAL.NOT_REACHABLE}`), CODING_AGENT_FAILURE.GITHUB],
  [
    failed(MODEL, `Not run: ${REPOSITORY_REFUSAL.CHECKOUT_FAILED} fatal`),
    CODING_AGENT_FAILURE.SANDBOX,
  ],
  [
    failed(MODEL, `MODEL_CALL_FAILED ${CODER_REFUSAL.ACCOUNT_KEY_REFUSED}`),
    CODING_AGENT_FAILURE.PROVIDER_KEY,
  ],
  [
    failed(MODEL, `MODEL_CALL_FAILED ${CODER_REFUSAL.ACCOUNT_KEY_NO_QUOTA}`),
    CODING_AGENT_FAILURE.PROVIDER_KEY,
  ],
  [
    failed(MODEL, `Error ${CODER_REFUSAL.ACCOUNT_KEY_UNREADABLE}`),
    CODING_AGENT_FAILURE.PROVIDER_KEY,
  ],
  [
    failed(MODEL, `MODEL_CALL_FAILED [message,name] ${CODER_REFUSAL.FAST_NOT_ENABLED}`),
    CODING_AGENT_FAILURE.FAST_NOT_ENABLED,
  ],
  [failed(MODEL, `Error ${CODER_REFUSAL.FAST_ON_OWN_KEY}`), CODING_AGENT_FAILURE.FAST_ON_OWN_KEY],
  [failed(ABANDONED), CODING_AGENT_FAILURE.ABANDONED],
  [failed(PERSISTENCE), CODING_AGENT_FAILURE.OTHER],
  [{ status: TURN_STATUS.CANCELLED, failure: MODEL, failureDetail: null }, undefined],
  [undefined, CODING_AGENT_FAILURE.NOT_STARTED],
] as const)(
  "a failed agent's reason is the wire's one word, a turnless one's that it never started: %o",
  ([turn, word]) => {
    assert.equal(codingAgentFailureOf(turn), word);
  },
);
