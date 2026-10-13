import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { CONTEXT_WINDOW } from "@sidecar/hosted/coding-agent-wire";
import { CODING_AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import {
  HTTP_STATUS,
  type JsonValue,
  jsonResponse,
  recordingHttpClient,
} from "@sidecar/wire/testing";
import { Duration, Effect, Layer, Result } from "effect";
import { TestClock } from "effect/testing";
import {
  acceptedModelChoice,
  MODEL_CATALOG_TTL,
  MODEL_CATALOG_URL,
  MODEL_CHOICE_REFUSAL,
  ModelCatalog,
  modelCatalogLayer,
  modelCatalogOf,
  type OfferedModel,
  providerModelOf,
  validateModelChoice,
} from "../server/hosted/model-catalog";

/**
 * The model catalog at its HTTP boundary: AI Gateway answering its catalog
 * as a scripted table, so no test reaches the network. What each test
 * asserts is the list a caller reads, the requests that left, and the
 * verdict on a choice, never how either was built. The clock is the test's
 * own, so the cache's hour passes in one step.
 *
 * A fixture catalog throughout: the ids are the catalog's own spellings,
 * and the entries beside the offered ones are each one way an entry is left
 * out. One offered entry lists its prices and the other a price this
 * module cannot read, which costs it its price and nothing else, as it
 * does the unoffered entry spelled the same way; these are the two ways a
 * model's usage comes to be priced or told as tokens alone.
 */

/** One catalog entry as AI Gateway shapes it, with only what the reader looks at and one field it does not. */
function entry(
  id: string,
  name: string,
  options: {
    readonly tags?: readonly string[];
    readonly reasoning?: readonly JsonValue[] | null;
    /** The entry's prices as the catalog spells them, dollars per token as strings; an entry without lists none. */
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
      pricing: { input: "varies", output: "0.00001" },
    }),
    entry("openai/gpt-4.1", "GPT-4.1", { tags: ["tool-use"], reasoning: null }),
    entry("openai/gpt-image-2", "GPT Image 2", {
      tags: ["reasoning", "tool-use"],
      reasoning: null,
    }),
    entry("xai/grok-5", "Grok 5"),
  ],
};

const OFFERED: readonly OfferedModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: OPUS_EFFORTS,
    contextWindow: 200_000,
    pricing: {
      inputUsd: 0.000004,
      outputUsd: 0.00002,
      cachedInputUsd: 0.0000002,
      cacheWriteUsd: 0.000005,
    },
  },
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["none", "low", "high"],
    contextWindow: 200_000,
  },
];

/** The catalog layer over a gateway answering as scripted, with the requests it saw. */
function gateway(answers: () => Response) {
  const http = recordingHttpClient(answers);
  const layer = modelCatalogLayer.pipe(Layer.provide(http.layer));
  return { http, layer };
}

const readCatalog = Effect.flatMap(ModelCatalog, (catalog) => catalog.read);

it.effect(
  "the catalog is the Anthropic and OpenAI models tagged for tool use and reasoning that list an effort",
  () =>
    Effect.gen(function* () {
      const { http, layer } = gateway(() => jsonResponse(CATALOG));
      const offered = yield* readCatalog.pipe(Effect.provide(layer));
      assert.deepEqual(offered, OFFERED);
      assert.equal(http.requests.length, 1);
      assert.equal(http.requests[0]?.url, MODEL_CATALOG_URL);
      assert.equal(http.requests[0]?.init.method, "GET");
    }),
);

