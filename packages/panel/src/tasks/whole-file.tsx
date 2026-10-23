import { useAtomValue } from "@effect/atom-react";
import { EmptyState, Fill, ScrollArea, SpinnerRegion } from "@luke/ui";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSideBundles } from "../bundle-loader.js";
import type { FileLineRange, FileViewHandle, FileViewProps } from "../diff-view/contract.js";
import { type FIND_STEP, type FindSource, type FindTally, useFindSource } from "../find-in-tab.js";
import {
  type FindPainting,
  findRanges,
  NO_PAINTING,
  repaint,
  reveal,
  selectedWords,
  watchText,
} from "../find-matches.js";
import { useDiffLook } from "./file-diff.js";
import { type FileMatch, fileMatches, matchFrom } from "./file-find.js";

/**
 * whole-file.tsx -- a whole file drawn as every code is, by Pierre's diffs: a File tab's file, a page's source, a text file opened over the window, in the look View settings chose, its lines lit, and each note under its line.
 *
 * The diff bundle draws the file (`../diff-view/index.ts`'s `mountFile`),
 * loaded the first time code is shown: only the lines near the view, in a
 * shadow root of its own, coloured off the window's thread, plain until the
 * colours land. The look is the diffs' own (`file-diff.tsx`'s
 * `useDiffLook`), so wrap, numbers, theme, and type are one setting for
 * every code the window draws. A note is a React tree the view draws into
 * the element the bundle keeps under its line, through a portal, as Files
 * changed draws its threads (`diff-list.tsx`).
 *
 * Since most of a long file's lines are in no DOM, ⌘F finds in its text
 * rather than the DOM's (`file-find.ts`), and in its notes' cards, which
 * React draws whether or not their lines are in view, handed to the tab's
 * scope as a source of its own: the bar counts every match in the file and its notes,
 * a step scrolls the file to its match's line, and the matches Pierre has
 * drawn are painted, read again each time the lines drawn change, the one
 * the find is at brought into view, with a folded card or a chip around it
 * opened, as the DOM's find opens one.
 */

/** A note drawn under a line of the file: its key, the line, and the tree the view draws for it. */
export interface WholeFileNote {
  readonly key: string;
  readonly line: number;
  readonly content: ReactNode;
}

/** A note as a find reads it: where it stands, and the words its card holds as it was last read. */
interface ReadNote {
  readonly key: string;
  readonly line: number;
  readonly words: string;
}

/** What the file's owner asks of it once drawn: a run of lines centred, and the lines the reader picked. */
export interface WholeFileHandle {
  readonly revealLines: (range: FileLineRange) => void;
  readonly pickedLines: () => FileLineRange | undefined;
}

/** The attribute the element each note is drawn in names its key by, which a find reads a match's note from. */
const NOTE_KEY_ATTRIBUTE = "data-whole-file-note";

/** What stands in the file's place where the diff bundle failed to load. */
const FILE_LOAD_FAILED = "The file could not be shown.";

/** How a find steps. */
type FindStep = (typeof FIND_STEP)[keyof typeof FIND_STEP];

/** No matches. */
const NO_TALLY: FindTally = { count: 0, at: -1 };

/** Whether two runs of notes read alike to a find: the same words under the same lines by the same keys. */
function sameReadNotes(a: readonly ReadNote[], b: readonly ReadNote[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (note, at) =>
        note.key === b[at]?.key && note.line === b[at]?.line && note.words === b[at]?.words,
    )
  );
}

/** The line a range of drawn words stands on, read from the row Pierre drew it in, or the note its words are in. */
function placeOf(range: Range): { line: number | undefined; note: string | undefined } {
  const start = range.startContainer;
  const element = start instanceof Element ? start : start.parentElement;
  const note = element?.closest(`[${NOTE_KEY_ATTRIBUTE}]`)?.getAttribute(NOTE_KEY_ATTRIBUTE);
  if (note !== undefined && note !== null) return { line: undefined, note };
  const row = element?.closest("[data-line]");
  const line = Number(row?.getAttribute("data-line"));
  return { line: Number.isInteger(line) ? line : undefined, note: undefined };
}

/**
 * Which of the drawn ranges a match is: the `nth` of those on its line, or
 * in its note; -1 where it is not drawn.
 */
