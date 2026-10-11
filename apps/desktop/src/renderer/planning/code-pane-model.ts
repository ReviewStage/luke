import type { CodeRef } from "@sidecar/hosted/plan-wire";
import type { PlanCode, PlanCodeShowing } from "@sidecar/hosted/planning-view";
import type { TranscriptCallRow } from "./transcript-model";

/**
 * code-pane-model.ts -- what the Code tab's feed says, apart from drawing it: which call each code was shown on, its heading's range, the lines lit, and what its copy carries.
 */

/** The calls the feed groups its code under, as the Transcript tab draws them. */
export type CodeFeedCallSource = Pick<TranscriptCallRow, "key" | "startedAt" | "live">;

/** One call's run of the feed: the call's key, when it started, whether it stands now, and each code shown on it, oldest first. */
export interface CodeFeedCall {
  readonly key: string;
  readonly startedAt: number;
  readonly live: boolean;
  readonly showings: readonly PlanCodeShowing[];
}

/** The lines pointed at, as a card's heading reads them: "Lines 40–58", "Line 7", or nothing for a whole file. */
export function rangeLabel(ref: CodeRef): string | undefined {
  if (ref.startLine === undefined || ref.endLine === undefined) return undefined;
  return ref.startLine === ref.endLine
    ? `Line ${ref.startLine}`
    : `Lines ${ref.startLine}–${ref.endLine}`;
}

/** Whether `line` of the file is one the reference points at. */
export function isPointed(ref: CodeRef, line: number): boolean {
  if (ref.startLine === undefined || ref.endLine === undefined) return false;
  return line >= ref.startLine && line <= ref.endLine;
}

/** What a card's copy carries: the lines pointed at as plain text, or every line the card draws for a whole file. */
export function copiedLines(code: PlanCode): string {
  const kept = code.lines.filter(
    (_line, at) => code.ref.startLine === undefined || isPointed(code.ref, code.firstLine + at),
  );
  return kept.map((tokens) => tokens.map((token) => token.text).join("")).join("\n");
}

/** The call a code was shown on: the latest to start at or before it, or none where no call started before it. */
function callOf(
  showing: PlanCodeShowing,
  calls: readonly CodeFeedCallSource[],
): CodeFeedCallSource | undefined {
  let found: CodeFeedCallSource | undefined;
  for (const call of calls) {
    if (call.startedAt > showing.shownAt) continue;
    if (found === undefined || call.startedAt >= found.startedAt) found = call;
  }
  return found;
}

/**
 * The feed's code grouped under the calls it was shown on, in the order it
 * was shown, several of one file each its own. Code shown before any call
 * the transcript holds (one whose words were left out of its read, or a
 * transcript not read) stands under its own turn, headed by when the turn
 * began.
 */
export function codeFeedCalls(
  shown: readonly PlanCodeShowing[],
  calls: readonly CodeFeedCallSource[],
): readonly CodeFeedCall[] {
  const runs = new Map<
    string,
    { call: Omit<CodeFeedCall, "showings">; showings: PlanCodeShowing[] }
  >();
  for (const showing of shown) {
    const call = callOf(showing, calls);
    const key = call?.key ?? showing.turnId;
    const run = runs.get(key) ?? {
      call: {
        key,
        startedAt: call?.startedAt ?? showing.shownAt,
        live: call?.live ?? false,
      },
      showings: [],
    };
    run.showings.push(showing);
    runs.set(key, run);
  }
  return [...runs.values()].map(({ call, showings }) => ({ ...call, showings }));
}
