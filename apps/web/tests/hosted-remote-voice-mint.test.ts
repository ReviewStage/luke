import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTEXT_ITEM_KIND,
  contextItemId,
  REALTIME_DEFAULTS,
  realtimeClientSecretRequest,
  remoteRealtimeClientSecretRequest,
  remoteRealtimeToolDefinitions,
} from "../server/core";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import type { HostedSpend } from "../server/hosted/quota";
import { handleRemoteVoiceMint } from "../server/hosted/remote-voice-mint";

const NOW = Date.parse("2026-09-07T12:00:00.000Z");
const API_KEY = "sk-hosted-secret";

const OPEN_SPEND: HostedSpend = {
  allowed: true,
  quota: { used: 1, limit: 5_000, remaining: 4_999, resetsAt: NOW + 43_200_000 },
};

interface RemoteMintRequestBody {
  voice?: string;
  speed?: number;
}

function mintRequest(body?: RemoteMintRequestBody): Request {
  const init: RequestInit = { method: "POST", headers: { authorization: "Bearer token-1" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request("https://luke.test/api/voice/remote-mint", init);
}

interface UpstreamCall {
  url?: string;
  init?: RequestInit;
}

function mintedPayload(): Response {
  return Response.json({ value: "eph-secret", expires_at: (NOW + 60_000) / 1000 });
}

function options(overrides: Partial<Parameters<typeof handleRemoteVoiceMint>[0]> = {}) {
  return {
    request: mintRequest(),
    apiKey: API_KEY,
    resolveUserId: async () => "user-1",
    spend: async () => OPEN_SPEND,
    encryptionSecret: undefined,
    readVaultKeys: async () => [],
    now: () => NOW,
    ...overrides,
  };
}

test("a phone or watch mint keeps its own narrowed session document on the shared upstream helper", async () => {
  const call: UpstreamCall = {};
  const response = await handleRemoteVoiceMint(
    options({
      fetch: async (url, init) => {
        call.url = url;
        call.init = init;
        return mintedPayload();
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.connection.value, "eph-secret");
  assert.equal(body.connection.model, REALTIME_DEFAULTS.MODEL);
  assert.deepEqual(body.quota, OPEN_SPEND.quota);
  assert.equal(body.context.sessions.itemId, contextItemId(CONTEXT_ITEM_KIND.SESSIONS, 0));
  assert.match(body.context.sessions.text, /^\[observed session status, sent automatically\]\n/);

  assert.equal(call.url, "https://api.openai.com/v1/realtime/client_secrets");
  const sent = JSON.parse(String(call.init?.body));
  // The document is the remote one, byte for byte, and the desktop's full-act
  // session differs from it only by the toolset.
  assert.deepEqual(sent, remoteRealtimeClientSecretRequest());
  assert.deepEqual(sent.session.tools, remoteRealtimeToolDefinitions());
  assert.notDeepEqual(sent.session.tools, realtimeClientSecretRequest().session.tools);
  assert.equal(sent.session.instructions, realtimeClientSecretRequest().session.instructions);
  // No caller cancellation is joined here: the upstream signal is the helper's
  // own timeout, not aborted, exactly as before the brain route shared it.
  assert.ok(call.init?.signal instanceof AbortSignal);
  assert.equal(call.init?.signal.aborted, false);
});

test("the remote mint gate order is method, kill switch, token, body, quota", async () => {
  let upstreamCalls = 0;
  const fetch = async (): Promise<Response> => {
    upstreamCalls += 1;
    return mintedPayload();
  };
  const method = await handleRemoteVoiceMint(
    options({
      fetch,
      request: new Request("https://luke.test/api/voice/remote-mint", { method: "GET" }),
    }),
  );
  assert.equal(method.status, 405);
  const off = await handleRemoteVoiceMint(options({ fetch, apiKey: "  " }));
  assert.equal(off.status, 503);
  assert.deepEqual(await off.json(), { error: HOSTED_API_ERROR.UNAVAILABLE });
  const anonymous = await handleRemoteVoiceMint(
    options({ fetch, resolveUserId: async () => undefined }),
  );
  assert.equal(anonymous.status, 401);
  const malformed = await handleRemoteVoiceMint(
    options({ fetch, request: mintRequest({ voice: "nobody" }) }),
  );
  assert.equal(malformed.status, 400);
  const quota = { used: 5_000, limit: 5_000, remaining: 0, resetsAt: NOW + 1_000 };
  const spent = await handleRemoteVoiceMint(
    options({ fetch, spend: async () => ({ allowed: false, quota }) }),
  );
  assert.equal(spent.status, 429);
  assert.deepEqual(await spent.json(), { error: HOSTED_API_ERROR.QUOTA_EXHAUSTED, quota });
  assert.equal(upstreamCalls, 0);
});
