import { encodeMention, MENTION_KIND } from "@luke/features/mention-link";
import type { TaskFileRequest } from "@luke/features/task-wire";
import type { TaskCode, TasksFileAnswer } from "@luke/features/tasks-view";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { ERROR_STATE_PLACEMENT, ErrorState, type ErrorStatePlacement } from "@luke/ui";
import { fileName } from "@luke/voice/code-pane-model";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAppCommand } from "../app-commands";
import { useFindOpen } from "../find-in-tab";
import { RetryRowLabel } from "../retry-button";
import { BusyLabel, SpinnerRegion } from "../spinner";
import { CodeLineRows, centreWithin } from "./code-pane";
import { type FileNotes, notesBefore } from "./file-note";
import {
  FILE_READ,
  type FileLines,
  type FileRead,
  type FileWindow,
  holdsLines,
  lastLineOf,
  refusalLine,
  refusalPasses,
  windowAt,
  windowUnread,
  withWindow,
} from "./file-tab-model";
import { useFileViewSettings } from "./file-view-settings";
import { useMentionDrop, usePlanMentions } from "./plan-mentions";
import type { OpenFile } from "./use-side-panel";

/**
 * file-tab.tsx -- a File tab: one whole file of the open task's repository, opened from a snippet Luke showed, its lines lit and scrolled into view.
 *
 * The Code tab's cards hold the lines a snippet pointed at and a few around
 * them; opening a card's file draws the file whole here, numbered and
 * coloured as the cards are. The file is read through the service a window
 * at a time (`ACT_KIND.TASKS_FILE`), first the window holding the
 * snippet's lines, then the window above or below as the developer scrolls
 * to the top or the bottom of what is drawn, so a long file costs one
 * window until it is read further. A file an inbox item's code opened is
 * read at the commit the agent named, so its lines are the ones it meant,
 * and one a snippet opened at the commit Luke's checkout stood at when he
 * read it, so a file main has since moved or deleted still reads as he
 * showed it. Note that the service otherwise reads the file from GitHub as
 * it stands now on the repository's default branch, as a snippet shown
 * before its commit was recorded is read: a file changed since is drawn as
 * it is now, the snippet's lines lit where they fall, and a file gone, or
 * one the service refuses, says so in the file's place, over the lines Luke
 * showed of it where the task holds them. Over the first line of each
 * range Luke showed with a note stands his note on it (`file-note.tsx`),
 * on the file and on those lines alike. The tab draws no heading of its
 * own: the File view's bar over it names the file and offers what is done
 * with it (`file-view.tsx`), told how the read stands as it moves. The lines
 * are drawn numbered or not, wrapped or not, as every File tab is
 * (`file-view-settings.ts`). While a find bar is open over the tab,
 * the rest of the file is read a window after another until it is drawn
 * whole, so the find covers every line of it (`find-in-tab.tsx`). Every line here is
 * the repository's, so the root is left out of the screen recording
 * (`ph-no-capture`) as a second line behind the recording's text masking.
 */

/** What stands over the lines Luke showed, drawn where the file cannot be. */
const SNIPPET_LABEL = "The lines Luke showed, from his copy of the repository";

/** Where a read of the lines above or below the drawn ones stands. */
const EDGE_READ = {
  IDLE: "idle",
  READING: "reading",
  FAILED: "failed",
} as const;

type EdgeRead = (typeof EDGE_READ)[keyof typeof EDGE_READ];

/** Reads one window of the tab's file: the answer, or a rejection where main refused the act. */
export type ReadFileWindow = (window: TaskFileRequest) => Promise<TasksFileAnswer>;

/**
 * The row standing above or below the drawn lines while the file goes on
 * past them: the next window is read as the row scrolls into view, or on
 * its press after a read that failed, as the Call tab reads earlier work.
 */
