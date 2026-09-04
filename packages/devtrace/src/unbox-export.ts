/**
 * Converts a recorded trace into the gateway document unbox-ai reads
 * (https://github.com/tester-army/unbox-ai): `{events[]}` of generation
 * entries, each carrying the model, its metrics, the tools it could call,
 * and a cumulative snapshot of the conversation at that generation.
 *
 * The realtime wire is an event stream rather than request/response, so the
 * conversion replays it: session updates stand the instructions and tools,
 * created items and transcriptions grow the conversation, and each
 * `response.done` becomes one generation whose snapshot is everything said up
 * to and including it. Every reader here is defensive — the stream is what a
 * service actually sent, not what this build expects — so one odd event costs
 * itself, never the export.
 */

import { brainToolDefinitions } from "@sidecar/brain";
import { REALTIME_CLIENT_EVENT, REALTIME_SERVER_EVENT } from "@sidecar/realtime";
import {
  isRecord,
  recordFromJsonLine,
  text,
  unparsedWire,
  type WireRecord,
  type WireValue,
  wholeNumber,
  wireRecord,
} from "@sidecar/wire";
import { TRACE_ENTRY_KIND } from "./trace-writer.js";
import { TRACE_DIRECTION } from "./vocabulary.js";

export interface UnboxExportOptions {
  /** Names the trace in the viewer, defaulting to a fixed label. */
  name?: string;
}

const DEFAULT_TRACE_NAME = "luke-agent-trace";
const UNKNOWN_MODEL = "gpt-realtime";
const BRAIN_GENERATION_NAME = "brain-turn";
/**
 * A hosted brain turn records no model, because the service's build owns that
 * choice and the desktop never learns it; the export shows the keyed default
 * rather than a blank, since the viewer requires a model on every generation.
 */
const UNKNOWN_BRAIN_MODEL = "gpt-5.6-terra";
const BRAIN_DIGEST_GENERATION_NAME = "brain-digest";
/** The same stand-in for a digest a hosted client wrote, whose model the desktop never learns. */
const UNKNOWN_DIGEST_MODEL = "gpt-5.6-luna";

function recordItems(value: WireValue | undefined): readonly WireRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** The words inside a content list, whichever of the wire's text fields carries them. */
function contentText(content: WireValue | undefined): string {
  return recordItems(content)
    .map((part) => text(part.text) ?? text(part.transcript) ?? "")
    .filter((part) => part.length > 0)
    .join("\n");
}

function toolDefinitions(tools: WireValue | undefined): readonly WireRecord[] {
  return recordItems(tools).map((tool) => ({
    type: text(tool.type) ?? "function",
    name: text(tool.name) ?? "",
    ...(text(tool.description) ? { description: text(tool.description) ?? "" } : undefined),
    ...(isRecord(tool.parameters) ? { inputSchema: tool.parameters } : undefined),
  }));
}

interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number | undefined;
}

function tokenCounts(usage: WireRecord | undefined): TokenCounts {
  return {
    input: wholeNumber(usage?.input_tokens) ?? 0,
    output: wholeNumber(usage?.output_tokens) ?? 0,
    cacheRead: wholeNumber(wireRecord(usage?.input_token_details)?.cached_tokens),
  };
}

interface ExportState {
  instructions: string | undefined;
  tools: readonly WireRecord[];
  model: string;
  messages: WireRecord[];
  events: WireRecord[];
  totalInput: number;
  totalOutput: number;
  /** When the reply now owed was asked for, for the generation's latency. */
  responseAskedAtMs: number | undefined;
  firstAt: string | undefined;
}

function conversationSnapshot(state: ExportState): WireRecord[] {
  return [
    ...(state.instructions !== undefined ? [{ role: "system", content: state.instructions }] : []),
    ...state.messages,
  ];
}

function applySessionUpdate(state: ExportState, event: WireRecord): void {
  const session = wireRecord(event.session);
  if (!session) return;
  state.instructions = text(session.instructions) ?? state.instructions;
  state.model = text(session.model) ?? state.model;
  if (Array.isArray(session.tools)) state.tools = toolDefinitions(session.tools);
}

function applyItemCreate(state: ExportState, event: WireRecord): void {
  const item = wireRecord(event.item);
  if (!item) return;
  if (item.type === "message") {
    const content = contentText(item.content);
    if (content.length > 0) {
      state.messages.push({ role: text(item.role) ?? "user", content });
    }
    return;
  }
  if (item.type === "function_call_output") {
    state.messages.push({
      role: "tool",
      content: text(item.output) ?? "",
      ...(text(item.call_id) ? { tool_call_id: text(item.call_id) ?? "" } : undefined),
    });
  }
}

