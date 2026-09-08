import { boundCandidateText, type MemoryCandidate } from "./candidate.js";
import type { DeepRanking, RankedCandidate } from "./deep-ranking.js";

/**
 * How a promoted entry is written into MEMORY.md and found again: its source
 * reference, the promotion marker that attributes it to a candidate, and the
 * lineage marker a supersession names, each on the line before the entry.
 */

export function candidateSourceRef(
  candidate: Pick<MemoryCandidate, "path" | "startLine" | "endLine">,
): string {
  return `${candidate.path}#L${candidate.startLine}-L${candidate.endLine}`;
}

const PROMOTION_MARKER_PREFIX = "<!-- luke-memory-promotion:";
const LINEAGE_MARKER_PREFIX = "<!-- luke-memory-lineage:";

export function promotionMarker(candidateKey: string): string {
  return `${PROMOTION_MARKER_PREFIX}${candidateKey} -->`;
}

export function lineageMarker(lineageKey: string): string {
  return `${LINEAGE_MARKER_PREFIX}${lineageKey} -->`;
}

/** The candidate key a promotion marker line names, or nothing. */
export function promotionMarkerKey(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith(PROMOTION_MARKER_PREFIX) || !trimmed.endsWith("-->")) return undefined;
  const key = trimmed.slice(PROMOTION_MARKER_PREFIX.length, -3).trim();
  return key.length > 0 ? key : undefined;
}

function importance(ranking: DeepRanking): number {
  return Math.max(1, Math.min(10, Math.round(ranking.score * 10)));
}

/** The entry a promoted candidate becomes: its bounded words, its source reference, and its trailing recall metadata. */
export function promotedEntry(ranked: RankedCandidate): string {
  const { candidate, ranking } = ranked;
  const tags = candidate.tags.length > 0 ? ` <!-- trigger: ${candidate.tags.join(", ")} -->` : "";
  return `- ${boundCandidateText(candidate.text)} Source: ${candidateSourceRef(candidate)}${tags} <!-- importance: ${importance(ranking)} -->`;
}

function isMemoryEntryLine(trimmed: string): boolean {
  return (
    trimmed.length > 0 &&
    !trimmed.startsWith("#") &&
    !trimmed.startsWith("<!--") &&
    !trimmed.startsWith("-->") &&
    trimmed !== "```"
  );
}

/** Every entry line of MEMORY.md: what the loss limit counts and a prior entry must be one of. */
export function memoryEntries(content: string): string[] {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(isMemoryEntryLine);
}

function isLineageMarkerLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith(LINEAGE_MARKER_PREFIX) && trimmed.endsWith("-->");
}

/** The lineage key the marker before an entry's promotion marker names, or nothing. */
export function lineageOfEntry(lines: readonly string[], index: number): string | undefined {
  const marker = lines[index - 1] ?? "";
  if (promotionMarkerKey(marker) === undefined) return undefined;
  const lineage = (lines[index - 2] ?? "").trim();
  if (!isLineageMarkerLine(lineage)) return undefined;
  const key = lineage.slice(LINEAGE_MARKER_PREFIX.length, -3).trim();
  return key.length > 0 ? key : undefined;
}

/** Every entry line written along the lineage named. */
export function lineageEntries(content: string, lineageKey: string): string[] {
  const lines = content.replace(/\r\n/gu, "\n").split("\n");
  return lines.flatMap((line, index) => {
    const entry = line.trim();
    return isMemoryEntryLine(entry) && lineageOfEntry(lines, index) === lineageKey ? [entry] : [];
  });
}

/**
 * Removes the line at `index` together with the markers written before it:
 * the promotion marker, when the line is an entry and one stands before it,
 * and the lineage marker before that. Answers where the removal began.
 */
export function removeEntryWithMarkers(lines: string[], index: number): number {
  let start = index;
  const line = lines[index] ?? "";
  if (
    promotionMarkerKey(line) === undefined &&
    promotionMarkerKey(lines[start - 1] ?? "") !== undefined
  ) {
    start -= 1;
  }
  if (isLineageMarkerLine(lines[start - 1] ?? "")) start -= 1;
  lines.splice(start, index - start + 1);
  return start;
}

/** Which candidate keys the file's promotion markers name, so a forget can find what a source produced. */
export function promotedCandidateKeys(content: string): string[] {
  return content
    .split("\n")
    .map(promotionMarkerKey)
    .filter((key): key is string => key !== undefined);
}

/**
 * The file with the entries behind the keys named removed, marker lines
 * included, and how many entries carried a `Source:` reference but no
 * marker: a hand-edited promotion whose attribution is gone and which a
 * forget can only report, never claim to have erased.
 */
export interface PromotedEntryRemoval {
  readonly content: string;
  readonly removed: number;
  /** Entries carrying a source reference but no promotion marker: attribution a hand edit destroyed. */
  readonly unattributed: number;
}

export function removePromotedEntries(
  content: string,
  keys: ReadonlySet<string>,
): PromotedEntryRemoval {
  const lines = content.replace(/\r\n/gu, "\n").split("\n");
  let removed = 0;
  for (let index = 0; index < lines.length; ) {
    const key = promotionMarkerKey(lines[index] ?? "");
    if (key === undefined || !keys.has(key)) {
      index += 1;
      continue;
    }
    const entryFollows = isMemoryEntryLine((lines[index + 1] ?? "").trim());
    const start = removeEntryWithMarkers(lines, entryFollows ? index + 1 : index);
    if (entryFollows) removed += 1;
    index = start;
  }
  const unattributed = lines.filter((line, index) => {
    const trimmed = line.trim();
    return (
      isMemoryEntryLine(trimmed) &&
      /\sSource:\s+\S+#L\d+-L\d+/u.test(trimmed) &&
      promotionMarkerKey(lines[index - 1] ?? "") === undefined
    );
  }).length;
  return { content: lines.join("\n"), removed, unattributed };
}