function EdgeRow({
  label,
  onRead,
}: {
  label: string;
  onRead: () => Promise<boolean>;
}): React.JSX.Element {
  const row = useRef<HTMLButtonElement>(null);
  const [read, setRead] = useState<EdgeRead>(EDGE_READ.IDLE);
  const load = useRef(() => {
    setRead(EDGE_READ.READING);
    onRead().then(
      (landed) => setRead(landed ? EDGE_READ.IDLE : EDGE_READ.FAILED),
      () => setRead(EDGE_READ.FAILED),
    );
  });

  useEffect(() => {
    const target = row.current;
    if (target === null || read !== EDGE_READ.IDLE) return;
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) load.current();
    });
    seen.observe(target);
    return () => seen.disconnect();
  }, [read]);

  return (
    <button
      ref={row}
      type="button"
      className="file-tab-edge"
      disabled={read === EDGE_READ.READING}
      onClick={() => load.current()}
    >
      <BusyLabel busy={read === EDGE_READ.READING} label="Loading lines">
        {read === EDGE_READ.FAILED ? (
          <RetryRowLabel failure="Could not read these lines." />
        ) : (
          label
        )}
      </BusyLabel>
    </button>
  );
}

/** The attributes every run of a File tab's lines, or a Changes tab's diff, is drawn by: its numbers shown or not, wrapped or not, as the File tabs' settings say. */
interface LinesLook {
  readonly "data-line-numbers": string;
  readonly "data-wrap": string;
}

export function useLinesLook(): LinesLook {
  const { settings } = useFileViewSettings();
  return {
    "data-line-numbers": String(settings.lineNumbers),
    "data-wrap": String(settings.wordWrap),
  };
}

/** The run of lines held after a window's answer, or why there is none. */
function afterAnswer(held: FileRead, answer: TasksFileAnswer): FileRead {
  if ("file" in answer) return { kind: FILE_READ.READY, ...withWindow(held, answer.file) };
  if ("refusal" in answer) {
    return { kind: FILE_READ.REFUSED, refusal: answer.refusal, branch: answer.branch };
  }
  return { kind: FILE_READ.FAILED };
}

/** The window the tab first reads for the lines it lights: the one holding their start, or the file's first. */
function firstWindow(file: OpenFile): FileWindow {
  return windowAt(file.range?.startLine ?? 1);
}

/** The drawn lines, the rows that read more above and below them, and the lit lines scrolled into view whenever the file is opened again. */
function FileLinesView({
  file,
  held,
  notes,
  readWindow,
}: {
  file: OpenFile;
  held: FileLines;
  notes: FileNotes;
  readWindow: (window: FileWindow) => Promise<boolean>;
}): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null);
  const centred = useRef<number | undefined>(undefined);
  const look = useLinesLook();
  const last = lastLineOf(held);
  const above = held.firstLine > 1 ? windowAt(held.firstLine - 1) : undefined;
  const below = last < held.lineCount ? windowAt(last + 1) : undefined;
  const pointed = { path: file.path, ...file.range };

  // Note that this waits for the lit lines to be drawn, which may take the
  // window holding them a read after the file opened.
  useLayoutEffect(() => {
    const lines = scroller.current;
    if (lines === null || centred.current === file.opened) return;
    if (file.range === undefined) {
      lines.scrollTop = 0;
      centred.current = file.opened;
      return;
    }
    const target = lines.querySelector<HTMLElement>("[data-pointed='true']");
    if (target === null) return;
    centreWithin(lines, target);
    centred.current = file.opened;
  });

  return (
    <div className="code-lines file-tab-lines scroll-fade-top" ref={scroller} {...look}>
      {above === undefined ? null : (
        <EdgeRow
          key={above.firstLine}
          label={`Show lines ${above.firstLine}–${above.lastLine}`}
          onRead={() => readWindow(above)}
        />
      )}
      <CodeLineRows
        firstLine={held.firstLine}
        lines={held.lines}
        pointed={pointed}
        before={notesBefore(notes)}
      />
      {below === undefined ? null : (
        <EdgeRow
          key={below.firstLine}
          label={`Show lines ${below.firstLine}–${Math.min(below.lastLine, held.lineCount)}`}
          onRead={() => readWindow(below)}
        />
      )}
    </div>
  );
}

/**
 * Why a file read is not drawn: a read that did not land, or a refusal that
 * may pass, as a read failure with Retry; any other refusal in the notice's
 * own ink, with Open Settings where signing in is what it waits on.
 */
