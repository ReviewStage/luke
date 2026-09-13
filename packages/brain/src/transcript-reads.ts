import {
  OMISSION_MARKER,
  type ProviderTranscriptResult,
  type ProviderTranscriptSinceResult,
  type SessionIdentity,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { Effect, Option } from "effect";
import { settledUnlessAborted } from "./effect/settled.js";
import { rejection, sameIdentity } from "./tools/records.js";
import { REFUSAL_REASON } from "./tools/refusals.js";
import type { BrainTranscriptDelta, BrainWakeEvent } from "./wake-events.js";

/** A transcript held to a bound from the front, and whether anything was cut. */
interface FrontCut {
  text: string;
  cut: boolean;
}

function cutFront(value: string, maximumChars: number): FrontCut {
  if (value.length <= maximumChars) return { text: value, cut: false };
  const keep = Math.max(0, maximumChars - OMISSION_MARKER.length - 1);
  return { text: `${OMISSION_MARKER}\n${value.slice(value.length - keep)}`, cut: true };
}

/** The cursor each session's transcript was last read to, kept by the turn's own generation. */
interface TranscriptCursors {
  cursor(identity: SessionIdentity): string | undefined;
  setCursor(identity: SessionIdentity, cursor: string): void;
}

export interface TranscriptDeltaRead {
  cursors: TranscriptCursors;
  read: (
    identity: SessionIdentity,
    cursor: string | undefined,
  ) => Effect.Effect<ProviderTranscriptSinceResult>;
  maximumChars: number;
}

export interface TranscriptDeltasAttached {
  events: readonly BrainWakeEvent[];
  transcriptBytes: number;
}

/**
 * Reads what each event's session gained since its cursor and attaches it,
 * one read per session however many events name it. A revocation midway
 * keeps the events already attached and drops the rest unread; a revocation
 * while a read is out interrupts the turn's own fiber, which rolls the
 * cursors back with the context, so the same deltas are read again.
 */
export function attachTranscriptDeltas(
  events: readonly BrainWakeEvent[],
  options: TranscriptDeltaRead & { revoked: () => boolean },
): Effect.Effect<TranscriptDeltasAttached> {
  return Effect.gen(function* () {
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
      const delta = yield* readTranscriptDelta(event.identity, options);
      transcriptBytes += delta.text.length;
      attached.push({ ...event, transcriptDelta: delta });
    }
    return { events: attached, transcriptBytes };
  });
}

/** A failed read answers a rejected, empty delta; a revocation reaches the turn's fiber instead. */
export function readTranscriptDelta(
  identity: SessionIdentity,
  options: TranscriptDeltaRead,
): Effect.Effect<BrainTranscriptDelta> {
  const { cursors } = options;
  return Effect.catchAllDefect(
    Effect.map(
      Effect.suspend(() => options.read(identity, cursors.cursor(identity))),
      (result) => {
        if (result.status !== ACTION_RESULT_STATUS.ACCEPTED) {
          return { text: "", truncated: false, status: result.status };
        }
        if (result.cursor !== undefined) cursors.setCursor(identity, result.cursor);
        const bounded = cutFront(result.text, options.maximumChars);
        return {
          text: bounded.text,
          truncated: result.truncated || bounded.cut,
          status: ACTION_RESULT_STATUS.ACCEPTED,
        };
      },
    ),
    // The seam declares no error, so a read that died is the only failure
    // left to answer for: it is the rejected, empty delta a rejected read is.
    () => Effect.succeed({ text: "", truncated: false, status: ACTION_RESULT_STATUS.REJECTED }),
  );
}

export interface WholeTranscriptRead {
  read: (identity: SessionIdentity) => Effect.Effect<ProviderTranscriptResult>;
  signal: AbortSignal;
  maximumChars: number;
}

/**
 * The whole tail of one session's transcript, for the read tool. The signal
 * is raced here rather than left to the fiber, because this read is
 * dispatched inside the batch of calls the model emitted, which the tool
 * loop holds uninterruptible as one: a revocation reaches this wait only as
 * the signal, and a provider that never answers would otherwise hold the
 * batch — and the run behind it — open past the deadline that fired it. The
 * race itself is interruptible for the same reason `guardedRead` is: it ends
 * by interrupting whichever arm lost, and under that uninterruptible batch a
 * wait on the signal could never be interrupted at all.
 */
export function readWholeTranscript(
  identity: SessionIdentity,
  options: WholeTranscriptRead,
): Effect.Effect<WireRecord> {
  return Effect.catchAllDefect(
    Effect.map(
      Effect.interruptible(
        settledUnlessAborted(
          Effect.suspend(() => options.read(identity)),
          options.signal,
        ),
      ),
      Option.match({
        onNone: () => rejection(REFUSAL_REASON.RUN_REVOKED),
        onSome: (result) => {
          if (result.status !== ACTION_RESULT_STATUS.ACCEPTED) {
            return { status: result.status, reason: result.reason };
          }
          const bounded = cutFront(result.transcript, options.maximumChars);
          return {
            status: ACTION_RESULT_STATUS.ACCEPTED,
            truncated: bounded.cut,
            transcript: bounded.text,
          };
        },
      }),
    ),
    // The seam declares no error, so a read that died answers the same
    // refusal a read that failed always did.
    () => Effect.succeed(rejection(REFUSAL_REASON.READ_FAILED)),
  );
}
