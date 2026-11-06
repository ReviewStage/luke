import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { AgentAttachment } from "@repo/features/agent-wire";
import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_BOUNDS,
  DESCRIPTION_COMMENT_ENTRY,
  type DescriptionCommentStart,
} from "@repo/features/description-comment-wire";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { IRREVERSIBLE_WORDS } from "@repo/features/words";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  FailureNote,
  useConfirmDialog,
} from "@repo/ui";
import { neverBusyAct } from "@repo/ui/confirm-state";
import type { DescriptionCommentsControl } from "@repo/ui/description-comments";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { Schema } from "effect";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { keptLines } from "../composer-drafts.js";
import { confirmFailure, failureShown } from "../failure-report.js";
import { undoToast, useToast } from "../toast.js";
import { REVIEW_PANEL_WORDS, ReviewPress, type ReviewWords } from "./review-panel.js";

/**
 * page-review.tsx -- a member's review of a page: comments gathered on it and held in this window, unsent, until they send them together from the page's Review press, as a pull request's review is finished from its tab's.
 *
 * A comment on a page reaches the agent that wrote it the moment it is
 * posted, and each one wakes it again. A member with several things to say
 * instead starts a review (`PAGE_REVIEW_WORDS.START`), which holds the
 * comment here, a new thread's or a reply on a posted one, as a pull
 * request's review holds both; while one is held, every comment on the
 * page joins it until it is sent or discarded. Held comments are the reader's alone, kept
 * for the account signed in, in the renderer's storage as drafts are
 * (`keptLines`), so a reload or a relaunch finds them; their files stay in
 * the window that attached them, as a draft's do. Each stands where it was
 * written, pinned dashed to its element, and in the Review press's panel
 * (`review-panel.tsx`), never among the posted threads of the comments
 * column, as a pull request's pending comments stand on their lines and in
 * its Review panel; a held reply stands as the last comment of its thread,
 * wherever the thread is drawn. Each is edited in place, and deleted at
 * once with Undo, since it reaches no one but the reader.
 *
 * Sending the review starts each comment's thread, or replies on it, held
 * (`held`), which posts it for every member to read and hands it to no
 * agent, then sends the last naming the others' threads along (`along`),
 * which hands each agent in any of them every thread in one message, so the agent revises the page once
 * (the service's `reviewHandedOver`). The panel's summary, where one is
 * written, is held as a comment on the whole page and sent last. A start is
 * taken once under its key, so a send that stopped part way is simply sent
 * again.
 */

/** What starting, holding, and deleting a comment of a review say. */
export const PAGE_REVIEW_WORDS = {
  START: "Start a review",
  ADD: "Add to review",
  REMOVED: "Comment removed from your review",
  NOT_SENT: "Some comments could not be sent.",
  /** A held pin's name. */
  pin: (count: number) => `${count} ${count === 1 ? "comment" : "comments"} in your review`,
} as const;

/** Where a page's review goes, said before what it holds. */
const PAGE_LEAD = "Sent as you to the agent that wrote the page.";

/** The page's Review press's and panel's words. */
const PAGE_REVIEW_PRESS_WORDS: ReviewWords = {
  open: "Review",
  openWith: (count) => `Review, ${REVIEW_PANEL_WORDS.pending(count)}`,
  title: REVIEW_PANEL_WORDS.TITLE,
  lead: (count) =>
    count === 0
      ? PAGE_LEAD
      : `${PAGE_LEAD} ${REVIEW_PANEL_WORDS.pending(count)} will be sent together.`,
  body: REVIEW_PANEL_WORDS.BODY,
  placeholder: "Leave a summary comment (optional)",
  send: "Send review",
  sending: "Sending review",
};

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
  /** The posted thread it answers, its quote, and the element it is on, where it is a reply rather than a thread of its own. */
  readonly reply?: { readonly threadId: string; readonly quote: string; readonly path?: string };
  readonly words: string;
  readonly attachments: readonly AgentAttachment[];
  /** Whether a send that stopped part way posted it held already, so it is sent no more, and neither edited nor deleted, since the service holds it as it stood. */
  readonly landed?: true;
  /** Whether a Discard asked to delete it, posted already, and the service would not: it is sent no more, and only another Discard tries again. */
  readonly discarded?: true;
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
  reply: Schema.optionalKey(
    Schema.Struct({
      threadId: Schema.String,
      quote: Schema.String,
      path: Schema.optionalKey(Schema.String),
    }),
  ),
  words: Schema.String,
  landed: Schema.optionalKey(Schema.Literal(true)),
  discarded: Schema.optionalKey(Schema.Literal(true)),
});

