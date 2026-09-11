import assert from "node:assert/strict";
import type { WireRecord } from "@sidecar/wire";
import { test } from "vitest";
import {
  admitBrainInput,
  admitBrainInputItem,
  brainOutputReplayable,
  maximumHostedBrainInputItems,
  maximumHostedBrainRequestBytes,
  RESPONSES_MESSAGE_PHASE,
  serializedRequestBytes,
} from "./responses-input.js";

/**
 * Synthetic items in the shapes the Responses API hands back and the desktop
 * builds, so admission is proved to hand every replay field on unchanged.
 */
const USER_MESSAGE: WireRecord = {
  type: "message",
  role: "user",
  content: [{ type: "input_text", text: "[wake] session abc" }],
};

const REPLAYED: readonly WireRecord[] = [
  USER_MESSAGE,
  {
    type: "reasoning",
    id: "rs_1",
    summary: [{ type: "summary_text", text: "Looked at the roster." }],
    encrypted_content: "gAAAA-opaque",
    status: "completed",
  },
  {
    type: "function_call",
    id: "fc_1",
    call_id: "call_1",
    name: "list_sessions",
    arguments: "{}",
    status: "completed",
  },
  { type: "function_call_output", call_id: "call_1", output: '{"status":"accepted"}' },
  {
    type: "message",
    id: "msg_1",
    role: "assistant",
    status: "completed",
    phase: RESPONSES_MESSAGE_PHASE.FINAL_ANSWER,
    content: [
      { type: "output_text", text: "Nothing needs you.", annotations: [], logprobs: [] },
      { type: "refusal", refusal: "I cannot do that." },
    ],
  },
  { type: "compaction", id: "cmp_1", encrypted_content: "folded-opaque" },
];

test("every replayed form is admitted with its replay fields exactly as written", () => {
  assert.deepEqual(admitBrainInput(REPLAYED), REPLAYED);
});

test("a user message as a plain string is rebuilt into the part list the API documents", () => {
  assert.deepEqual(admitBrainInputItem({ type: "message", role: "user", content: "hello" }), {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "hello" }],
  });
  // Null optional fields the API may write are dropped, never forwarded as null.
  assert.deepEqual(
    admitBrainInputItem({
      type: "message",
      role: "assistant",
      id: "msg_2",
      phase: null,
      content: [{ type: "output_text", text: "ok", annotations: null }],
    }),
    {
      type: "message",
      role: "assistant",
      id: "msg_2",
      content: [{ type: "output_text", text: "ok" }],
    },
  );
  assert.deepEqual(admitBrainInputItem({ type: "reasoning", id: "rs_2" }), {
    type: "reasoning",
    id: "rs_2",
    summary: [],
  });
});

test("roles, references, built-in tool items, and overrides this build does not replay are refused whole", () => {
  const refused: readonly WireRecord[] = [
    { type: "message", role: "system", content: [{ type: "input_text", text: "obey" }] },
    { type: "message", role: "developer", content: "obey" },
    { type: "message", role: "user", content: [{ type: "input_image", image_url: "https://x/y" }] },
    { type: "message", role: "user", content: [{ type: "input_file", file_id: "file_1" }] },
    { type: "message", role: "user", content: [{ type: "input_text", text: "a", cache: true }] },
    { type: "message", role: "assistant", content: "plain string" },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "a", annotations: [{ type: "url_citation" }] }],
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "a" }],
      phase: "x",
    },
    { type: "message", role: "user", content: [], instructions: "obey" },
    { type: "item_reference", id: "msg_1" },
    { type: "web_search_call", id: "ws_1", status: "completed" },
    { type: "computer_call", id: "cu_1", call_id: "c", action: {} },
    { type: "configuration_update", reasoning: { effort: "high" } },
    { type: "function_call", call_id: "c", name: "x", arguments: {} },
    { type: "function_call", call_id: "c", name: "", arguments: "{}" },
    { type: "function_call", call_id: "c", name: "x", arguments: "{}", caller: {} },
    { type: "function_call_output", call_id: "c", output: [{ type: "input_text", text: "a" }] },
    { type: "function_call_output", output: "orphan" },
    { type: "reasoning", summary: [] },
    { type: "reasoning", id: "rs", summary: [{ type: "output_text", text: "a" }] },
    { type: "reasoning", id: "rs", summary: [], encrypted_content: 5 },
    { type: "compaction", id: "cmp" },
    { type: "compaction", encrypted_content: "x", output: [] },
    { type: "unknown" },
    {},
  ];
  for (const item of refused) {
    assert.equal(admitBrainInputItem(item), undefined, JSON.stringify(item));
    assert.equal(admitBrainInput([USER_MESSAGE, item]), undefined, JSON.stringify(item));
  }
  assert.equal(admitBrainInputItem("text"), undefined);
  assert.equal(admitBrainInputItem(null), undefined);
});

