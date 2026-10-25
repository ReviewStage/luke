import { DIFF_INDICATORS, INLINE_DIFF } from "@luke/settings/diff-view";
import { cssCustomProperties } from "@luke/ui";
import { useEffect, useState } from "react";
import { LINE_HEIGHT_RATIO } from "../code-type.js";
import { DIFF_SELECTION_SIDE, type DiffLook } from "../diff-view/contract.js";
import {
  litSelection,
  noteRange,
  pointedRange,
  type SnippetLines,
  snippetPatch,
  snippetRange,
} from "./code-snippet-model.js";
import { PierreDiff, type PierreDiffNote, useDiffLook } from "./file-diff.js";
import { FileNoteAnnotation, type FileNotes, type NoteLines, noteLineOf } from "./file-note.js";
import type { FileNote } from "./file-tab-model.js";
import { useFileViewSettings } from "./file-view-settings.js";

/**
 * code-snippet.tsx -- a snippet of a file as Luke draws every line of one: Pierre's diff (`../diff-view/`) holding the snippet's lines as a hunk that changes nothing, numbered from where they sit in the file, the lines pointed at lit, and Luke's note under the last of them; a Code tab card's, an inbox item's code, and a File tab's snippet where its file cannot be read.
 *
 * The lines follow View settings as a File tab's and a diff's do: the
 * theme, the type, wrap and the numbers, drawn unified with no marks and no
 * tints, so the lines read as the file's own (`code-snippet-model.ts`). A
 * snippet is mounted as it comes near the view, a feed of hundreds of
 * cards mounting only those read, and coloured off the window's thread in
 * the pool its diffs share (`pooled`), plain until the colours land.
 *
 * Luke's note stands under the last line it is on, on the card every
 * annotation on code stands on (`file-note.tsx`): his mark, his name and
 * how long ago, ⋯ with View in conversation and Copy link, and the lines it
 * is on lit while the pointer or the keyboard rests on it. It folds to its
 * head, and with Minimize inline comments on it is drawn small, as review
 * threads are, as one chip floating at the end of its line
 * (`minimized-threads.tsx`), which shows it or puts it away.
 */

/** How far past the view a snippet is mounted, so it is drawn by the time it is scrolled to. */
const NEAR_VIEW_MARGIN = "800px 0px";

/**
 * Whether an element has come near the view, and the door it is handed
 * through; near once, it stays so. Where nothing observes the view, as
 * under a test's document, it is near at once.
 */
function useNearView(): [(element: HTMLElement | null) => void, boolean] {
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (near || element === null) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: NEAR_VIEW_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, element]);
  return [setElement, near];
}

/** How a snippet is drawn: the File tabs' theme, type, wrap and numbers, unified, with nothing marked or tinted, since nothing in it changed. */
function useSnippetLook(): DiffLook {
  return {
    ...useDiffLook(false),
    indicators: DIFF_INDICATORS.NONE,
    inlineDiff: INLINE_DIFF.NONE,
    backgrounds: false,
  };
}

/**
 * Whether a minimized note is shown under its chip, and the door that shows
 * or hides it; put away again whenever the setting changes, as a review
 * thread's chip is.
 */
function useChipShown(minimize: boolean): [boolean, (shown: boolean) => void] {
  const [shown, setShown] = useState({ of: minimize, shown: false });
  return [shown.of === minimize && shown.shown, (next) => setShown({ of: minimize, shown: next })];
}

/**
 * One of Luke's notes as it stands under the snippet's lines, as a File tab
 * draws it (`FileNoteAnnotation`): his card, or with Minimize inline
 * comments on, the chip that shows it, which lights the note's lines as the
 * card does while the pointer rests on it.
 */
