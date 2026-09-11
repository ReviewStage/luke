import assert from "node:assert/strict";
import {
  RESPONSES_CONTENT_PART_TYPE,
  RESPONSES_INPUT_ITEM_TYPE,
  RESPONSES_MESSAGE_ROLE,
} from "@sidecar/hosted";
import {
  CONTEXT_INPUT_KIND,
  type ContextEngine,
  checkpointFormatTag,
} from "@sidecar/runtime/vocabulary";
import {
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TOOL_PART_STATE,
  type ToolPartState,
} from "@sidecar/session";
import type { StoredUIMessage } from "@sidecar/session/ui-messages";
import {
  isRecord,
  isWireString,
  SCHEMA_REFUSAL,
  UNKNOWN_ACTION_STATUS,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import {
  type AssistantModelMessage,
  type ModelMessage,
  type ProviderMetadata,
  type ToolModelMessage,
  type ToolSet,
  tool,
  type UIDataTypes,
  type UIMessagePart,
  type UITools,
} from "ai";
import { test } from "vitest";
import { z } from "zod";
import { ResponsesContextEngine } from "./context-engine.js";
import {
  type ContextRow,
  type ModelInputOptions,
  modelInputFrom,
  type ReplayTarget,
  readContextRows,
  retainedRows,
  rowsSinceCompaction,
  UI_MESSAGE_ENGINE_REFUSAL,
  UIMessageContextEngine,
} from "./ui-message-context.js";

const RUNTIME = { id: "tool-loop", version: 1 };
const LOST_RESULT = { status: UNKNOWN_ACTION_STATUS, reason: "the result was lost" } as const;
/** How the SDK marks a tool result's output to the model when it is an answer rather than an error. */
const MODEL_RESULT_OUTPUT = { JSON: "json" } as const;
const MODEL = "gpt-5.4-mini";
const PROVIDER = "openai";
const REPLAY: ReplayTarget = { provider: PROVIDER, model: MODEL };

const TOOL_NAME = "read_transcript";
const TOOLS: ToolSet = {
  [TOOL_NAME]: tool({
    description: "Reads the tail of an observed session's transcript.",
    inputSchema: z.object({ providerId: z.string(), providerSessionId: z.string() }),
    outputSchema: z.object({ lines: z.array(z.string()) }),
  }),
};

const OPTIONS: ModelInputOptions = { tools: TOOLS, replay: REPLAY, lostResult: LOST_RESULT };

/** One turn: an ask, a reasoning item before a transcript read, the read's answer, a reasoning item before the reply. */
const TURN = {
  ASK: '[developer ask] 2026-09-10T00:00:00.000Z\n{"question":"What is the fixture session waiting on?"}',
  CALL_ID: "call_6f10d4e59a712b8c",
  INPUT: { providerId: "conductor", providerSessionId: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50" },
  OUTPUT: { lines: ["user: Please add the fixture test.", "assistant: Waiting for permission."] },
  REASONING_BEFORE_CALL: {
    itemId: "rs_0f3a1c22",
    encrypted: "Zml4dHVyZS1vcGFxdWUtb25l",
    summary: "The developer asked about the fixture session, so read its tail before answering.",
  },
  REASONING_BEFORE_REPLY: {
    itemId: "rs_1b4d2e33",
    encrypted: "Zml4dHVyZS1vcGFxdWUtdHdv",
    summary: "The tail shows a permission hold; say so.",
  },
  REPLY: "It is holding on a permission prompt before it runs the tests.",
  EPHEMERAL: "[standing context] 2026-09-10T00:00:01.000Z\nroster",
} as const;

interface Reasoning {
  readonly itemId: string;
  readonly encrypted: string;
  readonly summary: string;
}

function reasoningItem(reasoning: Reasoning): WireRecord {
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.REASONING,
    id: reasoning.itemId,
    encrypted_content: reasoning.encrypted,
    summary: [{ type: RESPONSES_CONTENT_PART_TYPE.SUMMARY_TEXT, text: reasoning.summary }],
  };
}

function functionCallItem(): WireRecord {
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
    call_id: TURN.CALL_ID,
    name: TOOL_NAME,
    arguments: JSON.stringify(TURN.INPUT),
  };
}

