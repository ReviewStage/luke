import {
  PULL_REQUEST_ACTION,
  REVIEW_EVENT,
  type ReviewEvent,
} from "@repo/features/pull-request-write-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { IRREVERSIBLE_WORDS } from "@repo/features/words";
import {
  ChoiceList,
  type ChoiceOption,
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  useConfirmDialog,
} from "@repo/ui";
import { CONFIRM_STAGE } from "@repo/ui/confirm-state";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useState } from "react";
import { confirmFailure } from "../failure-report.js";
import { overCommentBound } from "./comment-editor.js";
import type { PendingReview } from "./line-comment.js";
import { PullRequestWriteNote, type PullRequestWrites } from "./pull-request-writes.js";
import {
  type PendingItem,
  REVIEW_PANEL_WORDS,
  ReviewPress,
  type ReviewWords,
} from "./review-panel.js";

/**
 * pull-request-review.tsx -- the review a member submits on an agent's pull request from its Pull request tab: the Review press at the end of its tabs' row and the panel it opens (`review-panel.tsx`), as stage-cli's review panel.
 *
 * The panel asks what the review says of the pull request, Comment,
 * Approve, or Request changes, and its optional words, written as
 * Markdown on the description's editor (`comment-editor.tsx`), and sends both as one change
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

/** What submitting says, where GitHub publishes the review. */
const LEAD = "Submitted on GitHub as you.";

/** The press's and the panel's words on a pull request. */
const REVIEW_WORDS: ReviewWords = {
  open: "Review",
  openWith: (count) => `Review, ${REVIEW_PANEL_WORDS.pending(count)}`,
  title: REVIEW_PANEL_WORDS.TITLE,
  lead: (count) =>
    count === 0 ? LEAD : `${LEAD} ${REVIEW_PANEL_WORDS.pending(count)} will be published.`,
  body: REVIEW_PANEL_WORDS.BODY,
  placeholder: "Leave a summary comment (optional)",
  send: "Submit review",
  sending: "Submitting review",
};

/** The legend of what the review says. */
const EVENTS_LEGEND = "What the review says";

/** What Discard asks before it throws the member's pending review away. */
const DISCARD_QUESTION: DialogQuestion = {
  title: "Discard your pending review?",
  body: `This deletes every pending comment you added to it. ${IRREVERSIBLE_WORDS}`,
  verb: "Discard review",
  running: "Discarding",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
  replayUnmasked: true,
};

/** What the review may say, in the order GitHub's own review box offers it. */
const EVENT_OPTIONS = [
  { value: REVIEW_EVENT.COMMENT, label: "Comment" },
  { value: REVIEW_EVENT.APPROVE, label: "Approve" },
  { value: REVIEW_EVENT.REQUEST_CHANGES, label: "Request changes" },
] as const satisfies readonly ChoiceOption<ReviewEvent>[];

/** The field's prompt, by what the review says: changes asked for want their summary. */
function placeholderOf(event: ReviewEvent): string {
  return event === REVIEW_EVENT.REQUEST_CHANGES
    ? "Summarize the requested changes"
    : "Leave a summary comment (optional)";
}

/**
 * The tabs' row's Review press and the panel it opens, holding the review being
 * written for as long as the tab stands, so a panel closed by a stray
 * click opens again on the same words.
 */
export function PullRequestReview({
  writes,
  pending,
  pendingItems,
}: {
  writes: PullRequestWrites;
  /** The member's own pending review, which the panel publishes or discards. */
  pending: PendingReview;
  /** Its comments as the panel lists them, under the line counting them; none lists none. */
  pendingItems?: readonly PendingItem[] | undefined;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [event, setEvent] = useState<ReviewEvent>(REVIEW_EVENT.COMMENT);
  const [body, setBody] = useState("");
  // Note that the question stands, busy, until GitHub answers the discard, says its refusal in GitHub's words, and holds the panel open meanwhile as a review on its way does.
  const discarding = useConfirmDialog(
    { subject: pending != null, surfaceOpen: open },
    writes.confirmAct({ action: PULL_REQUEST_ACTION.DISCARD_REVIEW }),
    confirmFailure(FAILURE_SURFACE.PULL_REQUEST_REVIEW_DISCARD),
  );
  const sending = writes.pending !== undefined || discarding.stage !== CONFIRM_STAGE.RESTING;
  return (
    <>
      <ReviewPress
        className="pull-request-review"
        words={{ ...REVIEW_WORDS, placeholder: placeholderOf(event) }}
        count={pending?.comments ?? 0}
        open={open}
        onOpen={setOpen}
        draft={{ body, setBody, over: overCommentBound(body) }}
        sending={sending}
        pending={pendingItems}
        choices={
          <ReplayUnmask>
            <ChoiceList<ReviewEvent>
              legend={EVENTS_LEGEND}
              options={EVENT_OPTIONS}
              value={[event]}
              disabled={writes.pending !== undefined}
              onChange={([next]) => {
                if (next !== undefined) setEvent(next);
              }}
            />
          </ReplayUnmask>
        }
        note={<PullRequestWriteNote writes={writes} className="pull-request-review-note" />}
        onDiscard={pending == null ? undefined : discarding.ask}
        onSent={(done) =>
          writes.write({ action: PULL_REQUEST_ACTION.SUBMIT_REVIEW, event, body }, () => {
            setEvent(REVIEW_EVENT.COMMENT);
            done();
          })
        }
      />
      <ConfirmDialog open confirm={discarding} question={DISCARD_QUESTION} />
    </>
  );
}