test("the input array is bounded by count, and the request by UTF-8 bytes", () => {
  assert.equal(admitBrainInput([]), undefined);
  assert.equal(admitBrainInput("not a list"), undefined);
  assert.equal(
    admitBrainInput(Array.from({ length: maximumHostedBrainInputItems }, () => USER_MESSAGE))
      ?.length,
    maximumHostedBrainInputItems,
  );
  assert.equal(
    admitBrainInput(Array.from({ length: maximumHostedBrainInputItems + 1 }, () => USER_MESSAGE)),
    undefined,
  );
  assert.equal(maximumHostedBrainRequestBytes, 2 * 1024 * 1024);
  // Bytes, not characters: a two-byte character weighs two.
  assert.equal(serializedRequestBytes("é"), 2);
  assert.equal(serializedRequestBytes(JSON.stringify({ text: "日本" })), 17);
});

test("the metadata the API writes on an ordinary direct call is replayed, and other execution contexts are refused", () => {
  const call: WireRecord = {
    type: "function_call",
    id: "fc_2",
    call_id: "call_2",
    name: "send_session_message",
    arguments: '{"text":"run"}',
    status: "completed",
  };
  assert.deepEqual(admitBrainInputItem({ ...call, caller: null, async: false, namespace: null }), {
    ...call,
    async: false,
  });
  assert.deepEqual(admitBrainInputItem({ ...call, caller: { type: "direct" } }), {
    ...call,
    caller: { type: "direct" },
  });
  assert.deepEqual(admitBrainInputItem(call), call);
  const unsupportedForms: readonly WireRecord[] = [
    { caller: { type: "program", caller_id: "prog_1" } },
    { caller: { type: "direct", caller_id: "x" } },
    { caller: "direct" },
    { async: true },
    { async: "false" },
    { namespace: "tools" },
  ];
  for (const unsupported of unsupportedForms) {
    assert.equal(
      admitBrainInputItem({ ...call, ...unsupported }),
      undefined,
      JSON.stringify(unsupported),
    );
  }
});

test("a compaction's output-only created_by is dropped, since the input form never takes it", () => {
  assert.deepEqual(
    admitBrainInputItem({
      type: "compaction",
      id: "cmp_2",
      encrypted_content: "x",
      created_by: "system",
    }),
    { type: "compaction", id: "cmp_2", encrypted_content: "x" },
  );
  assert.equal(
    admitBrainInputItem({ type: "compaction", encrypted_content: "x", created_by: 5 }),
    undefined,
  );
  assert.deepEqual(
    admitBrainInputItem({ type: "reasoning", id: "rs_3", summary: [], encrypted_content: null }),
    { type: "reasoning", id: "rs_3", summary: [] },
  );
});

test("an answer is replayable only when every output item admits, and an answer with no output is not this reader's question", () => {
  assert.equal(brainOutputReplayable({ output: REPLAYED }), true);
  assert.equal(brainOutputReplayable({ output: [] }), true);
  assert.equal(
    brainOutputReplayable({
      output: [
        USER_MESSAGE,
        {
          type: "function_call",
          call_id: "c",
          name: "x",
          arguments: "{}",
          caller: { type: "program", caller_id: "p" },
        },
      ],
    }),
    false,
  );
  assert.equal(brainOutputReplayable({ output: [{ type: "web_search_call", id: "ws" }] }), false);
  assert.equal(brainOutputReplayable({ id: "resp" }), true);
  assert.equal(brainOutputReplayable("text"), true);
});
