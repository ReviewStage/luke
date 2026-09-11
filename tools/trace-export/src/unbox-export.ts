/**
 * Converts a recorded trace into the gateway document unbox-ai reads
 * (https://github.com/tester-army/unbox-ai): `{events[]}` of generation
 * entries, each carrying the model, its metrics, the tools it could call,
 * and a cumulative snapshot of the conversation at that generation.
 *
 * The live wire is an event stream rather than request/response, so the
 * conversion replays it: both speakers' transcript deltas are grouped into
 * utterances by the same ledger the app keeps, the trusted side's appends
 * join the conversation as text (commentary as the assistant's, instructions
 * and thinking as the developer's), and each delegation is a boundary — the
 * exchange it closes becomes one generation whose snapshot is everything said
 * up to it, and the session's close settles the last. Every reader here is
 * defensive — the stream is what a service actually sent, not what this build
 * expects — so one odd event costs itself, never the export.
 */

import { hostedBrainToolCatalog } from "@sidecar/brain";
import { TRACE_DIRECTION, TRACE_ENTRY_KIND, TRACE_LIVE_EVENT } from "@sidecar/devtrace/vocabulary";
import {
  LIVE_DEFAULTS,
  TRANSCRIPT_SPEAKER,
  TranscriptLedger,
  type TranscriptSpeaker,
} from "@sidecar/live";
import {
  isRecord,
  isWireNumber,
  isWireString,
  recordFromJsonLine,
  text,
  unparsedWire,
  type WireRecord,
  type WireValue,
  wholeNumber,
  wireRecord,
} from "@sidecar/wire";

export interface UnboxExportOptions {
  /** Names the trace in the viewer, defaulting to a fixed label. */
  name?: string;
}

const DEFAULT_TRACE_NAME = "luke-agent-trace";

/** The exchange before any delegation has no id of its own; a segment that closes with the session is named for it. */
const SESSION_GENERATION_NAME = "session";
const BRAIN_GENERATION_NAME = "brain-turn";
/**
 * A hosted brain turn records no model, because the service's build owns that
 * choice and the desktop never learns it; the export shows the keyed default
 * rather than a blank, since the viewer requires a model on every generation.
 */
const UNKNOWN_BRAIN_MODEL = "gpt-5.6-terra";

const MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
  DEVELOPER: "developer",
  TOOL: "tool",
} as const;

const SPEAKER_ROLE = {
  [TRANSCRIPT_SPEAKER.USER]: MESSAGE_ROLE.USER,
  [TRANSCRIPT_SPEAKER.ASSISTANT]: MESSAGE_ROLE.ASSISTANT,
} as const satisfies Record<TranscriptSpeaker, string>;

/** Which speaker each caption event transcribes. */
const TRANSCRIPT_EVENT_SPEAKER = {
  [TRACE_LIVE_EVENT.INPUT_TRANSCRIPT_DELTA]: TRANSCRIPT_SPEAKER.USER,
  [TRACE_LIVE_EVENT.OUTPUT_TRANSCRIPT_DELTA]: TRANSCRIPT_SPEAKER.ASSISTANT,
} as const;

/** Which role each trusted-side append reads back as. */
const APPEND_ROLE = {
  [TRACE_LIVE_EVENT.COMMENTARY_APPEND]: MESSAGE_ROLE.ASSISTANT,
  [TRACE_LIVE_EVENT.INSTRUCTIONS_APPEND]: MESSAGE_ROLE.DEVELOPER,
  [TRACE_LIVE_EVENT.THINKING_APPEND]: MESSAGE_ROLE.DEVELOPER,
} as const;

function recordItems(value: WireValue | undefined): readonly WireRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function toolDefinitions(tools: WireValue | undefined): readonly WireRecord[] {
  return recordItems(tools).map((tool) => ({
    type: text(tool.type) ?? "function",
    name: text(tool.name) ?? "",
    ...(text(tool.description) ? { description: text(tool.description) ?? "" } : undefined),
    ...(isRecord(tool.parameters) ? { inputSchema: tool.parameters } : undefined),
  }));
}

/** Utterances sort ahead of appends placed at the same instant, since the append answered what was said. */
const PLACEMENT_RANK = {
  UTTERANCE: 0,
  APPEND: 1,
} as const;

/**
 * One message on the session timeline. An utterance sits where its speech
 * started; an append sits where the transcript stood when it was sent, since
 * a client event carries no session time of its own and the acknowledgment
 * that would is the sideband's, so the ledger's last instant is the honest
 * place for it.
 */
