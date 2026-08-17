import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  ATTENTION_DISPOSITION,
  ATTENTION_TRIGGER,
  type AttentionUpdate,
  SESSION_STATUS,
} from "@sidecar/core";
import {
  ATTENTION_RATE_LIMIT_COOLDOWN_MS,
  OpenAiAttentionEvaluator,
  openAiAttentionEvaluator,
} from "../src/openai-attention-evaluator";
import { type RecordedRequest, recordingFetch } from "./support/http-fake";

const DECIDED_AT = 1_800_000_000_000;
const API_KEY = "test-openai-key";
const SPOKEN_SUMMARY = "Claude Code is waiting on you in checkout-service.";
const TRANSCRIPT_SECRET = "SECRET_TRANSCRIPT_TEXT";

function update(overrides: Partial<AttentionUpdate> = {}): AttentionUpdate {
  return {
    providerId: "claude-code",
    providerSessionId: "review",
    trigger: ATTENTION_TRIGGER.STATUS_CHANGED,
    providerName: "Claude Code",
    title: "Claude Code: checkout-service",
    status: SESSION_STATUS.WAITING,
    previousStatus: SESSION_STATUS.WORKING,
    recap: "Claude Code waiting; transcript content is not retained.",
    observedAt: DECIDED_AT,
    ...overrides,
  };
}

function structuredResponse(decision: Record<string, unknown>): Response {
  return Response.json({
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(decision) }],
      },
    ],
  });
}

function evaluatorWith(respond: (request: RecordedRequest) => Promise<Response> | Response): {
  evaluator: OpenAiAttentionEvaluator;
  requests: RecordedRequest[];
} {
  const { fetch, requests } = recordingFetch(respond);
  const evaluator = new OpenAiAttentionEvaluator({
    apiKey: API_KEY,
    now: () => DECIDED_AT,
    fetch,
  });
  return { evaluator, requests };
}

function requestBody(request: RecordedRequest): Record<string, unknown> {
  assert.equal(typeof request.body, "string");
  return JSON.parse(String(request.body)) as Record<string, unknown>;
}

function silenceStderr(t: TestContext): void {
  t.mock.method(process.stderr, "write", () => true);
}

function recordStderr(t: TestContext): string[] {
  const written: string[] = [];
  t.mock.method(process.stderr, "write", (chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });
  return written;
}

test("requests a strict structured decision and never asks the API to retain it", async (t) => {
  silenceStderr(t);
  const { evaluator, requests } = evaluatorWith(() =>
    structuredResponse({
      disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
      summary: SPOKEN_SUMMARY,
    }),
  );

  const decision = await evaluator.evaluate(update());

  assert.deepEqual(decision, {
    disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
    decidedAt: DECIDED_AT,
    summary: SPOKEN_SUMMARY,
  });

  const [request] = requests;
  assert.ok(request);
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(request.init.headers, {
    authorization: `Bearer ${API_KEY}`,
    "content-type": "application/json",
  });

  const body = requestBody(request);
  assert.equal(body.store, false);
  assert.equal(body.model, evaluator.model);
  assert.deepEqual(Object.keys(body).sort(), [
    "input",
    "instructions",
    "max_output_tokens",
    "model",
    "store",
    "text",
  ]);
  const format = (body.text as { format: Record<string, unknown> }).format;
  assert.equal(format.type, "json_schema");
  assert.equal(format.strict, true);
  assert.equal(format.name, "attention_decision");
  assert.deepEqual((format.schema as { required: string[] }).required, [
    "disposition",
    "summary",
    "answers_ask",
  ]);
});

test("sends only the bounded update and no provider transcript", async (t) => {
  silenceStderr(t);
  const { evaluator, requests } = evaluatorWith(() =>
    structuredResponse({ disposition: ATTENTION_DISPOSITION.SILENT, summary: null }),
  );

  await evaluator.evaluate(update());

  const [request] = requests;
  assert.ok(request);
  const serialized = String(request.body);
  assert.ok(!serialized.includes(TRANSCRIPT_SECRET));
  assert.ok(!serialized.includes("providerSessionId"));
  assert.ok(!serialized.includes("review"));
  assert.ok(String(requestBody(request).input).includes("Provider: Claude Code"));
});

test("stays silent when the API is unavailable or answers outside the contract", async (t) => {
  silenceStderr(t);
  const failures: Array<() => Response | Promise<Response>> = [
    () => new Response("rate limited", { status: 429 }),
    () => new Response("not json", { status: 200 }),
    () => structuredResponse({ disposition: "shout", summary: SPOKEN_SUMMARY }),
    () => structuredResponse({ disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END }),
    () => Response.json({ output: [] }),
    () => {
      throw new Error("network unreachable");
    },
  ];

  for (const failure of failures) {
    const { evaluator } = evaluatorWith(failure);
    assert.equal(await evaluator.evaluate(update()), undefined);
  }
});

