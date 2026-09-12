import assert from "node:assert/strict";
import path from "node:path";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { test } from "vitest";
import { HOSTED_SERVICE_PATH } from "../server/core";
import type { HostedSpend, IntroductionSpend } from "../server/hosted/quota";
import { type MintCall, mintAnswer } from "./support/mint-call";
import {
  type RecordedResponse,
  recordedGoldenNames,
  recordedResponse,
  settleResponseGolden,
} from "./support/response-golden";

/**
 * The bytes the two mint groups answer with, recorded from the promise-shaped
 * routes it replaces: the status, every header, and the body of each mint and
 * each refusal. The desktop's and the phone's mint clients read these against
 * the contract in `@sidecar/hosted`, so a byte that moved while the routes
 * converted would be a contract break nothing else would catch.
 *
 * `content-length` is held to the body it frames rather than recorded beside
 * it: the platform's web handler computes it from the very bytes the golden
 * holds.
 */

const GOLDEN_ROOT = path.join(import.meta.dirname, "../fixtures/voice-mint-route");
const NOW = Date.parse("2026-08-17T12:00:00.000Z");
const API_KEY = "sk-hosted-secret";
const OPEN_SPEND: HostedSpend = {
  allowed: true,
  quota: { used: 1, limit: 5_000, resetsAt: NOW + 43_200_000 },
};
const SPENT: HostedSpend = {
  allowed: false,
  quota: { used: 5_001, limit: 5_000, resetsAt: NOW + 43_200_000 },
};
const OPEN_INTRODUCTION: IntroductionSpend = { allowed: true };
const SPENT_INTRODUCTION: IntroductionSpend = { allowed: false };

/** The shape a caller may send, plus the stray fields the refusal cases probe with. */
interface MintRequestBody {
  voice?: string;
  speed?: number;
  scene?: string;
}

function mintRequest(servicePath: string, body?: MintRequestBody, method = "POST"): Request {
  const init: RequestInit = { method, headers: { authorization: "Bearer token-1" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`https://luke.test${servicePath}`, init);
}

function upstream(answer: () => Response) {
  return fakeHttpClientLayer(() => answer());
}

const minted = () => Response.json({ value: "eph-secret", expires_at: (NOW + 60_000) / 1000 });

function voice(overrides: Partial<MintCall> = {}) {
  return {
    request: mintRequest(HOSTED_SERVICE_PATH.VOICE_MINT),
    apiKey: API_KEY,
    resolveUserId: async () => "user-1",
    spend: async () => OPEN_SPEND,
    now: () => NOW,
    httpClient: upstream(minted),
    ...overrides,
  };
}

function remote(overrides: Partial<MintCall> = {}) {
  return {
    request: mintRequest(HOSTED_SERVICE_PATH.REMOTE_VOICE_MINT),
    apiKey: API_KEY,
    resolveUserId: async () => "user-1",
    spend: async () => OPEN_SPEND,
    readVaultKeys: async () => [],
    now: () => NOW,
    httpClient: upstream(minted),
    ...overrides,
  };
}

function introduction(overrides: Partial<MintCall> = {}) {
  return {
    request: mintRequest(HOSTED_SERVICE_PATH.INTRODUCTION_MINT),
    apiKey: API_KEY,
    spendIntroduction: async () => OPEN_INTRODUCTION,
    now: () => NOW,
    httpClient: upstream(minted),
    ...overrides,
  };
}

const CASES: [string, () => Promise<Response>][] = [
  ["mint", () => mintAnswer(voice())],
  [
    "mint-method-not-allowed",
    () =>
      mintAnswer(voice({ request: mintRequest(HOSTED_SERVICE_PATH.VOICE_MINT, undefined, "GET") })),
  ],
  ["mint-unavailable", () => mintAnswer(voice({ apiKey: " " }))],
  ["mint-invalid-token", () => mintAnswer(voice({ resolveUserId: async () => undefined }))],
  [
    "mint-invalid-request",
    () =>
      mintAnswer(
        voice({ request: mintRequest(HOSTED_SERVICE_PATH.VOICE_MINT, { voice: "nobody" }) }),
      ),
  ],
  ["mint-quota-exhausted", () => mintAnswer(voice({ spend: async () => SPENT }))],
  [
    "mint-upstream-error",
    () =>
      mintAnswer(voice({ httpClient: upstream(() => new Response("secret", { status: 500 })) })),
  ],
  ["remote-mint", () => mintAnswer(remote())],
  [
    "remote-mint-method-not-allowed",
    () =>
      mintAnswer(
        remote({ request: mintRequest(HOSTED_SERVICE_PATH.REMOTE_VOICE_MINT, undefined, "GET") }),
      ),
  ],
  ["remote-mint-unavailable", () => mintAnswer(remote({ apiKey: " " }))],
  ["remote-mint-invalid-token", () => mintAnswer(remote({ resolveUserId: async () => undefined }))],
  [
    "remote-mint-invalid-request",
    () =>
      mintAnswer(
        remote({ request: mintRequest(HOSTED_SERVICE_PATH.REMOTE_VOICE_MINT, { scene: "phone" }) }),
      ),
  ],
  ["remote-mint-quota-exhausted", () => mintAnswer(remote({ spend: async () => SPENT }))],
  ["introduction-mint", () => mintAnswer(introduction())],
  [
    "introduction-mint-method-not-allowed",
    () =>
      mintAnswer(
        introduction({
          request: mintRequest(HOSTED_SERVICE_PATH.INTRODUCTION_MINT, undefined, "GET"),
        }),
      ),
  ],
  ["introduction-mint-unavailable", () => mintAnswer(introduction({ apiKey: " " }))],
  [
    "introduction-mint-invalid-request",
    () =>
      mintAnswer(
        introduction({
          request: mintRequest(HOSTED_SERVICE_PATH.INTRODUCTION_MINT, { scene: "phone" }),
        }),
      ),
  ],
  [
    "introduction-mint-quota-exhausted",
    () => mintAnswer(introduction({ spendIntroduction: async () => SPENT_INTRODUCTION })),
  ],
];

const FRAMING_HEADER = { CONTENT_LENGTH: "content-length" } as const;

/** The answer as the caller reads it, with the framing header held to the body it frames. */
async function answered(response: Response): Promise<RecordedResponse> {
  const recorded = await recordedResponse(response);
  const framed = recorded.headers.find(([name]) => name === FRAMING_HEADER.CONTENT_LENGTH);
  if (framed) assert.equal(Number(framed[1]), new TextEncoder().encode(recorded.body).byteLength);
  return {
    ...recorded,
    headers: recorded.headers.filter(([name]) => name !== FRAMING_HEADER.CONTENT_LENGTH),
  };
}

test("each group answers its mints and its refusals with the bytes recorded for them", async () => {
  for (const [name, answer] of CASES) {
    await settleResponseGolden(GOLDEN_ROOT, name, await answered(await answer()));
  }
});

test("the recorded set is exactly the cases declared", async () => {
  const named = CASES.map(([name]) => name).sort();
  assert.deepEqual(await recordedGoldenNames(GOLDEN_ROOT), named);
});
