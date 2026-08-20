import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTENTION_DISPOSITION,
  ATTENTION_TRIGGER,
  type AttentionUpdate,
  SESSION_STATUS,
} from "@sidecar/core";
import { Effect } from "effect";
import { HostedAttentionEvaluator } from "../src/hosted-attention-evaluator";
import { runWithHttp } from "./support/effect-http";

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
  noticeRequest: "tell me when this finishes",
  observedAt: NOW - 1_000,
};

const SPOKEN_ANSWER = {
  decision: {
    disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
    decidedAt: NOW - 99_999,
    summary: "Claude Code is waiting on you in checkout-service.",
    answers_ask: true,
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
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
    now: () => NOW,
    ...options,
  });
}

function evaluate(
  hosted: HostedAttentionEvaluator,
  fetchLike: typeof fetch,
  attentionUpdate: AttentionUpdate = UPDATE,
) {
  return runWithHttp(
    hosted
      .evaluate(attentionUpdate)
      .pipe(Effect.catchTag("AttentionRateLimited", () => Effect.succeed(undefined))),
    fetchLike,
  );
}

test("sends only what the prompt reads — never the session's identifiers or clock", async () => {
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify(SPOKEN_ANSWER), { status: 200 }),
  ]);
  const hosted = evaluator();

  const decision = await evaluate(hosted, fetchLike);
  assert.deepEqual(decision, {
    disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
    decidedAt: NOW,
    summary: SPOKEN_ANSWER.decision.summary,
    answersAsk: true,
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
    noticeRequest: UPDATE.noticeRequest,
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
  const hosted = evaluator();

  assert.equal(await evaluate(hosted, fetchLike), undefined);

  // Held back without another request until the reset.
  assert.equal(await evaluate(hosted, fetchLike), undefined);
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
    readAccessToken: () => Effect.succeed(tokens[Math.min(refreshes, tokens.length - 1)]),
    refreshAccount: () => {
      refreshes += 1;
      return Effect.void;
    },
  });

  const decision = await evaluate(hosted, fetchLike);
  assert.ok(decision);
  assert.equal(refreshes, 1);
  assert.equal(new Headers(requests[1]?.init.headers).get("authorization"), "Bearer fresh-token");
});

test("stays silent on failures, contract violations, and a missing account", async () => {
  const failing = evaluator();
  assert.equal(
    await evaluate(failing, service([() => new Response("oops", { status: 502 })]).fetchLike),
    undefined,
  );

  const malformed = evaluator();
  assert.equal(
    await evaluate(
      malformed,
      service([
        () => new Response(JSON.stringify({ decision: { disposition: "shout" } }), { status: 200 }),
      ]).fetchLike,
    ),
    undefined,
  );

  const signedOut = evaluator({ readAccessToken: () => Effect.succeed(undefined) });
  assert.equal(await evaluate(signedOut, service([]).fetchLike), undefined);
});
