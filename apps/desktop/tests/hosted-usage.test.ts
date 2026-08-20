import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { HostedUsageReader } from "../src/hosted-usage";
import { runWithHttp } from "./support/effect-http";

const ANSWER = {
  voice: { used: 3, limit: 50, remaining: 47, resetsAt: 1_800_003_600_000 },
  attention: { used: 41, limit: 500, remaining: 459, resetsAt: 1_800_003_600_000 },
};

interface RecordedRequest {
  url: string;
  init: RequestInit;
}

function service(answers: Array<() => Response>) {
  const requests: RecordedRequest[] = [];
  let call = 0;
  const fetchLike = async (url: string, init: RequestInit): Promise<Response> => {
    requests.push({ url, init });
    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;
    if (!answer) throw new Error("no scripted answer");
    return answer();
  };
  return { requests, fetchLike };
}

function reader(options: Partial<ConstructorParameters<typeof HostedUsageReader>[0]> = {}) {
  return new HostedUsageReader({
    serviceBaseUrl: "https://tryluke.dev",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
    ...options,
  });
}

test("reads both meters on the account's bearer token without spending either", async () => {
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify(ANSWER), { status: 200 }),
  ]);

  const usage = await runWithHttp(reader().read(), fetchLike);
  assert.deepEqual(usage, ANSWER);

  const [request] = requests;
  assert.equal(request?.url, "https://tryluke.dev/api/usage");
  assert.equal(request?.init.method, "GET");
  assert.equal(new Headers(request?.init.headers).get("authorization"), "Bearer token-1");
});

test("a 401 refreshes the account and retries once", async () => {
  const tokens = ["stale-token", "fresh-token"];
  let refreshes = 0;
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify({ error: "invalid-token" }), { status: 401 }),
    () => new Response(JSON.stringify(ANSWER), { status: 200 }),
  ]);

  const usage = await runWithHttp(
    reader({
      readAccessToken: () => Effect.succeed(tokens[Math.min(refreshes, tokens.length - 1)]),
      refreshAccount: () =>
        Effect.sync(() => {
          refreshes += 1;
        }),
    }).read(),
    fetchLike,
  );

  assert.deepEqual(usage, ANSWER);
  assert.equal(refreshes, 1);
  assert.equal(new Headers(requests[1]?.init.headers).get("authorization"), "Bearer fresh-token");
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("failures, malformed answers, and a missing account all read as no answer", async () => {
  const failingFetch = service([() => new Response("oops", { status: 500 })]).fetchLike;
  const failing = reader();
  assert.equal(await runWithHttp(failing.read(), failingFetch), undefined);

  const malformedFetch = service([
    () => new Response(JSON.stringify({ voice: { used: 1 } }), { status: 200 }),
  ]).fetchLike;
  const malformed = reader();
  assert.equal(await runWithHttp(malformed.read(), malformedFetch), undefined);

  const { requests, fetchLike } = service([]);
  const signedOut = reader({ readAccessToken: () => Effect.succeed(undefined) });
  assert.equal(await runWithHttp(signedOut.read(), fetchLike), undefined);
  assert.equal(requests.length, 0);
});
