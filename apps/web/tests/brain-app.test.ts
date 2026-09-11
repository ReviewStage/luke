import assert from "node:assert/strict";
import path from "node:path";
import { test } from "vitest";
import {
  ACTION_TOOL,
  BRAIN_EMBEDDING_MODEL,
  BRAIN_TOOL,
  HOSTED_BRAIN_CONTRACT_VERSION,
  HOSTED_BRAIN_PROMPT_BOUNDS,
  HOSTED_SERVICE_PATH,
  maximumHostedBrainRequestBytes,
  type WireRecord,
} from "../server/core";
import type { HostedSpend } from "../server/hosted/quota";
import { type BrainCall, brainAnswer } from "./support/brain-call";
import {
  type RecordedResponse,
  recordedGoldenNames,
  recordedResponse,
  settleResponseGolden,
} from "./support/response-golden";

/**
 * The bytes the brain group answers with, recorded from the promise-shaped
 * routes it replaces: the status, every header, and the body of each
 * operation and each refusal. The desktop's hosted brain client reads these
 * against the contract in `@sidecar/hosted`, so a byte that moved while the
 * routes converted would be a contract break nothing else would catch.
 *
 * `content-length` is held to the body it frames rather than recorded beside
 * it: the platform's web handler computes it from the very bytes the golden
 * holds, so recording it would record the same fact twice and a body edited
 * by hand would still read as settled.
 */

const GOLDEN_ROOT = path.join(import.meta.dirname, "../fixtures/brain-route");
const NOW = Date.parse("2026-09-07T12:00:00.000Z");
const OPEN_SPEND: HostedSpend = {
  allowed: true,
  quota: { used: 2, limit: 5_000, resetsAt: NOW + 43_200_000 },
};
const INPUT: readonly WireRecord[] = [
  { type: "message", role: "user", content: [{ type: "input_text", text: "[ask] anything?" }] },
];
const RESPONDED = {
  id: "resp_1",
  status: "completed",
  output: [
    {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "Nothing needs you.", annotations: [] }],
    },
  ],
  usage: { input_tokens: 42 },
};

const FRAMING_HEADER = { CONTENT_LENGTH: "content-length" } as const;

/** The answer as the desktop reads it, with the framing header held to the body it frames. */
async function answered(response: Response): Promise<RecordedResponse> {
  const recorded = await recordedResponse(response);
  const framed = recorded.headers.find(([name]) => name === FRAMING_HEADER.CONTENT_LENGTH);
  if (framed) assert.equal(Number(framed[1]), new TextEncoder().encode(recorded.body).byteLength);
  return {
    ...recorded,
    headers: recorded.headers.filter(([name]) => name !== FRAMING_HEADER.CONTENT_LENGTH),
  };
}

const HEADERS = { authorization: "Bearer token-1", "content-type": "application/json" } as const;

function get(servicePath: string): Request {
  return new Request(`https://luke.test${servicePath}`, { method: "GET", headers: HEADERS });
}

function post(servicePath: string, body: string): Request {
  return new Request(`https://luke.test${servicePath}`, { method: "POST", headers: HEADERS, body });
}

function posted(servicePath: string, body: WireRecord): Request {
  return post(servicePath, JSON.stringify(body));
}

function respondBody(overrides: WireRecord = {}): WireRecord {
  return {
    contract: HOSTED_BRAIN_CONTRACT_VERSION,
    prompt: "You are Luke.",
    tools: [ACTION_TOOL.SEND_SESSION_MESSAGE, BRAIN_TOOL.READ_TRANSCRIPT],
    options: {},
    input: INPUT,
    ...overrides,
  };
}

function upstream(answer: () => Response) {
  return async (): Promise<Response> => answer();
}

function answering(call: Partial<BrainCall> & { request: Request }): () => Promise<Response> {
  return () =>
    brainAnswer({
      apiKey: "sk-hosted-secret",
      resolveUserId: async () => "user-1",
      spend: async () => OPEN_SPEND,
      ...call,
    });
}

