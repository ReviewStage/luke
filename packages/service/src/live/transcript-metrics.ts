/**
 * transcript-metrics.ts -- what a transcript's live answers cost: how long a write waited to be answered, and how many bytes an answer carried.
 *
 * The transcript's journal grows in place, so every answer past a cursor
 * carries a grown message whole, and its words reach a reader a finished
 * sentence at a time. These two measures say whether either is worth
 * changing, and Sentry's metrics layer sends them
 * (`observability/sentry.ts`) as each histogram's `.sum`, `.count`, `.min`,
 * and `.max`, which are cumulative for the instance, so a mean is a sum over
 * its count. The bytes a journal rewrite writes are counted where it is
 * written (`@luke/database/models/writer`).
 *
 * Metrics carry counts, durations, and byte sizes only, never a row, an id,
 * or a txid.
 */
import type { SealedLiveQueryWire } from "@luke/features/live-wire";
import { Clock, Effect, Metric } from "effect";

/** Buckets from a kilobyte up to a few megabytes, doubling, which is where a long turn's journal climbs. */
const BYTE_BOUNDARIES = Metric.exponentialBoundaries({ start: 1024, factor: 2, count: 12 });

/** Buckets from ten milliseconds up to twenty seconds, doubling. */
const MILLI_BOUNDARIES = Metric.exponentialBoundaries({ start: 10, factor: 2, count: 12 });

export const TRANSCRIPT_METRIC = {
  ANSWER_MILLIS: Metric.histogram("luke.transcript.answer_ms", {
    description:
      "Milliseconds from the instance hearing a write to a transcript's rows that carry it being answered, for a held read that a notification woke",
    boundaries: MILLI_BOUNDARIES,
  }),
  ANSWER_BYTES: Metric.histogram("luke.transcript.answer_bytes", {
    description: "Bytes of rows a transcript live answer carried, for an answer that carried any",
    boundaries: BYTE_BOUNDARIES,
  }),
} as const;

/** The bytes of the rows an answer's parts carry, as their JSON text; none where it carries no rows, as a held read that ends unmoved does not. */
function rowBytes(queries: Readonly<Record<string, SealedLiveQueryWire>>): number | undefined {
  const carried = Object.values(queries).filter(({ rows }) => rows !== undefined);
  if (carried.length === 0) return undefined;
  return carried.reduce((total, { rows }) => total + Buffer.byteLength(JSON.stringify(rows)), 0);
}

/** Counts the bytes of the rows a transcript answer carries, where it carries any. */
export const countAnswerBytes = (queries: Readonly<Record<string, SealedLiveQueryWire>>) => {
  const bytes = rowBytes(queries);
  return bytes === undefined ? Effect.void : Metric.update(TRANSCRIPT_METRIC.ANSWER_BYTES, bytes);
};

/** Counts how long a write heard at `heardAt` (clock milliseconds) has waited, as its rows are answered. */
export const countAnswerWait = (heardAt: number) =>
  Effect.flatMap(Clock.currentTimeMillis, (now) =>
    Metric.update(TRANSCRIPT_METRIC.ANSWER_MILLIS, now - heardAt),
  );
