import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  ATTENTION_DISPOSITION,
  ATTENTION_TRIGGER,
  type AttentionUpdate,
  SESSION_STATUS,
} from "@sidecar/core";
import {
  OpenAiAttentionEvaluator,
  openAiAttentionEvaluatorFromEnvironment,
} from "../src/openai-attention-evaluator";

const DECIDED_AT = 1_800_000_000_000;
const API_KEY = "test-openai-key";
const SPOKEN_SUMMARY = "Claude Code is waiting on you in checkout-service.";
const TRANSCRIPT_SECRET = "SECRET_TRANSCRIPT_TEXT";

interface RecordedRequest {
  url: string;
  init: RequestInit;
}

function update(overrides: Partial<AttentionUpdate> = {}): AttentionUpdate {
  return {
    providerId: "claude-code",
    providerSessionId: "review",
    trigger: ATTENTION_TRIGGER.STATUS_CHANGED,
    providerName: "Claude Code",
    title: "Claude Code: checkout-service",
    status: SESSION_STATUS.WAITING,
    previousStatus: SESSION_STATUS.WORKING,
    summary: "Claude Code waiting; transcript content is not retained.",
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
  const requests: RecordedRequest[] = [];
  const evaluator = new OpenAiAttentionEvaluator({
    apiKey: API_KEY,
    now: () => DECIDED_AT,
    fetch: async (url, init) => {
      const request = { url, init };
      requests.push(request);
      return respond(request);
    },
  });
  return { evaluator, requests };
}

function requestBody(request: RecordedRequest): Record<string, unknown> {
  assert.equal(typeof request.init.body, "string");
  return JSON.parse(String(request.init.body)) as Record<string, unknown>;
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
  assert.deepEqual((format.schema as { required: string[] }).required, ["disposition", "summary"]);
});

test("sends only the bounded update and no provider transcript", async (t) => {
  silenceStderr(t);
  const { evaluator, requests } = evaluatorWith(() =>
    structuredResponse({ disposition: ATTENTION_DISPOSITION.SILENT, summary: null }),
  );

  await evaluator.evaluate(update());

  const [request] = requests;
  assert.ok(request);
  const serialized = String(request.init.body);
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

test("builds an evaluator only when the environment supplies a key", (t) => {
  const environment = { ...process.env };
  t.after(() => {
    process.env = environment;
  });

  process.env.OPENAI_API_KEY = "";
  assert.equal(openAiAttentionEvaluatorFromEnvironment(), undefined);

  process.env.OPENAI_API_KEY = `  ${API_KEY}  `;
  process.env.LUKE_ATTENTION_MODEL = "  gpt-test  ";
  process.env.OPENAI_BASE_URL = "https://gateway.test/v1/";
  const configured = openAiAttentionEvaluatorFromEnvironment();
  assert.ok(configured);
  assert.equal(configured.model, "gpt-test");

  delete process.env.LUKE_ATTENTION_MODEL;
  const defaulted = openAiAttentionEvaluatorFromEnvironment();
  assert.ok(defaulted);
  assert.equal(defaulted.model, "gpt-5.6-luna");

  assert.throws(() => new OpenAiAttentionEvaluator({ apiKey: "   " }));
});

test("honors a configured base URL without doubling its separator", async (t) => {
  silenceStderr(t);
  const requests: RecordedRequest[] = [];
  const evaluator = new OpenAiAttentionEvaluator({
    apiKey: API_KEY,
    baseUrl: "https://gateway.test/v1/",
    now: () => DECIDED_AT,
    fetch: async (url, init) => {
      requests.push({ url, init });
      return structuredResponse({ disposition: ATTENTION_DISPOSITION.SILENT, summary: null });
    },
  });

  await evaluator.evaluate(update());
  assert.equal(requests[0]?.url, "https://gateway.test/v1/responses");
});
