import {
  PULL_REQUEST_ACTION,
  REVIEW_EVENT,
  type ReviewEvent,
} from "@luke/features/pull-request-write-wire";
import {
  AnchoredPopover,
  BUTTON_VARIANT,
  Button,
  ChoiceList,
  type ChoiceOption,
  ConfirmDialog,
  type DialogQuestion,
  POPOVER_ALIGN,
  useConfirmDialog,
} from "@luke/ui";
import { CONFIRM_STAGE } from "@luke/ui/confirm-state";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { MessageSquarePlusIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { PopoverPanel } from "../popover-panel.js";
import { Tooltip } from "../tooltip.js";
import type { PendingReview } from "./line-comment.js";
import { MarkdownField } from "./markdown-field.js";
import { PullRequestWriteNote, type PullRequestWrites } from "./pull-request-writes.js";

/**
 * pull-request-review.tsx -- the review a member submits on an agent's pull request from its Pull request tab: the Review press at the end of its tabs' row and the panel it opens, as stage-cli's review panel.
 *
 * The panel asks what the review says of the pull request, Comment,
 * Approve, or Request changes, and its optional words, written as
 * Markdown with a preview (`markdown-field.tsx`), and sends both as one change
 * (`PULL_REQUEST_ACTION.SUBMIT_REVIEW`), which the service submits on
 * GitHub as the member pressing it: their own pending review where they
 * hold one, else a new one (`pull-request-writes.ts`). Nothing is refused
 * here that GitHub might allow: GitHub's own rules, approving one's own
 * pull request among them, come back as its words on the panel's own
 * line, with the sign-in offered where GitHub would not take the member's.
 * Once GitHub took it the panel closes and lets go of its words, and the
 * tab reads the conversation again (`usePullRequestWrites`); until then
 * what was written stands, the panel closed and opened again included.
 * Under the line counting the member's pending comments stand the comments
 * themselves, each with Edit and Delete (`pending-comments.tsx`); a Delete's
 * question over the window leaves the panel open.
 */

/** The panel's own words. */
const REVIEW_WORDS = {
  OPEN: "Review",
  TITLE: "Finish your review",
  LEAD: "Submitted on GitHub as you.",
  CLOSE: "Close",
  BODY: "Review comment",
  EVENTS: "What the review says",
  CANCEL: "Cancel",
  SUBMIT: "Submit review",
  SUBMITTING: "Submitting review",
  DISCARD: "Discard",
  /** What the panel says of the comments the member's pending review holds, which submitting publishes. */
  pending: (count: number) =>
    `${count} pending ${count === 1 ? "comment" : "comments"} will be published.`,
  /** The Review press's name to a reader, with the pending comments it holds. */
  openWith: (count: number) => `Review, ${count} pending ${count === 1 ? "comment" : "comments"}`,
} as const;

/** What Discard asks before it throws the member's pending review away. */
const DISCARD_QUESTION: DialogQuestion = {
  title: "Discard your pending review?",
  body: "This deletes every pending comment you added to it. This can't be undone.",
  verb: "Discard review",
  running: "Discarding",
};

/** What the review may say, in the order GitHub's own review box offers it, and what the two that need it mean. */
const EVENT_OPTIONS = [
  {
    value: REVIEW_EVENT.COMMENT,
    label: "Comment",
    detail: "Submit general feedback without approval.",
  },
  { value: REVIEW_EVENT.APPROVE, label: "Approve" },
  {
    value: REVIEW_EVENT.REQUEST_CHANGES,
    label: "Request changes",
    detail: "Submit feedback that must be addressed.",
  },
] as const satisfies readonly ChoiceOption<ReviewEvent>[];

/** The field's prompt, by what the review says: changes asked for want their summary. */
function placeholderOf(event: ReviewEvent): string {
  return event === REVIEW_EVENT.REQUEST_CHANGES
    ? "Summarize the requested changes…"
    : "Leave a summary comment (optional)…";
}

/**
 * Whether a press or the focus went to a question asked over the window
 * from inside the panel, a pending comment's Delete, which stands outside
 * it in the document and leaves it open.
 */
function inQuestion(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="alertdialog"]') !== null;
}

/** The width the panel asks for, stage-cli's own; the side panel may narrow it. */
const PANEL_WIDTH = 480;

/** The review being written: what it says, its words, and the presses on them. */
interface ReviewDraft {
  readonly event: ReviewEvent;
  readonly body: string;
  readonly setEvent: (event: ReviewEvent) => void;
  readonly setBody: (body: string) => void;
  readonly submit: () => void;
}

/**
 * The panel: its head, the words with their preview, what the review says,
 * GitHub's answer where it did not take the last one, and Cancel and
 * Submit. Escape closes it, ⌘↩ submits from anywhere in it, and focus
 * leaving it closes it, its words kept, unless a review is on its way.
 */