function assistantMessageItem(text: string): WireRecord {
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.MESSAGE,
    role: RESPONSES_MESSAGE_ROLE.ASSISTANT,
    content: [{ type: RESPONSES_CONTENT_PART_TYPE.OUTPUT_TEXT, text }],
  };
}

function openAiReplay(reasoning: Reasoning): ProviderMetadata {
  return {
    [PROVIDER]: {
      itemId: reasoning.itemId,
      reasoningEncryptedContent: reasoning.encrypted,
    },
  };
}

type StoredPart = UIMessagePart<UIDataTypes, UITools>;
type ModelPart =
  | Exclude<AssistantModelMessage["content"], string>[number]
  | ToolModelMessage["content"][number];

/** What a test hangs on a tool part beyond its state: a still-streaming answer, or metadata the call carries for replay. */
interface ToolPartExtra {
  readonly preliminary?: boolean;
  readonly callProviderMetadata?: ProviderMetadata;
}

function userRow(id: string, text: string): ContextRow {
  return {
    message: {
      id,
      role: MESSAGE_ROLE.USER,
      metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
      parts: [{ type: "text", text }],
    },
  };
}

function assistantRow(id: string, parts: readonly StoredPart[], model?: string): ContextRow {
  const message: StoredUIMessage = {
    id,
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
    parts: [...parts],
  };
  return model === undefined ? { message } : { message, model };
}

function compactionRow(id: string, summary: string, firstKeptMessageId: string): ContextRow {
  return {
    model: MODEL,
    message: {
      id,
      role: MESSAGE_ROLE.ASSISTANT,
      metadata: {
        author: MESSAGE_AUTHOR.BRAIN,
        compaction: { first_kept_message_id: firstKeptMessageId, tokens_before: 48_210 },
      },
      parts: [{ type: "text", text: summary, state: "done" }],
    },
  };
}

function toolPart(state: ToolPartState, extra: ToolPartExtra = {}): StoredPart {
  const call = { type: `tool-${TOOL_NAME}` as const, toolCallId: TURN.CALL_ID, input: TURN.INPUT };
  switch (state) {
    case TOOL_PART_STATE.OUTPUT_AVAILABLE:
      return { ...call, state, output: TURN.OUTPUT, ...extra };
    case TOOL_PART_STATE.OUTPUT_ERROR:
      return { ...call, state, errorText: "refused", ...extra };
    case TOOL_PART_STATE.INPUT_AVAILABLE:
    case TOOL_PART_STATE.INPUT_STREAMING:
      return { ...call, state, ...extra };
  }
}

/** The turn's assistant row as the SDK's own writer shapes it: a step boundary before each inference's parts. */
function replyParts(
  toolState: ToolPartState = TOOL_PART_STATE.OUTPUT_AVAILABLE,
  toolExtra: ToolPartExtra = {},
): StoredPart[] {
  return [
    { type: "step-start" },
    {
      type: "reasoning",
      text: TURN.REASONING_BEFORE_CALL.summary,
      state: "done",
      providerMetadata: openAiReplay(TURN.REASONING_BEFORE_CALL),
    },
    toolPart(toolState, toolExtra),
    { type: "step-start" },
    {
      type: "reasoning",
      text: TURN.REASONING_BEFORE_REPLY.summary,
      state: "done",
      providerMetadata: openAiReplay(TURN.REASONING_BEFORE_REPLY),
    },
    { type: "text", text: TURN.REPLY, state: "done" },
  ];
}

/** How many of a reply's parts stand before the crash the interrupted fixtures model: the step's start, its reasoning, and the call. */
const PARTS_THROUGH_CALL = 3;

const ASK_ROW = userRow("3f1c9a2e-7b4d-4e8f-9a01-2b3c4d5e6f70", TURN.ASK);
const REPLY_ROW = assistantRow("5a2d7b3c-8e4f-4a9b-8c12-3d4e5f6a7b81", replyParts(), MODEL);

function engine(): UIMessageContextEngine {
  return new UIMessageContextEngine({ runtime: RUNTIME, tools: TOOLS, replay: REPLAY });
}