const CASES: readonly (readonly [string, () => Promise<Response>])[] = [
  ["capabilities", answering({ request: get(HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES) })],
  [
    "capabilities-method-not-allowed",
    answering({ request: post(HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES, "") }),
  ],
  [
    "capabilities-unavailable",
    answering({
      request: get(HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES),
      apiKey: " ",
    }),
  ],
  [
    "capabilities-invalid-token",
    answering({
      request: get(HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES),
      resolveUserId: async () => undefined,
    }),
  ],
  [
    "respond",
    answering({
      request: posted(HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2, respondBody()),
      fetch: upstream(() => Response.json(RESPONDED)),
    }),
  ],
  [
    "respond-prompt-too-large",
    answering({
      request: posted(
        HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2,
        respondBody({ prompt: "x".repeat(HOSTED_BRAIN_PROMPT_BOUNDS.MAXIMUM_CHARS + 1) }),
      ),
    }),
  ],
  [
    "respond-unknown-tool",
    answering({
      request: posted(HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2, respondBody({ tools: ["shell"] })),
    }),
  ],
  [
    "respond-invalid-request",
    answering({
      request: posted(HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2, respondBody({ contract: 1 })),
    }),
  ],
  [
    "respond-request-too-large",
    answering({
      request: post(
        HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2,
        JSON.stringify(
          respondBody({
            input: [
              {
                type: "message",
                role: "user",
                content: "x".repeat(maximumHostedBrainRequestBytes),
              },
            ],
          }),
        ),
      ),
    }),
  ],
  [
    "respond-quota-exhausted",
    answering({
      request: posted(HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2, respondBody()),
      spend: async () => ({ allowed: false, quota: OPEN_SPEND.quota }),
    }),
  ],
  [
    "respond-upstream-throttled",
    answering({
      request: posted(HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2, respondBody()),
      fetch: upstream(() => new Response("", { status: 429, headers: { "retry-after": "12" } })),
    }),
  ],
  [
    "respond-upstream-error",
    answering({
      request: posted(HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2, respondBody()),
      fetch: upstream(() => new Response("upstream secret words", { status: 500 })),
    }),
  ],
  [
    "count-tokens",
    answering({
      request: posted(HOSTED_SERVICE_PATH.BRAIN_COUNT_TOKENS, {
        contract: HOSTED_BRAIN_CONTRACT_VERSION,
        prompt: "You are Luke.",
        tools: [BRAIN_TOOL.ANNOUNCE],
        input: INPUT,
      }),
      fetch: upstream(() =>
        Response.json({ object: "response.input_tokens", input_tokens: 1_234 }),
      ),
    }),
  ],
  [
    "count-tokens-upstream-error",
    answering({
      request: posted(HOSTED_SERVICE_PATH.BRAIN_COUNT_TOKENS, {
        contract: HOSTED_BRAIN_CONTRACT_VERSION,
        prompt: "p",
        tools: [],
        input: INPUT,
      }),
      fetch: upstream(() => Response.json({ input_tokens: -1 })),
    }),
  ],
  [
    "embed",
    answering({
      request: posted(HOSTED_SERVICE_PATH.BRAIN_EMBED, {
        contract: HOSTED_BRAIN_CONTRACT_VERSION,
        texts: ["one", "two"],
      }),
      fetch: upstream(() =>
        Response.json({
          object: "list",
          model: BRAIN_EMBEDDING_MODEL,
          data: [
            { object: "embedding", index: 1, embedding: [0, 1] },
            { object: "embedding", index: 0, embedding: [1, 0] },
          ],
        }),
      ),
    }),
  ],
  [
    "route-not-found",
    answering({ request: posted(`${HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2}/extra`, respondBody()) }),
  ],
];

test("the group answers each operation and each refusal with the bytes recorded for it", async () => {
  for (const [name, answer] of CASES) {
    await settleResponseGolden(GOLDEN_ROOT, name, await answered(await answer()));
  }
});

test("the recorded set is exactly the cases declared", async () => {
  const named = CASES.map(([name]) => name).sort();
  assert.deepEqual(await recordedGoldenNames(GOLDEN_ROOT), named);
});
