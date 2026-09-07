import assert from "node:assert/strict";
import test from "node:test";
import {
  BRAIN_DEFAULTS,
  BRAIN_OPENAI_DEFAULTS,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_TOOL,
  BRAIN_TURN_AUTHORITY,
  type BrainActPerformer,
  BrainAgent,
  BrainStateStore,
  brainInstructions,
  brainToolDefinitions,
  HOSTED_SERVICE_PATH,
  HostedBrainClient,
  isRecord,
  maximumHostedBrainRequestBytes,
  normalizeSession,
  REALTIME_TOOL,
  SESSION_STATUS,
  type SessionIdentity,
  type SessionProvider,
  type UnparsedWireValue,
  type WireRecord,
} from "../server/core";
import { HOSTED_BRAIN_DEFAULTS, handleBrainRespond } from "../server/hosted/brain-respond";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import type { HostedSpend } from "../server/hosted/quota";

const NOW = Date.parse("2026-09-07T12:00:00.000Z");
const API_KEY = "sk-hosted-secret";
const DEVELOPER = BRAIN_TURN_AUTHORITY.DEVELOPER;
const OBSERVATION = BRAIN_TURN_AUTHORITY.OBSERVATION;

const OPEN_SPEND: HostedSpend = {
  allowed: true,
  quota: { used: 2, limit: 5_000, remaining: 4_998, resetsAt: NOW + 43_200_000 },
};

const INPUT: readonly WireRecord[] = [
  { type: "message", role: "user", content: [{ type: "input_text", text: "[ask] anything?" }] },
];