function toWire(value: StoredUIMessage): WireRecord {
  // SAFETY: a row and a model message are JSON; the round trip is their wire shape, as the engine itself takes it.
  return JSON.parse(JSON.stringify(value)) as WireRecord;
}

function itemsOf(rows: readonly ContextRow[]): WireRecord[] {
  return rows.map((row) => ({
    message: toWire(row.message),
    ...(row.model !== undefined ? { model: row.model } : undefined),
  }));
}

function checkpointOf(context: UIMessageContextEngine, rows: readonly ContextRow[]) {
  return { format: context.checkpointFormat, items: itemsOf(rows) };
}

async function bootstrapped(rows: readonly ContextRow[]) {
  const context = engine();
  const bootstrap = await context.bootstrap(checkpointOf(context, rows), LOST_RESULT);
  return { context, bootstrap };
}

/**
 * The turn as either engine shows it to a model, in one vocabulary: what each
 * item is and what it carries, provider shapes stripped away. Equivalence is
 * this sequence being the same from both.
 */
const SHOWN = {
  USER: "user",
  ASSISTANT: "assistant",
  REASONING: "reasoning",
  CALL: "call",
  RESULT: "result",
} as const;

type Shown =
  | { kind: typeof SHOWN.USER; text: string }
  | { kind: typeof SHOWN.ASSISTANT; text: string }
  | { kind: typeof SHOWN.REASONING; itemId: unknown; encrypted: unknown; summary: string }
  | { kind: typeof SHOWN.CALL; callId: unknown; name: unknown; input: unknown }
  | { kind: typeof SHOWN.RESULT; callId: unknown; output: unknown };

function texts(content: UnparsedWireValue, type: string): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      isRecord(part) && part.type === type && isWireString(part.text) ? part.text : "",
    )
    .join("");
}

function shownByResponses(items: readonly WireRecord[]): Shown[] {
  const shown: Shown[] = [];
  for (const item of items) {
    switch (item.type) {
      case RESPONSES_INPUT_ITEM_TYPE.MESSAGE:
        shown.push(
          item.role === RESPONSES_MESSAGE_ROLE.USER
            ? {
                kind: SHOWN.USER,
                text: texts(item.content, RESPONSES_CONTENT_PART_TYPE.INPUT_TEXT),
              }
            : {
                kind: SHOWN.ASSISTANT,
                text: texts(item.content, RESPONSES_CONTENT_PART_TYPE.OUTPUT_TEXT),
              },
        );
        break;
      case RESPONSES_INPUT_ITEM_TYPE.REASONING:
        shown.push({
          kind: SHOWN.REASONING,
          itemId: item.id,
          encrypted: item.encrypted_content,
          summary: texts(item.summary, RESPONSES_CONTENT_PART_TYPE.SUMMARY_TEXT),
        });
        break;
      case RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL:
        shown.push({
          kind: SHOWN.CALL,
          callId: item.call_id,
          name: item.name,
          input: isWireString(item.arguments) ? JSON.parse(item.arguments) : undefined,
        });
        break;
      case RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT:
        shown.push({
          kind: SHOWN.RESULT,
          callId: item.call_id,
          output: isWireString(item.output) ? JSON.parse(item.output) : undefined,
        });
        break;
      default:
        throw new Error(`unexpected item ${String(item.type)}`);
    }
  }
  return shown;
}

const MODEL_MESSAGE_ROLE = { USER: "user", ASSISTANT: "assistant", TOOL: "tool" } as const;
const MODEL_PART = {
  TEXT: "text",
  REASONING: "reasoning",
  TOOL_CALL: "tool-call",
  TOOL_RESULT: "tool-result",
} as const;

