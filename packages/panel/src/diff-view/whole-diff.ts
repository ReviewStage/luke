import { type FileDiffMetadata, type Hunk, parseDiffFromFile } from "@pierre/diffs";
import type { DiffFileTexts } from "./contract.js";

export function wholeOf(read: FileDiffMetadata, whole: DiffFileTexts): FileDiffMetadata {
  const kept = WHOLE_DIFFS.get(whole);
  if (kept !== undefined) return kept;
  const parsed = parseDiffFromFile(
    { name: read.prevName ?? read.name, contents: whole.before },
    { name: read.name, contents: whole.after },
    { context: Number.MAX_SAFE_INTEGER },
  );
  const drawn = parsed.hunks.length === 0 ? unchangedWhole(parsed) : parsed;
  WHOLE_DIFFS.set(whole, drawn);
  return drawn;
}

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

const WHOLE_DIFFS = new WeakMap<DiffFileTexts, FileDiffMetadata>();
