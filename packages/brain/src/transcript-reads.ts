import type {
  ProviderTranscriptResult,
  ProviderTranscriptSinceResult,
  SessionIdentity,
} from "@sidecar/session";
import { ACT_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { rejection, sameIdentity } from "./generation.js";
import { type Settled, settledUnlessAborted } from "./settled.js";
import { REFUSAL_REASON } from "./turn.js";
import type { BrainTranscriptDelta, BrainWakeEvent } from "./wake-events.js";

/** Stands where the front of a transcript was cut, so the model knows it is reading a tail. */
export const OMISSION_MARKER = "[… earlier transcript omitted …]";

/** A transcript held to a bound from the front, and whether anything was cut. */
export interface FrontCut {
  text: string;
  cut: boolean;
}

function cutFront(value: string, maximumChars: number): FrontCut {
  if (value.length <= maximumChars) return { text: value, cut: false };
  const keep = Math.max(0, maximumChars - OMISSION_MARKER.length - 1);
  return { text: `${OMISSION_MARKER}\n${value.slice(value.length - keep)}`, cut: true };
}

/** The cursor each session's transcript was last read to, kept by the turn's own generation. */
export interface TranscriptCursors {
  cursor(identity: SessionIdentity): string | undefined;
  setCursor(identity: SessionIdentity, cursor: string): void;
}

export interface TranscriptDeltaRead {
  cursors: TranscriptCursors;
  read: (
    identity: SessionIdentity,
    cursor: string | undefined,
  ) => Promise<ProviderTranscriptSinceResult>;
  signal: AbortSignal;
  maximumChars: number;
}

export interface TranscriptDeltasAttached {
  events: readonly BrainWakeEvent[];
  transcriptBytes: number;
}

/**
 * Reads what each event's session gained since its cursor and attaches it,
 * one read per session however many events name it. A revocation midway
 * keeps the events already attached and drops the rest unread.
 */
export async function attachTranscriptDeltas(
  events: readonly BrainWakeEvent[],
  options: TranscriptDeltaRead & { revoked: () => boolean },
): Promise<TranscriptDeltasAttached> {
  const read: SessionIdentity[] = [];
  let transcriptBytes = 0;
  const attached: BrainWakeEvent[] = [];
  for (const event of events) {
    if (options.revoked()) break;
    // A wake replayed from the durable inbox carries the delta its capture
    // read; nothing is read again for it.
    if (event.transcriptDelta) {
      transcriptBytes += event.transcriptDelta.text.length;
      attached.push({ ...event });
      continue;
    }
    if (read.some((identity) => sameIdentity(identity, event.identity))) {
      attached.push({ ...event });
      continue;
    }
    read.push({ ...event.identity });
    const delta = await readTranscriptDelta(event.identity, options);
    if (!delta) break;
    transcriptBytes += delta.text.length;
    attached.push({ ...event, transcriptDelta: delta });
  }
  return { events: attached, transcriptBytes };
}

/** Answers undefined only when the signal fired first; a failed read answers a rejected, empty delta. */
export async function readTranscriptDelta(
  identity: SessionIdentity,
  options: TranscriptDeltaRead,
): Promise<BrainTranscriptDelta | undefined> {
  const { cursors } = options;
  let read: Settled<ProviderTranscriptSinceResult>;
  try {
    read = await settledUnlessAborted(
      options.read(identity, cursors.cursor(identity)),
      options.signal,
    );
  } catch {
    return { text: "", truncated: false, status: ACT_RESULT_STATUS.REJECTED };
  }
  if (read.aborted) return undefined;
  const result = read.value;
  if (result.status !== ACT_RESULT_STATUS.ACCEPTED) {
    return { text: "", truncated: false, status: result.status };
  }
  if (result.cursor !== undefined) cursors.setCursor(identity, result.cursor);
  const bounded = cutFront(result.text, options.maximumChars);
  return {
    text: bounded.text,
    truncated: result.truncated || bounded.cut,
    status: ACT_RESULT_STATUS.ACCEPTED,
  };
}

export interface WholeTranscriptRead {
  read: (identity: SessionIdentity) => Promise<ProviderTranscriptResult>;
  signal: AbortSignal;
  maximumChars: number;
}

export async function readWholeTranscript(
  identity: SessionIdentity,
  options: WholeTranscriptRead,
): Promise<WireRecord> {
  let read: Settled<ProviderTranscriptResult>;
  try {
    read = await settledUnlessAborted(options.read(identity), options.signal);
  } catch {
    return rejection(REFUSAL_REASON.READ_FAILED);
  }
  if (read.aborted) return rejection(REFUSAL_REASON.RUN_REVOKED);
  const result = read.value;
  if (result.status !== ACT_RESULT_STATUS.ACCEPTED) {
    return { status: result.status, reason: result.reason };
  }
  const bounded = cutFront(result.transcript, options.maximumChars);
  return {
    status: ACT_RESULT_STATUS.ACCEPTED,
    truncated: bounded.cut,
    transcript: bounded.text,
  };
}
