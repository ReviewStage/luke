import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentInboxAnsweredView,
  type CodingAgentInboxAnswerParams,
  type CodingAgentInboxAnswerView,
  type CodingAgentInboxParams,
} from "@sidecar/hosted/coding-agent-view";
import {
  INBOX_CURSOR_START,
  type InboxItem,
  type InboxReplyKind,
} from "@sidecar/hosted/inbox-wire";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { messageFailureNote } from "./coding-agent-model";
import { type InboxBoardView, type InboxDraft, inboxBoard, inboxReply } from "./inbox-model";

/**
 * use-plan-inbox.ts -- the open plan's inbox as one control: its items, read on the service's held long-poll while the window shows the plans, and the answers on their way back.
 *
 * The service holds a read open while nothing changed past the cursor and
 * lets it go at its own hold, so the loop is one read after another with no
 * clock of its own, as an agent's transcript is read (`use-agent-transcript.ts`);
 * each answer is the inbox whole, which replaces what was held. The loop
 * runs while the window shows the plans and a plan is open, so the tab's
 * count stands whichever tab is chosen, and another plan starts from
 * nothing of this one's. A read that did not answer ends the loop and says
 * so, with Try again, rather than asking again at once.
 *
 * An answer goes under a key minted here and kept with its words, so the
 * same answer sent again after a lost reply is taken once; the service
 * answers with the item as it then stands, which replaces the one held. An
 * answer to an item its agent changed first is not taken, and the card says
 * so above the item as it now stands. An answer the agent was to hear
 * reached it as one of the developer's messages, which may have started
 * its turn again, so the plan's agents are read again for where they stand.
 */

/** How one read is asked: the plan and the cursor to read past, answered as the view hears it. */
export type InboxReader = (params: CodingAgentInboxParams) => Promise<CodingAgentInboxAnswerView>;

/** How one answer is sent: the item, its revision, the answer, and the key the send is known by. */
export type InboxAnswerer = (
  params: CodingAgentInboxAnswerParams,
) => Promise<CodingAgentInboxAnsweredView>;

/** What the tab draws and presses. */
export interface PlanInboxControl {
  readonly board: InboxBoardView;
  /** Whether a read is out, with nothing held yet to draw. */
  readonly reading: boolean;
  /** Whether the last read did not answer, so the tab offers to try again. */
  readonly failed: boolean;
  readonly onRetry: () => void;
  /** The items whose answer is on its way, by id. */
  readonly sending: ReadonlySet<string>;
  /** Why an answer did not go, or was not taken, by item, said on its card until the next send. */
  readonly notes: ReadonlyMap<string, string>;
  /** Sends the card's answer, with the press where its kind is answered by one; nothing where it holds none or one is out. */
  readonly onAnswer: (item: InboxItem, draft: InboxDraft, press?: InboxReplyKind) => void;
}

/** What the card says when the agent changed the item before the answer landed. */
export const INBOX_CHANGED_NOTE =
  "The agent changed this item before your answer landed. Answer it as it stands now.";

/** An answer's key and words, kept so the same answer sent again goes under the same key. */
interface Attempt {
  readonly key: string;
  readonly words: string;
}

interface Held {
  readonly planId: string | undefined;
  readonly items: readonly InboxItem[];
  readonly read: boolean;
  readonly failed: boolean;
}

function fresh(planId: string | undefined): Held {
  return { planId, items: [], read: false, failed: false };
}

const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** The items with one replaced by the service's newer word on it. */
function withItem(items: readonly InboxItem[], item: InboxItem): readonly InboxItem[] {
  return items.some((each) => each.id === item.id)
    ? items.map((each) => (each.id === item.id ? item : each))
    : [item, ...items];
}

export function usePlanInbox(input: {
  planId: string | undefined;
  /** Whether the window shows the plans. */
  shown: boolean;
  agents: {
    readonly agentIds: readonly string[] | undefined;
    readonly readInbox: InboxReader;
    readonly answerInbox: InboxAnswerer;
    /** Reads the plan's agents again, for where an agent an answer reached stands now. */
    readonly onRetryList: () => void;
  };
}): PlanInboxControl {
  const { planId, shown, agents } = input;
  const [held, setHeld] = useState<Held>(() => fresh(planId));
  if (held.planId !== planId) setHeld(fresh(planId));
  const [attempt, setAttempt] = useState(0);
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
  const [notes, setNotes] = useState<ReadonlyMap<string, string>>(new Map());
  const attempts = useRef(new Map<string, Attempt>());
  const latest = useRef(agents);
  latest.current = agents;

  const active = shown && planId !== undefined && !held.failed;
  useEffect(() => {
    if (!active || planId === undefined) return;
    let live = true;
    const loop = async () => {
      let after = INBOX_CURSOR_START;
      while (live) {
        const answer = await latest.current
          .readInbox({ planId, after })
          .catch((): CodingAgentInboxAnswerView => UNANSWERED);
        if (!live) return;
        if ("failure" in answer) {
          setHeld((was) => ({ ...was, failed: true }));
          return;
        }
        after = answer.cursor;
        setHeld((was) => ({ ...was, items: answer.items, read: true }));
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

  const note = useCallback((itemId: string, words: string | undefined) => {
    setNotes((was) => {
      const next = new Map(was);
      if (words === undefined) next.delete(itemId);
      else next.set(itemId, words);
      return next;
    });
  }, []);

  const onAnswer = useCallback(
    (item: InboxItem, draft: InboxDraft, press?: InboxReplyKind) => {
      const reply = inboxReply(item, draft, press);
      if (reply === undefined || sending.has(item.id)) return;
      const words = JSON.stringify([item.revision, reply]);
      const was = attempts.current.get(item.id);
      const key = was?.words === words ? was.key : crypto.randomUUID();
      attempts.current.set(item.id, { key, words });
      setSending((standing) => new Set(standing).add(item.id));
      note(item.id, undefined);
      latest.current
        .answerInbox({ itemId: item.id, revision: item.revision, ...reply, clientKey: key })
        .catch((): CodingAgentInboxAnsweredView => UNANSWERED)
        .then((answer) => {
          setSending((standing) => {
            const next = new Set(standing);
            next.delete(item.id);
            return next;
          });
          if ("failure" in answer) {
            note(item.id, messageFailureNote(answer.failure));
            return;
          }
          setHeld((standing) => ({ ...standing, items: withItem(standing.items, answer.item) }));
          if (!answer.taken) {
            note(item.id, INBOX_CHANGED_NOTE);
            return;
          }
          if (item.needsReply) latest.current.onRetryList();
        });
    },
    [sending, note],
  );

  const ids = agents.agentIds;
  const board = useMemo(() => inboxBoard(held.items, ids ?? []), [held.items, ids]);
  return {
    board,
    reading: active && !held.read,
    failed: held.failed,
    onRetry,
    sending,
    notes,
    onAnswer,
  };
}
