import { parsePatch } from "diff";

/**
 * diff-hunks.ts -- a changed file's patch read as hunks, each row numbered on the side it stands on, as Files changed and a pull request's chapters both read one.
 *
 * A patch is the hunks of a unified diff from the first `@@` header on, as
 * GitHub sends a changed file's. Its lines are read by jsdiff
 * (`parsePatch`), which counts them by each header, so a removed line whose
 * own text starts with dashes is still one removed line; each hunk keeps
 * its header as written, with where it starts and what it counts on each
 * side as git wrote them, which is how a hunk is named apart from the rest
 * of its file (`oldStart`).
 *
 * The lockfiles package managers write are named here too, because both a
 * reader folding what is rarely read and one leaving it out of a chapter
 * read past the same files.
 */

/** What one row of a hunk is: a line of context, one added, one removed, or git's note on the line above it. */
export const DIFF_ROW = {
  CONTEXT: "context",
  ADDED: "added",
  REMOVED: "removed",
  NOTE: "note",
} as const;

export type DiffRowKind = (typeof DIFF_ROW)[keyof typeof DIFF_ROW];

/** One row of a hunk: what it is, its line number on each side it stands on, and its text without the mark before it. */
export interface DiffRow {
  readonly kind: DiffRowKind;
  readonly oldLine: number | undefined;
  readonly newLine: number | undefined;
  readonly text: string;
}

/**
 * One hunk: its `@@` header as written; where it starts and how many lines
 * it counts on each side, as the header writes them, so a hunk adding a
 * file starts at 0 on the old side; and its rows.
 */
export interface DiffHunk {
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly rows: readonly DiffRow[];
}

/** A hunk's header with its counts: where it starts on each side, and how many lines, one where a count is left out. */
export const HUNK_COUNTS = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u;

/** The kind of row each mark starts in a patch; a line of context starts with a space. */
const ROW_MARK = new Map<string, DiffRowKind>([
  ["+", DIFF_ROW.ADDED],
  ["-", DIFF_ROW.REMOVED],
  ["\\", DIFF_ROW.NOTE],
]);

/** The names of the lockfiles package managers write, which a reader reads past wherever they stand. */
export const LOCKFILE_NAMES: ReadonlySet<string> = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "deno.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "composer.lock",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "go.sum",
  "Package.resolved",
  "Podfile.lock",
  "pubspec.lock",
  "mix.lock",
  "gradle.lockfile",
  "flake.lock",
]);

/** One hunk's lines as rows, each numbered on the side it stands on, counting from where the hunk starts. */
function rowsOf(lines: readonly string[], oldStart: number, newStart: number): DiffRow[] {
  let oldLine = oldStart;
  let newLine = newStart;
  return lines.map((line) => {
    const kind = ROW_MARK.get(line.charAt(0)) ?? DIFF_ROW.CONTEXT;
    const text = line.slice(1);
    if (kind === DIFF_ROW.NOTE) return { kind, oldLine: undefined, newLine: undefined, text };
    if (kind === DIFF_ROW.ADDED) return { kind, oldLine: undefined, newLine: newLine++, text };
    if (kind === DIFF_ROW.REMOVED) return { kind, oldLine: oldLine++, newLine: undefined, text };
    return { kind, oldLine: oldLine++, newLine: newLine++, text };
  });
}

/**
 * A patch's hunks, or none where it does not read as a unified diff. Note
 * that each hunk's header is taken from the patch as written, because
 * jsdiff keeps only its numbers and git writes the enclosing scope after
 * them; a hunk's own lines start with a mark or a space, so the lines that
 * start with `@@` are its headers, in order. Where a hunk starts and what
 * it counts are read off that header too, because jsdiff moves the start
 * of a side that counts no lines one line on.
 */
export function patchHunks(patch: string): readonly DiffHunk[] | undefined {
  let parsed: ReturnType<typeof parsePatch>;
  try {
    parsed = parsePatch(patch);
  } catch {
    return undefined;
  }
  const headers = patch.split("\n").filter((line) => line.startsWith("@@"));
  return (parsed[0]?.hunks ?? []).map((hunk, index) => {
    const header = headers[index] ?? "";
    const counts = HUNK_COUNTS.exec(header);
    const [, oldStart, oldLines = "1", newStart, newLines = "1"] = counts ?? [];
    return {
      header,
      oldStart: oldStart === undefined ? hunk.oldStart : Number(oldStart),
      oldLines: counts === null ? hunk.oldLines : Number(oldLines),
      newStart: newStart === undefined ? hunk.newStart : Number(newStart),
      newLines: counts === null ? hunk.newLines : Number(newLines),
      rows: rowsOf(hunk.lines, hunk.oldStart, hunk.newStart),
    };
  });
}
