import {
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_BOUNDS,
  REVIEW_EVENT,
  type ReviewEvent,
} from "@luke/features/pull-request-write-wire";
import { AnchoredPopover, POPOVER_ALIGN, TextArea } from "@luke/ui";
import { MessageSquarePlusIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { PopoverPanel } from "../popover-panel";
import { Segmented } from "../segmented";
import { PullRequestWriteNote, type PullRequestWrites } from "./pull-request-writes";
import { TranscriptWords } from "./transcript-blocks";

/**
 * pull-request-review.tsx -- the review a member submits on an agent's pull request from its Pull request tab: the bar's Review press and the panel it opens, as stage-cli's review panel.
 *
 * The panel asks what the review says of the pull request, Comment,
 * Approve, or Request changes, and its optional words, written as
 * Markdown with a preview, and sends both as one change
 * (`PULL_REQUEST_ACTION.SUBMIT_REVIEW`), which the service submits on
 * GitHub as the member pressing it: their own pending review where they
 * hold one, else a new one (`pull-request-writes.ts`). Nothing is refused
 * here that GitHub might allow: GitHub's own rules, approving one's own
 * pull request among them, come back as its words on the panel's own
 * line, with the sign-in offered where GitHub would not take the member's.
 * Once GitHub took it the panel closes and lets go of its words, and the
 * tab reads the conversation again (`usePullRequestWrites`); until then
 * what was written stands, the panel closed and opened again included.
 */

/** The panel's own words. */
const REVIEW_WORDS = {
  OPEN: "Review",
  TITLE: "Finish your review",
  LEAD: "Submitted on GitHub as you.",
  CLOSE: "Close",
  BODY: "Review comment",
  MODE: "Review comment view",
  WRITE: "Write",
  PREVIEW: "Preview",
  NOTHING: "Nothing to preview.",
  EVENTS: "What the review says",
  CANCEL: "Cancel",
  SUBMIT: "Submit review",
  SUBMITTING: "Submitting…",
} as const;

/** What the review may say, in the order GitHub's own review box offers it, and what each means. */
const EVENT_OPTIONS = [
  {
    event: REVIEW_EVENT.COMMENT,
    label: "Comment",
    detail: "Submit general feedback without approval.",
  },
  { event: REVIEW_EVENT.APPROVE, label: "Approve", detail: "Approve this pull request." },
  {
    event: REVIEW_EVENT.REQUEST_CHANGES,
    label: "Request changes",
    detail: "Submit feedback that must be addressed.",
  },
] as const satisfies readonly { event: ReviewEvent; label: string; detail: string }[];

/** The field's prompt, by what the review says: changes asked for want their summary. */
function placeholderOf(event: ReviewEvent): string {
  return event === REVIEW_EVENT.REQUEST_CHANGES
    ? "Summarize the requested changes…"
    : "Leave a summary comment (optional)…";
}

/** Whether the field shows what is written or how it reads. */
const BODY_MODE = {
  WRITE: "write",
  PREVIEW: "preview",
} as const;

type BodyMode = (typeof BODY_MODE)[keyof typeof BODY_MODE];

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
  onClose,
  onLeave,
}: {
  id: string;
  draft: ReviewDraft;
  writes: PullRequestWrites;
  onClose: () => void;
  onLeave: (left: EventTarget | null) => void;
}): React.JSX.Element {
  const field = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<BodyMode>(BODY_MODE.WRITE);
  const sending = writes.pending !== undefined;
  const eventsName = useId();

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
      <p className="pull-request-review-lead">{REVIEW_WORDS.LEAD}</p>
      <div className="pull-request-review-body">
        <Segmented
          legend={REVIEW_WORDS.MODE}
          options={[
            { value: BODY_MODE.WRITE, label: REVIEW_WORDS.WRITE },
            { value: BODY_MODE.PREVIEW, label: REVIEW_WORDS.PREVIEW },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === BODY_MODE.WRITE ? (
          <TextArea
            ref={field}
            label={REVIEW_WORDS.BODY}
            placeholder={placeholderOf(draft.event)}
            value={draft.body}
            maxLength={PULL_REQUEST_WRITE_BOUNDS.MAX_BODY_CHARS}
            rows={4}
            busy={sending}
            onChange={draft.setBody}
          />
        ) : (
          <div className="pull-request-review-preview pull-request-words">
            {draft.body.trim() === "" ? (
              <p className="pull-request-quiet">{REVIEW_WORDS.NOTHING}</p>
            ) : (
              <TranscriptWords text={draft.body} />
            )}
          </div>
        )}
      </div>
      <fieldset className="pull-request-review-events" disabled={sending}>
        <legend className="visually-hidden">{REVIEW_WORDS.EVENTS}</legend>
        {EVENT_OPTIONS.map((option) => (
          <label key={option.event} className="pull-request-review-event">
            <input
              type="radio"
              name={eventsName}
              value={option.event}
              checked={draft.event === option.event}
              onChange={() => draft.setEvent(option.event)}
            />
            <span className="pull-request-review-event-words">
              <span className="pull-request-review-event-label">{option.label}</span>
              <span className="pull-request-quiet">{option.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <PullRequestWriteNote writes={writes} className="pull-request-review-note" />
      <div className="pull-request-review-foot">
        <button type="button" className="toolbar-button" onClick={onClose}>
          {REVIEW_WORDS.CANCEL}
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={sending}
          aria-busy={sending}
          onClick={draft.submit}
        >
          {sending ? REVIEW_WORDS.SUBMITTING : REVIEW_WORDS.SUBMIT}
        </button>
      </div>
    </PopoverPanel>
  );
}

/**
 * The bar's Review press and the panel it opens, holding the review being
 * written for as long as the tab stands, so a panel closed by a stray
 * click opens again on the same words.
 */
export function PullRequestReview({ writes }: { writes: PullRequestWrites }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [event, setEvent] = useState<ReviewEvent>(REVIEW_EVENT.COMMENT);
  const [body, setBody] = useState("");
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Note that a press outside closes it too, as a menu's does, because the
  // field keeps the focus through a press on words nothing can focus, so no
  // blur says it was left; a review on its way holds it open all the same.
  const sending = writes.pending !== undefined;
  useEffect(() => {
    if (!open || sending) return undefined;
    const pressed = (event: PointerEvent) => {
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
      <button
        ref={trigger}
        type="button"
        className="toolbar-button pull-request-review-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
      >
        <MessageSquarePlusIcon aria-hidden="true" />
        {REVIEW_WORDS.OPEN}
      </button>
      {open ? (
        <AnchoredPopover align={POPOVER_ALIGN.END} width={PANEL_WIDTH}>
          <ReviewPanel
            id={panelId}
            draft={{ event, body, setEvent, setBody, submit }}
            writes={writes}
            onClose={close}
            onLeave={(left) => {
              // Note that a review on its way holds the panel open, because the
              // press it was sent from is disabled as it goes, which drops the
              // focus the way a click outside would, and GitHub's answer is
              // drawn in the panel.
              if (sending) return;
              if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
            }}
          />
        </AnchoredPopover>
      ) : null}
    </div>
  );
}
