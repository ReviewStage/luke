import assert from "node:assert/strict";
import test from "node:test";
import type { SubjectInput } from "@sidecar/attention";
import { HostedSubjectDeriver } from "./hosted-subject-deriver.js";

const NOW = 1_800_000_000_000;
const SERVICE = "https://tryluke.dev";

const INPUT: SubjectInput = {
  providerName: "Codex",
  title: "what is our burn",
  recap: "Thatch looks best.",
  transcript: "User: look into ICHRA options\nAssistant: Thatch looks best.",
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

function deriver(options: Partial<ConstructorParameters<typeof HostedSubjectDeriver>[0]> = {}) {
  return new HostedSubjectDeriver({
    serviceBaseUrl: SERVICE,
    readAccessToken: async () => "token-1",
    refreshAccount: async () => undefined,
    now: () => NOW,
    ...options,
  });
}

test("sends exactly the bounded input and answers the validated subject", async () => {
  const { requests, fetchLike } = service([
    () =>
      new Response(
        JSON.stringify({
          subject: "  researching ICHRA\n options ",
          quota: { used: 1, limit: 5_000, remaining: 4_999, resetsAt: NOW + 1 },
        }),
        { status: 200 },
      ),
  ]);
  const hosted = deriver({ fetch: fetchLike });

  assert.deepEqual(await hosted.derive(INPUT), { subject: "researching ICHRA options" });
  const [request] = requests;
  assert.equal(request?.url, "https://tryluke.dev/api/subject/derive");
  assert.equal(new Headers(request?.init.headers).get("authorization"), "Bearer token-1");
  assert.deepEqual(JSON.parse(String(request?.init.body)), INPUT);
});

test("a null subject is the service's honest answer, not a failure", async () => {
  const hosted = deriver({
    fetch: service([() => new Response(JSON.stringify({ subject: null }), { status: 200 })])
      .fetchLike,
  });
  assert.deepEqual(await hosted.derive(INPUT), { subject: null });
});

test("a spent allowance quiets derivations until the counters reset", async () => {
  const { requests, fetchLike } = service([
    () =>
      new Response(
        JSON.stringify({
          error: "quota-exhausted",
          quota: { used: 5_001, limit: 5_000, remaining: 0, resetsAt: NOW + 3_600_000 },
        }),
        { status: 429 },
      ),
  ]);
  const hosted = deriver({ fetch: fetchLike });
  assert.equal(await hosted.derive(INPUT), undefined);
  assert.equal(hosted.quietUntil(), NOW + 3_600_000);
  assert.equal(await hosted.derive(INPUT), undefined);
  assert.equal(requests.length, 1);
});

test("a 401 refreshes the account and retries once", async () => {
  const tokens = ["stale-token", "fresh-token"];
  let refreshes = 0;
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify({ error: "invalid-token" }), { status: 401 }),
    () => new Response(JSON.stringify({ subject: "s" }), { status: 200 }),
  ]);
  const hosted = deriver({
    fetch: fetchLike,
    readAccessToken: async () => tokens[Math.min(refreshes, tokens.length - 1)],
    refreshAccount: async () => {
      refreshes += 1;
    },
  });
  assert.deepEqual(await hosted.derive(INPUT), { subject: "s" });
  assert.equal(refreshes, 1);
  assert.equal(new Headers(requests[1]?.init.headers).get("authorization"), "Bearer fresh-token");
});

test("answers nothing on failures, contract violations, and a missing account", async () => {
  const failing = deriver({
    fetch: service([() => new Response("oops", { status: 502 })]).fetchLike,
  });
  assert.equal(await failing.derive(INPUT), undefined);

  const malformed = deriver({
    fetch: service([() => new Response(JSON.stringify({ subject: 7 }), { status: 200 })]).fetchLike,
  });
  assert.equal(await malformed.derive(INPUT), undefined);

  const signedOut = deriver({
    fetch: service([]).fetchLike,
    readAccessToken: async () => undefined,
  });
  assert.equal(await signedOut.derive(INPUT), undefined);
});
