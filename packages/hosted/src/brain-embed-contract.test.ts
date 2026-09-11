import assert from "node:assert/strict";
import type { UnparsedWireValue } from "@sidecar/wire";
import { test } from "vitest";
import {
  HOSTED_BRAIN_CONTRACT_VERSION,
  HOSTED_BRAIN_EMBED_BOUNDS,
  HOSTED_BRAIN_OPERATION,
  HOSTED_BRAIN_REQUEST_REFUSAL,
  hostedBrainCapabilitiesFromWire,
  hostedBrainEmbedAnswerFromWire,
  hostedBrainEmbedRequestFromWire,
} from "./brain-contract.js";

test("an embed request carries the contract and non-empty texts within the bounds, and nothing else", () => {
  const read = hostedBrainEmbedRequestFromWire({
    contract: HOSTED_BRAIN_CONTRACT_VERSION,
    texts: ["prefers tabs", "ships on tuesdays"],
  });
  assert.deepEqual(read, {
    ok: true,
    request: {
      contract: HOSTED_BRAIN_CONTRACT_VERSION,
      texts: ["prefers tabs", "ships on tuesdays"],
    },
  });
  const malformedRequests: UnparsedWireValue[] = [
    { texts: ["x"] },
    { contract: 1, texts: ["x"] },
    { contract: HOSTED_BRAIN_CONTRACT_VERSION, texts: [] },
    { contract: HOSTED_BRAIN_CONTRACT_VERSION, texts: ["   "] },
    { contract: HOSTED_BRAIN_CONTRACT_VERSION, texts: [1] },
    { contract: HOSTED_BRAIN_CONTRACT_VERSION, texts: ["x"], model: "anything" },
  ];
  for (const malformed of malformedRequests) {
    const refused = hostedBrainEmbedRequestFromWire(malformed);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.refusal, HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  }
  const tooMany = hostedBrainEmbedRequestFromWire({
    contract: HOSTED_BRAIN_CONTRACT_VERSION,
    texts: Array.from({ length: HOSTED_BRAIN_EMBED_BOUNDS.MAXIMUM_TEXTS + 1 }, () => "x"),
  });
  assert.equal(tooMany.ok, false);
  if (!tooMany.ok)
    assert.equal(tooMany.refusal, HOSTED_BRAIN_REQUEST_REFUSAL.OPTIONS_OUT_OF_BOUNDS);
  const tooLong = hostedBrainEmbedRequestFromWire({
    contract: HOSTED_BRAIN_CONTRACT_VERSION,
    texts: ["y".repeat(HOSTED_BRAIN_EMBED_BOUNDS.MAXIMUM_TEXT_CHARS + 1)],
  });
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok)
    assert.equal(tooLong.refusal, HOSTED_BRAIN_REQUEST_REFUSAL.OPTIONS_OUT_OF_BOUNDS);
});

test("an embed answer is one vector per text at the width it names", () => {
  assert.deepEqual(
    hostedBrainEmbedAnswerFromWire({
      model: "text-embedding-3-small",
      dimensions: 2,
      vectors: [[0.5, 1]],
    }),
    { model: "text-embedding-3-small", dimensions: 2, vectors: [[0.5, 1]] },
  );
  assert.equal(
    hostedBrainEmbedAnswerFromWire({ model: "m", dimensions: 2, vectors: [[0.5]] }),
    undefined,
  );
  assert.equal(
    hostedBrainEmbedAnswerFromWire({ model: "m", dimensions: 0, vectors: [] }),
    undefined,
  );
  assert.equal(
    hostedBrainEmbedAnswerFromWire({ model: "", dimensions: 1, vectors: [[1]] }),
    undefined,
  );
  assert.equal(
    hostedBrainEmbedAnswerFromWire({ model: "m", dimensions: 1, vectors: [["1"]] }),
    undefined,
  );
});

test("capabilities may list the embed operation, and a service without it is still read", () => {
  const bounds = { promptChars: 1, inputItems: 1, requestBytes: 1, maximumOutputTokens: 1 };
  const withEmbed = hostedBrainCapabilitiesFromWire({
    contract: HOSTED_BRAIN_CONTRACT_VERSION,
    model: "m",
    operations: Object.values(HOSTED_BRAIN_OPERATION),
    tools: ["memory_search"],
    bounds,
    reasoningEfforts: ["medium"],
  });
  assert.ok(withEmbed?.operations.includes(HOSTED_BRAIN_OPERATION.EMBED));
  const without = hostedBrainCapabilitiesFromWire({
    contract: HOSTED_BRAIN_CONTRACT_VERSION,
    model: "m",
    operations: ["respond"],
    tools: [],
    bounds,
    reasoningEfforts: ["medium"],
  });
  assert.equal(without?.operations.includes(HOSTED_BRAIN_OPERATION.EMBED), false);
});
