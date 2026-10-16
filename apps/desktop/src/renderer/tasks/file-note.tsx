import { ChevronDownIcon, WingFace } from "@luke/ui";
import { lineRangeText } from "@luke/voice/code-pane-model";
import { CodeXmlIcon } from "lucide-react";
import type { ReactNode } from "react";
import { MarkdownMessage } from "../markdown-message";
import { Tooltip } from "../tooltip";
import type { FileNote } from "./file-tab-model";
import { useMentionLink } from "./plan-mentions";
import { RelativeTime } from "./relative-time";
import { agoText, useMinute } from "./task-time";
import { useOpenLink } from "./use-open-link";

/**
 * file-note.tsx -- Luke's note on lines of a File tab's file: a card standing over the lines he showed, saying why he showed them, as a review comment stands over the lines it is on.
 *
 * Luke writes a sentence or two beside every range of code he shows
 * (`show_code`'s note), which the Code tab draws on the range's card. A
 * File tab opened on that file draws the same note over the range's
 * first line, one card a range, so lit lines say why they are lit: Luke's
 * mark and name, the lines, how long ago, his words as Markdown, and a
 * link to the card the Code tab holds under the call it was shown on. In
 * a narrow panel (`@container side-panel`) the age goes into the link's
 * pill and the link draws the Code tab's glyph alone, so the header's
 * parts never stand on one another. A
 * card folds to its header with its words cut to a line, and the tab
 * keeps which it folded (`use-side-panel.ts`). The words are text in the
 * tab's own lines, so a find over the tab finds them and the recording's
 * text masking covers them.
 */

/** What Luke is called over his note, as the Call tab names him. */
const AUTHOR = "Luke";

/** What the link to the note's card in the Code tab says. */
const SHOW_IN_CODE_LABEL = "Show in Code";

/** A File tab's notes, which of them it folded, and what a card asks of the panel. */
export interface FileNotes {
  readonly notes: readonly FileNote[];
  /** The calls whose notes the tab folded. */
  readonly folded: readonly string[];
  readonly onFold: (callId: string, folded: boolean) => void;
  /** Shows the card the call's code stands on in the Code tab. */
  readonly onShow: (callId: string) => void;
}

/** One note's card: its header, which folds it, then Luke's words while it is open. */
function FileNoteCard({
  note,
  folded,
  onFold,
  onShow,
}: {
  note: FileNote;
  folded: boolean;
  onFold: (folded: boolean) => void;
  onShow: () => void;
}): React.JSX.Element {
  const lines = lineRangeText(note) ?? "";
  // Note that the age moves on with the minute, because a tab left open draws nothing else anew.
  const now = useMinute();
  const link = useMentionLink();
  const openLink = useOpenLink();
  return (
    <aside
      className="file-note"
      aria-label={`${AUTHOR}'s note on ${lines.toLowerCase()}`}
      data-folded={String(folded)}
    >
      <header className="file-note-header">
        <button
          type="button"
          className="file-note-fold"
          aria-expanded={!folded}
          onClick={() => onFold(!folded)}
        >
          <ChevronDownIcon />
          <span className="transcript-luke-mark" aria-hidden="true">
            <WingFace />
          </span>
          <span className="file-note-author">{AUTHOR}</span>
          {folded ? (
            <span className="file-note-preview">{note.note}</span>
          ) : (
            <span className="file-note-lines">{lines}</span>
          )}
        </button>
        <RelativeTime className="file-note-time" at={note.shownAt} now={now} />
        <Tooltip label={`${SHOW_IN_CODE_LABEL} · ${agoText(note.shownAt, now)}`}>
          <button
            type="button"
            className="file-note-show"
            aria-label={SHOW_IN_CODE_LABEL}
            onClick={onShow}
          >
            <CodeXmlIcon aria-hidden="true" />
            <span className="file-note-show-words">{SHOW_IN_CODE_LABEL}</span>
          </button>
        </Tooltip>
      </header>
      {folded ? null : (
        <MarkdownMessage
          words={note.note}
          className="file-note-words"
          link={link}
          openLink={openLink}
        />
      )}
    </aside>
  );
}

/**
 * What a run of a File tab's lines draws before each line: the cards of the
 * notes whose ranges begin there, nothing where none does.
 */
export function notesBefore(notes: FileNotes): (line: number) => ReactNode {
  return (line) =>
    notes.notes
      .filter((note) => note.startLine === line)
      .map((note) => (
        <FileNoteCard
          key={note.callId}
          note={note}
          folded={notes.folded.includes(note.callId)}
          onFold={(folded) => notes.onFold(note.callId, folded)}
          onShow={() => notes.onShow(note.callId)}
        />
      ));
}