function shownByModelMessages(messages: readonly WireRecord[]): Shown[] {
  const shown: Shown[] = [];
  for (const message of messages) {
    if (message.role === MODEL_MESSAGE_ROLE.USER) {
      const text = isWireString(message.content)
        ? message.content
        : texts(message.content, MODEL_PART.TEXT);
      shown.push({ kind: SHOWN.USER, text });
      continue;
    }
    if (!Array.isArray(message.content)) throw new Error("content is an array");
    for (const part of message.content) {
      if (!isRecord(part)) throw new Error("a part is a record");
      switch (part.type) {
        case MODEL_PART.TEXT:
          shown.push({ kind: SHOWN.ASSISTANT, text: isWireString(part.text) ? part.text : "" });
          break;
        case MODEL_PART.REASONING: {
          const options = isRecord(part.providerOptions) ? part.providerOptions : undefined;
          const openai = options && isRecord(options[PROVIDER]) ? options[PROVIDER] : undefined;
          shown.push({
            kind: SHOWN.REASONING,
            itemId: openai?.itemId,
            encrypted: openai?.reasoningEncryptedContent,
            summary: isWireString(part.text) ? part.text : "",
          });
          break;
        }
        case MODEL_PART.TOOL_CALL:
          shown.push({
            kind: SHOWN.CALL,
            callId: part.toolCallId,
            name: part.toolName,
            input: part.input,
          });
          break;
        case MODEL_PART.TOOL_RESULT: {
          const output = isRecord(part.output) ? part.output : undefined;
          shown.push({ kind: SHOWN.RESULT, callId: part.toolCallId, output: output?.value });
          break;
        }
        default:
          throw new Error(`unexpected part ${String(part.type)}`);
      }
    }
  }
  return shown;
}

test("the same turn produces equivalent model input from both engines", async () => {
  const responses = new ResponsesContextEngine(RUNTIME);
  responses.bootstrap(undefined, LOST_RESULT);
  responses.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: TURN.ASK });
  responses.ingest({
    kind: CONTEXT_INPUT_KIND.MODEL_OUTPUT,
    items: [reasoningItem(TURN.REASONING_BEFORE_CALL), functionCallItem()],
  });
  responses.ingest({
    kind: CONTEXT_INPUT_KIND.TOOL_RESULT,
    callId: TURN.CALL_ID,
    outputJson: JSON.stringify(TURN.OUTPUT),
  });
  responses.ingest({
    kind: CONTEXT_INPUT_KIND.MODEL_OUTPUT,
    items: [reasoningItem(TURN.REASONING_BEFORE_REPLY), assistantMessageItem(TURN.REPLY)],
  });
  const { context, bootstrap } = await bootstrapped([ASK_ROW, REPLY_ROW]);
  assert.deepEqual(bootstrap, { loaded: true, repaired: 0 });

  const ephemeral = [TURN.EPHEMERAL];
  const fromCheckpoint = shownByResponses(responses.assemble({ ephemeral }));
  const fromRows = shownByModelMessages(await context.assemble({ ephemeral }));

  assert.deepEqual(fromRows, fromCheckpoint);
  assert.deepEqual(
    fromRows.map((item) => item.kind),
    [
      SHOWN.USER,
      SHOWN.REASONING,
      SHOWN.CALL,
      SHOWN.RESULT,
      SHOWN.REASONING,
      SHOWN.ASSISTANT,
      SHOWN.USER,
    ],
  );
  assert.deepEqual(fromRows[1], {
    kind: SHOWN.REASONING,
    itemId: TURN.REASONING_BEFORE_CALL.itemId,
    encrypted: TURN.REASONING_BEFORE_CALL.encrypted,
    summary: TURN.REASONING_BEFORE_CALL.summary,
  });
  assert.deepEqual(fromRows[3], { kind: SHOWN.RESULT, callId: TURN.CALL_ID, output: TURN.OUTPUT });
  // The ephemeral text rides last and is kept by neither engine.
  assert.equal(context.checkpoint().items.length, 2);
  assert.equal(responses.checkpoint().items.length, 6);
});

function isAssistant(message: ModelMessage): message is AssistantModelMessage {
  return message.role === MODEL_MESSAGE_ROLE.ASSISTANT;
}

function isTool(message: ModelMessage): message is ToolModelMessage {
  return message.role === MODEL_MESSAGE_ROLE.TOOL;
}

function assistantParts(message: AssistantModelMessage) {
  return Array.isArray(message.content)
    ? message.content
    : [{ type: MODEL_PART.TEXT, text: message.content }];
}