function ReadNotice({
  read,
  commit,
  onRetry,
  place,
}: {
  read: Exclude<FileRead, { kind: typeof FILE_READ.READY | typeof FILE_READ.READING }>;
  /** The commit the file was read at, where one pinned it. */
  commit: string | undefined;
  onRetry: () => void;
  place: ErrorStatePlacement;
}): React.JSX.Element {
  if (read.kind === FILE_READ.FAILED || refusalPasses(read.refusal)) {
    const line =
      read.kind === FILE_READ.FAILED
        ? "The file could not be read."
        : refusalLine(read.refusal, read.branch, commit);
    return (
      <ErrorState onRetry={onRetry} placement={place}>
        {line}
      </ErrorState>
    );
  }
  return (
    <p className="m-0" role="alert">
      {refusalLine(read.refusal, read.branch, commit)}
    </p>
  );
}

/** The first and last line a selection over the tab covers, by the numbers their rows are drawn with; nothing where it covers no line of the file. */
function selectedLines(
  tab: HTMLElement,
  selection: Selection | null,
): { readonly startLine: number; readonly endLine: number } | undefined {
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return undefined;
  const range = selection.getRangeAt(0);
  const rows = [...tab.querySelectorAll<HTMLElement>(".code-line")].filter((row) => {
    if (!range.intersectsNode(row)) return false;
    // Note that a row the selection only touches at its start, as a line selected whole ends, holds none of it.
    const text = row.querySelector(".code-line-text");
    if (text === null || !row.contains(range.endContainer)) return true;
    const held = document.createRange();
    held.setStart(text, 0);
    held.setEnd(range.endContainer, range.endOffset);
    return held.toString() !== "";
  });
  const numbers = rows.map((row) => Number(row.querySelector(".code-line-number")?.textContent));
  const startLine = numbers[0];
  const endLine = numbers.at(-1);
  if (startLine === undefined || endLine === undefined) return undefined;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return undefined;
  return { startLine, endLine };
}

/** A file's lines as their mention's chip names them: the file's name and the lines, `app.ts:12–20`, or the one line. */
function linesName(path: string, lines: { readonly startLine: number; readonly endLine: number }) {
  const span =
    lines.startLine === lines.endLine
      ? String(lines.startLine)
      : `${lines.startLine}–${lines.endLine}`;
  return `${fileName(path)}:${span}`;
}