function ReviewPanel({
  id,
  draft,
  writes,
  pending,
  pendingList,
  onDiscard,
  onClose,
  onLeave,
}: {
  id: string;
  draft: ReviewDraft;
  writes: PullRequestWrites;
  pending: PendingReview;
  /** The pending comments themselves, each with Edit and Delete, under the line counting them; none draws none. */
  pendingList: ReactNode;
  /** Asks to throw the pending review away; offered only while one is held. */
  onDiscard: () => void;
  onClose: () => void;
  onLeave: (left: EventTarget | null) => void;
}): React.JSX.Element {
  const field = useRef<HTMLTextAreaElement>(null);
  const sending = writes.pending !== undefined;

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    if (!sending) draft.submit();
  };

  return (
    <PopoverPanel
      id={id}
      title={REVIEW_WORDS.TITLE}
      closeLabel={REVIEW_WORDS.CLOSE}
      initialFocus={field}
      onDismiss={onClose}
      onLeave={onLeave}
      onKeyDown={onKey}
    >
      <p className="pull-request-review-lead">
        {REVIEW_WORDS.LEAD}
        {pending == null || pending.comments === 0
          ? null
          : ` ${REVIEW_WORDS.pending(pending.comments)}`}
      </p>
      {pendingList}
      <MarkdownField
        label={REVIEW_WORDS.BODY}
        placeholder={placeholderOf(draft.event)}
        value={draft.body}
        onChange={draft.setBody}
        busy={sending}
        fieldRef={field}
      />
      <ChoiceList<ReviewEvent>
        legend={REVIEW_WORDS.EVENTS}
        options={EVENT_OPTIONS}
        value={[draft.event]}
        disabled={sending}
        onChange={([event]) => {
          if (event !== undefined) draft.setEvent(event);
        }}
      />
      <PullRequestWriteNote writes={writes} className="pull-request-review-note" />
      <div className="pull-request-review-foot">
        {pending == null ? null : (
          <Button
            variant={BUTTON_VARIANT.DANGER_OUTLINE}
            icon={<Trash2Icon aria-hidden="true" />}
            disabled={sending}
            onClick={onDiscard}
          >
            {REVIEW_WORDS.DISCARD}
          </Button>
        )}
        <Button onClick={onClose}>{REVIEW_WORDS.CANCEL}</Button>
        <Button
          variant={BUTTON_VARIANT.PRIMARY}
          busy={sending}
          busyLabel={REVIEW_WORDS.SUBMITTING}
          onClick={draft.submit}
        >
          {REVIEW_WORDS.SUBMIT}
        </Button>
      </div>
    </PopoverPanel>
  );
}

/**
 * The tabs' row's Review press and the panel it opens, holding the review being
 * written for as long as the tab stands, so a panel closed by a stray
 * click opens again on the same words.
 */
export function PullRequestReview({
  writes,
  pending,
  pendingList,
}: {
  writes: PullRequestWrites;
  /** The member's own pending review, which the panel publishes or discards. */
  pending: PendingReview;
  /** Its comments as the panel lists them, under the line counting them; none lists none. */
  pendingList?: ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [event, setEvent] = useState<ReviewEvent>(REVIEW_EVENT.COMMENT);
  const [body, setBody] = useState("");
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Note that a press outside closes it too, as a menu's does, because the
  // field keeps the focus through a press on words nothing can focus, so no
  // blur says it was left; a review on its way holds it open all the same.
  // Note that the question stands, busy, until GitHub answers the discard, says its refusal in GitHub's words, and holds the panel open meanwhile as a review on its way does.
  const discarding = useConfirmDialog({ subject: pending != null, surfaceOpen: open }, () =>
    writes
      .write({ action: PULL_REQUEST_ACTION.DISCARD_REVIEW })
      .then(
        (outcome): ActionResult =>
          outcome.done
            ? { status: ACTION_RESULT_STATUS.ACCEPTED }
            : { status: ACTION_RESULT_STATUS.REJECTED, reason: outcome.words },
      ),
  );
  const sending = writes.pending !== undefined || discarding.stage !== CONFIRM_STAGE.RESTING;
  useEffect(() => {
    if (!open || sending) return undefined;
    const pressed = (event: PointerEvent) => {
      if (inQuestion(event.target)) return;
      if (!(event.target instanceof Node && root.current?.contains(event.target))) setOpen(false);
    };
    document.addEventListener("pointerdown", pressed, true);
    return () => document.removeEventListener("pointerdown", pressed, true);
  }, [open, sending]);

  // Note that we hand focus back to the press, as a menu returns it to its
  // trigger, because closing takes the focused field away with it.
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const submit = () =>
    writes.write({ action: PULL_REQUEST_ACTION.SUBMIT_REVIEW, event, body }, () => {
      setBody("");
      setEvent(REVIEW_EVENT.COMMENT);
      close();
    });

  return (
    <div className="pull-request-review" ref={root}>
      {/* Note that a narrow row draws the glyph and the count alone, so the word stands in the hint and the name. */}
      <Tooltip label={REVIEW_WORDS.OPEN}>
        <Button
          ref={trigger}
          icon={<MessageSquarePlusIcon aria-hidden="true" />}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          label={
            pending == null || pending.comments === 0
              ? REVIEW_WORDS.OPEN
              : REVIEW_WORDS.openWith(pending.comments)
          }
          onClick={() => setOpen(!open)}
        >
          <span className="pull-request-review-words">{REVIEW_WORDS.OPEN}</span>
          {pending == null || pending.comments === 0 ? null : (
            <span className="pull-request-review-count" aria-hidden="true">
              {pending.comments}
            </span>
          )}
        </Button>
      </Tooltip>
      {open ? (
        <AnchoredPopover align={POPOVER_ALIGN.END} width={PANEL_WIDTH}>
          <ReviewPanel
            id={panelId}
            draft={{ event, body, setEvent, setBody, submit }}
            writes={writes}
            pending={pending}
            pendingList={pendingList}
            onDiscard={discarding.ask}
            onClose={close}
            onLeave={(left) => {
              // Note that a review on its way holds the panel open, because the
              // press it was sent from is disabled as it goes, which drops the
              // focus the way a click outside would, and GitHub's answer is
              // drawn in the panel.
              if (sending || inQuestion(left)) return;
              if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
            }}
          />
        </AnchoredPopover>
      ) : null}
      <ConfirmDialog confirm={discarding} question={DISCARD_QUESTION} />
    </div>
  );
}
