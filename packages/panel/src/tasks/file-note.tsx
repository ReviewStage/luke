import { LINK_PLACE, type LinkPlace } from "@luke/features/luke-link";
import { IconButton, useMenu, WingFace } from "@luke/ui";
import { lineRangeText } from "@luke/voice/code-pane-model";
import { EllipsisIcon, MessagesSquareIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useCopyLinkItem } from "../copy-link-item.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { MarkdownMessage } from "../markdown-message.js";
import { Tooltip } from "../tooltip.js";
import { AnnotationCard, AnnotationComment, AnnotationComments } from "./annotation-card.js";
import type { FileNote } from "./file-tab-model.js";
import { RelativeTime } from "./relative-time.js";
import { useMentionLink } from "./task-mentions.js";
import { useMinute } from "./task-time.js";
import { useOpenLink, useOpenPlace } from "./use-open-link.js";

/**
 * file-note.tsx -- Luke's note on lines of a File tab's file: the card every annotation on code stands on, under the last line he showed, saying why he showed them, as a review thread stands under the lines it is on.
 *
 * Luke writes a sentence or two beside every range of code he shows
 * (`show_code`'s note). A File tab opened on that file draws the note under
 * the range's last line, one card a range, on the shared card
 * (`annotation-card.tsx`), so lit lines say why they are lit: Luke's wing
 * mark and his name in his own colour, how long ago, and his words as
 * Markdown. Its ⋯ offers View in conversation, which opens the turn of his
 * work that showed the lines, and Copy link, that turn's Luke link
 * (`LINK_PLACE.TURN`), the one place a link can name for it. The pointer
 * on a card, or the keyboard in it, lights the lines it is on, as a review
 * thread lights its own. A card folds to its head alone, and the tab keeps
 * which it folded (`use-side-panel.ts`). The words are text in the tab's
 * own lines, so a find over the tab finds them, a folded note's among them,
 * and the recording's text masking covers them.
 */

/** What Luke is called over his note, as the Call tab names him. */
const AUTHOR = "Luke";

/** What a note's ⋯ is called, and what it offers. */
const NOTE_WORDS = {
  MENU: "Note actions",
  VIEW_CONVERSATION: "View in conversation",
} as const;

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
  /** The task the notes were shown on, whose work a note's link names; none offers no link. */
  readonly taskId: string | undefined;
  /** Told the lines a note lights while the pointer or the keyboard is on it, and none once it leaves. */
  readonly onLight?: ((lines: NoteLines | undefined) => void) | undefined;
}

/** A press in a card's head that keeps it for itself, rather than folding the card. */
function keptInHead(event: MouseEvent<HTMLElement>): void {
  event.preventDefault();
  event.stopPropagation();
}

/** A note's ⋯: View in conversation, the turn that showed its lines, and Copy link, that turn's link; nothing where neither stands. */
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
    // biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only keeps the ⋯'s press from folding the card whose head it stands in; the button inside is the control.
    // biome-ignore lint/a11y/useKeyWithClickEvents: a key on the button inside reaches it as a click, which the wrapper keeps the same way.
    <span className="file-note-menu" onClick={keptInHead}>
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
  );
}

/**
 * One note's card: Luke's head, which folds it, then his words while it is
 * open, and no foot. The tab keeps which cards it folded, so the fold is
 * the tab's, a press and a find's reveal alike telling it.
 */
function FileNoteCard({
  note,
  folded,
  taskId,
  onFold,
  onLight,
}: {
  note: FileNote;
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
    taskId === undefined ? undefined : { kind: LINK_PLACE.TURN, planId: taskId, at: note.shownAt };
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
        label={`${AUTHOR}'s note on ${lines.toLowerCase()}`}
        open={!folded}
        onOpenChange={(open) => onFold(!open)}
        face={
          <span className="transcript-luke-mark" aria-hidden="true">
            <WingFace />
          </span>
        }
        name={<span className="file-note-author">{AUTHOR}</span>}
        time={<RelativeTime className="annotation-card-time" at={note.shownAt} now={now} />}
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
 * What a run of a File tab's lines draws after each line: the cards of the
 * notes whose ranges end there, nothing where none does. A note on a file
 * since shortened inside its range stands after the file's last line, as
 * long as its range still begins in the file.
 */
export function notesAfter(notes: FileNotes, lastLine: number): (line: number) => ReactNode {
  return (line) =>
    notes.notes
      .filter((note) => note.startLine <= lastLine && Math.min(note.endLine, lastLine) === line)
      .map((note) => (
        <FileNoteCard
          key={note.callId}
          note={note}
          folded={notes.folded.includes(note.callId)}
          taskId={notes.taskId}
          onFold={(folded) => notes.onFold(note.callId, folded)}
          onLight={notes.onLight}
        />
      ));
}
