import { LINK_PLACE, type LinkPlace } from "@luke/features/luke-link";
import {
  DisclosureAction,
  IconButton,
  Time,
  Tooltip,
  useMenu,
  useMinute,
  WingFace,
} from "@luke/ui";
import { lineRangeText } from "@luke/voice/code-pane-model";
import { EllipsisIcon, MessagesSquareIcon } from "lucide-react";
import { useCopyLinkItem } from "../copy-link-item.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { MarkdownMessage } from "../markdown-message.js";
import { AnnotationCard, AnnotationComment, AnnotationComments } from "./annotation-card.js";
import type { FileNote } from "./file-tab-model.js";
import { chipPress, MinimizedChip } from "./minimized-threads.js";
import { useMentionLink } from "./task-mentions.js";
import { useOpenLink, useOpenPlace } from "./use-open-link.js";

/**
 * file-note.tsx -- an agent's note on lines of a File tab's file: the card every annotation on code stands on, under the last line it showed, saying why it showed them, as a review thread stands under the lines it is on.
 *
 * An agent writes a sentence or two beside every range of code it shows
 * (`show_code`'s note). A File tab opened on that file draws the note under
 * the range's last line, one card a range, on the shared card
 * (`annotation-card.tsx`), so lit lines say why they are lit: the wing
 * mark and the agent's name as its tab names it, how long ago, and its
 * words as Markdown. Its ⋯ offers View in conversation, which opens the
 * agent's tab at the turn that showed the lines, and Copy link, that
 * turn's link (`LINK_PLACE.MESSAGE`). The pointer
 * on a card, or the keyboard in it, lights the lines it is on, as a review
 * thread lights its own. A card folds to its head alone, and the tab keeps
 * which it folded (`use-side-panel.ts`). While Minimize inline comments is
 * on, a card stands put away behind a chip at the end of its line, the
 * wing mark on it, as a review thread does in Files changed
 * (`minimized-threads.tsx`). The tab's find reads the notes' words from
 * their Markdown (`file-find.ts`) and opens a folded card, or a chip, whose
 * words it brings into view; the recording's text masking covers them.
 */

/** What a note's agent is called where the task lists no such agent, or the record has not named it yet. */
const UNNAMED_AUTHOR = "Agent";

/** What a note's ⋯ is called, and what it offers. */
const NOTE_WORDS = {
  MENU: "Note actions",
  VIEW_CONVERSATION: "View in conversation",
} as const;

/** What a chip says of an agent's note, and what pressing it does. */
const CHIP_LABEL = (author: string, lines: string, shown: boolean) =>
  `${author}'s note on ${lines.toLowerCase()}, ${chipPress(shown)}`;

/** A run of a file's lines, from its first to its last. */
export interface NoteLines {
  readonly startLine: number;
  readonly endLine: number;
}

/** A File tab's notes, which of them it folded, and what a card asks of the panel. */
export interface FileNotes {
  readonly notes: readonly FileNote[];
  /** The calls whose notes the tab folded. */
  readonly folded: readonly string[];
  readonly onFold: (callId: string, folded: boolean) => void;
  /** The task the notes were shown on, under which a note's link names its agent's turn; none offers no link. */
  readonly taskId: string | undefined;
  /** An agent on the task as its tab names it, which a note is headed by; none for an agent not listed. */
  readonly agentLabel?: ((agentId: string) => string | undefined) | undefined;
  /** Told the lines a note lights while the pointer or the keyboard is on it, and none once it leaves. */
  readonly onLight?: ((lines: NoteLines | undefined) => void) | undefined;
}

/** A note's ⋯: View in conversation, the agent's turn that showed its lines, and Copy link, that turn's link; nothing where neither stands. */
function NoteMenu({ place }: { place: LinkPlace | undefined }): React.JSX.Element | null {
  const menu = useMenu(true);
  const openPlace = useOpenPlace();
  const copyLink = useCopyLinkItem();
  const copy = place === undefined ? undefined : copyLink(place);
  const actions: MenuAction[] = [
    ...(place === undefined || openPlace === undefined
      ? []
      : [
          {
            label: NOTE_WORDS.VIEW_CONVERSATION,
            icon: <MessagesSquareIcon aria-hidden="true" />,
            onSelect: () => openPlace(place),
          },
        ]),
    ...(copy === undefined ? [] : [copy]),
  ];
  if (actions.length === 0) return null;
  return (
    <DisclosureAction>
      <span className="file-note-menu">
        <Tooltip label={NOTE_WORDS.MENU}>
          <IconButton icon={<EllipsisIcon />} label={NOTE_WORDS.MENU} {...menu.trigger()} />
        </Tooltip>
        {menu.drawn === undefined ? null : (
          <ActionMenu
            label={NOTE_WORDS.MENU}
            menu={menu.drawn}
            groups={[actions]}
            onClose={menu.close}
          />
        )}
      </span>
    </DisclosureAction>
  );
}

