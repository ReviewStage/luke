import {
  AnchoredPopover,
  BUTTON_VARIANT,
  Button,
  CornerCount,
  FoldingButton,
  POPOVER_ALIGN,
  PopoverPanel,
} from "@repo/ui";
import { GLYPH, MessageSquarePlusIcon } from "@repo/ui/icons";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { type ReactNode, useId, useRef, useState } from "react";
import { CommentEditor } from "./comment-editor.js";
import { ACTS_AT_END_CLASS } from "./pull-request-look.js";

/**
 * review-panel.tsx -- a review the member finishes: the Review press, its count of pending comments at the corner, and the Finish your review panel it opens, the Pull request tab's and a page's alike.
 *
 * The panel says where the review goes, lists the pending comments it
 * holds, takes an optional summary comment, and ends with Discard, while
 * a review is held, then Cancel and the send. What the review says of a
 * pull request (Comment, Approve, Request changes) stands between the
 * summary and the note where the caller offers it; a page offers none.
 * Escape closes it, Enter in the summary sends, a press outside or the
 * focus leaving it closes it with its words kept, and a review on its way,
 * or a question asked over the window from inside it, holds it open.
 */

/** What the press and the panel say, by the review they finish. */
export interface ReviewWords {
  readonly open: string;
  /** The press's name to a reader while comments are pending. */
  readonly openWith: (count: number) => string;
  readonly title: string;
  /** Where the review goes, and what sending it publishes. */
  readonly lead: (count: number) => string;
  readonly body: string;
  readonly placeholder: string;
  readonly send: string;
  readonly sending: string;
}

/** The panel's words every review shares. */
export const REVIEW_PANEL_WORDS = {
  TITLE: "Finish your review",
  CLOSE: "Close",
  CANCEL: "Cancel",
  DISCARD: "Discard",
  BODY: "Review comment",
  /** How many comments a review holds, as its lead says it. */
  pending: (count: number) => `${count} pending ${count === 1 ? "comment" : "comments"}`,
} as const;

/** The width the panel asks for, stage-cli's own; the side panel may narrow it. */
const PANEL_WIDTH = 480;

/**
 * Whether a press or the focus went to a question asked over the window
 * from inside the panel, a pending comment's Delete, which stands outside
 * it in the document and leaves it open.
 */
function inQuestion(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="alertdialog"]') !== null;
}

/** The summary the panel asks for, and what the review says beside it where the caller asks that too. */
export interface ReviewDraft {
  readonly body: string;
  readonly setBody: (body: string) => void;
  /** Whether the summary may not be sent as it stands, past what a comment carries. */
  readonly over: boolean;
  readonly submit: () => void;
}

/**
 * The panel: its head and lead, the pending comments, the summary,
 * `choices` where the caller offers them, `note` where the last send did not
 * land, then Discard, Cancel, and the send.
 */
function ReviewPanel({
  open,
  id,
  words,
  count,
  draft,
  sending,
  pendingList,
  choices,
  note,
  onDiscard,
  onClose,
  onLeave,
}: {
  open: boolean;
  id: string;
  words: ReviewWords;
  count: number;
  draft: ReviewDraft;
  sending: boolean;
  pendingList: ReactNode;
  choices: ReactNode;
  note: ReactNode;
  onDiscard: (() => void) | undefined;
  onClose: () => void;
  onLeave: (left: EventTarget | null) => void;
}): React.JSX.Element {
  const field = useRef<HTMLElement>(null);
  return (
    <PopoverPanel
      open={open}
      id={id}
      title={words.title}
      replayUnmasked
      closeLabel={REVIEW_PANEL_WORDS.CLOSE}
      initialFocus={field}
      onDismiss={onClose}
      onLeave={onLeave}
    >
      <p className="m-0 -mt-ui-8 text-muted-foreground">
        <ReplayUnmask>{words.lead(count)}</ReplayUnmask>
      </p>
      {pendingList}
      <CommentEditor
        label={words.body}
        placeholder={words.placeholder}
        value={draft.body}
        onChange={draft.setBody}
        busy={sending}
        focus
        fieldRef={field}
        onSubmit={() => {
          if (!sending) draft.submit();
        }}
      />
      {choices}
      {note}
      <ReplayUnmask>
        <div className={ACTS_AT_END_CLASS}>
          {onDiscard === undefined ? null : (
            <Button
              variant={BUTTON_VARIANT.DANGER_OUTLINE}
              icon={<GLYPH.DELETE />}
              disabled={sending}
              onClick={onDiscard}
            >
              {REVIEW_PANEL_WORDS.DISCARD}
            </Button>
          )}
          <Button onClick={onClose}>{REVIEW_PANEL_WORDS.CANCEL}</Button>
          <Button
            variant={BUTTON_VARIANT.PRIMARY}
            disabled={draft.over}
            busy={sending}
            busyLabel={words.sending}
            onClick={draft.submit}
          >
            {words.send}
          </Button>
        </div>
      </ReplayUnmask>
    </PopoverPanel>
  );
}