/** Every comment held in a review, the account signed in's alone, in the order they were held, kept across a relaunch but for their files. */
const reviewAtom = keptLines<HeldComment, typeof keptHeldSchema.Type>({
  key: "app.pageReviews",
  kept: keptHeldSchema,
  toKept: ({ attachments: _files, element, reply, ...rest }) => ({
    ...rest,
    ...(element === undefined ? undefined : { element }),
    ...(reply === undefined ? undefined : { reply }),
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

/** The thread a held comment stands in once sent: the one it answers, or the one it starts, under its key. */
function threadOfHeld(comment: HeldComment): string {
  return comment.reply?.threadId ?? comment.clientKey;
}

/** Sends one held comment, held or naming the threads `along`: a reply on its thread, or the start of its own; answers whether it landed. */
async function sendHeld(
  control: DescriptionCommentsControl,
  comment: HeldComment,
  review: { readonly held: true } | { readonly along?: readonly string[] },
): Promise<boolean> {
  if (comment.reply === undefined) {
    const answer = await control.start({ ...startOf(comment), ...review });
    return !("note" in answer);
  }
  return control.act(comment.reply.threadId, {
    action: DESCRIPTION_COMMENT_ACTION.REPLY,
    clientKey: comment.clientKey,
    words: comment.words,
    ...(comment.attachments.length === 0 ? undefined : { attachments: comment.attachments }),
    ...review,
  });
}

/**
 * Sends a review: each comment but the last held, in the order held, but
 * those a send before posted already, each told to `onLanded` as it lands,
 * then the last naming the threads of the others along, each once. Answers
 * whether every comment landed, stopping at the first that did not.
 */
async function sendReview(
  control: DescriptionCommentsControl,
  comments: readonly HeldComment[],
  onLanded: (clientKey: string) => void,
): Promise<boolean> {
  const last = comments.at(-1);
  if (last === undefined) return true;
  const earlier = comments.slice(0, -1);
  for (const comment of earlier) {
    if (comment.landed === true) continue;
    // Note that each waits on the one before, so the threads stand in the order they were held.
    if (!(await sendHeld(control, comment, { held: true }))) return false;
    onLanded(comment.clientKey);
  }
  // Note that a thread holding several of the review's replies, or the last comment's own, is named once or not at all.
  const along = [...new Set(earlier.map(threadOfHeld))].filter((id) => id !== threadOfHeld(last));
  return sendHeld(control, last, along.length === 0 ? {} : { along });
}

/**
 * Deletes a held comment a stopped send posted already: the thread it
 * started, under its key, which is the thread's id; or, where it is a
 * reply, its own entry in its thread, the reader's latest of its words.
 * Answers whether it is gone; a reply no thread holds any more is.
 */
async function deletePosted(
  control: DescriptionCommentsControl | undefined,
  comment: HeldComment,
): Promise<boolean> {
  if (control === undefined) return false;
  const { reply } = comment;
  if (reply === undefined) {
    return control.act(comment.clientKey, { action: DESCRIPTION_COMMENT_ACTION.DELETE_THREAD });
  }
  const entry = control.threads
    .find((thread) => thread.id === reply.threadId)
    ?.entries.findLast(
      (each) => each.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT && each.words === comment.words,
    );
  if (entry === undefined) return true;
  return control.act(reply.threadId, {
    action: DESCRIPTION_COMMENT_ACTION.DELETE,
    entry: entry.id,
  });
}

/** A page's review as its pane draws and presses it. */
export interface PageReviewControl {
  /** The comments held on the page, in the order they were held, but those a Discard is still deleting. */
  readonly held: readonly HeldComment[];
  /** Whether a Discard left anything to delete, a thread the service would not delete yet, which another Discard tries again. */
  readonly leftover: boolean;
  readonly sending: boolean;
  /** Whether the last send stopped part way, until the next. */
  readonly failed: boolean;
  /** Holds a comment in the review, starting it where none was held. */
  readonly hold: (comment: Omit<HeldComment, "planId" | "pageId">) => void;
  /** Writes a held comment's words anew. */
  readonly edit: (clientKey: string, words: string) => void;
  /** Takes a held comment out of the review at once, saying so with Undo, which puts it back where it stood. */
  readonly remove: (clientKey: string) => void;
  readonly discard: () => void;
  /** Sends every held comment, then `summary` on the whole page where it holds words; answers whether all of it landed. */
  readonly send: (summary: string) => Promise<boolean>;
  /** Whether a held comment's edit stands open, which holds the review back until it is saved or canceled. */
  readonly editing: boolean;
  /** Says a held comment's edit opened or closed. The same function on every render. */
  readonly markEditing: (clientKey: string, open: boolean) => void;
}

/** The review of one page, at the version shown, of the plan the control holds, held in this window. */
export function usePageReview(
  control: DescriptionCommentsControl | undefined,
  pageId: string,
  version: number,
): PageReviewControl {
  const planId = control?.planId;
  const all = useAtomValue(reviewAtom);
  const setAll = useAtomSet(reviewAtom);
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  // The held comments whose edit stands open, by their keys.
  const [edits, setEdits] = useState<ReadonlySet<string>>(new Set());
  const markEditing = useCallback((clientKey: string, open: boolean) => {
    setEdits((was) => {
      if (was.has(clientKey) === open) return was;
      const next = new Set(was);
      if (open) next.add(clientKey);
      else next.delete(clientKey);
      return next;
    });
  }, []);
  const page = useMemo(
    () => all.filter((comment) => heldOn(comment, planId, pageId)),
    [all, planId, pageId],
  );
  // Note that a thread a Discard could not delete is never sent, drawn, or counted, so no Send hands on what the reader discarded.
  const held = useMemo(() => page.filter((comment) => comment.discarded !== true), [page]);
  const send = async (summary: string): Promise<boolean> => {
    // Note that an edit standing open would land after the words it changes went, so it is saved or canceled first.
    if (control === undefined || planId === undefined || sending || edits.size > 0) return false;
    const words = summary.trim();
    // Note that the summary is held before it goes, so a send that stops part way keeps it, under its key, for the next.
    const last: HeldComment[] =
      words === ""
        ? []
        : [
            {
              planId,
              pageId,
              clientKey: crypto.randomUUID(),
              version,
              element: undefined,
              words,
              attachments: [],
            },
          ];
    const comments = [...held, ...last];
    if (comments.length === 0) return false;
    if (last.length > 0) setAll((now) => [...now, ...last]);
    setSending(true);
    setFailed(false);
    // Note that a comment posted held is marked so, so a send that stops after it neither sends it again nor lets it change under the service's copy.
    const sent = await sendReview(control, comments, (clientKey) =>
      setAll((now) =>
        now.map((comment) =>
          comment.clientKey === clientKey ? { ...comment, landed: true } : comment,
        ),
      ),
    );
    setSending(false);
    if (!sent) {
      setFailed(true);
      return false;
    }
    const keys = new Set(comments.map((comment) => comment.clientKey));
    setAll((now) => now.filter((comment) => !keys.has(comment.clientKey)));
    return true;
  };
  const drop = (keep: (comment: HeldComment) => boolean) => setAll((now) => now.filter(keep));
  const remove = (clientKey: string) => {
    const at = all.findIndex((comment) => comment.clientKey === clientKey);
    const gone = all[at];
    if (gone === undefined || gone.landed === true) return;
    drop((comment) => comment.clientKey !== clientKey);
    // Note that Undo puts the comment back where it stood among the rest, its files with it, unless it stands there again already.
    const undo = () =>
      setAll((now) =>
        now.some((comment) => comment.clientKey === clientKey)
          ? now
          : [...now.slice(0, at), gone, ...now.slice(at)],
      );
    toast({ ...undoToast(PAGE_REVIEW_WORDS.REMOVED, undo), replayUnmasked: true });
  };
  return {
    held,
    leftover: page.length > held.length,
    sending,
    failed,
    hold: (comment) => {
      if (planId !== undefined) setAll((now) => [...now, { ...comment, planId, pageId }]);
    },
    edit: (clientKey, words) =>
      setAll((now) =>
        now.map((comment) =>
          comment.clientKey === clientKey && comment.landed !== true
            ? { ...comment, words }
            : comment,
        ),
      ),
    remove,
    discard: () => {
      setFailed(false);
      // Note that what a stopped send posted already is deleted with the rest, so a discarded review leaves nothing behind, as its question says; what the service would not delete stays held, never to be sent, for the next Discard to try again.
      const posted = page.filter((comment) => comment.landed === true);
      const keys = new Set(posted.map((comment) => comment.clientKey));
      setAll((now) =>
        now.flatMap((comment) => {
          if (!heldOn(comment, planId, pageId)) return [comment];
          return keys.has(comment.clientKey) ? [{ ...comment, discarded: true as const }] : [];
        }),
      );
      for (const comment of posted) {
        void deletePosted(control, comment).then((deleted) => {
          if (deleted) drop((each) => each.clientKey !== comment.clientKey);
        });
      }
    },
    send,
    editing: edits.size > 0,
    markEditing,
  };
}

/**
 * The page's Review press and its Finish your review panel, as a pull
 * request's tab draws them: the count of held comments at its corner; in
 * the panel, where the review goes, each held comment (`pendingOf`), the
 * summary, why the last send did not land, then Discard, which asks first,
 * Cancel, and Send review.
 */
export function PageReviewPress({
  review,
  pendingOf,
}: {
  review: PageReviewControl;
  /** A held comment as the panel lists it, with its Edit and Delete; none while the review is on its way, since a start out may still post it. */
  pendingOf: (comment: HeldComment, busy: boolean) => ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const count = review.held.length;
  const discarding = useConfirmDialog(
    { subject: count > 0 || review.leftover, surfaceOpen: open },
    neverBusyAct(() => {
      review.discard();
    }),
    confirmFailure(FAILURE_SURFACE.DESCRIPTION_COMMENT_DISCARD),
  );
  const nothing = count === 0 && body.trim() === "";
  return (
    <>
      <ReviewPress
        className="page-review"
        words={PAGE_REVIEW_PRESS_WORDS}
        count={count}
        open={open}
        onOpen={setOpen}
        draft={{
          body,
          setBody,
          over:
            nothing || review.editing || body.length > DESCRIPTION_COMMENT_BOUNDS.MAX_WORDS_CHARS,
        }}
        sending={review.sending}
        pending={review.held.map((comment) => ({
          key: comment.clientKey,
          comment: pendingOf(comment, review.sending),
        }))}
        note={
          review.failed ? (
            <FailureNote
              // Note that a retry that lands closes the panel, as Send does.
              onRetry={() =>
                void review.send("").then((sent) => {
                  if (sent) setOpen(false);
                })
              }
              failure={failureShown({
                surface: FAILURE_SURFACE.DESCRIPTION_COMMENT_SEND,
                cause: FAILURE_CONDITION.REFUSED,
              })}
            >
              <ReplayUnmask>{PAGE_REVIEW_WORDS.NOT_SENT}</ReplayUnmask>
            </FailureNote>
          ) : null
        }
        onDiscard={count === 0 && !review.leftover ? undefined : discarding.ask}
        onSent={(done) => {
          // Note that a summary goes into the review as it is sent, so it is let go of here whether or not the rest lands.
          const summary = body;
          setBody("");
          void review.send(summary).then((sent) => {
            if (sent) done();
          });
        }}
      />
      <ConfirmDialog open confirm={discarding} question={DISCARD_QUESTION} />
    </>
  );
}
