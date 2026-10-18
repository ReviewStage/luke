import { textChange } from "@luke/features/plan-comment-anchor";
import {
  PLAN_COMMENT_ACTION,
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_REFUSAL,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  PLAN_COMMENTS_CURSOR_START,
  type PlanCommentActionRequest,
  type PlanCommentRefusal,
  type PlanCommentStartRequest,
  type PlanCommentThread,
} from "@luke/features/plan-comment-wire";
import {
  PLAN_COMMENT_CALL_FAILURE,
  type TasksCommentActParams,
  type TasksCommentAnswer,
  type TasksCommentStartParams,
  type TasksCommentsAnswer,
  type TasksCommentsParams,
} from "@luke/features/tasks-view";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * plan-comments.ts -- the open plan's comment threads as one control: read on the service's held long-poll while the plan is shown, and each write on its way back.
 *
 * The service holds a read open while nothing changed past the cursor and
 * lets it go at its own hold, so the loop is one read after another with no
 * clock of its own, as the plan's inbox is read (the desktop's `use-plan-inbox.ts`); each
 * answer is every thread of the plan, which replaces what was held, so a
 * teammate's comment or an agent's reply lands in every open window. A read
 * that did not answer ends the loop and says so, with Try again.
 *
 * A thread is started, and each comment posted, under a key the caller
 * keeps for as long as its words stand, so a write sent again after a lost
 * answer is taken once; the service
 * answers with the thread as it then stands, which replaces the one held, or
 * that it was deleted. A write that did not land is said on its thread, its
 * draft kept by the caller. Posting a comment asks no agent anything.
 */

/** What a write to a thread did not do, said on the thread. */
const COMMENT_NOTE = {
  NOT_POSTED: "The comment could not be posted.",
  NOT_CHANGED: "The comment could not be changed.",
  TOO_MANY: "This thread holds as many comments as it can.",
  NO_WORDS: "The words this comment was on are no longer in the plan.",
  NOT_YOURS: "Only its writer can change this comment.",
  GONE: "This comment is no longer in the thread.",
  NO_AGENT: "That agent is no longer on this task.",
  AGENT_AWAY: "That agent isn't running, so it couldn't take the thread.",
  LUKE_AWAY: "Luke couldn't take the thread. Try again in a moment.",
  NOT_SENT: "The thread could not be sent.",
} as const;

/** How one read is asked: the plan and the cursor to read past. */
export type CommentsReader = (params: TasksCommentsParams) => Promise<TasksCommentsAnswer>;

/** How a thread is started. */
export type CommentStarter = (params: TasksCommentStartParams) => Promise<TasksCommentAnswer>;

/** How one thing is done to one thread. */
export type CommentActor = (params: TasksCommentActParams) => Promise<TasksCommentAnswer>;

/** What starting a thread came to: the thread as the service holds it, or why there is none. */
type CommentStarted = { readonly thread: PlanCommentThread } | { readonly note: string };

/** What the margin, the Comments tab, and the summary draw and press. */
export interface PlanCommentsControl {
  readonly planId: string;
  /** Every thread of the plan, oldest first, resolved ones among them. */
  readonly threads: readonly PlanCommentThread[];
  /** Whether a read has answered, so the threads are what the plan holds rather than nothing yet. */
  readonly read: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
  /** Why the last write to a thread did not land, by thread, said on it until the next write. */
  readonly notes: ReadonlyMap<string, string>;
  /** Starts a thread with its first comment, anchored to words of the text it names, under the caller's key, which stays the same while a send is tried again. */
  readonly start: (start: PlanCommentStartRequest) => Promise<CommentStarted>;
  /** Does one thing to one thread; answers whether it landed. */
  readonly act: (threadId: string, action: PlanCommentActionRequest) => Promise<boolean>;
}

/** Whether a thread still stands in the margin. */
export function openThread(thread: PlanCommentThread): boolean {
  return thread.status === PLAN_COMMENT_STATUS.OPEN;
}

/** What a comment's answer says of the ones its mentions asked who could not take the thread, Luke first; nothing where every one did. */
function unsentWords(answer: TasksCommentAnswer): string | undefined {
  const unsent = "thread" in answer ? (answer.unsent ?? []) : [];
  if (unsent.length === 0) return undefined;
  return unsent.some((asked) => asked.actor === PLAN_COMMENT_ACTOR.LUKE)
    ? COMMENT_NOTE.LUKE_AWAY
    : COMMENT_NOTE.AGENT_AWAY;
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
    case PLAN_COMMENT_REFUSAL.NO_AGENT:
      return COMMENT_NOTE.NO_AGENT;
    case PLAN_COMMENT_REFUSAL.AGENT_AWAY:
      return COMMENT_NOTE.AGENT_AWAY;
  }
}

/** The threads with one put in place of the one it was, or after them where it is new. */
function withThread(
  threads: readonly PlanCommentThread[],
  thread: PlanCommentThread,
): readonly PlanCommentThread[] {
  return threads.some((each) => each.id === thread.id)
    ? threads.map((each) => (each.id === thread.id ? thread : each))
    : [...threads, thread];
}

