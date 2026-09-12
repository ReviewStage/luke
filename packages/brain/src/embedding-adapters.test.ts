import assert from "node:assert/strict";
import {
  HOSTED_BRAIN_CONTRACT_VERSION,
  HOSTED_BRAIN_OPERATION,
  HOSTED_SERVICE_PATH,
} from "@sidecar/hosted";
import { MODEL_FAILURE, MODEL_RESPONSE_OUTCOME } from "@sidecar/runtime/vocabulary";
import { Effect } from "effect";
import { test } from "vitest";
import {
  BRAIN_EMBEDDING_MODEL,
  BRAIN_EMBEDDINGS_PATH,
  EMBEDDING_BATCH_SIZE,
  embeddingsVectors,
  HostedEmbeddingAdapter,
  OpenAiEmbeddingAdapter,
} from "./embedding-adapters.js";

interface Call {
  url: string;
  body: unknown;
  authorization: string | undefined;
}

function fetchAnswering(answer: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchLike = async (input: string, init: RequestInit): Promise<Response> => {
    const headers = new Headers(init.headers);
    const call: Call = {
      url: input,
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
      authorization: headers.get("authorization") ?? undefined,
    };
    calls.push(call);
    return answer(call);
  };
  return { calls, fetch: fetchLike };
}

function embeddingsPayload(vectors: readonly number[][], model = BRAIN_EMBEDDING_MODEL) {
  return {
    object: "list",
    model,
    data: vectors.map((embedding, index) => ({ object: "embedding", index, embedding })).reverse(),
  };
}

test("the embeddings answer is read in the order of the texts, or not at all", () => {
  assert.deepEqual(
    embeddingsVectors(
      embeddingsPayload([
        [1, 0],
        [0, 1],
      ]),
    ),
    {
      model: BRAIN_EMBEDDING_MODEL,
      vectors: [
        [1, 0],
        [0, 1],
      ],
    },
  );
  assert.equal(embeddingsVectors(embeddingsPayload([[1, 0], [1]])), undefined, "unequal widths");
  assert.equal(embeddingsVectors({ data: "no" }), undefined);
});

test("the keyed adapter posts the build-fixed model on the key and reports its identity", async () => {
  const { calls, fetch } = fetchAnswering(() =>
    Response.json(
      embeddingsPayload([
        [0.1, 0.2, 0.3],
        [0.3, 0.2, 0.1],
      ]),
    ),
  );
  const adapter = new OpenAiEmbeddingAdapter({ apiKey: "sk-test", fetch });
  const batch = await adapter.embed(["a", "b"]);
  assert.equal(batch.outcome, MODEL_RESPONSE_OUTCOME.ANSWERED);
  if (batch.outcome === MODEL_RESPONSE_OUTCOME.ANSWERED) assert.equal(batch.vectors.length, 2);
  assert.equal(calls[0]?.url, `https://api.openai.com/v1${BRAIN_EMBEDDINGS_PATH}`);
  assert.equal(calls[0]?.authorization, "Bearer sk-test");
  assert.deepEqual(calls[0]?.body, {
    model: BRAIN_EMBEDDING_MODEL,
    input: ["a", "b"],
    encoding_format: "float",
  });
  assert.deepEqual(await adapter.identity(), {
    provider: "openai-embeddings",
    model: BRAIN_EMBEDDING_MODEL,
    dimensions: 3,
  });
  const tooMany = await adapter.embed(Array.from({ length: EMBEDDING_BATCH_SIZE + 1 }, () => "x"));
  assert.equal(tooMany.outcome, MODEL_RESPONSE_OUTCOME.FAILED);
});

test("the keyed adapter names a throttle, a refused key, and an upstream failure by kind", async () => {
  const statuses = [429, 401, 500];
  const { fetch } = fetchAnswering(
    () => new Response("", { status: statuses.shift() ?? 200, headers: { "retry-after": "2" } }),
  );
  const adapter = new OpenAiEmbeddingAdapter({ apiKey: "sk-test", fetch, now: () => 1_000 });
  const throttledAnswer = await adapter.embed(["a"]);
  assert.deepEqual(throttledAnswer, { outcome: MODEL_RESPONSE_OUTCOME.THROTTLED, until: 3_000 });
  const refused = await adapter.embed(["a"]);
  assert.equal(
    refused.outcome === MODEL_RESPONSE_OUTCOME.FAILED && refused.failure,
    MODEL_FAILURE.CREDENTIAL,
  );
  const upstream = await adapter.embed(["a"]);
  assert.equal(
    upstream.outcome === MODEL_RESPONSE_OUTCOME.FAILED && upstream.failure,
    MODEL_FAILURE.UPSTREAM,
  );
});

function capabilities(operations: readonly string[]) {
  return {
    contract: HOSTED_BRAIN_CONTRACT_VERSION,
    model: "gpt",
    operations,
    tools: [],
    bounds: { promptChars: 1, inputItems: 1, requestBytes: 1, maximumOutputTokens: 1 },
    reasoningEfforts: ["medium"],
  };
}

test("the hosted adapter reads the capabilities once and embeds through the contract's operation", async () => {
  const { calls, fetch } = fetchAnswering((call) =>
    call.url.endsWith(HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES)
      ? Response.json(capabilities(Object.values(HOSTED_BRAIN_OPERATION)))
      : Response.json({ model: "text-embedding-3-small", dimensions: 2, vectors: [[1, 0]] }),
  );
  const adapter = new HostedEmbeddingAdapter({
    serviceBaseUrl: "https://luke.test/",
    readAccessToken: async () => "token-1",
    refreshAccount: () => Effect.void,
    fetch,
  });
  const batch = await adapter.embed(["a"]);
  assert.equal(batch.outcome, MODEL_RESPONSE_OUTCOME.ANSWERED);
  await adapter.embed(["b"]);
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      `https://luke.test${HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES}`,
      `https://luke.test${HOSTED_SERVICE_PATH.BRAIN_EMBED}`,
      `https://luke.test${HOSTED_SERVICE_PATH.BRAIN_EMBED}`,
    ],
  );
  assert.deepEqual(calls[1]?.body, { contract: HOSTED_BRAIN_CONTRACT_VERSION, texts: ["a"] });
  assert.equal(calls[1]?.authorization, "Bearer token-1");
  assert.deepEqual(await adapter.identity(), {
    provider: "hosted-embeddings",
    model: "text-embedding-3-small",
    dimensions: 2,
  });
});

test("a hosted service without the embed operation is a compatibility failure, not a fallback", async () => {
  const { calls, fetch } = fetchAnswering(() =>
    Response.json(capabilities(["respond", "count-tokens", "compact"])),
  );
  const adapter = new HostedEmbeddingAdapter({
    serviceBaseUrl: "https://luke.test",
    readAccessToken: async () => "token-1",
    refreshAccount: () => Effect.void,
    fetch,
  });
  const batch = await adapter.embed(["a"]);
  assert.equal(
    batch.outcome === MODEL_RESPONSE_OUTCOME.FAILED && batch.failure,
    MODEL_FAILURE.COMPATIBILITY,
  );
  assert.equal(calls.length, 1, "nothing is posted to an operation the service does not offer");
  const noToken = new HostedEmbeddingAdapter({
    serviceBaseUrl: "https://luke.test",
    readAccessToken: async () => undefined,
    refreshAccount: () => Effect.void,
    fetch,
  });
  const unsigned = await noToken.embed(["a"]);
  assert.equal(
    unsigned.outcome === MODEL_RESPONSE_OUTCOME.FAILED && unsigned.failure,
    MODEL_FAILURE.CREDENTIAL,
  );
});