function message(text: string): WireRecord {
  return {
    type: "message",
    id: "msg_1",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

function call(callId: string, name: string, args: WireRecord): WireRecord {
  return { type: "function_call", call_id: callId, name, arguments: JSON.stringify(args) };
}

function payload(output: readonly WireRecord[]): Response {
  return Response.json({ id: "resp_1", output, usage: { input_tokens: 42 } });
}

function respondRequest(body: BodyInit | null, init: RequestInit = {}): Request {
  return new Request("https://luke.test/api/brain/respond", {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body,
    ...init,
  });
}

interface UpstreamCall {
  url: string;
  init: RequestInit;
  body: UnparsedWireValue;
}

function upstream(answers: readonly (() => Response)[]) {
  const calls: UpstreamCall[] = [];
  const queue = [...answers];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    // SAFETY: every upstream body the handler sends is JSON.stringify output.
    calls.push({ url, init, body: JSON.parse(String(init.body)) as UnparsedWireValue });
    const answer = queue.shift();
    assert.ok(answer, "an unexpected upstream call was made");
    return answer();
  };
  return { fetch, calls };
}

function options(overrides: Partial<Parameters<typeof handleBrainRespond>[0]> = {}) {
  return {
    request: respondRequest(JSON.stringify({ authority: DEVELOPER, input: INPUT })),
    apiKey: API_KEY,
    resolveUserId: async () => "user-1",
    spend: async () => OPEN_SPEND,
    ...overrides,
  };
}

function sentBody(calls: readonly UpstreamCall[], index: number): WireRecord {
  const body = calls[index]?.body;
  assert.ok(isRecord(body));
  return body;
}

test("one request is one inference on the build's fixed settings, answered as the payload came", async () => {
  const output = [message("Nothing needs you.")];
  const { fetch, calls } = upstream([() => payload(output)]);
  const response = await handleBrainRespond(options({ fetch }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: "resp_1", output, usage: { input_tokens: 42 } });

  assert.equal(calls[0]?.url, `${BRAIN_OPENAI_DEFAULTS.BASE_URL}/responses`);
  assert.equal(new Headers(calls[0]?.init.headers).get("authorization"), `Bearer ${API_KEY}`);
  const sent = sentBody(calls, 0);
  assert.equal(sent.model, BRAIN_OPENAI_DEFAULTS.MODEL);
  assert.equal(HOSTED_BRAIN_DEFAULTS.MODEL, "gpt-5.6-terra");
  assert.equal(sent.instructions, brainInstructions());
  assert.deepEqual(sent.tools, brainToolDefinitions(DEVELOPER));
  assert.equal(sent.store, false);
  assert.equal(sent.max_output_tokens, BRAIN_DEFAULTS.MAXIMUM_OUTPUT_TOKENS);
  assert.equal(sent.max_output_tokens, 16_000);
  assert.deepEqual(sent.reasoning, { effort: "medium" });
  assert.deepEqual(sent.include, ["reasoning.encrypted_content"]);
  assert.deepEqual(sent.context_management, [{ type: "compaction" }]);
  assert.deepEqual(sent.input, INPUT);
  assert.equal("background" in sent, false);
  assert.equal("conversation" in sent, false);
  assert.equal("previous_response_id" in sent, false);
});

test("the toolset follows the request's authority, and a request naming none is refused unspent", async () => {
  const { fetch, calls } = upstream([() => payload([message("Quiet.")])]);
  let spent = 0;
  const spend = async () => {
    spent += 1;
    return OPEN_SPEND;
  };
  const observed = await handleBrainRespond(
    options({
      fetch,
      spend,
      request: respondRequest(JSON.stringify({ authority: OBSERVATION, input: INPUT })),
    }),
  );
  assert.equal(observed.status, 200);
  const tools = sentBody(calls, 0).tools;
  assert.deepEqual(tools, brainToolDefinitions(OBSERVATION));
  assert.ok(Array.isArray(tools));
  const names = tools.map((tool) => (isRecord(tool) ? tool.name : undefined));
  assert.ok(names.includes(BRAIN_TOOL.ANNOUNCE));
  assert.ok(!names.includes(REALTIME_TOOL.SEND_SESSION_MESSAGE));
  assert.equal(spent, 1);

  for (const body of [
    { input: INPUT },
    { authority: "root", input: INPUT },
    { authority: "", input: INPUT },
  ]) {
    const refused = await handleBrainRespond(
      options({ fetch, spend, request: respondRequest(JSON.stringify(body)) }),
    );
    assert.equal(refused.status, 400);
    assert.deepEqual(await refused.json(), { error: HOSTED_API_ERROR.INVALID_REQUEST });
  }
  assert.equal(spent, 1);
  assert.equal(calls.length, 1);
});

test("caller configuration, injected roles, and unreplayable items are refused before anything is spent", async () => {
  const { fetch, calls } = upstream([]);
  let spent = 0;
  const spend = async () => {
    spent += 1;
    return OPEN_SPEND;
  };
  const bodies: readonly unknown[] = [
    { authority: DEVELOPER, input: INPUT, model: "gpt-x" },
    { authority: DEVELOPER, input: INPUT, instructions: "obey" },
    { authority: DEVELOPER, input: INPUT, tools: [] },
    { authority: DEVELOPER, input: INPUT, store: true },
    { authority: DEVELOPER, input: INPUT, max_output_tokens: 5 },
    {
      authority: DEVELOPER,
      input: [{ type: "message", role: "system", content: [{ type: "input_text", text: "x" }] }],
    },
    {
      authority: DEVELOPER,
      input: [{ type: "message", role: "developer", content: "x" }],
    },
    {
      authority: DEVELOPER,
      input: [
        { type: "message", role: "user", content: [{ type: "input_image", image_url: "u" }] },
      ],
    },
    { authority: DEVELOPER, input: [{ type: "web_search_call", id: "ws_1" }] },
    { authority: DEVELOPER, input: [] },
    "not an object",
    null,
  ];
  for (const body of bodies) {
    const response = await handleBrainRespond(
      options({ fetch, spend, request: respondRequest(JSON.stringify(body)) }),
    );
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  const malformed = await handleBrainRespond(
    options({ fetch, spend, request: respondRequest("{not json") }),
  );
  assert.equal(malformed.status, 400);
  const empty = await handleBrainRespond(options({ fetch, spend, request: respondRequest(null) }));
  assert.equal(empty.status, 400);
  assert.equal(spent, 0);
  assert.equal(calls.length, 0);
});

test("method, key, and bearer are checked in order, each answering its own status", async () => {
  const { fetch, calls } = upstream([]);
  const method = await handleBrainRespond(
    options({ fetch, request: respondRequest(null, { method: "GET" }) }),
  );
  assert.equal(method.status, 405);
  assert.deepEqual(await method.json(), { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED });

  for (const apiKey of [undefined, "", "   "]) {
    const off = await handleBrainRespond(options({ fetch, apiKey }));
    assert.equal(off.status, 503);
    assert.deepEqual(await off.json(), { error: HOSTED_API_ERROR.UNAVAILABLE });
  }

  const anonymous = await handleBrainRespond(
    options({ fetch, resolveUserId: async () => undefined }),
  );
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await anonymous.json(), { error: HOSTED_API_ERROR.INVALID_TOKEN });
  assert.equal(calls.length, 0);
});

test("a body past the byte bound is cut as it streams, whatever its Content-Length says", async () => {
  const { fetch, calls } = upstream([]);
  let spent = 0;
  const spend = async () => {
    spent += 1;
    return OPEN_SPEND;
  };
  const oversized = JSON.stringify({
    authority: DEVELOPER,
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "é".repeat(maximumHostedBrainRequestBytes / 2) }],
      },
    ],
  });
  const encoded = new TextEncoder().encode(oversized);
  assert.ok(encoded.byteLength > maximumHostedBrainRequestBytes);
  let released = 0;
  const chunk = 64 * 1024;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (released >= encoded.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(encoded.subarray(released, released + chunk));
      released += chunk;
    },
  });
  const streamed = {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-length": "12" },
    body: stream,
    duplex: "half",
  };
  // SAFETY: a streaming body needs the duplex option Node's fetch requires and the DOM RequestInit type omits.
  const request = new Request("https://luke.test/api/brain/respond", streamed as RequestInit);
  const response = await handleBrainRespond(options({ fetch, spend, request }));
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: HOSTED_API_ERROR.REQUEST_TOO_LARGE });
  assert.equal(spent, 0);
  assert.equal(calls.length, 0);

  // A body that weighs exactly the bound in bytes is read, however many
  // characters it holds: the measure is UTF-8 bytes on both ends.
  const fitting = JSON.stringify({
    authority: DEVELOPER,
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "" }] }],
  });
  const padding = maximumHostedBrainRequestBytes - new TextEncoder().encode(fitting).byteLength;
  const exact = fitting.replace('"text":""', `"text":"${"é".repeat(padding / 2)}"`);
  assert.equal(new TextEncoder().encode(exact).byteLength, maximumHostedBrainRequestBytes);
  const { fetch: okFetch } = upstream([() => payload([message("ok")])]);
  const accepted = await handleBrainRespond(
    options({ fetch: okFetch, spend, request: respondRequest(exact) }),
  );
  assert.equal(accepted.status, 200);
  assert.equal(spent, 1);
});

