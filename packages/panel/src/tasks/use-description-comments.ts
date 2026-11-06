import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_REFUSAL,
  type DescriptionCommentActionRequest,
  type DescriptionCommentRefusal,
  type DescriptionCommentStart,
  type DescriptionCommentThread,
} from "@repo/features/description-comment-wire";
import {
  FAILURE_CONDITION,
  FAILURE_SURFACE,
  type FailureSurface,
} from "@repo/features/shown-failure";
import {
  DESCRIPTION_COMMENT_CALL_FAILURE,
  type TasksCommentAnswer,
} from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { STATUS_TONE } from "@repo/ui";
import type { DescriptionCommentsControl } from "@repo/ui/description-comments";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { DRAFT_PLACE, useDraftWriter } from "../composer-drafts.js";
import {
  type CommentSubject,
  descriptionCommentsQuery,
  descriptionCommentsRetryMutation,
} from "../live-reads.js";
import { TOAST_HOLD, useToast } from "../toast.js";

const COMMENT_NOTE = {
  NOT_POSTED: "The comment could not be posted.",
  NOT_CHANGED: "The comment could not be changed.",
  TOO_MANY: "This thread holds as many comments as it can.",
  NO_WORDS: "The words this comment was on are no longer in the description.",
  NOT_YOURS: "Only its writer can change this comment.",
  GONE: "This comment is no longer in the thread.",
  AGENT_AWAY: "That agent isn't running, so it couldn't take the thread.",
} as const;

const UNANSWERED = { failure: DESCRIPTION_COMMENT_CALL_FAILURE.UNANSWERED } as const;

const NO_THREADS: readonly DescriptionCommentThread[] = [];

function unsentWords(answer: TasksCommentAnswer): string | undefined {
  const unsent = "thread" in answer ? (answer.unsent ?? []) : [];
  return unsent.length === 0 ? undefined : COMMENT_NOTE.AGENT_AWAY;
}

function surfaceOf(action: DescriptionCommentActionRequest["action"]): FailureSurface {
  switch (action) {
    case DESCRIPTION_COMMENT_ACTION.REPLY:
      return FAILURE_SURFACE.DESCRIPTION_COMMENT_SEND;
    case DESCRIPTION_COMMENT_ACTION.EDIT:
      return FAILURE_SURFACE.DESCRIPTION_COMMENT_EDIT;
    case DESCRIPTION_COMMENT_ACTION.DELETE:
    case DESCRIPTION_COMMENT_ACTION.DELETE_THREAD:
      return FAILURE_SURFACE.DESCRIPTION_COMMENT_DELETE;
    case DESCRIPTION_COMMENT_ACTION.RESOLVE:
      return FAILURE_SURFACE.DESCRIPTION_THREAD_RESOLVE;
    case DESCRIPTION_COMMENT_ACTION.REOPEN:
      return FAILURE_SURFACE.DESCRIPTION_THREAD_REOPEN;
  }
}

function refusalWords(refusal: DescriptionCommentRefusal): string {
  switch (refusal) {
    case DESCRIPTION_COMMENT_REFUSAL.TOO_MANY:
      return COMMENT_NOTE.TOO_MANY;
    case DESCRIPTION_COMMENT_REFUSAL.NO_WORDS:
      return COMMENT_NOTE.NO_WORDS;
    case DESCRIPTION_COMMENT_REFUSAL.NOT_YOURS:
      return COMMENT_NOTE.NOT_YOURS;
    case DESCRIPTION_COMMENT_REFUSAL.NO_ENTRY:
      return COMMENT_NOTE.GONE;
    case DESCRIPTION_COMMENT_REFUSAL.KEY_TAKEN:
      return COMMENT_NOTE.NOT_CHANGED;
  }
}

export function useDescriptionComments(
  subject: CommentSubject | undefined,
): DescriptionCommentsControl | undefined {
  const read = useQuery(descriptionCommentsQuery(subject));
  const { mutate: retryComments } = useMutation(descriptionCommentsRetryMutation());
  const { mutateAsync: sendStart } = useMutation(actMutation(ACT_KIND.TASKS_COMMENT_START));
  const { mutateAsync: sendCommentAct } = useMutation(actMutation(ACT_KIND.TASKS_COMMENT_ACT));
  const toast = useToast();
  const drafts = useDraftWriter();
  const [notes, setNotes] = useState<ReadonlyMap<string, string>>(new Map());
  const planId = subject?.taskId;

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
    async (begun: DescriptionCommentStart) => {
      if (planId === undefined) return { note: COMMENT_NOTE.NOT_POSTED };
      const answer = await sendStart({ planId, start: begun }).catch(
        (): TasksCommentAnswer => UNANSWERED,
      );
      if (!("thread" in answer)) {
        const words = "refused" in answer ? refusalWords(answer.refused) : COMMENT_NOTE.NOT_POSTED;
        takenBack(words, FAILURE_SURFACE.DESCRIPTION_COMMENT_SEND, answer);
        return { note: words };
      }
      note(answer.thread.id, unsentWords(answer));
      return { thread: answer.thread };
    },
    [planId, sendStart, note, takenBack],
  );

  const act = useCallback(
    async (threadId: string, action: DescriptionCommentActionRequest): Promise<boolean> => {
      if (planId === undefined) return false;
      note(threadId, undefined);
      const answer = await sendCommentAct({ planId, threadId, action }).catch(
        (): TasksCommentAnswer => UNANSWERED,
      );
      if ("thread" in answer || "deleted" in answer) {
        note(threadId, unsentWords(answer));
        return true;
      }
      const reply = action.action === DESCRIPTION_COMMENT_ACTION.REPLY;
      const words =
        "refused" in answer
          ? refusalWords(answer.refused)
          : reply
            ? COMMENT_NOTE.NOT_POSTED
            : COMMENT_NOTE.NOT_CHANGED;
      if (reply) note(threadId, words);
      else takenBack(words, surfaceOf(action.action), answer);
      if (action.action === DESCRIPTION_COMMENT_ACTION.EDIT) {
        drafts.update(
          {
            kind: DRAFT_PLACE.DESCRIPTION_COMMENT,
            planId,
            on: { threadId, entryId: action.entry },
          },
          (was) => ({ ...was, text: action.words }),
        );
      }
      return false;
    },
    [planId, sendCommentAct, note, takenBack, drafts],
  );

  const rows = read.data;
  const { isSuccess, isError } = read;
  const pageId = subject?.pageId;
  const retry = useCallback(() => {
    if (planId === undefined) return;
    retryComments(pageId === undefined ? { taskId: planId } : { taskId: planId, pageId });
  }, [retryComments, planId, pageId]);
  return useMemo(
    () =>
      planId === undefined
        ? undefined
        : {
            planId,
            threads: rows ?? NO_THREADS,
            read: isSuccess,
            failed: isError,
            onRetry: retry,
            notes,
            start,
            act,
          },
    [planId, rows, isSuccess, isError, retry, notes, start, act],
  );
}
