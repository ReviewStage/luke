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

import { REALTIME_CLIENT_EVENT } from "@sidecar/realtime";
import { isRecord, isWireString, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";

export const TRACE_DIRECTION = {
  CLIENT: "client",
  SERVER: "server",
} as const;

export type TraceDirection = (typeof TRACE_DIRECTION)[keyof typeof TRACE_DIRECTION];

const TRACE_DIRECTIONS: readonly string[] = Object.values(TRACE_DIRECTION);

/** One realtime event as the tap saw it cross the data channel. */
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
 * Strips the one payload a trace must not carry whole: the developer's own
 * voice. An audio append is base64 microphone samples — megabytes an hour of
 * something no one reads in a trace viewer — so it is replaced by its size
 * before it ever crosses to the writer. Every other event travels as it went
 * over the wire, because the words and documents are exactly what a trace
 * exists to show.
 */
export function sanitizedTraceEvent(event: WireRecord): WireRecord {
  if (event.type !== REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_APPEND) return event;
  const audio = event.audio;
  if (!isWireString(audio)) return event;
  const padding = audio.endsWith("==") ? 2 : audio.endsWith("=") ? 1 : 0;
  return {
    type: event.type,
    audioBytes: Math.floor((audio.length * 3) / 4) - padding,
  };
}