/** The reply's own produce, as the messages the snapshot appends. */
function responseMessages(output: readonly WireRecord[]): readonly WireRecord[] {
  return output.flatMap((item) => {
    if (item.type === "message") {
      const content = contentText(item.content);
      return content.length > 0 ? [{ role: text(item.role) ?? "assistant", content }] : [];
    }
    if (item.type === "function_call") {
      return [
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              type: "function",
              id: text(item.call_id) ?? "",
              function: { name: text(item.name) ?? "", arguments: text(item.arguments) ?? "" },
            },
          ],
        },
      ];
    }
    return [];
  });
}

function applyResponseDone(state: ExportState, event: WireRecord, atMs: number | undefined): void {
  const response = wireRecord(event.response);
  const produced = responseMessages(recordItems(response?.output));
  const tokens = tokenCounts(wireRecord(response?.usage));
  const latencyMs =
    atMs !== undefined && state.responseAskedAtMs !== undefined && atMs >= state.responseAskedAtMs
      ? atMs - state.responseAskedAtMs
      : 0;
  // The reply's own produce joins the conversation first, so the snapshot
  // below is simply the conversation as it stands after this generation.
  state.messages.push(...produced);
  state.events.push({
    type: "generation",
    name: text(response?.id) ?? "reply",
    model: state.model,
    provider: "openai",
    metrics: {
      // The viewer reads latency in seconds; the trace stamps milliseconds.
      latency: latencyMs / 1_000,
      tokens: {
        input: tokens.input,
        output: tokens.output,
        ...(tokens.cacheRead !== undefined ? { cache_read: tokens.cacheRead } : undefined),
      },
      cost: 0,
    },
    available_tools: state.tools,
    messages: conversationSnapshot(state),
  });
  state.totalInput += tokens.input;
  state.totalOutput += tokens.output;
  state.responseAskedAtMs = undefined;
}

function applyWireEntry(state: ExportState, entry: WireRecord, atMs: number | undefined): void {
  const event = wireRecord(entry.event);
  if (!event) return;
  if (entry.direction === TRACE_DIRECTION.CLIENT) {
    switch (event.type) {
      case REALTIME_CLIENT_EVENT.SESSION_UPDATE:
        applySessionUpdate(state, event);
        return;
      case REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE:
        applyItemCreate(state, event);
        return;
      case REALTIME_CLIENT_EVENT.RESPONSE_CREATE:
        state.responseAskedAtMs = atMs;
        return;
      default:
        return;
    }
  }
  switch (event.type) {
    case REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_COMPLETED: {
      const transcript = text(event.transcript);
      if (transcript) state.messages.push({ role: "user", content: transcript });
      return;
    }
    case REALTIME_SERVER_EVENT.RESPONSE_DONE:
      applyResponseDone(state, event, atMs);
      return;
    default:
      return;
  }
}

/**
 * The brain's own tool definitions, in the viewer's shape. They are already
 * the Responses API's function-tool form, the same one a realtime session
 * update carries, so the JSON round trip lets the wire reader above render
 * them the way it renders the session's.
 */
function brainAvailableTools(): readonly WireRecord[] {
  return toolDefinitions(unparsedWire(JSON.parse(JSON.stringify(brainToolDefinitions()))));
}

/**
 * The turn's input as the trace kept it: what woke it, the kinds of items it
 * carried, and how many transcript bytes it read. The items' text was never
 * recorded, so none is shown.
 */
function brainInputText(entry: WireRecord): string {
  const itemKinds = Array.isArray(entry.inputItemKinds)
    ? entry.inputItemKinds.map((kind) => text(kind)).filter((kind) => kind !== undefined)
    : [];
  return [
    `trigger: ${text(entry.trigger) ?? "unknown"}`,
    `input items: ${itemKinds.length > 0 ? itemKinds.join(", ") : "none"}`,
    `transcript bytes: ${wholeNumber(entry.transcriptBytes) ?? 0}`,
  ].join("\n");
}

/**
 * The turn's produce: the text it ended on, one line per tool call with how
 * the act came out, and one line per briefing it handed the mouth, as counts.
 * A turn that ended in an error shows the error where its text would be.
 */
