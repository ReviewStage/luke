import assert from "node:assert/strict";
import test from "node:test";
import { ATTENTION_TRIGGER, type AttentionUpdate } from "@sidecar/attention";
import { ATTENTION_DISPOSITION, SESSION_STATUS } from "@sidecar/session";
import { HostedAttentionEvaluator } from "./hosted-attention-evaluator.js";

const NOW = 1_800_000_000_000;
const SERVICE = "https://tryluke.dev";
const TRANSCRIPT_SECRET = "WITHHELD_SESSION_IDENTIFIER";

const UPDATE: AttentionUpdate = {
  providerId: "claude-code",
  providerSessionId: TRANSCRIPT_SECRET,
  trigger: ATTENTION_TRIGGER.STATUS_CHANGED,
  providerName: "Claude Code",
  title: "checkout-service",
  status: SESSION_STATUS.WAITING,
  previousStatus: SESSION_STATUS.WORKING,
  recap: "Waiting on a permission decision.",
  context: { branch: "main" },
  observedAt: NOW - 1_000,
};

const SPOKEN_ANSWER = {
  decision: {
    disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
    decidedAt: NOW - 99_999,
    summary: "Claude Code is waiting on you in checkout-service.",
  },
  quota: { used: 9, limit: 500, remaining: 491, resetsAt: NOW + 3_600_000 },
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

function evaluator(
  options: Partial<ConstructorParameters<typeof HostedAttentionEvaluator>[0]> = {},
) {
  return new HostedAttentionEvaluator({
    serviceBaseUrl: SERVICE,
    readAccessToken: async () => "token-1",
    refreshAccount: async () => undefined,
    now: () => NOW,
    ...options,
  });
}

test("sends only what the prompt reads — never the session's identifiers or clock", async () => {
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify(SPOKEN_ANSWER), { status: 200 }),
  ]);
  const hosted = evaluator({ fetch: fetchLike });

  const decision = await hosted.evaluate(UPDATE);
  assert.deepEqual(decision, {
    disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
    decidedAt: NOW,
    summary: SPOKEN_ANSWER.decision.summary,
  });

  const [request] = requests;
  assert.equal(request?.url, "https://tryluke.dev/api/attention/review");
  assert.equal(new Headers(request?.init.headers).get("authorization"), "Bearer token-1");
  const sent = String(request?.init.body);
  assert.doesNotMatch(sent, new RegExp(TRANSCRIPT_SECRET));
  assert.deepEqual(JSON.parse(sent), {
    trigger: UPDATE.trigger,
    providerName: UPDATE.providerName,
    title: UPDATE.title,
    status: UPDATE.status,
    previousStatus: UPDATE.previousStatus,
    recap: UPDATE.recap,
    context: UPDATE.context,
  });
});

test("a spent allowance quiets reviews until the day's counters reset", async () => {
  const { requests, fetchLike } = service([
    () =>
      new Response(
        JSON.stringify({
          error: "quota-exhausted",
          quota: { used: 501, limit: 500, remaining: 0, resetsAt: NOW + 3_600_000 },
        }),
        { status: 429 },
      ),
  ]);
  const hosted = evaluator({ fetch: fetchLike });

  assert.equal(await hosted.evaluate(UPDATE), undefined);
  assert.equal(hosted.quietUntil(), NOW + 3_600_000);

  // Held back without another request until the reset.
  assert.equal(await hosted.evaluate(UPDATE), undefined);
  assert.equal(requests.length, 1);
});

test("a 401 refreshes the account and retries once", async () => {
  const tokens = ["stale-token", "fresh-token"];
  let refreshes = 0;
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify({ error: "invalid-token" }), { status: 401 }),
    () => new Response(JSON.stringify(SPOKEN_ANSWER), { status: 200 }),
  ]);
  const hosted = evaluator({
    fetch: fetchLike,
    readAccessToken: async () => tokens[Math.min(refreshes, tokens.length - 1)],
    refreshAccount: async () => {
      refreshes += 1;
    },
  });

  const decision = await hosted.evaluate(UPDATE);
  assert.ok(decision);
  assert.equal(refreshes, 1);
  assert.equal(new Headers(requests[1]?.init.headers).get("authorization"), "Bearer fresh-token");
});

test("stays silent on failures, contract violations, and a missing account", async () => {
  const failing = evaluator({
    fetch: service([() => new Response("oops", { status: 502 })]).fetchLike,
  });
  assert.equal(await failing.evaluate(UPDATE), undefined);

  const malformed = evaluator({
    fetch: service([
      () => new Response(JSON.stringify({ decision: { disposition: "shout" } }), { status: 200 }),
    ]).fetchLike,
  });
  assert.equal(await malformed.evaluate(UPDATE), undefined);

  const signedOut = evaluator({
    fetch: service([]).fetchLike,
    readAccessToken: async () => undefined,
  });
  assert.equal(await signedOut.evaluate(UPDATE), undefined);
});
