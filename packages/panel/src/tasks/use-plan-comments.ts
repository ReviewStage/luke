import { LIVE_READ } from "@repo/features/live-wire";
import {
  PLAN_COMMENT_ACTION,
  PLAN_COMMENT_REFUSAL,
  type PlanCommentActionRequest,
  type PlanCommentRefusal,
  type PlanCommentStart,
  type PlanCommentThread,
} from "@repo/features/plan-comment-wire";
import {
  FAILURE_CONDITION,
  FAILURE_SURFACE,
  type FailureSurface,
} from "@repo/features/shown-failure";
import { PLAN_COMMENT_CALL_FAILURE, type TasksCommentAnswer } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { STATUS_TONE } from "@repo/ui";
import type { PlanCommentsControl } from "@repo/ui/plan-comments";
import { useCallback, useMemo, useState } from "react";
import { useAct } from "../act.js";
import { DRAFT_PLACE, useDraftWriter } from "../composer-drafts.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { type CommentSubject, HOST_READ_STATUS, useHostRead } from "../use-host-read.js";

/**
 * use-plan-comments.ts -- a plan's comment threads, or one of its task's pages', as one control: held by the host while the surface shows them, and each write on its way back.
 *
 * The host follows the subject's threads while a surface holds them
 * (`LIVE_READ.PLAN_COMMENTS`) and lays them on app state, so a teammate's
 * comment or an agent's reply lands in every open window, and a surface
 * drawn again draws them in its first frame. A read that did not answer
 * says so, with Try again.
 *
 * Every write is drawn by the host over the held threads the moment it is
 * asked (`@repo/host`'s `plan-comment-writes.ts`), a thread started among
 * them under the id its caller minted, and stands until the read carries
 * it, so nothing here waits on one. A thread is started, and each comment
 * posted, under a key the caller keeps for as long as its words stand, so a
 * write sent again after a lost answer is taken once. A write that did not
 * land is taken back by the host: a reply's is said on its thread, its words
 * kept by its field, and any other's in a toast, since what it was pressed
 * on may have closed or gone meanwhile, an edit's words kept as its draft. Posting a comment reaches the agents
 * in its thread, the page's writer among them on a page, and one it
 * mentions, and is said on its thread where one in it could not take it.
 */

/** What a write to a thread did not do, said on the thread. */
const COMMENT_NOTE = {
  NOT_POSTED: "The comment could not be posted.",
  NOT_CHANGED: "The comment could not be changed.",
  TOO_MANY: "This thread holds as many comments as it can.",
  NO_WORDS: "The words this comment was on are no longer in the description.",
  NOT_YOURS: "Only its writer can change this comment.",
  GONE: "This comment is no longer in the thread.",
  AGENT_AWAY: "That agent isn't running, so it couldn't take the thread.",
} as const;

const UNANSWERED = { failure: PLAN_COMMENT_CALL_FAILURE.UNANSWERED } as const;

/** No threads, while a read has not answered. */
const NO_THREADS: readonly PlanCommentThread[] = [];

/** What a comment's answer says of the agents its mentions asked who could not take the thread; nothing where every one did. */
function unsentWords(answer: TasksCommentAnswer): string | undefined {
  const unsent = "thread" in answer ? (answer.unsent ?? []) : [];
  return unsent.length === 0 ? undefined : COMMENT_NOTE.AGENT_AWAY;
}

/** Where a write's refusal is reported, by what it did. */
function surfaceOf(action: PlanCommentActionRequest["action"]): FailureSurface {
  switch (action) {
    case PLAN_COMMENT_ACTION.REPLY:
      return FAILURE_SURFACE.PLAN_COMMENT_SEND;
    case PLAN_COMMENT_ACTION.EDIT:
      return FAILURE_SURFACE.PLAN_COMMENT_EDIT;
    case PLAN_COMMENT_ACTION.DELETE:
    case PLAN_COMMENT_ACTION.DELETE_THREAD:
      return FAILURE_SURFACE.PLAN_COMMENT_DELETE;
    case PLAN_COMMENT_ACTION.RESOLVE:
      return FAILURE_SURFACE.PLAN_THREAD_RESOLVE;
    case PLAN_COMMENT_ACTION.REOPEN:
      return FAILURE_SURFACE.PLAN_THREAD_REOPEN;
  }
}

