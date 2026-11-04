import { LIVE_READ } from "@repo/features/live-wire";
import {
  PLAN_COMMENT_REFUSAL,
  type PlanCommentActionRequest,
  type PlanCommentRefusal,
  type PlanCommentStart,
  type PlanCommentThread,
} from "@repo/features/plan-comment-wire";
import { PLAN_COMMENT_CALL_FAILURE, type TasksCommentAnswer } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import type { PlanCommentsControl } from "@repo/ui/plan-comments";
import { useCallback, useMemo, useState } from "react";
import { useAct } from "../act.js";
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
 * A thread is started, and each comment posted, under a key the caller
 * keeps for as long as its words stand, so a write sent again after a lost
 * answer is taken once; the host lays the thread the service answers, or
 * its deletion, over the held threads until the read holds it. A write that
 * did not land is said on its thread, its draft kept by the caller. Posting
 * a comment reaches the agents in its thread, the page's writer among them
 * on a page, and one it mentions, and is said on its thread where one in it
 * could not take it.
 */

/** What a write to a thread did not do, said on the thread. */
const COMMENT_NOTE = {
  NOT_POSTED: "The comment could not be posted.",
  NOT_CHANGED: "The comment could not be changed.",
  TOO_MANY: "This thread holds as many comments as it can.",
  NO_WORDS: "The words this comment was on are no longer in the plan.",
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
  const [notes, setNotes] = useState<ReadonlyMap<string, string>>(new Map());
  const planId = subject?.taskId;

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
      if ("refused" in answer) return { note: refusalWords(answer.refused) };
      if (!("thread" in answer)) return { note: COMMENT_NOTE.NOT_POSTED };
      note(answer.thread.id, unsentWords(answer));
      return { thread: answer.thread };
    },
    [planId, ask, note],
  );

  const act = useCallback(
    async (threadId: string, action: PlanCommentActionRequest): Promise<boolean> => {
      if (planId === undefined) return false;
      note(threadId, undefined);
      const answer = await ask(ACT_KIND.TASKS_COMMENT_ACT, { planId, threadId, action }).catch(
        (): TasksCommentAnswer => UNANSWERED,
      );
      if ("refused" in answer) {
        note(threadId, refusalWords(answer.refused));
        return false;
      }
      if ("failure" in answer) {
        note(threadId, "words" in action ? COMMENT_NOTE.NOT_POSTED : COMMENT_NOTE.NOT_CHANGED);
        return false;
      }
      note(threadId, unsentWords(answer));
      return true;
    },
    [planId, ask, note],
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
