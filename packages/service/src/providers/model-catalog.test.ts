import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { AGENT_DEFAULT_CHOICE } from "@repo/features/models-wire";
import {
  type JsonValue,
  jsonResponse,
  type RecordedRequest,
  recordingHttpClient,
} from "@repo/wire/testing";
import { Duration, Effect, Layer, Result } from "effect";
import { TestClock } from "effect/testing";
import { ModelCatalog, modelCatalogLayer, validateModelChoice } from "./model-catalog.js";

function entry(
  id: string,
  name: string,
  options: {
    readonly tags?: readonly string[];
    readonly reasoning?: readonly JsonValue[] | null;
    readonly pricing?: JsonValue;
    readonly contextWindow?: number;
  } = {},
): JsonValue {
  const tags = options.tags ?? ["tool-use", "reasoning"];
  const reasoning =
    options.reasoning === undefined
      ? [{ type: "effort", values: ["low", "medium", "high"] }]
      : options.reasoning;
  return {
    id,
    object: "model",
    name,
    tags: [...tags],
    context_window: options.contextWindow ?? 200_000,
    ...(reasoning === null ? undefined : { reasoning_options: [...reasoning] }),
    ...(options.pricing === undefined ? undefined : { pricing: options.pricing }),
  };
}

const OPUS_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const CATALOG: JsonValue = {
  object: "list",
  data: [
    entry("alibaba/qwen-3-14b", "Qwen3-14B", { pricing: { input: "unknown", output: "0.000001" } }),
    entry("anthropic/claude-opus-5.5", "Claude Opus 5.5", {
      reasoning: [{ type: "effort", values: OPUS_EFFORTS }],
      pricing: {
        input: "0.000004",
        output: "0.00002",
        input_cache_read: "0.0000002",
        input_cache_write: "0.000005",
        web_search: "10",
      },
    }),
    entry("anthropic/claude-sonnet-4.5", "Claude Sonnet 4.5", {
      reasoning: [{ type: "toggle" }, { type: "budget_tokens", min: 1024 }],
    }),
    entry("anthropic/claude-haiku-4", "Claude Haiku 4", { tags: ["tool-use"] }),
    entry("openai/gpt-6.1-sol", "GPT-6.1 Sol", {
      reasoning: [{ type: "toggle" }, { type: "effort", values: ["none", "low", "high"] }],
      contextWindow: 1_050_000,
      pricing: {
        input: "varies",
        output: "0.00001",
        service_tiers: {
          priority: { input: "0.00002", output: "0.0001" },
          ultrafast: {
            input: "0.00006",
            output: "0.0003",
            input_cache_read: "0.000006",
            long_context: {
              threshold: 272001,
              input: "0.00012",
              output: "0.00045",
              input_cache_read: "0.000012",
            },
          },
        },
      },
    }),
    entry("openai/gpt-6.1-sol-fast", "GPT-6.1 Sol (Fast)", {
      reasoning: [{ type: "toggle" }, { type: "effort", values: ["none", "low", "high"] }],
    }),
    entry("openai/gpt-6.1-sol-batch", "GPT-6.1 Sol (Batch)", {
      reasoning: [{ type: "effort", values: ["none", "low", "high"] }],
    }),
    entry("openai/gpt-4.1", "GPT-4.1", { tags: ["tool-use"], reasoning: null }),
    entry("openai/gpt-image-2", "GPT Image 2", {
      tags: ["reasoning", "tool-use"],
      reasoning: null,
    }),
    entry("xai/grok-5", "Grok 5"),
  ],
};

function gateway(answers: (request: RecordedRequest) => Response) {
  const http = recordingHttpClient(answers);
  const layer = modelCatalogLayer.pipe(Layer.provide(http.layer));
  return { http, layer };
}

const readCatalog = Effect.flatMap(ModelCatalog, (catalog) => catalog.read);

it.effect("the default choice is one the catalog as published accepts", () =>
  Effect.gen(function* () {
    const { layer } = gateway(() => jsonResponse(CATALOG));
    const offered = yield* readCatalog.pipe(Effect.provide(layer));
    assert.deepEqual(
      validateModelChoice(offered, AGENT_DEFAULT_CHOICE),
      Result.succeed(AGENT_DEFAULT_CHOICE),
    );
  }),
);

it.effect(
  "a GPT model's fast version is offered beside it, which Codex runs on its fast tier, and its batch version never is, since no turn can wait on the Batch API, and where its entry prices OpenAI's Ultrafast tier an Ultrafast version priced at that tier",
  () =>
    Effect.gen(function* () {
      const { layer } = gateway(() => jsonResponse(CATALOG));
      const offered = yield* readCatalog.pipe(Effect.provide(layer));
      assert.deepEqual(
        offered.map((model) => model.id).filter((id) => id.startsWith("openai/")),
        ["openai/gpt-6.1-sol", "openai/gpt-6.1-sol-ultrafast", "openai/gpt-6.1-sol-fast"],
      );
      assert.deepEqual(
        offered.find((model) => model.id === "openai/gpt-6.1-sol-ultrafast"),
        {
          id: "openai/gpt-6.1-sol-ultrafast",
          name: "GPT-6.1 Sol (Ultrafast)",
          provider: "openai",
          efforts: ["none", "low", "high"],
          contextWindows: {
            standardTokens: 272_000,
            longTokens: 1_050_000,
            longInputPriceFactor: 2,
            longOutputPriceFactor: 1.5,
          },
          contextWindow: 1_050_000,
          pricing: { inputUsd: 0.00006, outputUsd: 0.0003, cachedInputUsd: 0.000006 },
        },
      );
    }),
);

it.effect("a refetch that fails past the hour answers the catalog read before it", () =>
  Effect.gen(function* () {
    let up = true;
    const { layer } = gateway(() =>
      up ? jsonResponse(CATALOG) : new Response(null, { status: 503 }),
    );
    const [before, after] = yield* Effect.gen(function* () {
      const first = yield* readCatalog;
      up = false;
      yield* TestClock.adjust(Duration.hours(2));
      return [first, yield* readCatalog] as const;
    }).pipe(Effect.provide(layer));
    assert.deepEqual(
      after.map((model) => model.id),
      before.map((model) => model.id),
    );
    assert.ok(after.some((model) => model.id === "anthropic/claude-opus-5.5"));
  }),
);