function resultParts(message: ToolModelMessage) {
  return message.content.flatMap((part) => (part.type === MODEL_PART.TOOL_RESULT ? [part] : []));
}

/** The provider options a model part carries, on the parts that can carry any. */
function optionsOf(part: ModelPart) {
  return "providerOptions" in part ? part.providerOptions : undefined;
}

/** For every assistant message with calls, the call ids it makes and the result ids the next message answers. */
function callsAndAnswers(messages: readonly ModelMessage[]) {
  const pairs: { calls: string[]; answers: string[] | undefined }[] = [];
  for (const [index, message] of messages.entries()) {
    if (!isAssistant(message)) continue;
    const calls = assistantParts(message).flatMap((part) =>
      part.type === MODEL_PART.TOOL_CALL ? [part.toolCallId] : [],
    );
    if (calls.length === 0) continue;
    const next = messages[index + 1];
    pairs.push({
      calls,
      answers: next && isTool(next) ? resultParts(next).map((part) => part.toolCallId) : undefined,
    });
  }
  return pairs;
}

/** What follows each reasoning part inside its own assistant message: the part type, or nothing at the end. */
function followersOfReasoning(messages: readonly ModelMessage[]) {
  const followers: (string | undefined)[] = [];
  for (const message of messages) {
    if (!isAssistant(message)) continue;
    const parts = assistantParts(message);
    for (const [index, part] of parts.entries()) {
      if (part.type === MODEL_PART.REASONING) followers.push(parts[index + 1]?.type);
    }
  }
  return followers;
}

function reasoningReplay(messages: readonly ModelMessage[]) {
  return messages.flatMap((message) =>
    isAssistant(message)
      ? assistantParts(message).flatMap((part) =>
          part.type === MODEL_PART.REASONING ? [part.providerOptions] : [],
        )
      : [],
  );
}

test("a reasoning part is never split from its call, and a call is never parted from its result", async () => {
  const messages = await modelInputFrom([ASK_ROW, REPLY_ROW], OPTIONS);
  assert.deepEqual(callsAndAnswers(messages), [{ calls: [TURN.CALL_ID], answers: [TURN.CALL_ID] }]);
  assert.deepEqual(followersOfReasoning(messages), [MODEL_PART.TOOL_CALL, MODEL_PART.TEXT]);
  assert.deepEqual(reasoningReplay(messages), [
    openAiReplay(TURN.REASONING_BEFORE_CALL),
    openAiReplay(TURN.REASONING_BEFORE_REPLY),
  ]);
});

test("a provider or model change drops every replay item whole and keeps the words, the call, and its result", async () => {
  for (const replay of [
    { provider: PROVIDER, model: "gpt-5.5" },
    { provider: "anthropic", model: MODEL },
  ]) {
    const messages = await modelInputFrom([ASK_ROW, REPLY_ROW], { ...OPTIONS, replay });
    assert.deepEqual(reasoningReplay(messages), [undefined, undefined]);
    assert.deepEqual(followersOfReasoning(messages), [MODEL_PART.TOOL_CALL, MODEL_PART.TEXT]);
    assert.deepEqual(callsAndAnswers(messages), [
      { calls: [TURN.CALL_ID], answers: [TURN.CALL_ID] },
    ]);
    const summaries = messages.flatMap((message) =>
      isAssistant(message)
        ? assistantParts(message).flatMap((part) =>
            part.type === MODEL_PART.REASONING ? [part.text] : [],
          )
        : [],
    );
    assert.deepEqual(summaries, [
      TURN.REASONING_BEFORE_CALL.summary,
      TURN.REASONING_BEFORE_REPLY.summary,
    ]);
  }
});

test("a row whose turn recorded no model proves nothing current, and replays nothing", async () => {
  const unattributed = assistantRow(REPLY_ROW.message.id, replyParts());
  const messages = await modelInputFrom([ASK_ROW, unattributed], OPTIONS);
  assert.deepEqual(reasoningReplay(messages), [undefined, undefined]);
});