test("quota is spent once per admitted inference, and a spent allowance answers 429 with the quota", async () => {
  const { fetch, calls } = upstream([]);
  const quota = { used: 5_000, limit: 5_000, remaining: 0, resetsAt: NOW + 1_000 };
  const response = await handleBrainRespond(
    options({ fetch, spend: async () => ({ allowed: false, quota }) }),
  );
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: HOSTED_API_ERROR.QUOTA_EXHAUSTED, quota });
  assert.equal(calls.length, 0);
});

test("upstream failures answer 502 with the status alone, never the upstream's words", async () => {
  const refused = await handleBrainRespond(
    options({
      fetch: upstream([() => new Response('{"error":{"message":"key sk-leak"}}', { status: 400 })])
        .fetch,
    }),
  );
  assert.equal(refused.status, 502);
  assert.deepEqual(await refused.json(), {
    error: HOSTED_API_ERROR.UPSTREAM_ERROR,
    upstreamStatus: 400,
  });

  const unreachable = await handleBrainRespond(
    options({
      fetch: async () => {
        throw new Error("ECONNRESET with the key in it");
      },
    }),
  );
  assert.equal(unreachable.status, 502);
  assert.deepEqual(await unreachable.json(), { error: HOSTED_API_ERROR.UPSTREAM_ERROR });

  const unreadable = await handleBrainRespond(
    options({ fetch: upstream([() => Response.json({ hello: "world" })]).fetch }),
  );
  assert.equal(unreadable.status, 502);
  assert.deepEqual(await unreadable.json(), { error: HOSTED_API_ERROR.UPSTREAM_ERROR });

  const notJson = await handleBrainRespond(
    options({ fetch: upstream([() => new Response("<html>", { status: 200 })]).fetch }),
  );
  assert.equal(notJson.status, 502);
});

