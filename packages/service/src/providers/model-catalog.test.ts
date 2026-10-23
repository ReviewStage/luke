import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { CODING_AGENT_DEFAULT_CHOICE } from "@luke/features/models-wire";
import {
  type JsonValue,
  jsonResponse,
  type RecordedRequest,
  recordingHttpClient,
} from "@luke/wire/testing";
import { Effect, Layer, Result } from "effect";
import { ModelCatalog, modelCatalogLayer, validateModelChoice } from "./model-catalog.js";

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

/** The catalog layer over a gateway answering as scripted, with the requests it saw. */
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
      validateModelChoice(offered, CODING_AGENT_DEFAULT_CHOICE),
      Result.succeed(CODING_AGENT_DEFAULT_CHOICE),
    );
  }),
);
