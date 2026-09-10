import assert from "node:assert/strict";
import test from "node:test";
import {
  HOSTED_API_ERROR,
  HOSTED_SERVICE_PATH,
  VOICE_SERVICE_SECRET_HEADER,
  VOICE_USAGE_RECORD,
} from "@sidecar/hosted";
import type { CloudFetch } from "@sidecar/wire";
import {
  AUTHORIZE_OUTCOME,
  createAccountService,
  USAGE_REPORT_OUTCOME,
} from "./account-service.js";

const SECRET = "shared";
const QUOTA = { used: 1, limit: 5000, resetsAt: 1_800_000_000_000 };

interface Seen {
  url: string;
  headers: Headers;
  body: string | undefined;
}

interface Upstream {
  fetch: CloudFetch;
  seen: Seen[];
}

function answering(status: number, body: string): Upstream {
  const seen: Seen[] = [];
  return {
    seen,
    fetch: async (url, init) => {
      seen.push({
        url,
        headers: new Headers(init.headers),
        body: init.body === undefined || init.body === null ? undefined : init.body.toString(),
      });
      return new Response(body, { status, headers: { "content-type": "application/json" } });
    },
  };
}

const service = (fetch: CloudFetch) =>
  createAccountService({ webOrigin: "https://luke.test/", serviceSecret: SECRET, fetch });

test("authorize posts the bearer under the service secret and reads the account back", async () => {
  const upstream = answering(200, JSON.stringify({ userId: "user-1", quota: QUOTA }));
  const result = await service(upstream.fetch).authorize("Bearer token");
  assert.deepEqual(result, {
    outcome: AUTHORIZE_OUTCOME.AUTHORIZED,
    userId: "user-1",
    quota: QUOTA,
  });
  assert.equal(upstream.seen.length, 1);
  const call = upstream.seen[0];
  assert.ok(call);
  assert.equal(call.url, `https://luke.test${HOSTED_SERVICE_PATH.VOICE_AUTHORIZE}`);
  assert.equal(call.headers.get(VOICE_SERVICE_SECRET_HEADER), SECRET);
  assert.equal(call.headers.get("authorization"), null);
  assert.deepEqual(JSON.parse(call.body ?? ""), { bearer: "Bearer token" });
});

test("a 401 and a 429 are refusals carrying the reason the account service named", async () => {
  const unknown = await service(
    answering(401, JSON.stringify({ error: HOSTED_API_ERROR.INVALID_TOKEN })).fetch,
  ).authorize("Bearer stale");
  assert.deepEqual(unknown, {
    outcome: AUTHORIZE_OUTCOME.REFUSED,
    reason: HOSTED_API_ERROR.INVALID_TOKEN,
    status: 401,
  });
  const spent = await service(
    answering(429, JSON.stringify({ error: HOSTED_API_ERROR.QUOTA_EXHAUSTED, quota: QUOTA })).fetch,
  ).authorize("Bearer token");
  assert.deepEqual(spent, {
    outcome: AUTHORIZE_OUTCOME.REFUSED,
    reason: HOSTED_API_ERROR.QUOTA_EXHAUSTED,
    status: 429,
  });
});

test("a refusal without a readable body still refuses by its status", async () => {
  const result = await service(answering(429, "").fetch).authorize("Bearer token");
  assert.deepEqual(result, {
    outcome: AUTHORIZE_OUTCOME.REFUSED,
    reason: HOSTED_API_ERROR.QUOTA_EXHAUSTED,
    status: 429,
  });
});

test("a 5xx, an unreadable success, and a network fault are each unavailable", async () => {
  assert.deepEqual(await service(answering(503, "{}").fetch).authorize("Bearer t"), {
    outcome: AUTHORIZE_OUTCOME.UNAVAILABLE,
    status: 503,
  });
  assert.deepEqual(
    await service(answering(200, JSON.stringify({ userId: 4 })).fetch).authorize("Bearer t"),
    {
      outcome: AUTHORIZE_OUTCOME.UNAVAILABLE,
      status: 200,
    },
  );
  const failing: CloudFetch = () => Promise.reject(new TypeError("fetch failed"));
  assert.deepEqual(await service(failing).authorize("Bearer t"), {
    outcome: AUTHORIZE_OUTCOME.UNAVAILABLE,
    status: undefined,
  });
});

test("a usage report is posted whole and answered as recorded or repeated", async () => {
  const upstream = answering(200, JSON.stringify({ record: VOICE_USAGE_RECORD.RECORDED }));
  const report = { userId: "user-1", sessionId: "live_1", seconds: 42 };
  assert.deepEqual(await service(upstream.fetch).recordUsage(report), {
    outcome: USAGE_REPORT_OUTCOME.RECORDED,
    status: 200,
  });
  const call = upstream.seen[0];
  assert.ok(call);
  assert.equal(call.url, `https://luke.test${HOSTED_SERVICE_PATH.VOICE_USAGE}`);
  assert.equal(call.headers.get(VOICE_SERVICE_SECRET_HEADER), SECRET);
  assert.deepEqual(JSON.parse(call.body ?? ""), report);

  const repeated = answering(200, JSON.stringify({ record: VOICE_USAGE_RECORD.REPEATED }));
  assert.deepEqual(await service(repeated.fetch).recordUsage(report), {
    outcome: USAGE_REPORT_OUTCOME.REPEATED,
    status: 200,
  });
});

test("a usage report the account service refuses or cannot take is failed, never recorded", async () => {
  const report = { userId: "user-1", sessionId: "live_1", seconds: 42 };
  assert.deepEqual(await service(answering(400, "{}").fetch).recordUsage(report), {
    outcome: USAGE_REPORT_OUTCOME.FAILED,
    status: 400,
  });
  const failing: CloudFetch = () => Promise.reject(new TypeError("fetch failed"));
  assert.deepEqual(await service(failing).recordUsage(report), {
    outcome: USAGE_REPORT_OUTCOME.FAILED,
    status: undefined,
  });
});