test("replay metadata travels whole when it may travel at all, on reasoning, text, and the call alike", async () => {
  const twoProviders: ProviderMetadata = {
    ...openAiReplay(TURN.REASONING_BEFORE_CALL),
    other: { trace: "kept beside it" },
  };
  const callReplay: ProviderMetadata = { [PROVIDER]: { itemId: "fc_9a0b4c2d" } };
  const textReplay: ProviderMetadata = { [PROVIDER]: { itemId: "msg_8e3f0a1b" } };
  const parts: StoredPart[] = [
    { type: "step-start" },
    {
      type: "reasoning",
      text: TURN.REASONING_BEFORE_CALL.summary,
      state: "done",
      providerMetadata: twoProviders,
    },
    toolPart(TOOL_PART_STATE.OUTPUT_AVAILABLE, { callProviderMetadata: callReplay }),
    { type: "step-start" },
    { type: "text", text: TURN.REPLY, state: "done", providerMetadata: textReplay },
  ];
  const row = assistantRow("m2", parts, MODEL);
  const replayed = await modelInputFrom([ASK_ROW, row], OPTIONS);
  const partOptions = (messages: readonly ModelMessage[]) =>
    messages.flatMap((message) =>
      isAssistant(message)
        ? assistantParts(message).map((part) => [part.type, optionsOf(part)])
        : isTool(message)
          ? resultParts(message).map((part) => [part.type, optionsOf(part)])
          : [],
    );
  assert.deepEqual(partOptions(replayed), [
    [MODEL_PART.REASONING, twoProviders],
    [MODEL_PART.TOOL_CALL, callReplay],
    [MODEL_PART.TOOL_RESULT, callReplay],
    [MODEL_PART.TEXT, textReplay],
  ]);
  const dropped = await modelInputFrom([ASK_ROW, row], {
    ...OPTIONS,
    replay: { provider: PROVIDER, model: "gpt-5.5" },
  });
  assert.deepEqual(partOptions(dropped), [
    [MODEL_PART.REASONING, undefined],
    [MODEL_PART.TOOL_CALL, undefined],
    [MODEL_PART.TOOL_RESULT, undefined],
    [MODEL_PART.TEXT, undefined],
  ]);
});

const SUMMARY =
  "Earlier the developer asked about the fixture session twice; nothing was sent to it.";

/** Nine rows: three exchanges, a compaction keeping the second's reply on, then one more exchange. */
function compactedRows(firstKept = "m4"): ContextRow[] {
  return [
    userRow("m1", "one"),
    assistantRow("m2", [{ type: "text", text: "first reply" }], MODEL),
    userRow("m3", "two"),
    assistantRow("m4", [{ type: "text", text: "second reply" }], MODEL),
    userRow("m5", "three"),
    assistantRow("m6", [{ type: "text", text: "third reply" }], MODEL),
    compactionRow("m7", SUMMARY, firstKept),
    userRow("m8", "four"),
    assistantRow("m9", [{ type: "text", text: "fourth reply" }], MODEL),
  ];
}

const ids = (rows: readonly ContextRow[]) => rows.map((row) => row.message.id);

test("the derivation is the latest compaction first, then every row from the one it named as first kept", async () => {
  assert.deepEqual(ids(rowsSinceCompaction(compactedRows())), ["m7", "m4", "m5", "m6", "m8", "m9"]);
  assert.deepEqual(ids(rowsSinceCompaction(compactedRows("m8"))), ["m7", "m8", "m9"]);
  assert.deepEqual(ids(rowsSinceCompaction(compactedRows("not-held"))), ["m7", "m8", "m9"]);
  const uncompacted = compactedRows().filter((row) => row.message.id !== "m7");
  assert.deepEqual(ids(rowsSinceCompaction(uncompacted)), ids(uncompacted));
  const twice = [...compactedRows(), compactionRow("m10", SUMMARY, "m9"), userRow("m11", "five")];
  assert.deepEqual(ids(rowsSinceCompaction(twice)), ["m10", "m9", "m11"]);
  // A later compaction may keep an earlier one in its tail; the later one still cuts.
  const nested = [...compactedRows(), compactionRow("m10", SUMMARY, "m6"), userRow("m11", "five")];
  assert.deepEqual(ids(rowsSinceCompaction(nested)), ["m10", "m6", "m7", "m8", "m9", "m11"]);
  assert.deepEqual(ids(retainedRows(nested)), ["m6", "m7", "m8", "m9", "m10", "m11"]);
  assert.deepEqual(
    ids(rowsSinceCompaction(retainedRows(nested))),
    ids(rowsSinceCompaction(nested)),
  );

  const messages = await modelInputFrom(compactedRows(), OPTIONS);
  assert.equal(messages.length, 6);
  const first = messages[0];
  assert.ok(first && isAssistant(first));
  assert.deepEqual(assistantParts(first), [{ type: MODEL_PART.TEXT, text: SUMMARY }]);
});