it.effect("one read serves every caller for the hour, and the next hour reads again", () =>
  Effect.gen(function* () {
    const { http, layer } = gateway(() => jsonResponse(CATALOG));
    yield* Effect.gen(function* () {
      yield* readCatalog;
      yield* readCatalog;
      yield* TestClock.adjust(Duration.subtract(MODEL_CATALOG_TTL, Duration.seconds(1)));
      yield* readCatalog;
      assert.equal(http.requests.length, 1);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* readCatalog;
      assert.equal(http.requests.length, 2);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect(
  "a catalog that cannot be read is unavailable, remembered for no time, and read again next",
  () =>
    Effect.gen(function* () {
      let answered = 0;
      const { http, layer } = gateway(() => {
        answered += 1;
        return answered === 1 ? jsonResponse({}, HTTP_STATUS.SERVER_ERROR) : jsonResponse(CATALOG);
      });
      yield* Effect.gen(function* () {
        const first = yield* Effect.result(readCatalog);
        assert.ok(Result.isFailure(first));
        assert.equal(first.failure._tag, "ModelCatalogUnavailable");
        const second = yield* readCatalog;
        assert.deepEqual(second, OFFERED);
        assert.equal(http.requests.length, 2);
      }).pipe(Effect.provide(layer));
    }),
);

it.effect(
  "an answer that is not the catalog's shape is unavailable rather than an empty list",
  () =>
    Effect.gen(function* () {
      const { layer } = gateway(() => jsonResponse({ data: [{ id: 7 }] }));
      const read = yield* Effect.result(readCatalog.pipe(Effect.provide(layer)));
      assert.ok(Result.isFailure(read));
      assert.equal(read.failure._tag, "ModelCatalogUnavailable");
    }),
);

it.effect("the default choice is one the catalog as published accepts", () =>
  Effect.gen(function* () {
    const { layer } = gateway(() => jsonResponse(CATALOG));
    const offered = yield* readCatalog.pipe(Effect.provide(layer));
    assert.deepEqual(
      validateModelChoice(offered, CODING_AGENT_DEFAULT_CHOICE),
      Result.succeed(CODING_AGENT_DEFAULT_CHOICE),
    );
  }),
);

/** Prices tiered at a boundary as the catalog spells them: the first tier from none, the second from the boundary on. */
function tiered(
  boundary: number,
  input: readonly [string, string],
  output: readonly [string, string],
): JsonValue {
  return {
    input: input[0],
    output: output[0],
    input_tiers: [
      { cost: input[0], min: 0, max: boundary },
      { cost: input[1], min: boundary },
    ],
    output_tiers: [
      { cost: output[0], min: 0, max: boundary },
      { cost: output[1], min: boundary },
    ],
  };
}

const WINDOWED_CATALOG: JsonValue = {
  object: "list",
  data: [
    entry("openai/gpt-5.5", "GPT-5.5", {
      contextWindow: 1_050_000,
      pricing: tiered(272_000, ["0.000004", "0.000008"], ["0.00002", "0.00003"]),
    }),
    // The boundary spelled as the first token past it, and a first tier that names no `min`.
    entry("anthropic/claude-haiku-5.5", "Claude Haiku 5.5", {
      contextWindow: 1_000_000,
      pricing: {
        input: "0.0000001",
        output: "0.0000005",
        input_tiers: [
          { cost: "0.0000001", max: 100_001 },
          { cost: "0.0000005", min: 100_001 },
        ],
      },
    }),
    entry("anthropic/claude-opus-5.5", "Claude Opus 5.5", {
      contextWindow: 1_000_000,
      pricing: { input: "0.000004", output: "0.00002" },
    }),
    entry("anthropic/claude-sonnet-5", "Claude Sonnet 5", {
      contextWindow: 200_000,
      pricing: tiered(200_001, ["0.000003", "0.000006"], ["0.000015", "0.0000225"]),
    }),
    entry("openai/gpt-6-luna", "GPT-6 Luna", {
      contextWindow: 1_050_000,
      pricing: tiered(272_000, ["0.000001", "0.000001"], ["0.000005", "0.000005"]),
    }),
    entry("openai/gpt-6-sol", "GPT-6 Sol", {
      contextWindow: 1_050_000,
      pricing: {
        input: "0.000002",
        output: "0.00001",
        input_tiers: [{ cost: "varies", min: 272_000 }],
      },
    }),
  ],
};

it.effect(
  "a model priced apart past a boundary inside its window offers the boundary and its whole window, at what the tokens past it cost; one priced the same throughout offers one",
  () =>
    Effect.gen(function* () {
      const { layer } = gateway(() => jsonResponse(WINDOWED_CATALOG));
      const offered = yield* readCatalog.pipe(Effect.provide(layer));
      const windowsOf = (id: string) => offered.find((model) => model.id === id)?.contextWindows;
      assert.deepEqual(windowsOf("openai/gpt-5.5"), {
        standardTokens: 272_000,
        longTokens: 1_050_000,
        longInputPriceFactor: 2,
        longOutputPriceFactor: 1.5,
      });
      assert.deepEqual(windowsOf("anthropic/claude-haiku-5.5"), {
        standardTokens: 100_000,
        longTokens: 1_000_000,
        longInputPriceFactor: 5,
      });
      assert.equal(windowsOf("anthropic/claude-opus-5.5"), undefined);
      // A tier at the first tier's own price is no boundary.
      assert.equal(windowsOf("openai/gpt-6-luna"), undefined);
      // A boundary at the window's own edge leaves nothing past it to choose.
      assert.equal(windowsOf("anthropic/claude-sonnet-5"), undefined);
      // A tier this module cannot read costs the model its long window, and not its price.
      assert.equal(windowsOf("openai/gpt-6-sol"), undefined);
      assert.deepEqual(offered.find((model) => model.id === "openai/gpt-6-sol")?.pricing, {
        inputUsd: 0.000002,
        outputUsd: 0.00001,
      });
    }),
);

it("the standard window is kept for a model that offers two, and dropped for a model with one, which runs on its whole window either way, as the long window always is", () => {
  const offered: readonly OfferedModel[] = [
    ...OFFERED,
    {
      id: "openai/gpt-5.5",
      name: "GPT-5.5",
      provider: MODEL_PROVIDER.OPENAI,
      efforts: ["low", "high"],
      contextWindow: 1_050_000,
      contextWindows: { standardTokens: 272_000, longTokens: 1_050_000 },
    },
  ];
  assert.deepEqual(
    validateModelChoice(offered, {
      model: "openai/gpt-5.5",
      effort: "high",
      contextWindow: CONTEXT_WINDOW.STANDARD,
    }),
    Result.succeed({
      model: "openai/gpt-5.5",
      effort: "high",
      contextWindow: CONTEXT_WINDOW.STANDARD,
    }),
  );
  assert.deepEqual(
    validateModelChoice(offered, {
      model: "openai/gpt-5.5",
      effort: "high",
      contextWindow: CONTEXT_WINDOW.LONG,
    }),
    Result.succeed({ model: "openai/gpt-5.5", effort: "high" }),
  );
  assert.deepEqual(
    validateModelChoice(offered, {
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      contextWindow: CONTEXT_WINDOW.STANDARD,
    }),
    Result.succeed({ model: "anthropic/claude-opus-5.5", effort: "high" }),
  );
});

it("a choice is accepted only for an offered model at an effort it lists", () => {
  assert.deepEqual(
    validateModelChoice(OFFERED, { model: "openai/gpt-6.1-sol", effort: "none" }),
    Result.succeed({ model: "openai/gpt-6.1-sol", effort: "none" }),
  );
  assert.deepEqual(
    validateModelChoice(OFFERED, { model: "openai/gpt-6.1-sol", effort: "max" }),
    Result.fail(MODEL_CHOICE_REFUSAL.UNKNOWN_EFFORT),
  );
  assert.deepEqual(
    validateModelChoice(OFFERED, { model: "anthropic/claude-sonnet-4.5", effort: "high" }),
    Result.fail(MODEL_CHOICE_REFUSAL.UNKNOWN_MODEL),
  );
  assert.deepEqual(
    validateModelChoice(OFFERED, { model: "claude-opus-5-5", effort: "high" }),
    Result.fail(MODEL_CHOICE_REFUSAL.UNKNOWN_MODEL),
  );
});

it("a catalog id translates to the provider's own: Anthropic's points become dashes, OpenAI's stand", () => {
  assert.deepEqual(providerModelOf("anthropic/claude-opus-5.5"), {
    provider: MODEL_PROVIDER.ANTHROPIC,
    modelId: "claude-opus-5-5",
    fast: false,
  });
  assert.deepEqual(providerModelOf("anthropic/claude-sonnet-5"), {
    provider: MODEL_PROVIDER.ANTHROPIC,
    modelId: "claude-sonnet-5",
    fast: false,
  });
  assert.deepEqual(providerModelOf("openai/gpt-6.1-sol"), {
    provider: MODEL_PROVIDER.OPENAI,
    modelId: "gpt-6.1-sol",
    fast: false,
  });
  assert.equal(providerModelOf("xai/grok-5"), undefined);
  assert.equal(providerModelOf("claude-opus-5.5"), undefined);
  assert.equal(providerModelOf("anthropic/"), undefined);
});

it("a fast slug is the gateway's name and no provider's: it translates to its base model with fast on", () => {
  assert.deepEqual(providerModelOf("anthropic/claude-opus-5.5-fast"), {
    provider: MODEL_PROVIDER.ANTHROPIC,
    modelId: "claude-opus-5-5",
    fast: true,
  });
  assert.deepEqual(providerModelOf("openai/gpt-5.5-fast"), {
    provider: MODEL_PROVIDER.OPENAI,
    modelId: "gpt-5.5",
    fast: true,
  });
});

it.effect(
  "an Anthropic model's fast version is offered at its own prices, and an OpenAI one is not, since what it stands for at OpenAI is unconfirmed",
  () =>
    Effect.gen(function* () {
      const reasoning = [{ type: "effort", values: OPUS_EFFORTS }];
      const { layer } = gateway(() =>
        jsonResponse({
          object: "list",
          data: [
            entry("anthropic/claude-opus-5.5", "Claude Opus 5.5", { reasoning }),
            entry("anthropic/claude-opus-5.5-fast", "Claude Opus 5.5 (Fast)", {
              reasoning,
              pricing: { input: "0.000008", output: "0.00004" },
            }),
            entry("openai/gpt-5.5", "GPT 5.5", { reasoning }),
            entry("openai/gpt-5.5-fast", "GPT 5.5 (Fast)", { reasoning }),
          ],
        }),
      );
      const offered = yield* readCatalog.pipe(Effect.provide(layer));
      assert.deepEqual(
        offered.map((model) => model.id),
        ["anthropic/claude-opus-5.5", "anthropic/claude-opus-5.5-fast", "openai/gpt-5.5"],
      );
      assert.deepEqual(
        offered.find((model) => model.id === "anthropic/claude-opus-5.5-fast")?.pricing,
        { inputUsd: 0.000008, outputUsd: 0.00004 },
      );
      assert.deepEqual(
        validateModelChoice(offered, { model: "openai/gpt-5.5-fast", effort: "high" }),
        Result.fail(MODEL_CHOICE_REFUSAL.UNKNOWN_MODEL),
      );
    }),
);

it.effect(
  "a choice of a fast version is refused for an account that runs its provider on its own key, and accepted for one on Luke's key",
  () =>
    Effect.gen(function* () {
      const catalog = modelCatalogOf([
        {
          id: "anthropic/claude-opus-5.5",
          name: "Claude Opus 5.5",
          provider: MODEL_PROVIDER.ANTHROPIC,
          efforts: OPUS_EFFORTS,
        },
        {
          id: "anthropic/claude-opus-5.5-fast",
          name: "Claude Opus 5.5 (Fast)",
          provider: MODEL_PROVIDER.ANTHROPIC,
          efforts: OPUS_EFFORTS,
        },
      ]);
      const fast = { model: "anthropic/claude-opus-5.5-fast", effort: "high" };
      const ownKey = yield* acceptedModelChoice(fast, new Set([MODEL_PROVIDER.ANTHROPIC])).pipe(
        Effect.flip,
        Effect.provide(catalog),
      );
      assert.equal(
        ownKey._tag === "ModelChoiceRefused" ? ownKey.reason : ownKey._tag,
        MODEL_CHOICE_REFUSAL.UNKNOWN_MODEL,
      );
      assert.deepEqual(
        yield* acceptedModelChoice(fast, new Set()).pipe(Effect.provide(catalog)),
        fast,
      );
    }),
);
