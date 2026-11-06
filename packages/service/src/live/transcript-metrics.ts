import type { SealedLiveQueryWire } from "@repo/features/live-wire";
import { Clock, Effect, Metric } from "effect";

const BYTE_BOUNDARIES = Metric.exponentialBoundaries({ start: 1024, factor: 2, count: 12 });

const MILLI_BOUNDARIES = Metric.exponentialBoundaries({ start: 10, factor: 2, count: 12 });

export const TRANSCRIPT_METRIC = {
  ANSWER_MILLIS: Metric.histogram("app.transcript.answer_ms", {
    description:
      "Milliseconds from the instance hearing a write to a transcript's rows that carry it being answered, for a held read that a notification woke",
    boundaries: MILLI_BOUNDARIES,
  }),
  ANSWER_BYTES: Metric.histogram("app.transcript.answer_bytes", {
    description: "Bytes of rows a transcript live answer carried, for an answer that carried any",
    boundaries: BYTE_BOUNDARIES,
  }),
} as const;

function rowBytes(queries: Readonly<Record<string, SealedLiveQueryWire>>): number | undefined {
  const carried = Object.values(queries).filter(({ rows }) => rows !== undefined);
  if (carried.length === 0) return undefined;
  return carried.reduce((total, { rows }) => total + Buffer.byteLength(JSON.stringify(rows)), 0);
}

export const countAnswerBytes = (queries: Readonly<Record<string, SealedLiveQueryWire>>) => {
  const bytes = rowBytes(queries);
  return bytes === undefined ? Effect.void : Metric.update(TRANSCRIPT_METRIC.ANSWER_BYTES, bytes);
};

export const countAnswerWait = (heardAt: number) =>
  Effect.flatMap(Clock.currentTimeMillis, (now) =>
    Metric.update(TRANSCRIPT_METRIC.ANSWER_MILLIS, now - heardAt),
  );
