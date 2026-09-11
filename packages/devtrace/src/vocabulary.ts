/**
 * The wire vocabulary of the development trace: what one tapped event looks
 * like as it crosses from the renderer to the writer. It lives behind its own
 * door because the renderer and the bridge need exactly this and nothing that
 * touches a file — the writer stays behind the barrel, on the main process's
 * side of the sandbox.
 *
 * The trace is a development instrument, never a product surface: nothing here
 * decides anything, and everything recorded stays on this machine. What a
 * trace may record is a product decision, not an implementation detail.
 */

import { LIVE_CLIENT_EVENT, LIVE_SERVER_EVENT } from "@sidecar/live";
import { isRecord, isWireString, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";

/**
 * Which kind of record one line of the trace carries. It is vocabulary rather
 * than the writer's own detail because the exporter that reads a trace back
 * must name the same kinds without reaching the writer's file handling.
 */
export const TRACE_ENTRY_KIND = {
  WIRE: "wire",
  BRAIN: "brain",
  BRAIN_REQUEST: "brain-request",
  SPEECH: "speech",
} as const;

export const TRACE_DIRECTION = {
  CLIENT: "client",
  SERVER: "server",
} as const;

export type TraceDirection = (typeof TRACE_DIRECTION)[keyof typeof TRACE_DIRECTION];

const TRACE_DIRECTIONS: readonly string[] = Object.values(TRACE_DIRECTION);

/** One live event as the tap saw it cross the data channel. */
export interface AgentWireTrace {
  readonly direction: TraceDirection;
  readonly event: WireRecord;
}

function isTraceDirection(value: UnparsedWireValue): value is TraceDirection {
  return isWireString(value) && TRACE_DIRECTIONS.includes(value);
}

export function isAgentWireTrace(value: UnparsedWireValue): value is AgentWireTrace & WireRecord {
  return isRecord(value) && isTraceDirection(value.direction) && isRecord(value.event);
}

/**
 * The live events a trace reads back into a conversation. The exporter names
 * them from here rather than from the live package directly so the trace's
 * vocabulary is one list: the two captions, the three appends a trusted side
 * sends, the delegation that opens a backend turn, the usage snapshot, and
 * the two lifecycle events.
 */
export const TRACE_LIVE_EVENT = {
  SESSION_STARTED: LIVE_SERVER_EVENT.SESSION_STARTED,
  SESSION_CLOSED: LIVE_SERVER_EVENT.SESSION_CLOSED,
  INPUT_TRANSCRIPT_DELTA: LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA,
  OUTPUT_TRANSCRIPT_DELTA: LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
  DELEGATION_CREATED: LIVE_SERVER_EVENT.DELEGATION_CREATED,
  USAGE_UPDATED: LIVE_SERVER_EVENT.USAGE_UPDATED,
  INSTRUCTIONS_APPEND: LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND,
  THINKING_APPEND: LIVE_CLIENT_EVENT.THINKING_APPEND,
  COMMENTARY_APPEND: LIVE_CLIENT_EVENT.COMMENTARY_APPEND,
} as const;

export type TraceLiveEvent = (typeof TRACE_LIVE_EVENT)[keyof typeof TRACE_LIVE_EVENT];

/**
 * The two reflected-audio events, and the field each carries its base64
 * samples in. Neither reaches the renderer's channel, but a sideband trace
 * would see both, and the writer strips them by the same rule.
 */
const REFLECTED_AUDIO_FIELD: ReadonlyMap<string, string> = new Map([
  [LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND, "audio"],
  [LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA, "delta"],
]);

/**
 * Strips the one payload a trace must not carry whole: audio. A reflected
 * audio event is base64 samples of the developer's voice or Luke's — megabytes
 * an hour of something no one reads in a trace viewer — so it is replaced by
 * its size before it ever crosses to the writer. Every other event travels as
 * it went over the wire, because the words and documents are exactly what a
 * trace exists to show.
 */
export function sanitizedTraceEvent(event: WireRecord): WireRecord {
  const type = event.type;
  const field = isWireString(type) ? REFLECTED_AUDIO_FIELD.get(type) : undefined;
  if (type === undefined || field === undefined) return event;
  const audio = event[field];
  if (!isWireString(audio)) return event;
  const padding = audio.endsWith("==") ? 2 : audio.endsWith("=") ? 1 : 0;
  return {
    type,
    audioBytes: Math.floor((audio.length * 3) / 4) - padding,
  };
}
