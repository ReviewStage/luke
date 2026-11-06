import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { AgentAttachment } from "@repo/features/agent-wire";
import type { DescriptionCommentStart } from "@repo/features/description-comment-wire";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { IRREVERSIBLE_WORDS } from "@repo/features/words";
import {
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  FailureNote,
  useConfirmDialog,
} from "@repo/ui";
import type { DescriptionCommentsControl } from "@repo/ui/description-comments";
import { GLYPH } from "@repo/ui/icons";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { Schema } from "effect";
import { Fragment, useMemo, useState } from "react";
import { keptLines } from "../composer-drafts.js";
import { confirmFailure, failureShown } from "../failure-report.js";
import { ACTS_AT_END_CLASS } from "./pull-request-look.js";

/**
 * page-review.tsx -- a member's review of a page: comments gathered on it and held in this window, unsent, until they send them together, and the section at the head of the page's comments column that lists, sends, and discards them.
 *
 * A comment on a page reaches the agent that wrote it the moment it is
 * posted, and each one wakes it again. A member with several things to say
 * instead starts a review (`PAGE_REVIEW_WORDS.START`), which holds the
 * comment here; while one is held, every comment on the page joins it
 * until it is sent or discarded. Held comments are the reader's alone, kept
 * for the account signed in, in the renderer's storage as drafts are
 * (`keptLines`), so a reload or a relaunch finds them; their files stay in
 * the window that attached them, as a draft's do. Each is pinned to its
 * element, dashed, until it is sent.
 *
 * Sending the review starts each comment's thread held (`held`), which
 * posts it for every member to read and hands it to no agent, then starts
 * the last naming the others along (`along`), which hands each agent in any
 * of them every thread in one message, so the agent revises the page once
 * (the service's `reviewHandedOver`). A start is taken once under its key,
 * so a send that stopped part way is simply sent again.
 */

/** What the review's press, panel, and the field's presses say. */
export const PAGE_REVIEW_WORDS = {
  TITLE: "Your review",
  START: "Start a review",
  ADD: "Add to review",
  SEND: "Send",
  SENDING: "Sending",
  DISCARD: "Discard",
  REMOVE: "Remove",
  PENDING: "Pending",
  WHOLE_PAGE: "Whole page",
  NOT_SENT: "Some comments could not be sent.",
  /** A held pin's name. */
  pin: (count: number) => `${count} ${count === 1 ? "comment" : "comments"} in your review`,
} as const;

/** What Discard asks before it lets every held comment go. */
const DISCARD_QUESTION: DialogQuestion = {
  title: "Discard your review?",
  body: `This deletes every comment you held in it. ${IRREVERSIBLE_WORDS}`,
  verb: "Discard review",
  running: "Discarding",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
  replayUnmasked: true,
};

/** One comment held in a member's review of a page, unsent. */
export interface HeldComment {
  readonly planId: string;
  readonly pageId: string;
  /** The key its thread is started under, which is its thread's id too. */
  readonly clientKey: string;
  /** The version of the page it was written on. */
  readonly version: number;
  /** The element it is on, as a thread being started names it; none for the whole page. */
  readonly element:
    | {
        readonly path: string;
        readonly quote: string;
        readonly section: string;
        readonly words?: true;
      }
    | undefined;
  readonly words: string;
  readonly attachments: readonly AgentAttachment[];
}

/** A held comment as the renderer's storage keeps it: all of it but its files. */
const keptHeldSchema = Schema.Struct({
  planId: Schema.String,
  pageId: Schema.String,
  clientKey: Schema.String,
  version: Schema.Number,
  element: Schema.optionalKey(
    Schema.Struct({
      path: Schema.String,
      quote: Schema.String,
      section: Schema.String,
      words: Schema.optionalKey(Schema.Literal(true)),
    }),
  ),
  words: Schema.String,
});

/** Every comment held in a review, the account signed in's alone, in the order they were held, kept across a relaunch but for their files. */
const reviewAtom = keptLines<HeldComment, typeof keptHeldSchema.Type>({
  key: "app.pageReviews",
  kept: keptHeldSchema,
  toKept: ({ attachments: _files, element, ...rest }) => ({
    ...rest,
    ...(element === undefined ? undefined : { element }),
  }),
  fromKept: (kept) => ({ ...kept, element: kept.element, attachments: [] }),
  idOf: (kept) => kept.clientKey,
});

/** Whether a held comment is the page's, on the plan named. */
function heldOn(comment: HeldComment, planId: string | undefined, pageId: string): boolean {
  return comment.planId === planId && comment.pageId === pageId;
}

/** The start of a held comment's thread, under its key, which names the thread. */
function startOf(comment: HeldComment): DescriptionCommentStart {
  return {
    id: comment.clientKey,
    clientKey: comment.clientKey,
    page: { id: comment.pageId, version: comment.version },
    ...(comment.element === undefined ? undefined : { element: comment.element }),
    words: comment.words,
    ...(comment.attachments.length === 0 ? undefined : { attachments: comment.attachments }),
  };
}

/**
 * Sends a review: each comment but the last started held, in the order
 * held, then the last naming them all along. Answers whether every start
 * landed, stopping at the first that did not.
 */
