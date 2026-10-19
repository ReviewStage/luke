/**
 * whole-diff.ts -- a Files changed file drawn whole, as stage-cli's Expand full file draws one: its texts before and after diffed as one hunk holding every line.
 *
 * Pierre diffs two texts to the hunks around their changes; with every
 * line kept as context those hunks are one, the whole file. Two texts alike,
 * a file that only moved, diff to no hunk at all, so that file's lines are
 * laid out here as one hunk of context, numbered alike on both sides, and
 * a file of no line stays as it was parsed.
 */

import { type FileDiffMetadata, type Hunk, parseDiffFromFile } from "@pierre/diffs";
import type { DiffFileTexts } from "./contract.js";

/**
 * A file drawn whole: its texts before and after diffed with every line
 * kept as context, so its changes stand among all of its unchanged lines
 * in one hunk, as a file opened in full; named as its patch names it.
 */
export function wholeOf(read: FileDiffMetadata, whole: DiffFileTexts): FileDiffMetadata {
  const kept = WHOLE_DIFFS.get(whole);
  if (kept !== undefined) return kept;
  const parsed = parseDiffFromFile(
    { name: read.prevName ?? read.name, contents: whole.before },
    { name: read.name, contents: whole.after },
    { context: Number.MAX_SAFE_INTEGER },
  );
  // Note that texts alike, a file that only moved, diff to no hunk at all, so its lines are laid out as one of context.
  const drawn = parsed.hunks.length === 0 ? unchangedWhole(parsed) : parsed;
  WHOLE_DIFFS.set(whole, drawn);
  return drawn;
}

/** A file whose texts are alike drawn whole: every one of its lines in one hunk of context, numbered alike on both sides. */
function unchangedWhole(parsed: FileDiffMetadata): FileDiffMetadata {
  const lines = parsed.additionLines.length;
  if (lines === 0) return parsed;
  const hunk: Hunk = {
    collapsedBefore: 0,
    additionStart: 1,
    additionCount: lines,
    additionLines: 0,
    additionLineIndex: 0,
    deletionStart: 1,
    deletionCount: lines,
    deletionLines: 0,
    deletionLineIndex: 0,
    hunkContent: [{ type: "context", lines, additionLineIndex: 0, deletionLineIndex: 0 }],
    hunkSpecs: `@@ -1,${lines} +1,${lines} @@\n`,
    splitLineStart: 0,
    splitLineCount: lines,
    unifiedLineStart: 0,
    unifiedLineCount: lines,
    noEOFCRDeletions: false,
    noEOFCRAdditions: false,
  };
  return { ...parsed, hunks: [hunk], splitLineCount: lines, unifiedLineCount: lines };
}

/** Each whole file's diff, made once for its texts, so a file drawn again for its notes keeps the diff Pierre drew. */
const WHOLE_DIFFS = new WeakMap<DiffFileTexts, FileDiffMetadata>();