/** The tab: the file, or why it is not shown over the lines Luke showed of it. */
export function FileTab({
  file,
  snippet,
  notes,
  readFile,
  onRead,
}: {
  file: OpenFile;
  /** The lines Luke showed of the file, drawn where the file cannot be. */
  snippet: TaskCode | undefined;
  /** Luke's notes on the file's lines, each drawn over the first line of its range. */
  notes: FileNotes;
  readFile: ReadFileWindow;
  /** Hears how the read of the file stands each time it moves, the bar over the tab offering what it allows. */
  onRead: (read: FileRead) => void;
}): React.JSX.Element {
  const [read, setRead] = useState<FileRead>({ kind: FILE_READ.READING });
  const tab = useRef<HTMLElement>(null);
  const page = usePlanMentions();
  const drop = useMentionDrop();
  const held = useRef<FileRead>(read);
  held.current = read;
  const told = useRef(onRead);
  const look = useLinesLook();
  told.current = onRead;
  useEffect(() => {
    told.current(read);
  }, [read]);

  // Note that the reads go through refs to the latest file and door, so
  // they ask again only when the file is opened again, never because a
  // parent drew a fresh door.
  const latest = useRef({ file, readFile });
  latest.current = { file, readFile };
  const asked = useRef<number | undefined>(undefined);

  // One window read and laid beside what is held, answering whether it
  // landed. Note that a read of more lines that did not land leaves the
  // lines drawn as they were, because only its own row has failed.
  const readWindow = useCallback((window: FileWindow) => {
    const missed = () => {
      if (held.current.kind !== FILE_READ.READY) setRead({ kind: FILE_READ.FAILED });
      return false;
    };
    const { file: open, readFile: read } = latest.current;
    return read({ path: open.path, ...window }).then((answer) => {
      if ("failure" in answer) return missed();
      // Note that what is held moves at once, because the windows above and
      // below may answer in one tick, each to be laid beside the other.
      const next = afterAnswer(held.current, answer);
      held.current = next;
      setRead(next);
      return next.kind === FILE_READ.READY;
    }, missed);
  }, []);

  // The window holding the lit lines, read when the tab opens and whenever
  // the file is opened again on lines not yet drawn: a range that runs on
  // into the next window reads that one too, and lit lines past the file's
  // end, as in a file shortened since, read the window holding its last.
  const readLit = useCallback(() => {
    // Lines already drawn stay drawn until the window holding the lit ones lands.
    if (held.current.kind !== FILE_READ.READY) setRead({ kind: FILE_READ.READING });
    const open = latest.current.file;
    const window = firstWindow(open);
    const end = open.range?.endLine ?? window.firstLine;
    readWindow(window).then(
      (landed) => {
        const standing = held.current;
        if (landed && standing.kind === FILE_READ.READY && standing.lines.length === 0) {
          return readWindow(windowAt(standing.lineCount));
        }
        if (landed && end > window.lastLine) return readWindow(windowAt(end));
        return landed;
      },
      () => false,
    );
  }, [readWindow]);

  // While a find is open, the window above or below what is drawn, one at
  // a time, until the file is whole: each landing draws a fresh run, which
  // asks for the next. Note that a window that did not land ends the
  // reading until the find is opened again, rather than asking at once.
  const finding = useFindOpen();
  const readingRest = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!finding || read.kind !== FILE_READ.READY) return;
    const next = windowUnread(read);
    if (next === undefined || readingRest.current === next.firstLine) return;
    readingRest.current = next.firstLine;
    const missed = () => {
      readingRest.current = undefined;
    };
    readWindow(next).then((landed) => {
      if (!landed) missed();
    }, missed);
  }, [finding, read, readWindow]);

  useEffect(() => {
    if (asked.current === file.opened) return;
    asked.current = file.opened;
    const standing = held.current;
    const range = latest.current.file.range ?? { startLine: 1, endLine: 1 };
    if (standing.kind === FILE_READ.READY && holdsLines(standing, range.startLine, range.endLine)) {
      return;
    }
    readLit();
  }, [file.opened, readLit]);

  // ⌥⌘K hands the agent's message box the lines selected here, pinned to the commit they were read at.
  const commit = read.kind === FILE_READ.READY ? (read.commit ?? file.commit) : undefined;
  const mentionLines =
    page === undefined || drop === undefined || commit === undefined
      ? undefined
      : () => {
          const shown = tab.current;
          const lines = shown === null ? undefined : selectedLines(shown, window.getSelection());
          if (lines === undefined) return;
          const mention = { kind: MENTION_KIND.FILE, path: file.path, lines: { commit, ...lines } };
          drop({
            name: linesName(file.path, lines),
            target: encodeMention(mention, page.doors.place),
          });
        };
  useAppCommand(APP_COMMAND.MENTION_LINES, mentionLines);

  return (
    <section className="file-tab ph-no-capture" aria-label={file.path} ref={tab}>
      {read.kind === FILE_READ.READY ? (
        <FileLinesView file={file} held={read} notes={notes} readWindow={readWindow} />
      ) : read.kind === FILE_READ.READING ? (
        <SpinnerRegion label="Loading file" />
      ) : snippet === undefined ? (
        <div className="side-panel-empty">
          <ReadNotice
            read={read}
            commit={file.commit}
            onRetry={readLit}
            place={ERROR_STATE_PLACEMENT.CENTRED}
          />
        </div>
      ) : (
        <>
          <div className="file-tab-notice">
            <ReadNotice
              read={read}
              commit={file.commit}
              onRetry={readLit}
              place={ERROR_STATE_PLACEMENT.INLINE}
            />
          </div>
          <p className="file-tab-snippet-label">{SNIPPET_LABEL}</p>
          <div className="code-lines file-tab-lines scroll-fade-top" {...look}>
            <CodeLineRows
              firstLine={snippet.firstLine}
              lines={snippet.lines}
              pointed={snippet.ref}
              before={notesBefore(notes)}
            />
          </div>
        </>
      )}
    </section>
  );
}