function drawnAt(ranges: readonly Range[], match: FileMatch | undefined): number {
  if (match === undefined) return -1;
  let seen = 0;
  return ranges.findIndex((range) => {
    const place = placeOf(range);
    const here = match.note === undefined ? place.line === match.line : place.note === match.note;
    if (!here) return false;
    seen += 1;
    return seen - 1 === match.nth;
  });
}

/**
 * The find over the file, as its scope's source: matches read from the
 * latest text and notes, painted where drawn. `paint` is what the view runs
 * each time Pierre draws lines anew.
 */
function useWholeFileFind(
  host: RefObject<HTMLDivElement | null>,
  read: RefObject<{ text: string; notes: readonly WholeFileNote[]; from: number }>,
  noteElement: (key: string) => HTMLElement,
  handle: RefObject<FileViewHandle | undefined>,
  findable: boolean,
): () => void {
  const [find] = useState(() => {
    const state = {
      query: "",
      matches: [] as FileMatch[],
      at: -1,
      painting: NO_PAINTING as FindPainting,
      // Whether the match the find is at still waits to be brought into view, once drawn.
      pending: false,
      // The text and notes the matches were read from.
      searched: { text: "", notes: [] as readonly ReadNote[] },
      listeners: new Set<(tally: FindTally) => void>(),
      // The note cards watched while a query stands, each with what stops its watch.
      watching: new Map<string, () => void>(),
    };
    const tell = () => {
      const tally = { count: state.matches.length, at: state.at };
      for (const listener of state.listeners) listener(tally);
    };
    const paint = () => {
      const root = host.current;
      if (root === null || state.query.length === 0) return;
      const ranges = findRanges(root, state.query);
      const at = drawnAt(ranges, state.matches[state.at]);
      const next = { ranges, at };
      repaint(state.painting, next);
      state.painting = next;
      const current = ranges[at];
      if (state.pending && current !== undefined) {
        state.pending = false;
        reveal(current, root);
      }
    };
    const go = () => {
      tell();
      const match = state.matches[state.at];
      state.pending = match !== undefined;
      if (match !== undefined)
        handle.current?.revealLines({ startLine: match.line, endLine: match.line });
      paint();
    };
    // Note that a note's words are read from the card the view draws for it, which React draws whether or not Pierre has its line in view.
    const readNotes = (): ReadNote[] =>
      read.current.notes.map((note) => ({
        key: note.key,
        line: note.line,
        words: noteElement(note.key).textContent ?? "",
      }));
    // Note that a card is watched while a query stands, since it draws its own words anew, its age among them, with no draw of the file's.
    const watchNotes = () => {
      const standing = new Set(read.current.notes.map((note) => note.key));
      for (const [key, stop] of state.watching) {
        if (standing.has(key)) continue;
        stop();
        state.watching.delete(key);
      }
      for (const note of read.current.notes) {
        if (!state.watching.has(note.key)) {
          state.watching.set(
            note.key,
            watchText(noteElement(note.key), () => refresh()),
          );
        }
      }
    };
    const unwatchNotes = () => {
      for (const stop of state.watching.values()) stop();
      state.watching.clear();
    };
    const readMatches = () => {
      watchNotes();
      const { text, notes } = read.current;
      state.searched = { text, notes: readNotes() };
      const counted = notes.map((note) => ({
        key: note.key,
        line: note.line,
        matches: findRanges(noteElement(note.key), state.query).length,
      }));
      return fileMatches(text.split("\n"), counted, state.query);
    };
    const search = (query: string) => {
      state.query = query;
      state.matches = readMatches();
      state.at = matchFrom(state.matches, read.current.from);
      go();
    };
    // Note that matches are read again where the text or the notes changed under an open find, as a note Luke adds, the find kept at the match it was at where that still stands, and nothing scrolled.
    const refresh = () => {
      if (state.query.length === 0) return;
      const { text } = read.current;
      if (text === state.searched.text && sameReadNotes(readNotes(), state.searched.notes)) return;
      const was = state.matches[state.at];
      state.matches = readMatches();
      const kept = state.matches.findIndex(
        (match) => match.line === was?.line && match.note === was.note && match.nth === was.nth,
      );
      state.at = kept !== -1 ? kept : matchFrom(state.matches, was?.line ?? read.current.from);
      tell();
      paint();
    };
    const source: FindSource = {
      search,
      step: (query: string, step: FindStep) => {
        if (query !== state.query) return search(query);
        const count = state.matches.length;
        if (count === 0) return tell();
        state.at = (state.at + step + count) % count;
        go();
      },
      clear: () => {
        repaint(state.painting, NO_PAINTING);
        state.painting = NO_PAINTING;
        state.query = "";
        state.matches = [];
        state.at = -1;
        state.pending = false;
        unwatchNotes();
        for (const listener of state.listeners) listener(NO_TALLY);
      },
      onTally: (listener) => {
        state.listeners.add(listener);
        return () => state.listeners.delete(listener);
      },
      selection: () => (host.current === null ? undefined : selectedWords(host.current)),
    };
    return { source, paint, refresh, clear: source.clear };
  });
  useFindSource(findable ? find.source : undefined);
  // Note that the tints are taken away with the file, since they name ranges of its rows.
  useEffect(() => find.clear, [find]);
  useEffect(() => find.refresh());
  return find.paint;
}

