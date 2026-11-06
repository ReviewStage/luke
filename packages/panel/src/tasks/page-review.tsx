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
import { neverBusyAct } from "@repo/ui/confirm-state";
import type { DescriptionCommentsControl } from "@repo/ui/description-comments";
import { GLYPH } from "@repo/ui/icons";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { Schema } from "effect";
import { Fragment, useMemo, useState } from "react";
import { keptLines } from "../composer-drafts.js";
import { confirmFailure, failureShown } from "../failure-report.js";
import { ACTS_AT_END_CLASS } from "./pull-request-look.js";

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
  pin: (count: number) => `${count} ${count === 1 ? "comment" : "comments"} in your review`,
} as const;

const DISCARD_QUESTION: DialogQuestion = {
  title: "Discard your review?",
  body: `This deletes every comment you held in it. ${IRREVERSIBLE_WORDS}`,
  verb: "Discard review",
  running: "Discarding",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
  replayUnmasked: true,
};

export interface HeldComment {
  readonly planId: string;
  readonly pageId: string;
  readonly clientKey: string;
  readonly version: number;
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

function heldOn(comment: HeldComment, planId: string | undefined, pageId: string): boolean {
  return comment.planId === planId && comment.pageId === pageId;
}

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

async function sendReview(
  control: DescriptionCommentsControl,
  comments: readonly HeldComment[],
): Promise<boolean> {
  const last = comments.at(-1);
  if (last === undefined) return true;
  const earlier = comments.slice(0, -1);
  for (const comment of earlier) {
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

export interface PageReviewControl {
  readonly held: readonly HeldComment[];
  readonly sending: boolean;
  readonly failed: boolean;
  readonly hold: (comment: Omit<HeldComment, "planId" | "pageId">) => void;
  readonly remove: (clientKey: string) => void;
  readonly discard: () => void;
  readonly send: () => void;
}

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

export function PageReviewSection({
  review,
  cardOf,
}: {
  review: PageReviewControl;
  cardOf: (comment: HeldComment, onRemove: (() => void) | undefined) => React.ReactNode;
}): React.JSX.Element | null {
  const count = review.held.length;
  const discarding = useConfirmDialog(
    { subject: count > 0, surfaceOpen: true },
    neverBusyAct(() => {
      review.discard();
    }),
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