const UNANSWERED = { failure: PLAN_COMMENT_CALL_FAILURE.UNANSWERED } as const;

interface Held {
  readonly planId: string | undefined;
  readonly threads: readonly PlanCommentThread[];
  readonly read: boolean;
  readonly failed: boolean;
}

function fresh(planId: string | undefined): Held {
  return { planId, threads: [], read: false, failed: false };
}

/**
 * The plan's comments, read while `shown`: the threads, and the doors that
 * write them, each answered as the service holds the thread after it.
 */
export function usePlanComments(input: {
  readonly planId: string | undefined;
  readonly shown: boolean;
  readonly readComments: CommentsReader;
  readonly startComment: CommentStarter;
  readonly actOnComment: CommentActor;
}): PlanCommentsControl | undefined {
  const { planId, shown } = input;
  const [held, setHeld] = useState<Held>(() => fresh(planId));
  if (held.planId !== planId) setHeld(fresh(planId));
  const [attempt, setAttempt] = useState(0);
  const [notes, setNotes] = useState<ReadonlyMap<string, string>>(new Map());
  const latest = useRef(input);
  latest.current = input;

  const active = shown && planId !== undefined && !held.failed;
  useEffect(() => {
    if (!active || planId === undefined) return;
    let live = true;
    const loop = async () => {
      let after = PLAN_COMMENTS_CURSOR_START;
      while (live) {
        const answer = await latest.current
          .readComments({ planId, after })
          .catch((): TasksCommentsAnswer => UNANSWERED);
        if (!live) return;
        if ("failure" in answer) {
          setHeld((was) => ({ ...was, failed: true }));
          return;
        }
        after = answer.cursor;
        setHeld((was) => ({ ...was, threads: answer.threads, read: true }));
      }
    };
    void loop();
    return () => {
      live = false;
    };
  }, [active, planId, attempt]);

  const onRetry = useCallback(() => {
    setHeld((was) => ({ ...was, failed: false }));
    setAttempt((count) => count + 1);
  }, []);

  const note = useCallback((threadId: string, words: string | undefined) => {
    setNotes((was) => {
      const next = new Map(was);
      if (words === undefined) next.delete(threadId);
      else next.set(threadId, words);
      return next;
    });
  }, []);

  /** An answer taken in, on the plan it was asked on only, since the window may have moved to another. */
  const took = useCallback(
    (askedOn: string, answer: TasksCommentAnswer): PlanCommentThread | undefined => {
      if ("thread" in answer) {
        const { thread } = answer;
        setHeld((was) =>
          was.planId === askedOn ? { ...was, threads: withThread(was.threads, thread) } : was,
        );
        return thread;
      }
      if ("deleted" in answer) {
        const { deleted } = answer;
        setHeld((was) =>
          was.planId === askedOn
            ? { ...was, threads: was.threads.filter((each) => each.id !== deleted) }
            : was,
        );
      }
      return undefined;
    },
    [],
  );

  const start = useCallback(
    async (begun: PlanCommentStartRequest): Promise<CommentStarted> => {
      if (planId === undefined) return { note: COMMENT_NOTE.NOT_POSTED };
      const answer = await latest.current
        .startComment({ planId, start: begun })
        .catch((): TasksCommentAnswer => UNANSWERED);
      if ("refused" in answer) return { note: refusalWords(answer.refused) };
      const thread = took(planId, answer);
      if (thread === undefined) return { note: COMMENT_NOTE.NOT_POSTED };
      note(thread.id, unsentWords(answer));
      return { thread };
    },
    [planId, took, note],
  );

  const act = useCallback(
    async (threadId: string, action: PlanCommentActionRequest): Promise<boolean> => {
      if (planId === undefined) return false;
      note(threadId, undefined);
      const answer = await latest.current
        .actOnComment({ planId, threadId, action })
        .catch((): TasksCommentAnswer => UNANSWERED);
      if ("refused" in answer) {
        note(threadId, refusalWords(answer.refused));
        return false;
      }
      if ("failure" in answer) {
        note(
          threadId,
          "words" in action
            ? COMMENT_NOTE.NOT_POSTED
            : action.action === PLAN_COMMENT_ACTION.ASK
              ? COMMENT_NOTE.NOT_SENT
              : COMMENT_NOTE.NOT_CHANGED,
        );
        return false;
      }
      took(planId, answer);
      note(threadId, unsentWords(answer));
      return true;
    },
    [planId, note, took],
  );

  return useMemo(
    () =>
      planId === undefined
        ? undefined
        : {
            planId,
            threads: held.threads,
            read: held.read,
            failed: held.failed,
            onRetry,
            notes,
            start,
            act,
          },
    [planId, held, onRetry, notes, start, act],
  );
}

const PlanCommentsContext = createContext<PlanCommentsControl | undefined>(undefined);

/** The open plan's comments, for the margin, the Comments tab, and the summary under it. */
export const PlanCommentsProvider = PlanCommentsContext.Provider;

