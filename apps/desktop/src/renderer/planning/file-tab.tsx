import type { PlanFileRequest } from "@sidecar/hosted/plan-wire";
import type { PlanningFileAnswer } from "@sidecar/hosted/planning-view";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Tooltip } from "../tooltip";
import { CodeLineRows, centreWithin } from "./code-pane";
import { rangeLabel } from "./code-pane-model";
import {
  FILE_READ,
  FILE_REFUSAL_LINE,
  type FileLines,
  type FileRead,
  type FileWindow,
  holdsLines,
  lastLineOf,
  refusalPasses,
  windowAt,
  withWindow,
} from "./file-tab-model";
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
 * one the service refuses, says so in the file's place. Every line here is
 * the repository's, so the root is left out of the screen recording
 * (`ph-no-capture`) as a second line behind the recording's text masking.
 */

/** What the heading says of where the lines come from. */
const SOURCE_LABEL = "Latest on GitHub";
const SOURCE_HINT =
  "The file as it stands now on the repository's default branch, which may have changed since Luke showed it.";

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
      {read === EDGE_READ.READING
        ? "Reading…"
        : read === EDGE_READ.FAILED
          ? "Could not read these lines. Try again"
          : label}
    </button>
  );
}

/** The run of lines held after a window's answer, or why there is none. */
function afterAnswer(held: FileRead, answer: PlanningFileAnswer): FileRead {
  if ("file" in answer) return { kind: FILE_READ.READY, ...withWindow(held, answer.file) };
  if ("refusal" in answer) return { kind: FILE_READ.REFUSED, refusal: answer.refusal };
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
    <div className="code-lines file-tab-lines" ref={scroller}>
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

/** The tab: its file's heading, then the file, or why it is not shown. */
export function FileTab({
  file,
  readFile,
}: {
  file: OpenFile;
  readFile: ReadFileWindow;
}): React.JSX.Element {
  const [read, setRead] = useState<FileRead>({ kind: FILE_READ.READING });
  const held = useRef<FileRead>(read);
  held.current = read;
  const label =
    file.range === undefined ? undefined : rangeLabel({ path: file.path, ...file.range });

  // One window read and laid beside what is held, answering whether it
  // landed. Note that a read of more lines that did not land leaves the
  // lines drawn as they were, because only its own row has failed.
  const readWindow = useCallback(
    (window: FileWindow) => {
      const missed = () => {
        if (held.current.kind !== FILE_READ.READY) setRead({ kind: FILE_READ.FAILED });
        return false;
      };
      return readFile({ path: file.path, ...window }).then((answer) => {
        if ("failure" in answer) return missed();
        // Note that what is held moves at once, because the windows above and
        // below may answer in one tick, each to be laid beside the other.
        const next = afterAnswer(held.current, answer);
        held.current = next;
        setRead(next);
        return next.kind === FILE_READ.READY;
      }, missed);
    },
    [readFile, file.path],
  );

  // The window holding the lit lines, read when the tab opens and whenever
  // the file is opened again on lines not yet drawn; a range that runs on
  // into the next window reads that one too.
  const readLit = useCallback(() => {
    // Lines already drawn stay drawn until the window holding the lit ones lands.
    if (held.current.kind !== FILE_READ.READY) setRead({ kind: FILE_READ.READING });
    const window = firstWindow(file);
    const end = file.range?.endLine ?? window.firstLine;
    readWindow(window).then(
      (landed) => {
        if (landed && end > window.lastLine) return readWindow(windowAt(end));
        return landed;
      },
      () => false,
    );
  }, [file, readWindow]);

  useEffect(() => {
    const standing = held.current;
    const range = file.range ?? { startLine: 1, endLine: 1 };
    if (standing.kind === FILE_READ.READY && holdsLines(standing, range.startLine, range.endLine)) {
      return;
    }
    readLit();
    // Note that the file opened again is what asks, so `opened` is the dependency.
  }, [file.opened, readLit]);

  return (
    <section className="file-tab ph-no-capture" aria-label={file.path}>
      <header className="code-card-header file-tab-header">
        <Tooltip label={file.path}>
          <span className="code-card-path">
            <bdi>{file.path}</bdi>
          </span>
        </Tooltip>
        {label === undefined ? null : <span className="code-card-range">{label}</span>}
        <Tooltip label={SOURCE_HINT}>
          <span className="file-tab-source">{SOURCE_LABEL}</span>
        </Tooltip>
      </header>
      {read.kind === FILE_READ.READY ? (
        <FileLinesView file={file} held={read} readWindow={readWindow} />
      ) : (
        <div
          className="side-panel-empty"
          role={read.kind === FILE_READ.READING ? undefined : "alert"}
        >
          {read.kind === FILE_READ.READING ? <p className="m-0">Reading the file…</p> : null}
          {read.kind === FILE_READ.REFUSED ? (
            <p className="m-0">{FILE_REFUSAL_LINE[read.refusal]}</p>
          ) : null}
          {read.kind === FILE_READ.FAILED ? (
            <p className="m-0">The file could not be read.</p>
          ) : null}
          {read.kind === FILE_READ.FAILED ||
          (read.kind === FILE_READ.REFUSED && refusalPasses(read.refusal)) ? (
            <button type="button" className="toolbar-button" onClick={readLit}>
              Try again
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
