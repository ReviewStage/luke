import {
  PULL_REQUEST_ACTION,
  REVIEW_EVENT,
  type ReviewEvent,
} from "@repo/features/pull-request-write-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { IRREVERSIBLE_WORDS } from "@repo/features/words";
import {
  AnchoredPopover,
  BUTTON_VARIANT,
  Button,
  ChoiceList,
  type ChoiceOption,
  CONFIRM_LOSS,
  ConfirmDialog,
  CornerCount,
  type DialogQuestion,
  FoldingButton,
  POPOVER_ALIGN,
  PopoverPanel,
  useConfirmDialog,
} from "@repo/ui";
import { CONFIRM_STAGE } from "@repo/ui/confirm-state";
import { GLYPH, MessageSquarePlusIcon } from "@repo/ui/icons";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { type ReactNode, useId, useRef, useState } from "react";
import { confirmFailure } from "../failure-report.js";
import { CommentEditor, overCommentBound } from "./comment-editor.js";
import type { PendingReview } from "./line-comment.js";
import { ACTS_AT_END_CLASS } from "./pull-request-look.js";
import { PullRequestWriteNote, type PullRequestWrites } from "./pull-request-writes.js";

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
  pending: (count: number) =>
    `${count} pending ${count === 1 ? "comment" : "comments"} will be published.`,
  openWith: (count: number) => `Review, ${count} pending ${count === 1 ? "comment" : "comments"}`,
} as const;

const DISCARD_QUESTION: DialogQuestion = {
  title: "Discard your pending review?",
  body: `This deletes every pending comment you added to it. ${IRREVERSIBLE_WORDS}`,
  verb: "Discard review",
  running: "Discarding",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
  replayUnmasked: true,
};

const EVENT_OPTIONS = [
  { value: REVIEW_EVENT.COMMENT, label: "Comment" },
  { value: REVIEW_EVENT.APPROVE, label: "Approve" },
  { value: REVIEW_EVENT.REQUEST_CHANGES, label: "Request changes" },
] as const satisfies readonly ChoiceOption<ReviewEvent>[];

function placeholderOf(event: ReviewEvent): string {
  return event === REVIEW_EVENT.REQUEST_CHANGES
    ? "Summarize the requested changes"
    : "Leave a summary comment (optional)";
}

function inQuestion(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="alertdialog"]') !== null;
}

const PANEL_WIDTH = 480;

interface ReviewDraft {
  readonly event: ReviewEvent;
  readonly body: string;
  readonly setEvent: (event: ReviewEvent) => void;
  readonly setBody: (body: string) => void;
  readonly submit: () => void;
}

function ReviewPanel({
  open,
  id,
  draft,
  writes,
  pending,
  pendingList,
  onDiscard,
  onClose,
  onLeave,
}: {
  open: boolean;
  id: string;
  draft: ReviewDraft;
  writes: PullRequestWrites;
  pending: PendingReview;
  pendingList: ReactNode;
  onDiscard: () => void;
  onClose: () => void;
  onLeave: (left: EventTarget | null) => void;
}): React.JSX.Element {
  const field = useRef<HTMLElement>(null);
  const sending = writes.pending !== undefined;

  return (
    <PopoverPanel
      open={open}
      id={id}
      title={REVIEW_WORDS.TITLE}
      replayUnmasked
      closeLabel={REVIEW_WORDS.CLOSE}
      initialFocus={field}
      onDismiss={onClose}
      onLeave={onLeave}
    >
      <p className="m-0 -mt-ui-8 text-muted-foreground">
        <ReplayUnmask>
          {REVIEW_WORDS.LEAD}
          {pending == null || pending.comments === 0
            ? null
            : ` ${REVIEW_WORDS.pending(pending.comments)}`}
        </ReplayUnmask>
      </p>
      {pendingList}
      <CommentEditor
        label={REVIEW_WORDS.BODY}
        placeholder={placeholderOf(draft.event)}
        value={draft.body}
        onChange={draft.setBody}
        busy={sending}
        focus
        fieldRef={field}
        onSubmit={() => {
          if (!sending) draft.submit();
        }}
      />
      <ReplayUnmask>
        <ChoiceList<ReviewEvent>
          legend={REVIEW_WORDS.EVENTS}
          options={EVENT_OPTIONS}
          value={[draft.event]}
          disabled={sending}
          onChange={([event]) => {
            if (event !== undefined) draft.setEvent(event);
          }}
        />
      </ReplayUnmask>
      <PullRequestWriteNote writes={writes} className="pull-request-review-note" />
      <ReplayUnmask>
        <div className={ACTS_AT_END_CLASS}>
          {pending == null ? null : (
            <Button
              variant={BUTTON_VARIANT.DANGER_OUTLINE}
              icon={<GLYPH.DELETE />}
              disabled={sending}
              onClick={onDiscard}
            >
              {REVIEW_WORDS.DISCARD}
            </Button>
          )}
          <Button onClick={onClose}>{REVIEW_WORDS.CANCEL}</Button>
          <Button
            variant={BUTTON_VARIANT.PRIMARY}
            disabled={overCommentBound(draft.body)}
            busy={sending}
            busyLabel={REVIEW_WORDS.SUBMITTING}
            onClick={draft.submit}
          >
            {REVIEW_WORDS.SUBMIT}
          </Button>
        </div>
      </ReplayUnmask>
    </PopoverPanel>
  );
}

export function PullRequestReview({
  writes,
  pending,
  pendingList,
}: {
  writes: PullRequestWrites;
  pending: PendingReview;
  pendingList?: ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [event, setEvent] = useState<ReviewEvent>(REVIEW_EVENT.COMMENT);
  const [body, setBody] = useState("");
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const discarding = useConfirmDialog(
    { subject: pending != null, surfaceOpen: open },
    writes.confirmAct({ action: PULL_REQUEST_ACTION.DISCARD_REVIEW }),
    confirmFailure(FAILURE_SURFACE.PULL_REQUEST_REVIEW_DISCARD),
  );
  const sending = writes.pending !== undefined || discarding.stage !== CONFIRM_STAGE.RESTING;

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const submit = () => {
    if (overCommentBound(body)) return;
    writes.write({ action: PULL_REQUEST_ACTION.SUBMIT_REVIEW, event, body }, () => {
      setBody("");
      setEvent(REVIEW_EVENT.COMMENT);
      close();
    });
  };

  return (
    <div className="pull-request-review relative flex" ref={root}>
      <FoldingButton
        ref={trigger}
        label={REVIEW_WORDS.OPEN}
        icon={
          <CornerCount count={pending?.comments ?? 0}>
            <MessageSquarePlusIcon aria-hidden="true" />
          </CornerCount>
        }
        name={
          pending == null || pending.comments === 0
            ? undefined
            : REVIEW_WORDS.openWith(pending.comments)
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
      />
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
          draft={{ event, body, setEvent, setBody, submit }}
          writes={writes}
          pending={pending}
          pendingList={pendingList}
          onDiscard={discarding.ask}
          onClose={close}
          onLeave={(left) => {
            if (sending || inQuestion(left)) return;
            if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
          }}
        />
      </AnchoredPopover>
      <ConfirmDialog open confirm={discarding} question={DISCARD_QUESTION} />
    </div>
  );
}
