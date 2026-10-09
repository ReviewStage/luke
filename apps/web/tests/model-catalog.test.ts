import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  HTTP_STATUS,
  type JsonValue,
  jsonResponse,
  recordingHttpClient,
} from "@sidecar/wire/testing";
import { Duration, Effect, Layer, Result } from "effect";
import { TestClock } from "effect/testing";
import {
  type CatalogModel,
  CODING_AGENT_DEFAULT_CHOICE,
  MODEL_CATALOG_TTL,
  MODEL_CATALOG_URL,
  MODEL_CHOICE_REFUSAL,
  MODEL_PROVIDER,
  ModelCatalog,
  modelCatalogLayer,
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
 * out.
 */

/** One catalog entry as AI Gateway shapes it, with only what the reader looks at and one field it does not. */
function entry(
  id: string,
  name: string,
  options: {
    readonly tags?: readonly string[];
    readonly reasoning?: readonly JsonValue[] | null;
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
    context_window: 200_000,
    ...(reasoning === null ? undefined : { reasoning_options: [...reasoning] }),
  };
}

const OPUS_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const CATALOG: JsonValue = {
  object: "list",
  data: [
    entry("alibaba/qwen-3-14b", "Qwen3-14B"),
    entry("anthropic/claude-opus-5.5", "Claude Opus 5.5", {
      reasoning: [{ type: "effort", values: OPUS_EFFORTS }],
    }),
    entry("anthropic/claude-sonnet-4.5", "Claude Sonnet 4.5", {
      reasoning: [{ type: "toggle" }, { type: "budget_tokens", min: 1024 }],
    }),
    entry("anthropic/claude-haiku-4", "Claude Haiku 4", { tags: ["tool-use"] }),
    entry("openai/gpt-6.1-sol", "GPT-6.1 Sol", {
      reasoning: [{ type: "toggle" }, { type: "effort", values: ["none", "low", "high"] }],
    }),
    entry("openai/gpt-4.1", "GPT-4.1", { tags: ["tool-use"], reasoning: null }),
    entry("openai/gpt-image-2", "GPT Image 2", {
      tags: ["reasoning", "tool-use"],
      reasoning: null,
    }),
    entry("xai/grok-5", "Grok 5"),
  ],
};

const OFFERED: readonly CatalogModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: OPUS_EFFORTS,
    contextWindow: 200_000,
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
  });
  assert.deepEqual(providerModelOf("anthropic/claude-sonnet-5"), {
    provider: MODEL_PROVIDER.ANTHROPIC,
    modelId: "claude-sonnet-5",
  });
  assert.deepEqual(providerModelOf("openai/gpt-6.1-sol"), {
    provider: MODEL_PROVIDER.OPENAI,
    modelId: "gpt-6.1-sol",
  });
  assert.equal(providerModelOf("xai/grok-5"), undefined);
  assert.equal(providerModelOf("claude-opus-5.5"), undefined);
  assert.equal(providerModelOf("anthropic/"), undefined);
});