/** Who wrote a note, as its card and its chip name them: the agent as its tab does. */
function authorOf(note: FileNote, notes: Pick<FileNotes, "agentLabel">): string {
  const named = note.agentId === undefined ? undefined : notes.agentLabel?.(note.agentId);
  return named ?? UNNAMED_AUTHOR;
}

/**
 * One note's card: its agent's head, which folds it, then its words while
 * it is open, and no foot. The tab keeps which cards it folded, so the fold is
 * the tab's, a press and a find's reveal alike telling it.
 */
function FileNoteCard({
  note,
  author,
  folded,
  taskId,
  onFold,
  onLight,
}: {
  note: FileNote;
  author: string;
  folded: boolean;
  taskId: string | undefined;
  onFold: (folded: boolean) => void;
  onLight: ((lines: NoteLines | undefined) => void) | undefined;
}): React.JSX.Element {
  const lines = lineRangeText(note) ?? "";
  // Note that the age moves on with the minute, because a tab left open draws nothing else anew.
  const now = useMinute();
  const link = useMentionLink();
  const openLink = useOpenLink();
  const place: LinkPlace | undefined =
    taskId === undefined || note.agentId === undefined || note.turnId === undefined
      ? undefined
      : { kind: LINK_PLACE.MESSAGE, planId: taskId, agentId: note.agentId, messageId: note.turnId };
  const light = () => onLight?.({ startLine: note.startLine, endLine: note.endLine });
  const dark = () => onLight?.(undefined);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the pointer resting on a note, or the keyboard in it, only lights the lines it is on; nothing is pressed.
    <div
      className="file-note"
      onMouseEnter={light}
      onMouseLeave={dark}
      onFocus={() => {
        // Note that only the keyboard's focus lights them, as a hint shows on it.
        if (document.documentElement.dataset.keyboard === "true") light();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) dark();
      }}
    >
      <AnnotationCard
        label={`${author}'s note on ${lines.toLowerCase()}`}
        open={!folded}
        onOpenChange={(open) => onFold(!open)}
        face={
          <span className="transcript-luke-mark" aria-hidden="true">
            <WingFace />
          </span>
        }
        name={<span className="file-note-author">{author}</span>}
        time={<Time className="annotation-card-time" at={note.shownAt} now={now} />}
        menu={<NoteMenu place={place} />}
      >
        <AnnotationComments>
          <AnnotationComment>
            <MarkdownMessage
              words={note.note}
              className="file-note-words"
              link={link}
              openLink={openLink}
            />
          </AnnotationComment>
        </AnnotationComments>
      </AnnotationCard>
    </div>
  );
}

/**
 * The line a note stands under in a file of `lineCount` lines: its range's
 * last, or the file's last where the file was shortened inside the range
 * since it was shown; none where the range begins past the file's end.
 */
export function noteLineOf(note: FileNote, lineCount: number): number | undefined {
  return note.startLine <= lineCount ? Math.min(note.endLine, lineCount) : undefined;
}

/** A note as the tab draws it under its line: its card, or, while notes are minimized, the chip it stands behind, shown or put away as `minimized` says. */
export function FileNoteAnnotation({
  note,
  notes,
  minimized,
}: {
  note: FileNote;
  notes: FileNotes;
  minimized: { readonly shown: boolean; readonly onShown: (shown: boolean) => void } | undefined;
}): React.JSX.Element {
  const author = authorOf(note, notes);
  const card = (
    <FileNoteCard
      note={note}
      author={author}
      folded={notes.folded.includes(note.callId)}
      taskId={notes.taskId}
      onFold={(folded) => notes.onFold(note.callId, folded)}
      onLight={notes.onLight}
    />
  );
  if (minimized === undefined) return card;
  return (
    <MinimizedChip
      label={CHIP_LABEL(author, lineRangeText(note) ?? "", minimized.shown)}
      faces={
        <span className="transcript-luke-mark" aria-hidden="true">
          <WingFace />
        </span>
      }
      count={1}
      shown={minimized.shown}
      onShown={minimized.onShown}
    >
      {card}
    </MinimizedChip>
  );
}
