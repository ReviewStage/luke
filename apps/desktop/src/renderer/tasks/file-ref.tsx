import type { CodeRef } from "@luke/features/task-wire";
import type { TaskCodeShowing } from "@luke/features/tasks-view";
import { InlineRef } from "@luke/panel/inline-ref";
import {
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  INLINE_REF_LOOK,
  INLINE_REF_NAME,
} from "@luke/ui";
import { fileFolder, fileName, fileRefText, lineRangeText } from "@luke/voice/code-pane-model";
import { shownWhereRead } from "./file-tab-model";
import { FileTypeIcon } from "./file-type-icon";

/**
 * file-ref.tsx -- a file named anywhere in the window: its look as a row wears it, the card its tab hangs, and its mark, path, and lines as the one button that hangs that card and opens its tab.
 *
 * A file of the task's repository is named in many places beside its own
 * tab: a code card's head, an inbox item's code, the side panel's "+", the
 * task's summary, ⌘K, and a `show_code` row in a transcript. Each wears
 * the file's type icon, as the file tree draws it (`file-type-icon.tsx`),
 * before its name, says its lines one way (`lineRangeText`), and hangs the
 * file's tab's own card while the pointer rests on it: the file's whole
 * path, and Luke's note on the lines where the place knows one. A press or
 * Enter shows the file's tab through the side panel's one door for it
 * (`SidePanelControl.onOpenFile`): the tab it has, or a new one at the
 * strip's end, on the lines the place names, where it names any.
 */

/** A file as a row names it, in a menu, the summary, or ⌘K: its type's icon, its name, its folder after the name, and the whole path a search finds it by. */
export interface FileLook {
  readonly icon: React.JSX.Element;
  readonly label: string;
  readonly detail: string | undefined;
  readonly terms: readonly string[];
}

/** How a file is named in a row, and its tab's icon and name the same. */
export function fileLook(path: string): FileLook {
  const name = fileName(path);
  return {
    icon: <FileTypeIcon name={name} />,
    label: name,
    detail: fileFolder(path),
    terms: [path],
  };
}

/** Where a file is read: the task's repository, none before one is chosen, and the commit a tab is pinned to, none for the default branch's head. */
export interface FileRead {
  readonly repository: string | null;
  readonly commit: string | undefined;
}

/**
 * Luke's note on the newest lines of the file he showed with one, if any,
 * which the file's card says: of those read where the file is read, as a
 * File tab's notes are (`notesOf`), so a card never speaks of another
 * repository's file of the same path, nor of another commit than its tab's.
 */
export function newestFileNote(
  shown: readonly TaskCodeShowing[],
  path: string,
  read: FileRead,
): string | undefined {
  return shown.findLast(
    ({ code }) =>
      code.ref.path === path &&
      code.note !== undefined &&
      (read.repository === null || code.repository === read.repository) &&
      shownWhereRead(code, read.commit),
  )?.code.note;
}

/**
 * A file's card, its tab's and every place naming it, drawn from the parts
 * every hover card is (`@luke/ui`'s `HoverCard`): the file's type icon and its
 * whole path, its repository under the path where the place names one, and
 * under them Luke's note on its lines, where the place knows one.
 */
export function FileCard({
  path,
  repository,
  note,
}: {
  path: string;
  /** The repository the file is of, under its path, where the place names one. */
  repository?: string | undefined;
  note: string | undefined;
}): React.JSX.Element {
  return (
    <HoverCard data-tab-card="" data-file-card="">
      <HoverCardHead glyph={<FileTypeIcon name={fileName(path)} />} name={path} sub={repository} />
      {note === undefined ? null : <HoverCardNote>{note}</HoverCardNote>}
    </HoverCard>
  );
}

/**
 * A file named in place: its type's icon, its path, cut from the left so
 * the file's own name stays in sight, and the lines it points at, as one
 * button that hangs the file's card while the pointer rests on it and shows
 * the file's tab on a press. With no `onOpen` the file cannot be opened
 * from here, and it is plain words that hang the card alone.
 */
export function FileRef({
  codeRef,
  note,
  onOpen,
}: {
  codeRef: CodeRef;
  /** Luke's note on the lines, which the card says; none where the place knows none. */
  note: string | undefined;
  /** Shows the file's tab on the reference's lines; none where the file cannot be opened from here. */
  onOpen: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <InlineRef
      look={INLINE_REF_LOOK.LINK}
      glyph={<FileTypeIcon name={fileName(codeRef.path)} />}
      label={codeRef.path}
      name={INLINE_REF_NAME.PATH}
      state={lineRangeText(codeRef)}
      onPress={onOpen === undefined ? undefined : () => onOpen()}
      pressLabel={onOpen === undefined ? undefined : `Open ${fileRefText(codeRef)}`}
      card={<FileCard path={codeRef.path} note={note} />}
      data-file-ref=""
    />
  );
}