/** The words a refusal is said in on its thread. */
function refusalWords(refusal: PlanCommentRefusal): string {
  switch (refusal) {
    case PLAN_COMMENT_REFUSAL.TOO_MANY:
      return COMMENT_NOTE.TOO_MANY;
    case PLAN_COMMENT_REFUSAL.NO_WORDS:
      return COMMENT_NOTE.NO_WORDS;
    case PLAN_COMMENT_REFUSAL.NOT_YOURS:
      return COMMENT_NOTE.NOT_YOURS;
    case PLAN_COMMENT_REFUSAL.NO_ENTRY:
      return COMMENT_NOTE.GONE;
    case PLAN_COMMENT_REFUSAL.KEY_TAKEN:
      return COMMENT_NOTE.NOT_CHANGED;
  }
}

/**
 * The plan's comments, or one of its task's pages' where the subject names
 * one, held while a subject is named: the threads, and the doors that write
 * them, each answered as the service holds the thread after it.
 */
export function usePlanComments(
  subject: CommentSubject | undefined,
): PlanCommentsControl | undefined {
  const read = useHostRead(LIVE_READ.PLAN_COMMENTS, subject);
  const { act: ask } = useAct();
  const toast = useToast();
  const drafts = useDraftWriter();
  const [notes, setNotes] = useState<ReadonlyMap<string, string>>(new Map());
  const planId = subject?.taskId;

  /** Says in a toast that a write the host drew was taken back, and why. */
  const takenBack = useCallback(
    (words: string, surface: FailureSurface, answer: TasksCommentAnswer) =>
      toast({
        replayUnmasked: true,
        words,
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure: {
          surface,
          cause: "refused" in answer ? FAILURE_CONDITION.REFUSED : FAILURE_CONDITION.NOT_KEPT,
          about: { taskId: planId },
        },
      }),
    [toast, planId],
  );

  const note = useCallback((threadId: string, words: string | undefined) => {
    setNotes((was) => {
      const next = new Map(was);
      if (words === undefined) next.delete(threadId);
      else next.set(threadId, words);
      return next;
    });
  }, []);

  const start = useCallback(
    async (begun: PlanCommentStart) => {
      if (planId === undefined) return { note: COMMENT_NOTE.NOT_POSTED };
      const answer = await ask(ACT_KIND.TASKS_COMMENT_START, { planId, start: begun }).catch(
        (): TasksCommentAnswer => UNANSWERED,
      );
      if (!("thread" in answer)) {
        const words = "refused" in answer ? refusalWords(answer.refused) : COMMENT_NOTE.NOT_POSTED;
        takenBack(words, FAILURE_SURFACE.PLAN_COMMENT_SEND, answer);
        return { note: words };
      }
      note(answer.thread.id, unsentWords(answer));
      return { thread: answer.thread };
    },
    [planId, ask, note, takenBack],
  );

  const act = useCallback(
    async (threadId: string, action: PlanCommentActionRequest): Promise<boolean> => {
      if (planId === undefined) return false;
      note(threadId, undefined);
      const answer = await ask(ACT_KIND.TASKS_COMMENT_ACT, { planId, threadId, action }).catch(
        (): TasksCommentAnswer => UNANSWERED,
      );
      if ("thread" in answer || "deleted" in answer) {
        note(threadId, unsentWords(answer));
        return true;
      }
      const reply = action.action === PLAN_COMMENT_ACTION.REPLY;
      const words =
        "refused" in answer
          ? refusalWords(answer.refused)
          : reply
            ? COMMENT_NOTE.NOT_POSTED
            : COMMENT_NOTE.NOT_CHANGED;
      // Note that a reply's refusal is said under its field, which its words go back into.
      if (reply) note(threadId, words);
      else takenBack(words, surfaceOf(action.action), answer);
      // Note that an edit's field closed as it was sent, so its words go back to its draft, which Edit opens on.
      if (action.action === PLAN_COMMENT_ACTION.EDIT) {
        drafts.update(
          { kind: DRAFT_PLACE.PLAN_COMMENT, planId, on: { threadId, entryId: action.entry } },
          (was) => ({ ...was, text: action.words }),
        );
      }
      return false;
    },
    [planId, ask, note, takenBack, drafts],
  );

  const { rows, status, retry } = read;
  return useMemo(
    () =>
      planId === undefined
        ? undefined
        : {
            planId,
            threads: rows ?? NO_THREADS,
            read: status === HOST_READ_STATUS.READY,
            failed: status === HOST_READ_STATUS.FAILED,
            onRetry: retry,
            notes,
            start,
            act,
          },
    [planId, rows, status, retry, notes, start, act],
  );
}