test("a rate limit quiets requests for the cooldown instead of retrying at full rate", async (t) => {
  silenceStderr(t);
  let now = DECIDED_AT;
  const { fetch, requests } = recordingFetch(() => new Response("rate limited", { status: 429 }));
  const evaluator = new OpenAiAttentionEvaluator({ apiKey: API_KEY, now: () => now, fetch });

  assert.equal(evaluator.quietUntil(), undefined);
  assert.equal(await evaluator.evaluate(update()), undefined);
  assert.equal(requests.length, 1);

  // The quiet is visible to the reviewer, so a pass can be skipped whole
  // rather than spending per-session retries on refusals.
  assert.equal(evaluator.quietUntil(), now + ATTENTION_RATE_LIMIT_COOLDOWN_MS);

  // Inside the cooldown nothing is even sent; the update stays derivable.
  now += ATTENTION_RATE_LIMIT_COOLDOWN_MS - 1;
  assert.equal(await evaluator.evaluate(update()), undefined);
  assert.equal(requests.length, 1);

  // The cooldown over, requests resume and the quiet reads as lifted.
  now += 1;
  assert.equal(evaluator.quietUntil(), undefined);
  assert.equal(await evaluator.evaluate(update()), undefined);
  assert.equal(requests.length, 2);
});

test("a rate limit that names its own wait is taken at its word", async (t) => {
  silenceStderr(t);
  let now = DECIDED_AT;
  const { fetch, requests } = recordingFetch(
    () => new Response("rate limited", { status: 429, headers: { "retry-after": "5" } }),
  );
  const evaluator = new OpenAiAttentionEvaluator({ apiKey: API_KEY, now: () => now, fetch });

  assert.equal(await evaluator.evaluate(update()), undefined);
  now += 4_999;
  await evaluator.evaluate(update());
  assert.equal(requests.length, 1);

  now += 1;
  await evaluator.evaluate(update());
  assert.equal(requests.length, 2);
});

test("reports a response that carried no decision instead of failing quietly", async (t) => {
  const written = recordStderr(t);
  const { evaluator } = evaluatorWith(() =>
    Response.json({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [],
    }),
  );

  assert.equal(await evaluator.evaluate(update()), undefined);
  const message = written.join("");
  assert.match(message, /carried no decision/);
  assert.match(
    message,
    /max_output_tokens/,
    "a model that spends its output budget on reasoning must not look like a healthy silent pass",
  );
});

test("reads a decision from a payload that carries aggregated output text", async (t) => {
  silenceStderr(t);
  const { evaluator } = evaluatorWith(() =>
    Response.json({
      output_text: JSON.stringify({
        disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
        summary: "Codex finished its turn in billing-api.",
      }),
    }),
  );

  assert.deepEqual(await evaluator.evaluate(update()), {
    disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
    decidedAt: DECIDED_AT,
    summary: "Codex finished its turn in billing-api.",
  });
});

test("builds an evaluator only when there is a key to build one from", (t) => {
  const environment = { ...process.env };
  t.after(() => {
    process.env = environment;
  });

  // The key is the caller's to resolve — the settings store reads the stored one
  // and falls back to `OPENAI_API_KEY` — so review stays off until one arrives,
  // whichever of the two it came from.
  assert.equal(openAiAttentionEvaluator(undefined), undefined);
  assert.equal(openAiAttentionEvaluator("   "), undefined);

  // The model and the endpoint are still the environment's to choose.
  process.env.LUKE_ATTENTION_MODEL = "  gpt-test  ";
  process.env.OPENAI_BASE_URL = "https://gateway.test/v1/";
  const configured = openAiAttentionEvaluator(`  ${API_KEY}  `);
  assert.ok(configured);
  assert.equal(configured.model, "gpt-test");

  delete process.env.LUKE_ATTENTION_MODEL;
  const defaulted = openAiAttentionEvaluator(API_KEY);
  assert.ok(defaulted);
  assert.equal(defaulted.model, "gpt-5.6-luna");

  assert.throws(() => new OpenAiAttentionEvaluator({ apiKey: "   " }));
});

test("honors a configured base URL without doubling its separator", async (t) => {
  silenceStderr(t);
  const { fetch, requests } = recordingFetch(() =>
    structuredResponse({ disposition: ATTENTION_DISPOSITION.SILENT, summary: null }),
  );
  const evaluator = new OpenAiAttentionEvaluator({
    apiKey: API_KEY,
    baseUrl: "https://gateway.test/v1/",
    now: () => DECIDED_AT,
    fetch,
  });

  await evaluator.evaluate(update());
  assert.equal(requests[0]?.url, "https://gateway.test/v1/responses");
});
