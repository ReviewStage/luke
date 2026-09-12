import assert from "node:assert/strict";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { test } from "vitest";
import {
  BRAIN_EMBEDDING_MODEL,
  BRAIN_EMBEDDINGS_PATH,
  HOSTED_BRAIN_CONTRACT_VERSION,
  HOSTED_SERVICE_PATH,
  hostedBrainEmbedAnswerFromWire,
  isRecord,
  type UnparsedWireValue,
  type WireRecord,
} from "../server/core";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import type { HostedSpend } from "../server/hosted/quota";
import { type BrainCall, brainAnswer } from "./support/brain-call";

const NOW = Date.parse("2026-09-08T12:00:00.000Z");
const OPEN_SPEND: HostedSpend = {
  allowed: true,
  quota: { used: 2, limit: 5_000, resetsAt: NOW + 43_200_000 },
};

function request(body: WireRecord | null): Request {
  return new Request(`https://luke.test${HOSTED_SERVICE_PATH.BRAIN_EMBED}`, {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: body === null ? null : JSON.stringify(body),
  });
}

function upstream(answer: () => Response) {
  const calls: { url: string; body: WireRecord }[] = [];
  const layer = fakeHttpClientLayer((url, init) => {
    // SAFETY: every upstream body the handler sends is JSON.stringify output.
    const body = JSON.parse(String(init.body)) as UnparsedWireValue;
    assert.ok(isRecord(body));
    calls.push({ url, body });
    return answer();
  });
  return { layer, calls };
}

function options(overrides: Partial<BrainCall> & { request: Request }): BrainCall {
  return {
    apiKey: "sk-hosted-secret",
    resolveUserId: async () => "user-1",
    spend: async () => OPEN_SPEND,
    ...overrides,
  };
}

test("an embed request posts the texts under the build-fixed model, spends the allowance, and answers one vector per text", async () => {
  const { layer, calls } = upstream(() =>
    Response.json({
      object: "list",
      model: BRAIN_EMBEDDING_MODEL,
      data: [
        { object: "embedding", index: 1, embedding: [0, 1] },
        { object: "embedding", index: 0, embedding: [1, 0] },
      ],
    }),
  );
  let spent = 0;
  const response = await brainAnswer(
    options({
      request: request({ contract: HOSTED_BRAIN_CONTRACT_VERSION, texts: ["a", "b"] }),
      httpClient: layer,
      spend: async () => {
        spent += 1;
        return OPEN_SPEND;
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(spent, 1);
  assert.equal(calls[0]?.url, `https://api.openai.com/v1${BRAIN_EMBEDDINGS_PATH}`);
  assert.deepEqual(calls[0]?.body, {
    model: BRAIN_EMBEDDING_MODEL,
    input: ["a", "b"],
    encoding_format: "float",
  });
  // SAFETY: response.json returns a runtime value; the reader below validates it as wire.
  const answer = hostedBrainEmbedAnswerFromWire((await response.json()) as UnparsedWireValue);
  assert.deepEqual(answer, {
    model: BRAIN_EMBEDDING_MODEL,
    dimensions: 2,
    vectors: [
      [1, 0],
      [0, 1],
    ],
  });
});

test("a malformed embed request, a spent allowance, and a malformed upstream answer each refuse without a vector", async () => {
  const malformed = await brainAnswer(
    options({ request: request({ contract: HOSTED_BRAIN_CONTRACT_VERSION, texts: [] }) }),
  );
  assert.equal(malformed.status, 400);
  // SAFETY: response.json returns a runtime value; only the error field is read.
  assert.equal(
    ((await malformed.json()) as { error: string }).error,
    HOSTED_API_ERROR.INVALID_REQUEST,
  );
  const exhausted = await brainAnswer(
    options({
      request: request({ contract: HOSTED_BRAIN_CONTRACT_VERSION, texts: ["a"] }),
      spend: async () => ({ allowed: false, quota: OPEN_SPEND.quota }),
    }),
  );
  assert.equal(exhausted.status, 429);
  const { layer } = upstream(() => Response.json({ object: "list", model: "m", data: [] }));
  const empty = await brainAnswer(
    options({
      request: request({ contract: HOSTED_BRAIN_CONTRACT_VERSION, texts: ["a"] }),
      httpClient: layer,
    }),
  );
  assert.equal(empty.status, 502);
});