function SnippetNoteContent({
  note,
  notes,
  onLight,
}: {
  note: FileNote;
  notes: FileNotes;
  onLight: (lines: NoteLines | undefined) => void;
}): React.JSX.Element {
  const { settings } = useFileViewSettings();
  const minimize = settings.diffMinimizeComments;
  const [shown, setShown] = useChipShown(minimize);
  const annotation = (
    <FileNoteAnnotation
      note={note}
      notes={{ ...notes, onLight }}
      minimized={minimize ? { shown, onShown: setShown } : undefined}
    />
  );
  if (!minimize) return annotation;
  const lines = { startLine: note.startLine, endLine: note.endLine };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the pointer resting on the chip only lights the lines its note is on; the chip inside is what is pressed.
    <div
      className="diff-thread-lines"
      onMouseEnter={() => onLight(lines)}
      onMouseLeave={() => onLight(undefined)}
    >
      {annotation}
    </div>
  );
}

/**
 * A snippet's own note, the Code tab card's: one note on the lines it
 * points at, or on every line it draws for a file shown from its top,
 * folded where the card folded it; none where its agent wrote none.
 */
export function useSnippetNote(
  code: SnippetLines,
  shown: Pick<FileNote, "callId" | "turnId" | "agentId" | "shownAt"> & {
    readonly note: string | undefined;
  },
  taskId: string | undefined,
  agentLabel?: FileNotes["agentLabel"],
): FileNotes | undefined {
  const [folded, setFolded] = useState<readonly string[]>([]);
  const lines = noteRange(code);
  if (shown.note === undefined || lines === undefined) return undefined;
  return {
    notes: [
      {
        callId: shown.callId,
        turnId: shown.turnId,
        agentId: shown.agentId,
        shownAt: shown.shownAt,
        note: shown.note,
        ...lines,
      },
    ],
    folded,
    onFold: (callId, fold) =>
      setFolded((was) => (fold ? [...was, callId] : was.filter((each) => each !== callId))),
    taskId,
    agentLabel,
  };
}

/**
 * A snippet's lines drawn by the diff bundle once near the view, those it
 * points at lit, or a note's while the pointer rests on it, and each of
 * Luke's notes on them under the last line it is on: a note running past
 * the snippet's end stands under its last line, as long as it begins in
 * the snippet, as a File tab's does on a file since shortened. Until it is
 * near, and while the bundle loads, the place stands empty at about the
 * height the lines will take, so a feed does not jump as cards mount.
 */
export function CodeSnippet({
  code,
  notes,
}: {
  code: SnippetLines;
  /** Luke's notes on the lines, which of them are folded, and what a card asks; none where the snippet has none. */
  notes?: FileNotes | undefined;
}): React.JSX.Element | null {
  const [place, near] = useNearView();
  const look = useSnippetLook();
  const [lit, setLit] = useState<NoteLines | undefined>(undefined);
  const patch = snippetPatch(code);
  const drawn = snippetRange(code);
  if (patch === undefined || drawn === undefined) return null;
  if (!near) {
    return (
      <div
        ref={place}
        className="h-snippet-pending"
        style={cssCustomProperties({
          "--snippet-rows": code.lines.length,
          "--snippet-row": `${Number(look.fontSize) * Number(LINE_HEIGHT_RATIO[look.lineHeight])}px`,
        })}
      />
    );
  }
  const placed: PierreDiffNote[] = (notes?.notes ?? [])
    .flatMap((note) => {
      const line = noteLineOf(note, drawn.endLine);
      return line === undefined || line < drawn.startLine ? [] : [{ note, line }];
    })
    .map(({ note, line }) => ({
      key: note.callId,
      side: DIFF_SELECTION_SIDE.ADDITIONS,
      line,
      content:
        notes === undefined ? null : (
          <SnippetNoteContent note={note} notes={notes} onLight={setLit} />
        ),
    }));
  return (
    <PierreDiff
      patch={patch}
      look={look}
      selected={litSelection(lit ?? pointedRange(code))}
      excerpt
      notes={placed}
      pooled
      className="diff-view code-snippet select-text"
    />
  );
}
