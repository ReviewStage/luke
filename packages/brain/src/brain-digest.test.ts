import assert from "node:assert/strict";
import test from "node:test";
import { HOOK_EVENT, SESSION_STATUS } from "@sidecar/session";
import { isRecord } from "@sidecar/wire";
import {
  DIGEST_SCHEMA,
  DIGEST_STOP_STATE,
  digestChars,
  digestFromModel,
  fallbackDigest,
} from "./brain-digest.js";
import {
  DIGEST_INPUT_MARKER,
  digestFromResponsesPayload,
  digestInputText,
  digestResponsesRequest,
} from "./brain-digest-openai.js";
import { BRAIN_REASONING_EFFORT } from "./brain-openai.js";

const TRANSCRIPT_SECRET = "SECRET_TRANSCRIPT_TEXT";

test("the reader accepts a schema-shaped digest, drops empty fields, and keeps a long one whole", () => {
  assert.deepEqual(
    digestFromModel({
      stop_state: "waiting-for-developer",
      last_ask: "  fix the flaky test ",
      did_since: null,
      waiting_on: "   ",
    }),
    { stopState: DIGEST_STOP_STATE.WAITING_FOR_DEVELOPER, lastAsk: "fix the flaky test" },
  );
  const long = "x".repeat(20_000);
  assert.equal(
    digestFromModel({ stop_state: "working", last_ask: null, did_since: long, waiting_on: null })
      ?.didSince,
    long,
  );
});

test("the reader refuses anything off the schema rather than repairing it", () => {
  const whole = {
    stop_state: "finished",
    last_ask: null,
    did_since: "ran tests",
    waiting_on: null,
  };
  assert.equal(digestFromModel({ ...whole, stop_state: "done" }), undefined);
  assert.equal(digestFromModel({ ...whole, did_since: 7 }), undefined);
  assert.equal(digestFromModel({ ...whole, last_ask: ["a"] }), undefined);
  assert.equal(digestFromModel({ stop_state: "finished" }), undefined);
  assert.equal(digestFromModel("finished"), undefined);
  assert.equal(digestFromModel(undefined), undefined);
  assert.deepEqual(digestFromModel(whole), {
    stopState: DIGEST_STOP_STATE.FINISHED,
    didSince: "ran tests",
  });
});

test("the fallback reads the hook first, then the roster status, and carries only the roster's error", () => {
  assert.deepEqual(fallbackDigest({ hookEvent: HOOK_EVENT.STOP_FAILURE }), {
    stopState: DIGEST_STOP_STATE.ERRORED,
  });
  assert.deepEqual(
    fallbackDigest({ hookEvent: HOOK_EVENT.NOTIFICATION, status: SESSION_STATUS.WORKING }),
    { stopState: DIGEST_STOP_STATE.WAITING_FOR_PERMISSION },
  );
  assert.deepEqual(fallbackDigest({ hookEvent: HOOK_EVENT.SESSION_END }), {
    stopState: DIGEST_STOP_STATE.FINISHED,
  });
  assert.deepEqual(fallbackDigest({ hookEvent: "stop", status: SESSION_STATUS.WORKING }), {
    stopState: DIGEST_STOP_STATE.WORKING,
  });
  assert.deepEqual(fallbackDigest({ status: SESSION_STATUS.WAITING }), {
    stopState: DIGEST_STOP_STATE.WAITING_FOR_DEVELOPER,
  });
  assert.deepEqual(fallbackDigest({ status: SESSION_STATUS.ERROR, error: "exit 1" }), {
    stopState: DIGEST_STOP_STATE.ERRORED,
    waitingOn: "exit 1",
  });
  assert.deepEqual(fallbackDigest({ status: SESSION_STATUS.COMPLETE, error: "stale" }), {
    stopState: DIGEST_STOP_STATE.FINISHED,
  });
  assert.deepEqual(fallbackDigest({}), { stopState: DIGEST_STOP_STATE.UNKNOWN });
});

test("a fallback digest round-trips through the reader's own field names", () => {
  const digest = fallbackDigest({ status: SESSION_STATUS.ERROR, error: "exit 1" });
  assert.deepEqual(
    digestFromModel({
      stop_state: digest.stopState,
      last_ask: digest.lastAsk ?? null,
      did_since: digest.didSince ?? null,
      waiting_on: digest.waitingOn ?? null,
    }),
    digest,
  );
  assert.equal(digestChars(digest), JSON.stringify(digest).length);
});

test("the request is tool-free, unstored, strict, and names no session id", () => {
  const request = digestResponsesRequest(
    {
      providerName: "Claude Code",
      title: "Fix the checkout tests",
      status: SESSION_STATUS.WAITING,
      hookEvent: "stop",
      truncated: true,
      transcript: `${TRANSCRIPT_SECRET}\nassistant: done`,
    },
    {
      model: "gpt-test",
      maximumOutputTokens: 2_000,
      reasoningEffort: BRAIN_REASONING_EFFORT.LOW,
    },
  );
  assert.equal(request.model, "gpt-test");
  assert.equal(request.store, false);
  assert.equal(request.max_output_tokens, 2_000);
  assert.deepEqual(request.reasoning, { effort: "low" });
  assert.ok(!("tools" in request));
  assert.ok(!("include" in request));
  assert.ok(!("context_management" in request));
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.schema, DIGEST_SCHEMA);
  assert.deepEqual(DIGEST_SCHEMA.required, ["stop_state", "last_ask", "did_since", "waiting_on"]);
  assert.equal(request.input.length, 1);
  const [item] = request.input;
  assert.ok(item && Array.isArray(item.content) && isRecord(item.content[0]));
  const text = item.content[0].text;
  assert.equal(
    text,
    [
      "provider: Claude Code",
      "title: Fix the checkout tests",
      "status: waiting",
      "hook: stop",
      "front_cut: yes",
      DIGEST_INPUT_MARKER,
      `${TRANSCRIPT_SECRET}\nassistant: done`,
    ].join("\n"),
  );
  assert.ok(request.instructions.includes(DIGEST_INPUT_MARKER));
  assert.ok(!request.instructions.includes(TRANSCRIPT_SECRET));
  assert.doesNotMatch(JSON.stringify(request), /provider_session_id|provider_id/u);
});

test("the input text leaves out fields the roster did not give", () => {
  const text = digestInputText({ providerName: "OMP", truncated: false, transcript: "hi" });
  assert.equal(text, ["provider: OMP", "front_cut: no", DIGEST_INPUT_MARKER, "hi"].join("\n"));
});

test("the payload reader takes the output text through the same schema gate", () => {
  const payload = (text: string) => ({
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
  });
  assert.deepEqual(
    digestFromResponsesPayload(
      payload('{"stop_state":"errored","last_ask":null,"did_since":null,"waiting_on":"exit 1"}'),
    ),
    { stopState: DIGEST_STOP_STATE.ERRORED, waitingOn: "exit 1" },
  );
  assert.equal(digestFromResponsesPayload(payload("not json")), undefined);
  assert.equal(digestFromResponsesPayload(payload('{"stop_state":"nope"}')), undefined);
  assert.equal(digestFromResponsesPayload({ output: [] }), undefined);
  assert.equal(digestFromResponsesPayload("text"), undefined);
});
