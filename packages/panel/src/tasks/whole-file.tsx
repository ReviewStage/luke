import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import { ERROR_STATE_PLACEMENT, ErrorState, Fill, ScrollArea, SpinnerRegion } from "@repo/ui";
import { Cause } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSideBundles } from "../bundle-loader.js";
import type { FileLineRange, FileViewHandle, FileViewProps } from "../diff-view/contract.js";
import { failureShown } from "../failure-report.js";
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

export interface WholeFileNote {
  readonly key: string;
  readonly line: number;
  readonly content: ReactNode;
}

interface ReadNote {
  readonly key: string;
  readonly line: number;
  readonly words: string;
}

export interface WholeFileHandle {
  readonly revealLines: (range: FileLineRange) => void;
  readonly pickedLines: () => FileLineRange | undefined;
}

const NOTE_KEY_ATTRIBUTE = "data-whole-file-note";

const FILE_LOAD_FAILED = "The file could not be shown.";

type FindStep = (typeof FIND_STEP)[keyof typeof FIND_STEP];

const NO_TALLY: FindTally = { count: 0, at: -1 };

function sameReadNotes(a: readonly ReadNote[], b: readonly ReadNote[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (note, at) =>
        note.key === b[at]?.key && note.line === b[at]?.line && note.words === b[at]?.words,
    )
  );
}

function placeOf(range: Range): { line: number | undefined; note: string | undefined } {
  const start = range.startContainer;
  const element = start instanceof Element ? start : start.parentElement;
  const note = element?.closest(`[${NOTE_KEY_ATTRIBUTE}]`)?.getAttribute(NOTE_KEY_ATTRIBUTE);
  if (note !== undefined && note !== null) return { line: undefined, note };
  const row = element?.closest("[data-line]");
  const line = Number(row?.getAttribute("data-line"));
  return { line: Number.isInteger(line) ? line : undefined, note: undefined };
}

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
      pending: false,
      searched: { text: "", notes: [] as readonly ReadNote[] },
      listeners: new Set<(tally: FindTally) => void>(),
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
    const readNotes = (): ReadNote[] =>
      read.current.notes.map((note) => ({
        key: note.key,
        line: note.line,
        words: noteElement(note.key).textContent ?? "",
      }));
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
  useEffect(() => find.clear, [find]);
  useEffect(() => find.refresh());
  return find.paint;
}

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
  findFrom: number;
  reveal?: { readonly range: FileLineRange; readonly at: number } | undefined;
  handleRef?: RefObject<WholeFileHandle | null> | undefined;
  findable?: boolean | undefined;
}): React.JSX.Element {
  const { diffView } = useSideBundles();
  const loaded = useAtomValue(diffView);
  const retry = useAtomRefresh(diffView);
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
  const [drawn, setDrawn] = useState(false);
  const onDrawn = useCallback(() => {
    setDrawn(true);
    paint();
  }, [paint]);
  const props: FileViewProps = {
    name,
    text,
    revision,
    look,
    lit,
    annotations: notes.map((note) => ({ key: note.key, line: note.line })),
    renderAnnotation: elementFor,
    onDrawn,
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
      setDrawn(false);
    };
  }, [module]);
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
    return (
      <ErrorState
        failure={failureShown({
          surface: FAILURE_SURFACE.FILE_READ,
          cause: Cause.squash(loaded.cause),
        })}
        placement={ERROR_STATE_PLACEMENT.CENTERED}
        onRetry={retry}
      >
        {FILE_LOAD_FAILED}
      </ErrorState>
    );
  }
  return (
    <Fill className="whole-file relative">
      <ScrollArea ref={host}>{null}</ScrollArea>
      {!drawn ? (
        <div className="absolute inset-0 flex">
          <SpinnerRegion delay label={readingWords("the file")} />
        </div>
      ) : null}
      {notes.map((note) => createPortal(note.content, elementFor(note.key), note.key))}
    </Fill>
  );
}
