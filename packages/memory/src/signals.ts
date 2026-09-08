import { DAILY_NOTES_DIRECTORY } from "@sidecar/runtime";
import {
  CANDIDATE_ORIGIN,
  CANDIDATE_SESSION_KIND,
  type CandidateSeed,
  CONSOLIDATION_DEFAULTS,
} from "./candidate.js";
import { prepareForIngestion } from "./redaction.js";
import { textSimilarity } from "./tokenize.js";

/** What a recall signal is read from: a search result's path, lines, words, and score. */
export interface RecallSignalResult {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly snippet: string;
  readonly score: number;
}

/**
 * The seeds a memory search's results stage as recall signals: only results
 * from the dated notes, each snippet through the same scrub the light phase
 * applies — recalled context stripped, secrets and identifiers redacted — so
 * a recall can stage nothing the ingestion path would refuse.
 */
export function recallSignalSeeds(
  query: string,
  results: readonly RecallSignalResult[],
  day: string,
  notesDirectory: string = DAILY_NOTES_DIRECTORY,
): CandidateSeed[] {
  const normalized = query.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized.length === 0) return [];
  const seeds: CandidateSeed[] = [];
  for (const result of results) {
    if (!result.path.startsWith(`${notesDirectory}/`)) continue;
    const prepared = prepareForIngestion(result.snippet);
    if (!prepared) continue;
    seeds.push({
      text: prepared.text,
      path: result.path,
      startLine: result.startLine,
      endLine: result.endLine,
      origin: CANDIDATE_ORIGIN.AGENT,
      sessionKind: CANDIDATE_SESSION_KIND.INTERACTIVE,
      query: normalized,
      score: result.score,
      day,
    });
  }
  return seeds;
}

/** Whether two staged texts are one signal, under the light phase's dedupe similarity. */
export function candidatesDuplicate(left: string, right: string): boolean {
  return textSimilarity(left, right) >= CONSOLIDATION_DEFAULTS.LIGHT_DEDUPE_SIMILARITY;
}
