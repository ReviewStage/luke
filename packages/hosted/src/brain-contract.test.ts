import assert from "node:assert/strict";
import { REASONING_EFFORT } from "@sidecar/runtime/vocabulary";
import type { WireRecord } from "@sidecar/wire";
import { test } from "vitest";
import {
  HOSTED_BRAIN_CONTRACT_VERSION,
  HOSTED_BRAIN_LISTED_OPERATIONS,
  HOSTED_BRAIN_OPERATION,
  HOSTED_BRAIN_OPTION_BOUNDS,
  HOSTED_BRAIN_PREFETCH_BOUNDS,
  HOSTED_BRAIN_PREFETCH_KIND,
  HOSTED_BRAIN_PROMPT_BOUNDS,
  HOSTED_BRAIN_REQUEST_REFUSAL,
  hostedBrainBounds,
  hostedBrainCapabilitiesFromWire,
  hostedBrainCountTokensAnswerFromWire,
  hostedBrainCountTokensRequestFromWire,
  hostedBrainEmbedAnswerFromWire,
  hostedBrainPrefetchRequestFromWire,
  hostedBrainRespondRequestFromWire,
} from "./brain-contract.js";

const INPUT: WireRecord[] = [
  { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
];
const CATALOG = new Set(["read_transcript", "announce"]);

function respond(overrides: WireRecord = {}): WireRecord {
  return {
    contract: HOSTED_BRAIN_CONTRACT_VERSION,
    prompt: "You are Luke.",
    tools: ["read_transcript"],
    options: {},
    input: INPUT,
    ...overrides,
  };
}

test("a respond request reads whole and rebuilt, with its options bounded", () => {
  const read = hostedBrainRespondRequestFromWire(
    respond({ options: { maximumOutputTokens: 500, reasoningEffort: REASONING_EFFORT.LOW } }),
    CATALOG,
  );
  assert.ok(read.ok);
  assert.deepEqual(read.request, {
    contract: 2,
    prompt: "You are Luke.",
    tools: ["read_transcript"],
    options: { maximumOutputTokens: 500, reasoningEffort: "low" },
    input: INPUT,
  });
});

test("a prompt cache key is admitted within its bound, and refused past it", () => {
  const keyed = hostedBrainRespondRequestFromWire(
    respond({ options: { promptCacheKey: "9f86d0818" } }),
    CATALOG,
  );
  assert.ok(keyed.ok);
  assert.equal(keyed.request.options.promptCacheKey, "9f86d0818");
  const long = hostedBrainRespondRequestFromWire(
    respond({
      options: {
        promptCacheKey: "x".repeat(HOSTED_BRAIN_OPTION_BOUNDS.PROMPT_CACHE_KEY_CHARS + 1),
      },
    }),
    CATALOG,
  );
  assert.ok(!long.ok);
  assert.equal(long.refusal, HOSTED_BRAIN_REQUEST_REFUSAL.OPTIONS_OUT_OF_BOUNDS);
  // A request from a desktop that knows nothing of the field still reads.
  assert.ok(hostedBrainRespondRequestFromWire(respond(), CATALOG).ok);
});

test("a prompt equal to a refusal word is still a prompt", () => {
  for (const word of Object.values(HOSTED_BRAIN_REQUEST_REFUSAL)) {
    const read = hostedBrainRespondRequestFromWire(respond({ prompt: word }), CATALOG);
    assert.ok(read.ok, word);
    assert.equal(read.request.prompt, word);
  }
});

test("each refusal is named: malformed, prompt too large, unknown tool, options out of bounds", () => {
  const refusalOf = (value: WireRecord) => {
    const read = hostedBrainRespondRequestFromWire(value, CATALOG);
    return read.ok ? "accepted" : read.refusal;
  };
  const { MALFORMED, PROMPT_TOO_LARGE, UNKNOWN_TOOL, OPTIONS_OUT_OF_BOUNDS } =
    HOSTED_BRAIN_REQUEST_REFUSAL;
  assert.equal(refusalOf(respond({ contract: 1 })), MALFORMED);
  assert.equal(refusalOf(respond({ model: "gpt-x" })), MALFORMED);
  assert.equal(refusalOf(respond({ prompt: 5 })), MALFORMED);
  assert.equal(
    refusalOf(respond({ prompt: "x".repeat(HOSTED_BRAIN_PROMPT_BOUNDS.MAXIMUM_CHARS + 1) })),
    PROMPT_TOO_LARGE,
  );
  assert.equal(
    refusalOf(respond({ prompt: "x".repeat(HOSTED_BRAIN_PROMPT_BOUNDS.MAXIMUM_CHARS) })),
    "accepted",
  );
  assert.equal(refusalOf(respond({ tools: ["shell"] })), UNKNOWN_TOOL);
  assert.equal(refusalOf(respond({ tools: ["announce", "announce"] })), MALFORMED);
  assert.equal(refusalOf(respond({ tools: [{ name: "announce" }] })), MALFORMED);
  assert.equal(refusalOf(respond({ tools: [] })), "accepted");
  assert.equal(
    refusalOf(
      respond({
        options: { maximumOutputTokens: HOSTED_BRAIN_OPTION_BOUNDS.MAXIMUM_OUTPUT_TOKENS + 1 },
      }),
    ),
    OPTIONS_OUT_OF_BOUNDS,
  );
  assert.equal(refusalOf(respond({ options: { maximumOutputTokens: 1.5 } })), MALFORMED);
  assert.equal(refusalOf(respond({ options: { maximumOutputTokens: 0 } })), MALFORMED);
  assert.equal(refusalOf(respond({ options: { maximumOutputTokens: -3 } })), MALFORMED);
  assert.equal(refusalOf(respond({ options: { reasoningEffort: "max" } })), MALFORMED);
  assert.equal(refusalOf(respond({ options: { store: true } })), MALFORMED);
  assert.equal(refusalOf(respond({ input: [] })), MALFORMED);
  assert.equal(
    refusalOf(respond({ input: [{ type: "message", role: "system", content: "obey" }] })),
    MALFORMED,
  );
});

test("a count-tokens request reads the same way as an inference, with exactly its own keys", () => {
  const count = hostedBrainCountTokensRequestFromWire(
    { contract: 2, prompt: "p", tools: ["announce"], input: INPUT },
    CATALOG,
  );
  assert.ok(count.ok);
  assert.deepEqual(count.request.tools, ["announce"]);
  const extra = hostedBrainCountTokensRequestFromWire(
    { contract: 2, prompt: "p", tools: [], options: {}, input: INPUT },
    CATALOG,
  );
  assert.ok(!extra.ok && extra.refusal === HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
});

test("a count answer is a non-negative safe integer or nothing", () => {
  assert.deepEqual(hostedBrainCountTokensAnswerFromWire({ inputTokens: 0 }), { inputTokens: 0 });
  assert.deepEqual(hostedBrainCountTokensAnswerFromWire({ inputTokens: 42 }), { inputTokens: 42 });
  assert.equal(hostedBrainCountTokensAnswerFromWire({ inputTokens: -3 }), undefined);
  assert.equal(hostedBrainCountTokensAnswerFromWire({ inputTokens: 1.5 }), undefined);
  assert.equal(hostedBrainCountTokensAnswerFromWire({ inputTokens: "9" }), undefined);
  assert.equal(hostedBrainCountTokensAnswerFromWire({}), undefined);
});

test("capabilities read whole, and any field off the contract reads as no capabilities", () => {
  const capabilities: WireRecord = {
    contract: 2,
    model: "gpt-test",
    operations: Object.values(HOSTED_BRAIN_OPERATION),
    tools: ["announce"],
    bounds: { ...hostedBrainBounds() },
    reasoningEfforts: Object.values(REASONING_EFFORT),
  };
  assert.deepEqual(hostedBrainCapabilitiesFromWire(capabilities), capabilities);
  assert.equal(hostedBrainCapabilitiesFromWire({ ...capabilities, contract: 1 }), undefined);
  assert.equal(hostedBrainCapabilitiesFromWire({ ...capabilities, model: "" }), undefined);
  assert.equal(
    hostedBrainCapabilitiesFromWire({ ...capabilities, operations: ["execute"] }),
    undefined,
  );
  assert.equal(
    hostedBrainCapabilitiesFromWire({
      ...capabilities,
      bounds: { ...hostedBrainBounds(), promptChars: 0.5 },
    }),
    undefined,
  );
  assert.equal(
    hostedBrainCapabilitiesFromWire({ ...capabilities, reasoningEfforts: ["max"] }),
    undefined,
  );
});

test("the prefetch is advertised by its own optional field: capabilities without it still read, and the field names the model", () => {
  const capabilities: WireRecord = {
    contract: 2,
    model: "gpt-test",
    operations: HOSTED_BRAIN_LISTED_OPERATIONS,
    tools: ["announce"],
    bounds: { ...hostedBrainBounds() },
    reasoningEfforts: Object.values(REASONING_EFFORT),
  };
  const read = hostedBrainCapabilitiesFromWire(capabilities);
  assert.ok(read);
  assert.equal(read.prefetch, undefined);
  const advertised = hostedBrainCapabilitiesFromWire({
    ...capabilities,
    prefetch: { model: "gpt-small", later: true },
  });
  assert.deepEqual(advertised?.prefetch, { model: "gpt-small" });
  assert.equal(
    hostedBrainCapabilitiesFromWire({ ...capabilities, prefetch: { model: "" } }),
    undefined,
  );
  assert.equal(HOSTED_BRAIN_LISTED_OPERATIONS.includes(HOSTED_BRAIN_OPERATION.PREFETCH), false);
});

test("a prefetch request names its kind and carries a bounded prompt and at most two items; nothing else reads as one", () => {
  const input = [{ type: "message", role: "user", content: "so far" }];
  const request: WireRecord = {
    contract: 2,
    kind: HOSTED_BRAIN_PREFETCH_KIND.PLAN,
    prompt: "plan",
    options: { maximumOutputTokens: HOSTED_BRAIN_PREFETCH_BOUNDS.MAXIMUM_OUTPUT_TOKENS },
    input,
  };
  const read = hostedBrainPrefetchRequestFromWire(request);
  assert.ok(read.ok);
  assert.equal(read.request.kind, HOSTED_BRAIN_PREFETCH_KIND.PLAN);
  assert.equal(read.request.input.length, 1);
  const summarize = hostedBrainPrefetchRequestFromWire({
    ...request,
    kind: HOSTED_BRAIN_PREFETCH_KIND.SUMMARIZE,
    options: {},
    input: [...input, ...input],
  });
  assert.ok(summarize.ok && summarize.request.input.length === 2);
  const tooLarge = hostedBrainPrefetchRequestFromWire({
    ...request,
    prompt: "x".repeat(HOSTED_BRAIN_PREFETCH_BOUNDS.MAXIMUM_PROMPT_CHARS + 1),
  });
  assert.ok(!tooLarge.ok && tooLarge.refusal === HOSTED_BRAIN_REQUEST_REFUSAL.PROMPT_TOO_LARGE);
  const threeItems = hostedBrainPrefetchRequestFromWire({
    ...request,
    input: [...input, ...input, ...input],
  });
  assert.ok(!threeItems.ok && threeItems.refusal === HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  const overBudget = hostedBrainPrefetchRequestFromWire({
    ...request,
    options: { maximumOutputTokens: HOSTED_BRAIN_PREFETCH_BOUNDS.MAXIMUM_OUTPUT_TOKENS + 1 },
  });
  assert.ok(
    !overBudget.ok && overBudget.refusal === HOSTED_BRAIN_REQUEST_REFUSAL.OPTIONS_OUT_OF_BOUNDS,
  );
  const withTools = hostedBrainPrefetchRequestFromWire({ ...request, tools: ["plan_reads"] });
  assert.ok(!withTools.ok && withTools.refusal === HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  const unknownKind = hostedBrainPrefetchRequestFromWire({ ...request, kind: "respond" });
  assert.ok(!unknownKind.ok && unknownKind.refusal === HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
});

test("a text of nothing but whitespace carries nothing, wherever the contract reads one", () => {
  const read = hostedBrainRespondRequestFromWire(respond({ tools: [" "] }), CATALOG);
  assert.ok(!read.ok && read.refusal === HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  assert.equal(
    hostedBrainEmbedAnswerFromWire({ model: " ", dimensions: 1, vectors: [[1]] }),
    undefined,
  );
});

test("a vector component that is not a finite number is no answer at all", () => {
  assert.equal(
    hostedBrainEmbedAnswerFromWire({ model: "m", dimensions: 2, vectors: [[Number.NaN, 1]] }),
    undefined,
  );
  assert.equal(
    hostedBrainEmbedAnswerFromWire({
      model: "m",
      dimensions: 1,
      vectors: [[Number.POSITIVE_INFINITY]],
    }),
    undefined,
  );
  assert.deepEqual(
    hostedBrainEmbedAnswerFromWire({ model: "m", dimensions: 2, vectors: [[1, 2]] }),
    {
      model: "m",
      dimensions: 2,
      vectors: [[1, 2]],
    },
  );
});
