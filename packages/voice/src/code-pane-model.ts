import type { CodeRef, PlanEditor } from "@luke/features/task-wire";
import type { TaskCode, TaskCodeShowing } from "@luke/features/tasks-view";
import {
  type CallRecord,
  callEndedLine,
  callStart,
  type TranscriptCallRow,
} from "./transcript-model.js";

/**
 * code-pane-model.ts -- what the Code tab's feed says, apart from drawing it: which call each code was shown on, how a range of lines is said, the lines lit, and what its copy carries.
 */

/** The calls the feed groups its code under, as the Call tab draws them. */
export type CodeFeedCallSource = Pick<
  TranscriptCallRow,
  "key" | "startedAt" | "live" | "lukeEnded" | "record" | "caller"
>;

/**
 * One call's run of the feed: the call's key, when it started, whether it
 * stands now, and each code shown on it, oldest first; and once the call
 * has ended, the line it closes with and what the record says of it, as
 * the Call tab closes it. A run of code shown on no call the transcript
 * holds closes on nothing.
 */
export interface CodeFeedCall {
  readonly key: string;
  readonly startedAt: number;
  readonly live: boolean;
  readonly showings: readonly TaskCodeShowing[];
  readonly ended: string | undefined;
  readonly record: CallRecord | undefined;
  /** The teammate whose call it was, named over its run as the Call tab names it; none for the reader's own or a turn's run. */
  readonly caller: PlanEditor | undefined;
}

/** A reference as a place names it, read from a call's input or a stored note, its lines absent for a whole file. */
export interface NamedLines {
  readonly path: string;
  readonly startLine?: number | undefined;
  readonly endLine?: number | undefined;
}

/**
 * The lines a reference points at, as every place naming them says them, a
 * code card's head, a File tab's note, a `show_code` row, and an inbox
 * item's code alike: "Lines 40–58", "Line 7", or nothing for a whole file.
 */
export function lineRangeText(ref: Omit<NamedLines, "path">): string | undefined {
  if (ref.startLine === undefined || ref.endLine === undefined) return undefined;
  return ref.startLine === ref.endLine
    ? `Line ${ref.startLine}`
    : `Lines ${ref.startLine}–${ref.endLine}`;
}

/** A reference as words, where its path and its lines are said in one breath: "src/invite.ts, Lines 40–58", or the path alone for a whole file. */
export function fileRefText(ref: NamedLines): string {
  const lines = lineRangeText(ref);
  return lines === undefined ? ref.path : `${ref.path}, ${lines}`;
}

/** Whether `line` of the file is one the reference points at. */
export function isPointed(ref: CodeRef, line: number): boolean {
  if (ref.startLine === undefined || ref.endLine === undefined) return false;
  return line >= ref.startLine && line <= ref.endLine;
}

/** What a card's copy carries: the lines pointed at as plain text, or every line the card draws for a whole file. */
export function copiedLines(code: TaskCode): string {
  const kept = code.lines.filter(
    (_line, at) => code.ref.startLine === undefined || isPointed(code.ref, code.firstLine + at),
  );
  return kept.map((tokens) => tokens.map((token) => token.text).join("")).join("\n");
}

/**
 * The call a code was shown on: the latest to start at or before it, or
 * none where no call started before it, or where that call's record says
 * it had ended before the turn that showed the code began. Note that the
 * ended call does not take it, because the call closes on its end line
 * (the desktop's `planning/call-card.tsx`), and code drawn above that line would read as shown
 * before the call ended.
 */
function callOf(
  showing: TaskCodeShowing,
  calls: readonly CodeFeedCallSource[],
): CodeFeedCallSource | undefined {
  let found: CodeFeedCallSource | undefined;
  for (const call of calls) {
    if (callStart(call) > showing.shownAt) continue;
    if (found === undefined || callStart(call) >= callStart(found)) found = call;
  }
  const endedAt = found?.record?.endedAt;
  return endedAt !== undefined && endedAt < showing.shownAt ? undefined : found;
}

/**
 * The feed's code grouped under the calls it was shown on, in the order it
 * was shown, several of one file each its own. Code shown before any call
 * the transcript holds (one whose words were left out of its read, or a
 * transcript not read) stands under its own turn, headed by when the turn
 * began.
 */
export function codeFeedCalls(
  shown: readonly TaskCodeShowing[],
  calls: readonly CodeFeedCallSource[],
): readonly CodeFeedCall[] {
  const runs = new Map<
    string,
    { call: Omit<CodeFeedCall, "showings">; showings: TaskCodeShowing[] }
  >();
  for (const showing of shown) {
    const call = callOf(showing, calls);
    const key = call?.key ?? showing.turnId;
    const run = runs.get(key) ?? {
      call: {
        key,
        startedAt: call?.startedAt ?? showing.shownAt,
        live: call?.live ?? false,
        ended: call === undefined ? undefined : callEndedLine(call),
        record: call?.record,
        caller: call?.caller,
      },
      showings: [],
    };
    run.showings.push(showing);
    runs.set(key, run);
  }
  return [...runs.values()].map(({ call, showings }) => ({ ...call, showings }));
}

/** A file Luke showed: the newest reference to it, and the commit his checkout stood at, where it was recorded. */
export type ShownFile = CodeRef & { readonly commit?: string | undefined };

/**
 * Each file Luke showed on the plan, once, in the order first shown, under
 * the newest reference to it and the commit it was read at: what the "+"
 * offers to open, and what a file's tab is held to.
 */
export function shownFiles(shown: readonly TaskCodeShowing[]): readonly ShownFile[] {
  const newest = new Map<string, ShownFile>();
  for (const { code } of shown) newest.set(code.ref.path, { ...code.ref, commit: code.commit });
  return [...newest.values()];
}

/** A file's name, the last part of its path, as its tab is labelled. */
export function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

/** The folder a file stands in, its path short of its name, as a row says it after the name; none at the repository's root. */
export function fileFolder(path: string): string | undefined {
  return path.slice(0, -fileName(path).length - 1) || undefined;
}