/**
 * A whole file drawn by the diff bundle in the place it fills, scrolling
 * there: `text` named `name`, read at `revision`, `lit` lit, each of `notes`
 * under its line. `reveal` centres a run of lines each time its `at`
 * changes, once the file is drawn.
 */
export function WholeFile({
  name,
  text,
  revision,
  lit,
  notes,
  findFrom,
  reveal: revealed,
  handleRef,
  findable = true,
}: {
  name: string;
  text: string;
  revision: string;
  lit: FileLineRange | undefined;
  notes: readonly WholeFileNote[];
  /** The line a find starts from, the first of the lines the tab was opened on. */
  findFrom: number;
  /** A run of lines to centre, again each time `at` changes; none leaves the file at its top. */
  reveal?: { readonly range: FileLineRange; readonly at: number } | undefined;
  handleRef?: RefObject<WholeFileHandle | null> | undefined;
  /**
   * Whether ⌘F over the tab finds in the file: false where the file is
   * drawn over the window rather than in the tab, as a text file opened from
   * a message is, so the tab's find stays the tab's own.
   */
  findable?: boolean | undefined;
}): React.JSX.Element {
  const loaded = useAtomValue(useSideBundles().diffView);
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<FileViewHandle | undefined>(undefined);
  const look = useDiffLook(true);
  const elements = useRef(new Map<string, HTMLElement>());
  const elementFor = useCallback((key: string) => {
    const held = elements.current.get(key);
    if (held !== undefined) return held;
    const element = document.createElement("div");
    element.setAttribute(NOTE_KEY_ATTRIBUTE, key);
    elements.current.set(key, element);
    return element;
  }, []);
  const read = useRef({ text: "", notes: [] as readonly WholeFileNote[], from: 1 });
  read.current = { text, notes, from: findFrom };
  const paint = useWholeFileFind(host, read, elementFor, handle, findable);
  const props: FileViewProps = {
    name,
    text,
    revision,
    look,
    lit,
    annotations: notes.map((note) => ({ key: note.key, line: note.line })),
    renderAnnotation: elementFor,
    onDrawn: paint,
  };
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const element = host.current;
    if (module === undefined || element === null) return undefined;
    const mounted = module.mountFile(element, latest.current);
    handle.current = mounted;
    return () => {
      handle.current = undefined;
      mounted.unmount();
    };
  }, [module]);
  // Note that the bundle draws again only what changed, so it is handed every draw.
  useEffect(() => handle.current?.update(props));

  const revealedAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (revealed === undefined || handle.current === undefined) return;
    if (revealedAt.current === revealed.at) return;
    revealedAt.current = revealed.at;
    handle.current.revealLines(revealed.range);
  });

  if (handleRef !== undefined) {
    handleRef.current = {
      revealLines: (range) => handle.current?.revealLines(range),
      pickedLines: () => handle.current?.pickedLines(),
    };
  }

  if (AsyncResult.isFailure(loaded)) {
    return <EmptyState>{FILE_LOAD_FAILED}</EmptyState>;
  }
  return (
    <Fill className="whole-file">
      <ScrollArea ref={host}>{null}</ScrollArea>
      {module === undefined ? (
        <div className="whole-file-wait">
          <SpinnerRegion delay label="Loading file" />
        </div>
      ) : null}
      {notes.map((note) => createPortal(note.content, elementFor(note.key), note.key))}
    </Fill>
  );
}