test("compact drops the rows the derivation no longer reads, keeps the rest in written order, and cuts the same way again", async () => {
  const rows = [...compactedRows(), compactionRow("m10", SUMMARY, "m6"), userRow("m11", "five")];
  const { context } = await bootstrapped(rows);
  const before = shownByModelMessages(await context.assemble({ ephemeral: [] }));
  assert.equal(context.compact(), 5);
  const retained = context
    .checkpoint()
    .items.map((item) => (isRecord(item.message) ? item.message.id : undefined));
  assert.deepEqual(retained, ["m6", "m7", "m8", "m9", "m10", "m11"]);
  assert.deepEqual(shownByModelMessages(await context.assemble({ ephemeral: [] })), before);
  assert.equal(context.compact(), 0);
});

test("a call left unanswered is shown to the model as an answer whose envelope says unknown, the same from both engines", async () => {
  const responses = new ResponsesContextEngine(RUNTIME);
  responses.bootstrap(undefined, LOST_RESULT);
  responses.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: TURN.ASK });
  responses.ingest({
    kind: CONTEXT_INPUT_KIND.MODEL_OUTPUT,
    items: [reasoningItem(TURN.REASONING_BEFORE_CALL), functionCallItem()],
  });
  const resumed = new ResponsesContextEngine(RUNTIME);
  resumed.bootstrap(responses.checkpoint(), LOST_RESULT);
  const interrupted = assistantRow(
    "m2",
    replyParts(TOOL_PART_STATE.INPUT_AVAILABLE).slice(0, PARTS_THROUGH_CALL),
    MODEL,
  );
  const { context, bootstrap } = await bootstrapped([ASK_ROW, interrupted]);
  assert.deepEqual(bootstrap, { loaded: true, repaired: 1 });

  const fromCheckpoint = shownByResponses(resumed.assemble({ ephemeral: [] }));
  const fromRows = shownByModelMessages(await context.assemble({ ephemeral: [] }));
  assert.deepEqual(fromRows, fromCheckpoint);
  assert.deepEqual(
    fromRows.map((item) => item.kind),
    [SHOWN.USER, SHOWN.REASONING, SHOWN.CALL, SHOWN.RESULT],
  );
  assert.deepEqual(fromRows[3], { kind: SHOWN.RESULT, callId: TURN.CALL_ID, output: LOST_RESULT });
});

test("a call the record left unanswered is answered with the lost result, and the record is not rewritten", async () => {
  for (const [state, extra] of [
    [TOOL_PART_STATE.INPUT_AVAILABLE, {}],
    [TOOL_PART_STATE.INPUT_STREAMING, {}],
    [TOOL_PART_STATE.OUTPUT_AVAILABLE, { preliminary: true }],
  ] as const) {
    const row = assistantRow("m2", replyParts(state, extra), MODEL);
    const { context, bootstrap } = await bootstrapped([ASK_ROW, row]);
    assert.deepEqual(bootstrap, { loaded: true, repaired: 1 });
    const messages = await modelInputFrom([ASK_ROW, row], OPTIONS);
    assert.deepEqual(callsAndAnswers(messages), [
      { calls: [TURN.CALL_ID], answers: [TURN.CALL_ID] },
    ]);
    const answered = messages.find(isTool);
    assert.deepEqual(answered ? resultParts(answered).map((part) => part.output) : [], [
      { type: MODEL_RESULT_OUTPUT.JSON, value: LOST_RESULT },
    ]);
    const kept = context.checkpoint().items[1];
    const parts = kept && isRecord(kept.message) ? kept.message.parts : undefined;
    assert.ok(Array.isArray(parts));
    const storedPart = parts[2];
    assert.ok(isRecord(storedPart));
    assert.equal(storedPart.state, state);
  }
});