/** The open plan's comments; none outside a plan's page. */
export function usePlanCommentsControl(): PlanCommentsControl | undefined {
  return useContext(PlanCommentsContext);
}

/** A stretch of a section's words a thread is anchored to, in the section's own offsets. */
export interface CommentSpan {
  readonly from: number;
  readonly to: number;
  readonly thread: string;
  readonly active: boolean;
  /** Whether the thread is on the whole block, drawn by its edge rather than over its words. */
  readonly block: boolean;
}

/** A thread not yet posted: where its words stand in the plan's text, and whether it is on a whole block. */
export interface PendingThread {
  readonly from: number;
  readonly to: number;
  readonly scope: PlanCommentThread["scope"];
  readonly quote: string;
  /** The text `from` and `to` are offsets in, where it is not the plan's as saved: the open editor's, for words started on there. */
  readonly text?: string;
}

/** The id the thread being started is drawn under until the service names it. */
export const PENDING_THREAD = "pending";

/** The last laying of a thread being started's text over the plan's, kept since every section asks it of the same two texts. */
let laid:
  | { readonly from: string; readonly to: string; readonly change: ReturnType<typeof textChange> }
  | undefined;

/**
 * A thread being started, where it stands in the plan's text as saved: one
 * begun on the editor's words is measured in the editor's text, laid over
 * the saved text so its mark stands on the same words; nothing where none of
 * them is saved yet.
 */
function pendingIn(
  pending: PendingThread,
  planText: string | undefined,
): PendingThread | undefined {
  if (pending.text === undefined || planText === undefined || pending.text === planText) {
    return pending;
  }
  if (laid?.from !== pending.text || laid.to !== planText) {
    laid = { from: pending.text, to: planText, change: textChange(pending.text, planText) };
  }
  const span = laid.change(pending);
  return span === undefined ? undefined : { ...pending, ...span };
}

/**
 * The open threads' words inside one section of the plan's text, `from` to
 * `to`, in the section's own offsets, and the thread being started's among
 * them: what the read view marks.
 */
export function commentSpansIn(
  threads: readonly PlanCommentThread[],
  section: { readonly from: number; readonly to: number },
  active: string | undefined,
  pending: PendingThread | undefined,
  planText?: string,
): readonly CommentSpan[] {
  const begun = pending === undefined ? undefined : pendingIn(pending, planText);
  const anchored = threads.flatMap((thread) =>
    thread.anchor !== undefined && openThread(thread)
      ? [{ ...thread.anchor, thread: thread.id, block: thread.scope === PLAN_COMMENT_SCOPE.BLOCK }]
      : [],
  );
  const all =
    begun === undefined
      ? anchored
      : [
          ...anchored,
          {
            from: begun.from,
            to: begun.to,
            thread: PENDING_THREAD,
            block: begun.scope === PLAN_COMMENT_SCOPE.BLOCK,
          },
        ];
  return all.flatMap((span) => {
    const from = Math.max(span.from, section.from);
    const to = Math.min(span.to, section.to);
    if (from >= to) return [];
    return [
      {
        from: from - section.from,
        to: to - section.from,
        thread: span.thread,
        active: span.thread === active,
        block: span.block,
      },
    ];
  });
}

/** One card the margin stands beside the words: its thread, where its words stand, and how tall it is drawn. */
export interface MarginCard {
  readonly id: string;
  readonly top: number;
  readonly height: number;
}

/**
 * Where each card of the margin stands: level with its words, the open one
 * exactly so, and the others stepped aside by `gap` so no two overlap, as a
 * document's margin comments do. Answers each card's top by its thread.
 */
export function marginTops(
  cards: readonly MarginCard[],
  active: string | undefined,
  gap: number,
): ReadonlyMap<string, number> {
  const sorted = [...cards].sort((a, b) => a.top - b.top);
  const tops = sorted.map((card) => card.top);
  const at = sorted.findIndex((card) => card.id === active);
  if (at >= 0) {
    for (let index = at + 1; index < sorted.length; index += 1) {
      const above = sorted[index - 1];
      const own = tops[index];
      const aboveTop = tops[index - 1];
      if (above !== undefined && own !== undefined && aboveTop !== undefined) {
        tops[index] = Math.max(own, aboveTop + above.height + gap);
      }
    }
    for (let index = at - 1; index >= 0; index -= 1) {
      const card = sorted[index];
      const own = tops[index];
      const belowTop = tops[index + 1];
      if (card !== undefined && own !== undefined && belowTop !== undefined) {
        tops[index] = Math.min(own, belowTop - card.height - gap);
      }
    }
  } else {
    for (let index = 1; index < sorted.length; index += 1) {
      const above = sorted[index - 1];
      const own = tops[index];
      const aboveTop = tops[index - 1];
      if (above !== undefined && own !== undefined && aboveTop !== undefined) {
        tops[index] = Math.max(own, aboveTop + above.height + gap);
      }
    }
  }
  return new Map(sorted.map((card, index) => [card.id, tops[index] ?? card.top]));
}
