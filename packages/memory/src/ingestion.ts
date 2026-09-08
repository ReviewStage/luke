import { DAILY_NOTES_DIRECTORY, parseDailyNoteName } from "@sidecar/runtime";
import { DAY_MS, type SessionKey } from "@sidecar/runtime-contracts";
import {
  CANDIDATE_ORIGIN,
  CANDIDATE_SESSION_KIND,
  type CandidateOrigin,
  type CandidateSeed,
  CONSOLIDATION_DEFAULTS,
  conversationCandidatePath,
  ingestionQuery,
  type MemoryCandidate,
} from "./candidate.js";
import { hashText } from "./chunking.js";
import { localDayStamp } from "./flush.js";
import { prepareForIngestion } from "./redaction.js";
import { candidatesDuplicate } from "./signals.js";
import { stripBullet } from "./tokenize.js";

/**
 * The light phase's seed builders, pure over what the sweep hands them: the
 * History lines of a conversation since its cursor, the lines of the recent
 * dated notes, and the dedupe that folds near-duplicates onto one candidate.
 * Every line passes the ingestion scrub — recalled context stripped, secrets
 * and identifiers redacted — before it becomes a seed.
 */

/** How much a day's ingestion counts for; three recurring days pass the score gate, one does not. */
export const INGESTION_SCORE = 0.8;

/**
 * The most of one raw note line the light phase reads before scrubbing it;
 * a candidate is cut to its own text bound afterwards anyway, and the
 * redaction treats a key armor the cut removed as an unterminated key.
 */
export const NOTE_LINE_MAX_CHARS = 4_000;

/** A note line as the scrub reads it: its bullet gone and its length bounded. */
export function boundNoteLine(line: string): string {
  return stripBullet(line).slice(0, NOTE_LINE_MAX_CHARS);
}

/** One History line as the sweep is handed it: its kind and words for the hash, and who said it. */
export interface IngestibleHistoryLine {
  readonly kind: string;
  readonly words: string;
  readonly origin: CandidateOrigin;
  readonly eventId?: string;
  readonly recordedAt?: number;
}

/** One History line as the light phase reads it: its hash, when it was said, and the seed it yields, if any. */
export interface IngestibleLine {
  readonly hash: string;
  readonly recordedAt: number;
  readonly seed?: CandidateSeed;
}

export function historyLineHash(line: Pick<IngestibleHistoryLine, "kind" | "words">): string {
  return hashText(`${line.kind}\n${line.words}`);
}

/** The lines since the cursor and inside the lookback, oldest first, each with its hash. */
export function recentHistoryLines(
  lines: readonly IngestibleHistoryLine[],
  cursor: number,
  now: number,
): readonly { readonly line: IngestibleHistoryLine; readonly hash: string }[] {
  const since = Math.max(cursor, now - CONSOLIDATION_DEFAULTS.LIGHT_LOOKBACK_DAYS * DAY_MS);
  return lines
    .filter((line) => (line.recordedAt ?? 0) > since)
    .sort((a, b) => (a.recordedAt ?? 0) - (b.recordedAt ?? 0))
    .map((line) => ({ line, hash: historyLineHash(line) }));
}

/**
 * Each recent line with the seed it yields: none when the store saw its hash
 * before or the scrub empties it, so the sweep still advances over it.
 */
export function ingestibleLines(
  sessionKey: SessionKey,
  recent: readonly { readonly line: IngestibleHistoryLine; readonly hash: string }[],
  seen: ReadonlySet<string>,
  now: number,
): IngestibleLine[] {
  return recent.map(({ line, hash }) => {
    const recordedAt = line.recordedAt ?? now;
    if (seen.has(hash)) return { hash, recordedAt };
    const prepared = prepareForIngestion(line.words);
    if (!prepared) return { hash, recordedAt };
    const day = localDayStamp(recordedAt);
    return {
      hash,
      recordedAt,
      seed: {
        text: prepared.text,
        path: conversationCandidatePath(sessionKey),
        startLine: 0,
        endLine: 0,
        origin: line.origin,
        sessionKind: CANDIDATE_SESSION_KIND.INTERACTIVE,
        sourceSessionKey: sessionKey,
        ...(line.eventId ? { sourceEventId: line.eventId } : undefined),
        query: ingestionQuery(day),
        score: INGESTION_SCORE,
        day,
      },
    };
  });
}

export interface NoteFile {
  /** The file's name inside the notes directory. */
  readonly name: string;
  readonly content: string;
}

/** The seeds of the dated notes inside the lookback: each bullet or line, headings and comments excluded. */
export function noteSeeds(files: readonly NoteFile[], now: number): CandidateSeed[] {
  const seeds: CandidateSeed[] = [];
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const day = parseDailyNoteName(file.name)?.day;
    if (!day) continue;
    const dayMs = Date.parse(`${day}T00:00:00`);
    if (!Number.isFinite(dayMs) || now - dayMs > CONSOLIDATION_DEFAULTS.LIGHT_LOOKBACK_DAYS * DAY_MS) {
      continue;
    }
    file.content.split("\n").forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith("<!--")) return;
      const prepared = prepareForIngestion(boundNoteLine(trimmed));
      if (!prepared || prepared.text.length < 12) return;
      seeds.push({
        text: prepared.text,
        path: `${DAILY_NOTES_DIRECTORY}/${file.name}`,
        startLine: index + 1,
        endLine: index + 1,
        origin: CANDIDATE_ORIGIN.AGENT,
        sessionKind: CANDIDATE_SESSION_KIND.INTERACTIVE,
        query: ingestionQuery(day),
        score: INGESTION_SCORE,
        day,
      });
    });
  }
  return seeds;
}

export interface DedupedSeeds {
  readonly seeds: CandidateSeed[];
  readonly deduped: number;
}

/** Near-duplicate seeds fold onto the first of their kind — a held candidate, or an earlier seed — so the store reinforces one candidate. */
export function dedupe(seeds: readonly CandidateSeed[], held: readonly MemoryCandidate[]): DedupedSeeds {
  const kept: CandidateSeed[] = [];
  let deduped = 0;
  for (const seed of seeds) {
    const existing = held.find((candidate) => candidatesDuplicate(candidate.text, seed.text));
    if (existing?.queries.includes(seed.query)) {
      // The same day's signal for a candidate already holding it adds no evidence.
      deduped += 1;
      continue;
    }
    const first = existing ?? kept.find((other) => candidatesDuplicate(other.text, seed.text));
    if (first) {
      kept.push({
        ...seed,
        text: first.text,
        path: first.path,
        startLine: first.startLine,
        endLine: first.endLine,
      });
      deduped += 1;
      continue;
    }
    kept.push(seed);
  }
  return { seeds: kept, deduped };
}