test("the stamp joins the runtime and the row format, and an empty checkpoint loads as nothing", async () => {
  const context = engine();
  assert.equal(checkpointFormatTag(context.checkpointFormat), "tool-loop@1:ai-ui-message/1");
  assert.deepEqual(await context.bootstrap(undefined, LOST_RESULT), { loaded: true, repaired: 0 });
  assert.deepEqual(await context.assemble({ ephemeral: [] }), []);
  assert.deepEqual(context.checkpoint().items, []);
});

test("a checkpoint of another stamp, or rows the vocabulary refuses, loads nothing and says why", async () => {
  const context = engine();
  const items = itemsOf([ASK_ROW, REPLY_ROW]);
  for (const format of [
    { ...context.checkpointFormat, runtime: "other-runtime" },
    { ...context.checkpointFormat, formatVersion: 2 },
  ]) {
    const result = await context.bootstrap({ format, items }, LOST_RESULT);
    assert.equal(result.loaded, false);
    assert.equal(result.repaired, 0);
    assert.deepEqual(context.checkpoint().items, []);
  }
  const unregistered = assistantRow(
    "m2",
    [
      {
        type: "tool-someone_elses_tool",
        toolCallId: "c",
        state: "output-available",
        input: {},
        output: {},
      },
    ],
    MODEL,
  );
  const refused = await context.bootstrap(
    checkpointOf(context, [ASK_ROW, unregistered]),
    LOST_RESULT,
  );
  assert.equal(refused.loaded, false);
  assert.deepEqual(context.checkpoint().items, []);
});

test("rows are read back field by field, and a refusal names the item and the field", async () => {
  const read = await readContextRows(itemsOf([ASK_ROW, REPLY_ROW]), TOOLS);
  assert.deepEqual(read, { ok: true, value: [ASK_ROW, REPLY_ROW] });
  const refusals = await Promise.all([
    readContextRows([{ model: MODEL }], TOOLS),
    readContextRows([{ message: toWire(ASK_ROW.message), model: 3 }], TOOLS),
    readContextRows([{ message: toWire(ASK_ROW.message), model: "" }], TOOLS),
    readContextRows(
      [
        { message: toWire(ASK_ROW.message) },
        { message: { ...toWire(REPLY_ROW.message), metadata: {} } },
      ],
      TOOLS,
    ),
  ]);
  assert.deepEqual(refusals, [
    { ok: false, refusal: SCHEMA_REFUSAL.MALFORMED, path: [0, "message"] },
    { ok: false, refusal: SCHEMA_REFUSAL.MALFORMED, path: [0, "model"] },
    { ok: false, refusal: SCHEMA_REFUSAL.MALFORMED, path: [0, "model"] },
    { ok: false, refusal: SCHEMA_REFUSAL.MALFORMED, path: [1, "message", "metadata", "author"] },
  ]);
});

test("the engine writes no row: the loop's inputs and adopted items are refused, not dropped", async () => {
  const { context } = await bootstrapped([ASK_ROW]);
  const seam: ContextEngine = context;
  assert.throws(() => seam.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "late words" }), {
    message: UI_MESSAGE_ENGINE_REFUSAL.INGEST,
  });
  assert.throws(() => seam.adopt([]), {
    message: UI_MESSAGE_ENGINE_REFUSAL.ADOPT,
  });
  assert.equal(seam.foldBehindSummary, undefined);
  assert.equal(context.checkpoint().items.length, 1);
});

test("a mark rolls the rows back, a foreign mark is refused, and dispose empties them", async () => {
  const { context } = await bootstrapped(compactedRows());
  const mark = context.mark();
  assert.equal(context.compact(), 3);
  context.rollback(mark);
  assert.equal(context.checkpoint().items.length, 9);
  assert.throws(() => context.rollback({ items: [...mark.items] }), {
    message: UI_MESSAGE_ENGINE_REFUSAL.FOREIGN_MARK,
  });
  context.dispose();
  assert.deepEqual(context.checkpoint().items, []);
});