interface PlacedMessage {
  atMs: number;
  rank: (typeof PLACEMENT_RANK)[keyof typeof PLACEMENT_RANK];
  order: number;
  message: WireRecord;
}

/** One session's conversation as it grows: the ledger both captions feed and the appends beside it. */
interface LiveSession {
  ledger: TranscriptLedger;
  appends: PlacedMessage[];
  /** Cumulative seconds as the session last reported them, folded into the total at its close. */
  seconds: number;
}

/** The exchange a delegation opened, closed by the next delegation or by the session. */
interface OpenSegment {
  name: string;
  delegatedAtMs: number | undefined;
  firstCommentaryAtMs: number | undefined;
  /**
   * The conversation as it stood when the segment opened, serialized, so an
   * exchange that changed nothing draws no generation while one that only
   * lengthened an earlier utterance with a late fragment still does.
   */
  snapshotAtOpen: string;
}

interface ExportState {
  model: string;
  tools: readonly WireRecord[];
  /** Messages of sessions already closed, frozen ahead of the current one. */
  settled: WireRecord[];
  session: LiveSession;
  segment: OpenSegment;
  events: WireRecord[];
  totalInput: number;
  sessionSeconds: number;
  firstAt: string | undefined;
}

function newSession(): LiveSession {
  return { ledger: new TranscriptLedger(), appends: [], seconds: 0 };
}

function openSegment(
  name: string,
  delegatedAtMs: number | undefined,
  snapshotAtOpen: string,
): OpenSegment {
  return { name, delegatedAtMs, firstCommentaryAtMs: undefined, snapshotAtOpen };
}

/** The current session's conversation in session order. */
function sessionMessages(session: LiveSession): readonly WireRecord[] {
  const utterances = session.ledger.utterances().map(
    (utterance, order): PlacedMessage => ({
      atMs: utterance.startMs,
      rank: PLACEMENT_RANK.UTTERANCE,
      order,
      message: { role: SPEAKER_ROLE[utterance.speaker], content: utterance.text },
    }),
  );
  return [...utterances, ...session.appends]
    .sort(
      (left, right) => left.atMs - right.atMs || left.rank - right.rank || left.order - right.order,
    )
    .map((placed) => placed.message);
}

function conversationSnapshot(state: ExportState): readonly WireRecord[] {
  return [...state.settled, ...sessionMessages(state.session)];
}

/**
 * Ends the exchange under way as one generation, unless nothing was said in
 * it, and opens the plain session segment after it; a delegation that follows
 * names its own.
 */
function closeSegment(state: ExportState): void {
  const messages = conversationSnapshot(state);
  const snapshot = JSON.stringify(messages);
  const segment = state.segment;
  state.segment = openSegment(SESSION_GENERATION_NAME, undefined, snapshot);
  if (snapshot === segment.snapshotAtOpen) return;
  const latencyMs =
    segment.delegatedAtMs !== undefined &&
    segment.firstCommentaryAtMs !== undefined &&
    segment.firstCommentaryAtMs >= segment.delegatedAtMs
      ? segment.firstCommentaryAtMs - segment.delegatedAtMs
      : 0;
  state.events.push({
    type: "generation",
    name: segment.name,
    model: state.model,
    provider: "openai",
    metrics: {
      // The viewer reads latency in seconds; the trace stamps milliseconds.
      latency: latencyMs / 1_000,
      tokens: { input: 0, output: 0 },
      cost: 0,
    },
    available_tools: state.tools,
    messages,
  });
}

function foldSession(state: ExportState): void {
  closeSegment(state);
  state.settled.push(...sessionMessages(state.session));
  state.sessionSeconds += state.session.seconds;
  state.session = newSession();
}

/** A session starting over one that never closed — a connection lost — settles the earlier one first. */
function applySessionStarted(state: ExportState, event: WireRecord): void {
  foldSession(state);
  const session = wireRecord(event.session);
  state.model = text(session?.model) ?? state.model;
}

function applyTranscriptDelta(
  state: ExportState,
  speaker: TranscriptSpeaker,
  event: WireRecord,
): void {
  // A delta is appended exactly as received: the space between two fragments
  // is a fragment's own trailing character, which a trimming reader would eat.
  const delta = event.delta;
  const startMs = wholeNumber(event.start_ms);
  const endMs = wholeNumber(event.end_ms);
  if (!isWireString(delta) || startMs === undefined || endMs === undefined) return;
  state.session.ledger.append({ speaker, text: delta, startMs, endMs });
}