function brainOutputText(entry: WireRecord): string {
  const toolCalls = recordItems(entry.toolCalls).map(
    (call) =>
      `tool call: ${text(call.name) ?? "unknown"} -> ${text(call.outcomeStatus) ?? "unknown"}`,
  );
  const deliveries = recordItems(entry.deliveries).map(
    (delivery) => `delivery: ${wholeNumber(delivery.briefingChars) ?? 0} chars`,
  );
  const outputText = text(entry.outputText);
  const error = text(entry.error);
  const lines = [
    ...(outputText ? [outputText] : []),
    ...toolCalls,
    ...deliveries,
    ...(error ? [`error: ${error}`] : []),
  ];
  return lines.length > 0 ? lines.join("\n") : "no output";
}

function applyBrainEntry(state: ExportState, entry: WireRecord): void {
  const inputTokens = wholeNumber(entry.inputTokens) ?? 0;
  state.events.push({
    type: "generation",
    name: BRAIN_GENERATION_NAME,
    model: text(entry.model) ?? UNKNOWN_BRAIN_MODEL,
    provider: "openai",
    metrics: {
      // The viewer reads latency in seconds; the trace stamps milliseconds.
      latency: (wholeNumber(entry.elapsedMs) ?? 0) / 1_000,
      tokens: { input: inputTokens, output: 0 },
      cost: 0,
    },
    available_tools: brainAvailableTools(),
    messages: [
      { role: "user", content: brainInputText(entry) },
      { role: "assistant", content: brainOutputText(entry) },
    ],
  });
  state.totalInput += inputTokens;
}

/**
 * A digest as the trace kept it: the slice as a count and a cut flag on the
 * input side, and on the output side the outcome, the stop state, and the
 * form's size — never a word of the slice or the form, because neither was
 * recorded.
 */
function applyBrainDigestEntry(state: ExportState, entry: WireRecord): void {
  const stopState = text(entry.stopState);
  const digestChars = wholeNumber(entry.digestChars);
  const error = text(entry.error);
  const outputLines = [
    `outcome: ${text(entry.outcome) ?? "unknown"}`,
    ...(stopState ? [`stop state: ${stopState}`] : []),
    ...(digestChars !== undefined ? [`digest chars: ${digestChars}`] : []),
    ...(error ? [`error: ${error}`] : []),
  ];
  state.events.push({
    type: "generation",
    name: BRAIN_DIGEST_GENERATION_NAME,
    model: text(entry.model) ?? UNKNOWN_DIGEST_MODEL,
    provider: "openai",
    metrics: {
      latency: (wholeNumber(entry.elapsedMs) ?? 0) / 1_000,
      tokens: { input: 0, output: 0 },
      cost: 0,
    },
    available_tools: [],
    messages: [
      {
        role: "user",
        content: [
          `transcript chars: ${wholeNumber(entry.transcriptChars) ?? 0}`,
          `front cut: ${entry.truncated === true ? "yes" : "no"}`,
        ].join("\n"),
      },
      { role: "assistant", content: outputLines.join("\n") },
    ],
  });
}

/** Reads one trace, already split into lines, into unbox-ai's gateway document. */
export function unboxTraceFromLines(
  lines: readonly string[],
  options: UnboxExportOptions = {},
): WireRecord {
  const state: ExportState = {
    instructions: undefined,
    tools: [],
    model: UNKNOWN_MODEL,
    messages: [],
    events: [],
    totalInput: 0,
    totalOutput: 0,
    responseAskedAtMs: undefined,
    firstAt: undefined,
  };
  for (const line of lines) {
    const entry = recordFromJsonLine(line);
    if (!entry) continue;
    const at = text(entry.at);
    state.firstAt ??= at;
    const parsedAt = at !== undefined ? Date.parse(at) : Number.NaN;
    const atMs = Number.isFinite(parsedAt) ? parsedAt : undefined;
    if (entry.kind === TRACE_ENTRY_KIND.WIRE) applyWireEntry(state, entry, atMs);
    // A brain-request entry is the raw JSONL's own record of one model call;
    // the turn entry already stands for it in the viewer.
    if (entry.kind === TRACE_ENTRY_KIND.BRAIN) applyBrainEntry(state, entry);
    if (entry.kind === TRACE_ENTRY_KIND.BRAIN_DIGEST) applyBrainDigestEntry(state, entry);
  }
  const name = options.name ?? DEFAULT_TRACE_NAME;
  return {
    trace_id: name,
    timestamp: state.firstAt ?? "",
    name,
    total_tokens: { input: state.totalInput, output: state.totalOutput },
    total_cost: 0,
    events: state.events,
  };
}
