import { MarkdownMessage } from "@luke/panel/markdown-message";
import type { FileNote } from "@luke/panel/tasks/file-tab-model";
import { RelativeTime } from "@luke/panel/tasks/relative-time";
import { agoText, useMinute } from "@luke/panel/tasks/task-time";
import { useOpenLink } from "@luke/panel/tasks/use-open-link";
import { Tooltip } from "@luke/panel/tooltip";
import {
  DISCLOSURE_BODY,
  DisclosureBody,
  DisclosureScope,
  DisclosureSummary,
  FoldingButton,
  type FoldingButtonHint,
  useDisclosureBodyDrawn,
  useDisclosureFold,
  WingFace,
} from "@luke/ui";
import { lineRangeText } from "@luke/voice/code-pane-model";
import { CodeXmlIcon } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { useMentionLink } from "./task-mentions";

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
 * card folds to its fold's line with its words cut to a line, and the tab
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

/**
 * The pill a folded Show in Code raises: its words and how long ago the note
 * was shown, since a narrow panel draws the age nowhere else. Note that it is
 * one component for as long as the age reads the same, because a hint
 * minted anew each render would mount its button afresh.
 */
function useAgedHint(ago: string): FoldingButtonHint {
  return useMemo(
    () =>
      function AgedHint({ label, children }) {
        return (
          <Tooltip label={label === undefined ? undefined : `${label} · ${ago}`}>
            {children}
          </Tooltip>
        );
      },
    [ago],
  );
}

/**
 * What the fold's line says after Luke's name: the note's words cut to the
 * line while it is folded, its lines while its words are drawn. Note that it
 * asks whether the body is drawn rather than whether the fold is open,
 * because a find draws a folded note's words hidden, and a preview beside
 * them would be found twice.
 */
function NoteLine({ note, lines }: { note: string; lines: string }): React.JSX.Element {
  return useDisclosureBodyDrawn() ? (
    <span className="file-note-lines">{lines}</span>
  ) : (
    <span className="file-note-preview">{note}</span>
  );
}

/**
 * One note's card: its fold's line, which folds it, its age and its link
 * beside that line, then Luke's words while it is open. The tab keeps which
 * cards it folded, so the fold is the tab's (`useDisclosureFold`'s control),
 * a press and a find's reveal alike telling it.
 */
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
  const hint = useAgedHint(agoText(note.shownAt, now));
  const { state, details } = useDisclosureFold(!folded, {
    open: !folded,
    onOpenChange: (open) => onFold(!open),
  });
  return (
    <aside className="file-note" aria-label={`${AUTHOR}'s note on ${lines.toLowerCase()}`}>
      <DisclosureScope state={state}>
        <details {...details} className="file-note-fold">
          <DisclosureSummary>
            <span className="transcript-luke-mark" aria-hidden="true">
              <WingFace />
            </span>
            <span className="file-note-author">{AUTHOR}</span>
            <NoteLine note={note.note} lines={lines} />
          </DisclosureSummary>
          <DisclosureBody inset={DISCLOSURE_BODY.NONE}>
            <MarkdownMessage
              words={note.note}
              className="file-note-words"
              link={link}
              openLink={openLink}
            />
          </DisclosureBody>
        </details>
      </DisclosureScope>
      <div className="file-note-actions">
        <RelativeTime className="file-note-time" at={note.shownAt} now={now} />
        <FoldingButton
          label={SHOW_IN_CODE_LABEL}
          icon={<CodeXmlIcon aria-hidden="true" />}
          onClick={onShow}
          hint={hint}
        />
      </div>
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