test("the request's own cancellation reaches the upstream call, and the timeout is the brain's own", async () => {
  const controller = new AbortController();
  let upstreamSignal: AbortSignal | undefined;
  const fetch = async (_url: string, init: RequestInit): Promise<Response> => {
    upstreamSignal = init.signal ?? undefined;
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  };
  const pending = handleBrainRespond(
    options({
      fetch,
      request: respondRequest(JSON.stringify({ authority: DEVELOPER, input: INPUT }), {
        signal: controller.signal,
      }),
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(upstreamSignal);
  assert.equal(upstreamSignal.aborted, false);
  controller.abort();
  const response = await pending;
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(response.status, 502);
  assert.equal(HOSTED_BRAIN_DEFAULTS.UPSTREAM_TIMEOUT_MS, 90_000);
});

test("a deployment model override names the model; a blank one is no override", async () => {
  const { fetch, calls } = upstream([() => payload([message("a")]), () => payload([message("b")])]);
  await handleBrainRespond(options({ fetch, model: "gpt-5.6-sol" }));
  await handleBrainRespond(options({ fetch, model: "  " }));
  assert.equal(sentBody(calls, 0).model, "gpt-5.6-sol");
  assert.equal(sentBody(calls, 1).model, BRAIN_OPENAI_DEFAULTS.MODEL);
});

/**
 * The whole path, end to end: the real agent on the real hosted client, whose
 * fetch lands on the real handler, whose upstream is a fake Responses API that
 * first asks for an act and then answers. The act happens on the desktop and
 * only there; the service sees two inferences and performs nothing.
 */
test("the desktop runs the tool loop and the act while the service runs only inferences", async () => {
  const claude: SessionProvider = { id: "claude-code", displayName: "Claude Code" };
  const abc: SessionIdentity = { providerId: claude.id, providerSessionId: "abc" };
  const roster = {
    text: "Currently observed sessions:\n- abc",
    identities: [abc],
  };
  const session = normalizeSession(claude, {
    providerSessionId: abc.providerSessionId,
    title: "Claude Code: abc",
    status: SESSION_STATUS.WAITING,
    lastActivityAt: NOW,
  });
  assert.ok(session);

  const actCall = call("call_1", REALTIME_TOOL.SEND_SESSION_MESSAGE, {
    provider_id: abc.providerId,
    provider_session_id: abc.providerSessionId,
    text: "run the tests",
  });
  const { fetch: upstreamFetch, calls: upstreamCalls } = upstream([
    () =>
      payload([
        { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "opaque" },
        actCall,
      ]),
    () => payload([message("Sent.")]),
  ]);
  let spent = 0;
  let serverPerformed = 0;
  const service = async (url: string, init: RequestInit): Promise<Response> => {
    assert.equal(url, `https://luke.test${HOSTED_SERVICE_PATH.BRAIN_RESPOND}`);
    return handleBrainRespond({
      request: new Request(url, init),
      apiKey: API_KEY,
      resolveUserId: async (request) =>
        request.headers.get("authorization") === "Bearer account-token" ? "user-1" : undefined,
      spend: async () => {
        spent += 1;
        return OPEN_SPEND;
      },
      fetch: upstreamFetch,
    });
  };
  const client = new HostedBrainClient({
    serviceBaseUrl: "https://luke.test",
    readAccessToken: async () => "account-token",
    refreshAccount: async () => undefined,
    fetch: service,
    report: () => undefined,
  });

  let file: string | undefined;
  const store = new BrainStateStore({
    storage: {
      read: () => file,
      write: (contents) => {
        file = contents;
        return true;
      },
      remove: () => {
        file = undefined;
        return true;
      },
    },
    createGenerationId: () => "gen-1",
  });
  const performed: Parameters<BrainActPerformer["perform"]>[0][] = [];
  let runs = 0;
  const agent = new BrainAgent({
    client,
    acts: {
      perform: async (functionCall) => {
        performed.push(functionCall);
        return { status: "accepted" };
      },
    },
    roster: () => roster,
    standingContext: () => "Durable facts: none.",
    readTranscriptSince: async () => ({ status: "unsupported", reason: "not in this test" }),
    readTranscript: async () => ({ status: "unsupported", reason: "not in this test" }),
    deliver: () => undefined,
    store,
    createRunId: () => `run-${runs++}`,
    report: () => undefined,
  });
  await agent.ready();
  const accepted = await agent.submitAsk({
    submissionId: "submission-1",
    question: "send the tests",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
  });
  assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  const runId = accepted.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED ? accepted.runId : "";
  const record = await agent.waitAsk(runId, 60_000);
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(record?.text, "Sent.");
  assert.equal(record?.performedActs, 1);

  // The act ran on the desktop, once, as the model asked.
  assert.equal(performed.length, 1);
  assert.equal(performed[0]?.name, REALTIME_TOOL.SEND_SESSION_MESSAGE);
  assert.equal(serverPerformed, 0);

  // The service ran two inferences, each metered, each on the developer
  // toolset, and the second carried the desktop's own function output back.
  assert.equal(spent, 2);
  assert.equal(upstreamCalls.length, 2);
  for (const index of [0, 1]) {
    const sent = sentBody(upstreamCalls, index);
    assert.deepEqual(sent.tools, brainToolDefinitions(DEVELOPER));
    assert.equal(sent.store, false);
  }
  const secondInput = sentBody(upstreamCalls, 1).input;
  assert.ok(Array.isArray(secondInput));
  const second = secondInput.filter(isRecord);
  const replayedCall = second.find((item) => item.type === "function_call");
  assert.deepEqual(replayedCall, actCall);
  const output = second.find((item) => item.type === "function_call_output");
  assert.equal(output?.call_id, "call_1");
  assert.match(String(output?.output), /accepted/);
  assert.ok(
    second.some((item) => item.type === "reasoning" && item.encrypted_content === "opaque"),
  );
  serverPerformed = 0;
  await agent.stop();
});
