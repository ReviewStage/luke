import type { PlanFileRequest } from "@sidecar/hosted/plan-wire";
import type { PlanCode, PlanningFileAnswer } from "@sidecar/hosted/planning-view";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BusyLabel, SpinnerRegion } from "../spinner";
import { CodeLineRows, centreWithin } from "./code-pane";
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
  withWindow,
} from "./file-tab-model";
import { useFileViewSettings } from "./file-view-settings";
import type { OpenFile } from "./use-side-panel";

/**
 * file-tab.tsx -- a File tab: one whole file of the open plan's repository, opened from a snippet Luke showed, its lines lit and scrolled into view.
 *
 * The Code tab's cards hold the lines a snippet pointed at and a few around
 * them; opening a card's file draws the file whole here, numbered and
 * coloured as the cards are. The file is read through the service a window
 * at a time (`ACT_KIND.PLANNING_FILE`), first the window holding the
 * snippet's lines, then the window above or below as the developer scrolls
 * to the top or the bottom of what is drawn, so a long file costs one
 * window until it is read further. Note that the service reads the file
 * from GitHub as it stands now on the repository's default branch, not from
 * the checkout the snippet was read from: a file changed since is drawn as
 * it is now, the snippet's lines lit where they fall, and a file gone, or
 * one the service refuses, says so in the file's place, over the lines Luke
 * showed of it where the plan holds them. The tab draws no heading of its
 * own: the File view's bar over it names the file and offers what is done
 * with it (`file-view.tsx`), told how the read stands as it moves. The lines
 * are drawn numbered or not, wrapped or not, as every File tab is
 * (`file-view-settings.ts`). Every line here is
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
export type ReadFileWindow = (window: PlanFileRequest) => Promise<PlanningFileAnswer>;

/**
 * The row standing above or below the drawn lines while the file goes on
 * past them: the next window is read as the row scrolls into view, or on
 * its press after a read that failed, as the Work tab reads earlier work.
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
        {read === EDGE_READ.FAILED ? "Could not read these lines. Try again" : label}
      </BusyLabel>
    </button>
  );
}

/** The run of lines held after a window's answer, or why there is none. */
function afterAnswer(held: FileRead, answer: PlanningFileAnswer): FileRead {
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
  readWindow,
}: {
  file: OpenFile;
  held: FileLines;
  readWindow: (window: FileWindow) => Promise<boolean>;
}): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null);
  const centred = useRef<number | undefined>(undefined);
  const { settings } = useFileViewSettings();
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
    <div
      className="code-lines file-tab-lines"
      ref={scroller}
      data-line-numbers={String(settings.lineNumbers)}
      data-wrap={String(settings.wordWrap)}
    >
      {above === undefined ? null : (
        <EdgeRow
          key={above.firstLine}
          label={`Show lines ${above.firstLine}–${above.lastLine}`}
          onRead={() => readWindow(above)}
        />
      )}
      <CodeLineRows firstLine={held.firstLine} lines={held.lines} pointed={pointed} />
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

/** Why a file read is not drawn, and the offer to read again where the reason may pass. */
function ReadNotice({
  read,
  onRetry,
}: {
  read: Exclude<FileRead, { kind: typeof FILE_READ.READY | typeof FILE_READ.READING }>;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <>
      <p className="m-0">
        {read.kind === FILE_READ.REFUSED
          ? refusalLine(read.refusal, read.branch)
          : "The file could not be read."}
      </p>
      {read.kind === FILE_READ.FAILED || refusalPasses(read.refusal) ? (
        <button type="button" className="toolbar-button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </>
  );
}

/** The tab: the file, or why it is not shown over the lines Luke showed of it. */
export function FileTab({
  file,
  snippet,
  readFile,
  onRead,
}: {
  file: OpenFile;
  /** The lines Luke showed of the file, drawn where the file cannot be. */
  snippet: PlanCode | undefined;
  readFile: ReadFileWindow;
  /** Hears how the read of the file stands each time it moves, the bar over the tab offering what it allows. */
  onRead: (read: FileRead) => void;
}): React.JSX.Element {
  const [read, setRead] = useState<FileRead>({ kind: FILE_READ.READING });
  const held = useRef<FileRead>(read);
  held.current = read;
  const told = useRef(onRead);
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

  return (
    <section className="file-tab ph-no-capture" aria-label={file.path}>
      {read.kind === FILE_READ.READY ? (
        <FileLinesView file={file} held={read} readWindow={readWindow} />
      ) : read.kind === FILE_READ.READING ? (
        <SpinnerRegion label="Loading file" />
      ) : snippet === undefined ? (
        <div className="side-panel-empty" role="alert">
          <ReadNotice read={read} onRetry={readLit} />
        </div>
      ) : (
        <>
          <div className="file-tab-notice" role="alert">
            <ReadNotice read={read} onRetry={readLit} />
          </div>
          <p className="file-tab-snippet-label">{SNIPPET_LABEL}</p>
          <div className="code-lines file-tab-lines">
            <CodeLineRows
              firstLine={snippet.firstLine}
              lines={snippet.lines}
              pointed={snippet.ref}
            />
          </div>
        </>
      )}
    </section>
  );
}