async function sendReview(
  control: DescriptionCommentsControl,
  comments: readonly HeldComment[],
): Promise<boolean> {
  const last = comments.at(-1);
  if (last === undefined) return true;
  const earlier = comments.slice(0, -1);
  for (const comment of earlier) {
    // Note that each waits on the one before, so the threads stand in the order they were held.
    const answer = await control.start({ ...startOf(comment), held: true });
    if ("note" in answer) return false;
  }
  const along = earlier.map((comment) => comment.clientKey);
  const answer = await control.start({
    ...startOf(last),
    ...(along.length === 0 ? undefined : { along }),
  });
  return !("note" in answer);
}

/** A page's review as its pane draws and presses it. */
export interface PageReviewControl {
  /** The comments held on the page, in the order they were held. */
  readonly held: readonly HeldComment[];
  readonly sending: boolean;
  /** Whether the last send stopped part way, until the next. */
  readonly failed: boolean;
  /** Holds a comment in the review, starting it where none was held. */
  readonly hold: (comment: Omit<HeldComment, "planId" | "pageId">) => void;
  readonly remove: (clientKey: string) => void;
  readonly discard: () => void;
  readonly send: () => void;
}

/** The review of one page of the plan the control holds, held in this window. */
export function usePageReview(
  control: DescriptionCommentsControl | undefined,
  pageId: string,
): PageReviewControl {
  const planId = control?.planId;
  const all = useAtomValue(reviewAtom);
  const setAll = useAtomSet(reviewAtom);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const held = useMemo(
    () => all.filter((comment) => heldOn(comment, planId, pageId)),
    [all, planId, pageId],
  );
  const send = () => {
    if (control === undefined || sending || held.length === 0) return;
    const comments = held;
    setSending(true);
    setFailed(false);
    void sendReview(control, comments).then((sent) => {
      setSending(false);
      if (!sent) return setFailed(true);
      const keys = new Set(comments.map((comment) => comment.clientKey));
      setAll((now) => now.filter((comment) => !keys.has(comment.clientKey)));
    });
  };
  const drop = (keep: (comment: HeldComment) => boolean) => setAll((now) => now.filter(keep));
  return {
    held,
    sending,
    failed,
    hold: (comment) => {
      if (planId !== undefined) setAll((now) => [...now, { ...comment, planId, pageId }]);
    },
    remove: (clientKey) => drop((comment) => comment.clientKey !== clientKey),
    discard: () => {
      setFailed(false);
      drop((comment) => !heldOn(comment, planId, pageId));
    },
    send,
  };
}

/**
 * The reader's review at the head of a page's comments column, standing
 * while they hold comments on the page: each held comment as a comment card
 * marked Pending, with Remove (`cardOf`), then
 * Discard, which asks first, and Send. Once sent, the section goes with the
 * comments it held, which stand as threads in the list under it.
 */
export function PageReviewSection({
  review,
  cardOf,
}: {
  review: PageReviewControl;
  /** A held comment drawn as a comment card, with its Remove; none while the review is on its way, since a start out may still post it. */
  cardOf: (comment: HeldComment, onRemove: (() => void) | undefined) => React.ReactNode;
}): React.JSX.Element | null {
  const count = review.held.length;
  const discarding = useConfirmDialog(
    { subject: count > 0, surfaceOpen: true },
    () => {
      review.discard();
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
    },
    confirmFailure(FAILURE_SURFACE.DESCRIPTION_COMMENT_DISCARD),
  );
  if (count === 0) return null;
  return (
    <section
      className="page-review flex min-w-0 flex-col gap-item-gap"
      aria-label={PAGE_REVIEW_WORDS.TITLE}
    >
      {review.held.map((comment) => (
        <Fragment key={comment.clientKey}>
          {cardOf(comment, review.sending ? undefined : () => review.remove(comment.clientKey))}
        </Fragment>
      ))}
      {review.failed ? (
        <FailureNote
          onRetry={review.send}
          failure={failureShown({
            surface: FAILURE_SURFACE.DESCRIPTION_COMMENT_SEND,
            cause: FAILURE_CONDITION.REFUSED,
          })}
        >
          <ReplayUnmask>{PAGE_REVIEW_WORDS.NOT_SENT}</ReplayUnmask>
        </FailureNote>
      ) : null}
      <ReplayUnmask>
        <div className={ACTS_AT_END_CLASS}>
          <Button
            variant={BUTTON_VARIANT.DANGER_OUTLINE}
            icon={<GLYPH.DELETE />}
            disabled={review.sending}
            onClick={discarding.ask}
          >
            {PAGE_REVIEW_WORDS.DISCARD}
          </Button>
          <Button
            variant={BUTTON_VARIANT.PRIMARY}
            busy={review.sending}
            busyLabel={PAGE_REVIEW_WORDS.SENDING}
            onClick={review.send}
          >
            {`${PAGE_REVIEW_WORDS.SEND} ${count} ${count === 1 ? "comment" : "comments"}`}
          </Button>
        </div>
      </ReplayUnmask>
      <ConfirmDialog open confirm={discarding} question={DISCARD_QUESTION} />
    </section>
  );
}
