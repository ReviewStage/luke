import assert from "node:assert/strict";
import test from "node:test";
import { VOICE_SERVICE_SECRET_HEADER, voiceAuthorizeAnswerSchema } from "@sidecar/hosted";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import type { HostedSpend } from "../server/hosted/quota";
import { handleVoiceAuthorize } from "../server/hosted/voice-authorize";

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
const SECRET = "voice-service-secret";

const OPEN_SPEND: HostedSpend = {
  allowed: true,
  quota: { used: 1, limit: 5_000, resetsAt: NOW + 43_200_000 },
};

const SPENT: HostedSpend = {
  allowed: false,
  quota: { used: 5_001, limit: 5_000, resetsAt: NOW + 43_200_000 },
};

const NO_BODY = null;

function authorizeRequest(
  body: string | typeof NO_BODY = JSON.stringify({ bearer: "Bearer account-token" }),
  headers: Record<string, string> = { [VOICE_SERVICE_SECRET_HEADER]: SECRET },
  method = "POST",
): Request {
  const init: RequestInit = { method, headers };
  if (body !== NO_BODY) init.body = body;
  return new Request("https://luke.test/api/internal/voice/authorize", init);
}

function options(overrides: Partial<Parameters<typeof handleVoiceAuthorize>[0]> = {}) {
  return {
    request: authorizeRequest(),
    serviceSecret: SECRET,
    resolveUserId: async (authorization: string) =>
      authorization === "Bearer account-token" ? "user-1" : undefined,
    spend: async () => OPEN_SPEND,
    ...overrides,
  };
}

test("an authorized account answers its id and the quota the session was spent against", async () => {
  const spent: string[] = [];
  const response = await handleVoiceAuthorize(
    options({
      spend: async (userId) => {
        spent.push(userId);
        return OPEN_SPEND;
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(voiceAuthorizeAnswerSchema.parse(await response.json()), {
    userId: "user-1",
    quota: OPEN_SPEND.quota,
  });
  assert.deepEqual(spent, ["user-1"]);
});

test("a missing or wrong service secret is refused before the bearer is read", async () => {
  const resolved: string[] = [];
  const resolveUserId = async (authorization: string) => {
    resolved.push(authorization);
    return "user-1";
  };
  const missing = await handleVoiceAuthorize(
    options({ request: authorizeRequest(NO_BODY, {}), resolveUserId }),
  );
  const wrong = await handleVoiceAuthorize(
    options({
      request: authorizeRequest(JSON.stringify({ bearer: "Bearer account-token" }), {
        [VOICE_SERVICE_SECRET_HEADER]: `${SECRET}x`,
      }),
      resolveUserId,
    }),
  );
  const bearerInstead = await handleVoiceAuthorize(
    options({
      request: authorizeRequest(JSON.stringify({ bearer: "Bearer account-token" }), {
        authorization: `Bearer ${SECRET}`,
      }),
      resolveUserId,
    }),
  );

  for (const response of [missing, wrong, bearerInstead]) {
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);
  }
  assert.deepEqual(resolved, []);
});

test("without a configured secret the route is off, whatever the header says", async () => {
  for (const serviceSecret of [undefined, "", "   "]) {
    const response = await handleVoiceAuthorize(options({ serviceSecret }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, HOSTED_API_ERROR.UNAVAILABLE);
  }
});

test("only POST is answered", async () => {
  const response = await handleVoiceAuthorize(
    options({
      request: authorizeRequest(NO_BODY, { [VOICE_SERVICE_SECRET_HEADER]: SECRET }, "GET"),
    }),
  );
  assert.equal(response.status, 405);
  assert.equal((await response.json()).error, HOSTED_API_ERROR.METHOD_NOT_ALLOWED);
});

test("a body that is not the one forwarded bearer is refused", async () => {
  for (const body of [
    NO_BODY,
    "not json",
    JSON.stringify({}),
    JSON.stringify({ bearer: "" }),
    JSON.stringify({ bearer: "Bearer t", userId: "u" }),
  ]) {
    const response = await handleVoiceAuthorize(options({ request: authorizeRequest(body) }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
  }
});

test("a bearer that resolves to no account is refused and spends nothing", async () => {
  let spends = 0;
  const response = await handleVoiceAuthorize(
    options({
      request: authorizeRequest(JSON.stringify({ bearer: "Bearer revoked" })),
      spend: async () => {
        spends += 1;
        return OPEN_SPEND;
      },
    }),
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);
  assert.equal(spends, 0);
});

test("a spent allowance refuses the session and reports the quota", async () => {
  const response = await handleVoiceAuthorize(options({ spend: async () => SPENT }));

  assert.equal(response.status, 429);
  const body = await response.json();
  assert.equal(body.error, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
  assert.deepEqual(body.quota, SPENT.quota);
});