function applyAppend(
  state: ExportState,
  role: (typeof APPEND_ROLE)[keyof typeof APPEND_ROLE],
  event: WireRecord,
  atMs: number | undefined,
): void {
  const content = text(event.content);
  if (content === undefined || content.length === 0) return;
  const session = state.session;
  session.appends.push({
    atMs: session.ledger.lastActivityMs() ?? 0,
    rank: PLACEMENT_RANK.APPEND,
    order: session.appends.length,
    message: { role, content },
  });
  if (role === MESSAGE_ROLE.ASSISTANT && state.segment.firstCommentaryAtMs === undefined) {
    state.segment.firstCommentaryAtMs = atMs;
  }
}

function applyDelegationCreated(state: ExportState, event: WireRecord, atMs: number | undefined) {
  closeSegment(state);
  const id = text(wireRecord(event.delegation)?.id);
  state.segment = openSegment(id ?? SESSION_GENERATION_NAME, atMs, state.segment.snapshotAtOpen);
}

function applyUsage(state: ExportState, event: WireRecord): void {
  const seconds = wireRecord(event.usage)?.seconds;
  if (isWireNumber(seconds) && seconds >= 0) state.session.seconds = seconds;
}

function applySessionClosed(state: ExportState, event: WireRecord): void {
  applyUsage(state, event);
  foldSession(state);
}

function applyWireEntry(state: ExportState, entry: WireRecord, atMs: number | undefined): void {
  const event = wireRecord(entry.event);
  if (!event) return;
  if (entry.direction === TRACE_DIRECTION.CLIENT) {
    switch (event.type) {
      case TRACE_LIVE_EVENT.COMMENTARY_APPEND:
      case TRACE_LIVE_EVENT.INSTRUCTIONS_APPEND:
      case TRACE_LIVE_EVENT.THINKING_APPEND:
        applyAppend(state, APPEND_ROLE[event.type], event, atMs);
        return;
      default:
        return;
    }
  }
  switch (event.type) {
    case TRACE_LIVE_EVENT.SESSION_STARTED:
      applySessionStarted(state, event);
      return;
    case TRACE_LIVE_EVENT.INPUT_TRANSCRIPT_DELTA:
    case TRACE_LIVE_EVENT.OUTPUT_TRANSCRIPT_DELTA:
      applyTranscriptDelta(state, TRANSCRIPT_EVENT_SPEAKER[event.type], event);
      return;
    case TRACE_LIVE_EVENT.DELEGATION_CREATED:
      applyDelegationCreated(state, event, atMs);
      return;
    case TRACE_LIVE_EVENT.USAGE_UPDATED:
      applyUsage(state, event);
      return;
    case TRACE_LIVE_EVENT.SESSION_CLOSED:
      applySessionClosed(state, event);
      return;
    default:
      return;
  }
}

/**
 * The tools the turn was offered, in the viewer's shape: the names the trace
 * recorded, each resolved against the catalog the build fixes. They are
 * already the Responses API's function-tool form, so the JSON round trip lets
 * the same reader render them. A name the catalog no longer holds is left
 * out rather than invented.
 */
function brainAvailableTools(entry: WireRecord): readonly WireRecord[] {
  const catalog = hostedBrainToolCatalog();
  const definitions = Array.isArray(entry.tools)
    ? entry.tools.flatMap((name) => {
        const tool = catalog.get(text(name) ?? "");
        return tool ? [tool] : [];
      })
    : [];
  return toolDefinitions(unparsedWire(JSON.parse(JSON.stringify(definitions))));
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
 * the action came out, and one line per briefing it handed the voice, as counts.
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
    available_tools: brainAvailableTools(entry),
    messages: [
      { role: MESSAGE_ROLE.USER, content: brainInputText(entry) },
      { role: MESSAGE_ROLE.ASSISTANT, content: brainOutputText(entry) },
    ],
  });
  state.totalInput += inputTokens;
}

/** Reads one trace, already split into lines, into unbox-ai's gateway document. */
export function unboxTraceFromLines(
  lines: readonly string[],
  options: UnboxExportOptions = {},
): WireRecord {
  const state: ExportState = {
    model: LIVE_DEFAULTS.MODEL,
    tools: [],
    settled: [],
    session: newSession(),
    segment: openSegment(SESSION_GENERATION_NAME, undefined, JSON.stringify([])),
    events: [],
    totalInput: 0,
    sessionSeconds: 0,
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
  }
  // A trace cut before the session closed still shows what was said in it.
  foldSession(state);
  const name = options.name ?? DEFAULT_TRACE_NAME;
  return {
    trace_id: name,
    timestamp: state.firstAt ?? "",
    name,
    total_tokens: { input: state.totalInput, output: 0 },
    total_cost: 0,
    session_seconds: state.sessionSeconds,
    events: state.events,
  };
}