/** Whether the press's panel stands, and what opens and closes it, for an owner that opens it from elsewhere too. */
export interface ReviewOpen {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
}

/** The panel's open state, held by the surface that draws the press, so a press elsewhere on it opens the same panel. */
export function useReviewOpen(): ReviewOpen {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}

/**
 * The Review press and the panel it opens: a narrow row folds the press to a
 * square around its glyph, which wears the count at its corner, so the word
 * stands in the hint and the name.
 */
export function ReviewPress({
  className,
  words,
  count,
  panel,
  draft,
  sending,
  pendingList,
  choices,
  note,
  onDiscard,
  onSent,
}: {
  /** The press's own class, which names and places it in its row. */
  className: string;
  words: ReviewWords;
  /** How many comments the review holds, worn at the press's corner and said in the lead. */
  count: number;
  /** The panel's open state, held by the owner where something else opens it too. */
  panel: ReviewOpen;
  draft: Omit<ReviewDraft, "submit">;
  /** Whether the review, or its discard, is on its way, which holds the panel open. */
  sending: boolean;
  /** The pending comments as the panel lists them; none lists none. */
  pendingList?: ReactNode;
  /** What the review says beside its summary, where the caller asks it. */
  choices?: ReactNode;
  /** Why the last send did not land, under the summary. */
  note?: ReactNode;
  /** Asks to throw the review away; offered only while one is held. */
  onDiscard: (() => void) | undefined;
  /** Sends the review, calling `done` once it landed, which closes the panel and lets its summary go. */
  onSent: (done: () => void) => void;
}): React.JSX.Element {
  const { open, setOpen } = panel;
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Note that we hand focus back to the press, as a menu returns it to its trigger, because closing takes the focused field away with it.
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const submit = () => {
    if (draft.over) return;
    onSent(() => {
      draft.setBody("");
      close();
    });
  };
  return (
    <div className={`${className} relative flex`} ref={root}>
      <FoldingButton
        ref={trigger}
        label={words.open}
        icon={
          <CornerCount count={count}>
            <MessageSquarePlusIcon aria-hidden="true" />
          </CornerCount>
        }
        name={count === 0 ? undefined : words.openWith(count)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
      />
      {/* Note that a press outside closes it too, as a menu's does, because
          the field keeps the focus through a press on words nothing can
          focus, so no blur says it was left; a review on its way, or the
          question it asked, holds it open all the same. */}
      <AnchoredPopover
        open={open}
        align={POPOVER_ALIGN.END}
        width={PANEL_WIDTH}
        onPressAway={sending ? undefined : () => setOpen(false)}
        holds={inQuestion}
      >
        <ReviewPanel
          open={open}
          id={panelId}
          words={words}
          count={count}
          draft={{ ...draft, submit }}
          sending={sending}
          pendingList={pendingList}
          choices={choices}
          note={note}
          onDiscard={onDiscard}
          onClose={close}
          onLeave={(left) => {
            // Note that a review on its way holds the panel open, because the
            // press it was sent from is disabled as it goes, which drops the
            // focus the way a click outside would, and the answer is drawn
            // in the panel.
            if (sending || inQuestion(left)) return;
            if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
          }}
        />
      </AnchoredPopover>
    </div>
  );
}
