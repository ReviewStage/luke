import assert from "node:assert/strict";
import test from "node:test";
import { SUBJECT_SCHEMA_NAME, type SubjectInput } from "@sidecar/attention";
import { transcriptReadTailBytes } from "@sidecar/session";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import type { HostedSpend } from "../server/hosted/quota";
import { HOSTED_SUBJECT_DEFAULTS, handleSubjectDerive } from "../server/hosted/subject-derive";

const NOW = Date.parse("2026-09-02T12:00:00.000Z");
const API_KEY = "sk-hosted-secret";

const OPEN_SPEND: HostedSpend = {
  allowed: true,
  quota: { used: 2, limit: 5_000, remaining: 4_998, resetsAt: NOW + 43_200_000 },
};

const INPUT: SubjectInput = {
  providerName: "Codex",
  title: "what is our burn",
  transcript: "User: look into ICHRA options\nAssistant: Thatch looks best.",
};

function deriveRequest(body: Partial<Record<keyof SubjectInput, string>>): Request {
  return new Request("https://luke.test/api/subject/derive", {
    method: "POST",
    headers: new Headers({ authorization: "Bearer token-1" }),
    body: JSON.stringify(body),
  });
}

interface UpstreamCall {
  url?: string;
  init?: RequestInit;
}

function upstream(call: UpstreamCall, response: () => Response) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    call.url = url;
    call.init = init;
    return response();
  };
}

function subjectPayload(subject: string | null) {
  return () =>
    new Response(JSON.stringify({ output_text: JSON.stringify({ subject }) }), { status: 200 });
}

function options(overrides: Partial<Parameters<typeof handleSubjectDerive>[0]> = {}) {
  return {
    request: deriveRequest(INPUT),
    apiKey: API_KEY,
    resolveUserId: async () => "user-1",
    spend: async () => OPEN_SPEND,
    ...overrides,
  };
}

test("a derivation sends the build's own construction and answers the bounded subject", async () => {
  const call: UpstreamCall = {};
  const response = await handleSubjectDerive(
    options({ fetch: upstream(call, subjectPayload("researching ICHRA options")) }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.subject, "researching ICHRA options");
  assert.deepEqual(body.quota, OPEN_SPEND.quota);

  assert.equal(call.url, "https://api.openai.com/v1/responses");
  const sent = JSON.parse(String(call.init?.body));
  assert.equal(sent.model, HOSTED_SUBJECT_DEFAULTS.MODEL);
  assert.equal(sent.store, false);
  assert.equal(sent.text.format.name, SUBJECT_SCHEMA_NAME);
  assert.match(sent.input, /First ask: what is our burn/);
  assert.match(sent.input, /=== transcript/);
  assert.ok(sent.input.endsWith(INPUT.transcript));
  assert.equal(new Headers(call.init?.headers).get("authorization"), `Bearer ${API_KEY}`);
});

test("a null subject passes through as the model's own answer", async () => {
  const response = await handleSubjectDerive(
    options({ fetch: upstream({}, subjectPayload(null)) }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).subject, null);
});

test("an input that fails the wire contract is refused before anything is spent", async () => {
  let spent = 0;
  const spend = async () => {
    spent += 1;
    return OPEN_SPEND;
  };
  const tooLong = await handleSubjectDerive(
    options({
      request: deriveRequest({ ...INPUT, transcript: "x".repeat(transcriptReadTailBytes + 1) }),
      spend,
    }),
  );
  assert.equal(tooLong.status, 400);
  assert.equal((await tooLong.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
  const untitled = await handleSubjectDerive(
    options({ request: deriveRequest({ providerName: "Codex", transcript: "t" }), spend }),
  );
  assert.equal(untitled.status, 400);
  assert.equal(spent, 0);
});

test("the gate order is method, kill switch, token, body, quota, upstream", async () => {
  const wrongMethod = await handleSubjectDerive(
    options({ request: new Request("https://luke.test/api/subject/derive") }),
  );
  assert.equal(wrongMethod.status, 405);

  assert.equal((await handleSubjectDerive(options({ apiKey: undefined }))).status, 503);
  assert.equal((await handleSubjectDerive(options({ apiKey: "  " }))).status, 503);
  assert.equal(
    (await handleSubjectDerive(options({ resolveUserId: async () => undefined }))).status,
    401,
  );

  const exhausted = await handleSubjectDerive(
    options({
      spend: async () => ({
        allowed: false,
        quota: { used: 5_001, limit: 5_000, remaining: 0, resetsAt: NOW + 43_200_000 },
      }),
    }),
  );
  assert.equal(exhausted.status, 429);
  assert.equal((await exhausted.json()).error, HOSTED_API_ERROR.QUOTA_EXHAUSTED);

  const upstreamDown = await handleSubjectDerive(
    options({ fetch: upstream({}, () => new Response("oops", { status: 500 })) }),
  );
  assert.equal(upstreamDown.status, 502);
  const upstreamBody = await upstreamDown.json();
  assert.equal(upstreamBody.error, HOSTED_API_ERROR.UPSTREAM_ERROR);
  assert.equal(upstreamBody.upstreamStatus, 500);

  const offContract = await handleSubjectDerive(
    options({
      fetch: upstream(
        {},
        () =>
          new Response(JSON.stringify({ output_text: JSON.stringify({ subject: 42 }) }), {
            status: 200,
          }),
      ),
    }),
  );
  assert.equal(offContract.status, 502);
});
