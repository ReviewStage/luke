import type { AgentQueue, QueuedMessage } from "@luke/features/agent-queue-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentQueueAnswerView,
} from "@luke/features/coding-agent-view";
import {
  type AgentQueueChange,
  type CodingAgentAttachment,
  hasWordsOrFiles,
  QUEUE_CHANGE,
} from "@luke/features/coding-agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import type { AgentComposerControl } from "./use-agent-composer.js";

/**
 * use-agent-queue.ts -- an agent's queue as its tab draws and changes it: the messages queued behind its turn, in the order they go, and the one door every change goes through.
 *
 * The queue is read live with the transcript, whose every page carries it
 * (`use-agent-transcript.ts`); nothing here polls. A change shows before
 * that page: a message queued is drawn at the queue's end as it goes, a new
 * order at once, so a dropped row never springs back to where it stood,
 * and the queue a change answered stands until the next page lands. Every change is one act
 * (`codingAgents.queue`), and each is the same however often it is sent: a
 * queued message names its own key, and every other change names the
 * message it changes, so a retried press never doubles.
 */

/** What a refused delete says in its dialog. */
const DELETE_REFUSED = "Luke could not delete the message. Try again.";

/** What a change answered where the act itself failed. */
const UNANSWERED: CodingAgentQueueAnswerView = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };

/** An agent's queue as its tab holds it. */
export interface AgentQueueControl {
  /** Its messages in the order they go, a new order drawn before the page that carries it. */
  readonly messages: readonly QueuedMessage[];
  readonly paused: AgentQueue["paused"];
  /** One change, answered as the service answered it. */
  readonly change: (change: AgentQueueChange) => Promise<CodingAgentQueueAnswerView>;
  /** The message at `from` put at `to`, as a drag drops it. */
  readonly move: (from: number, to: number) => void;
  /** One message deleted, answered as a confirm reads it. */
  readonly remove: (message: QueuedMessage) => Promise<ActionResult>;
}

export function useAgentQueue(agentId: string, queue: AgentQueue | undefined): AgentQueueControl {
  const { act } = useAct();
  const [answered, setAnswered] = useState<{
    readonly over: AgentQueue | undefined;
    readonly queue: AgentQueue;
  }>();
  const [going, setGoing] = useState<readonly QueuedMessage[]>([]);
  const [moved, setMoved] = useState<{
    readonly over: AgentQueue | undefined;
    readonly order: readonly string[];
  }>();
  const page = useRef(queue);
  page.current = queue;
  // Note that what a change answered stands only over the page it was answered on, so the next page lets it go.
  const shown = answered !== undefined && answered.over === queue ? answered.queue : queue;
  const held = [...(shown?.messages ?? []), ...going];
  const order = moved !== undefined && moved.over === shown ? moved.order : undefined;
  const messages =
    order === undefined ? held : order.flatMap((id) => held.filter((message) => message.id === id));
  const change = (next: AgentQueueChange) => {
    // A message queued is drawn at the queue's end, under its own key, until the queue answers with it.
    const queued =
      next.change === QUEUE_CHANGE.ADD
        ? { id: next.clientKey, text: next.text, queuedBy: "" }
        : undefined;
    if (queued !== undefined) setGoing((was) => [...was, queued]);
    return act(ACT_KIND.CODING_AGENTS_QUEUE, { agentId, change: next })
      .catch(() => UNANSWERED)
      .then((answer) => {
        if ("queue" in answer) setAnswered({ over: page.current, queue: answer.queue });
        if (queued !== undefined) setGoing((was) => was.filter((message) => message !== queued));
        return answer;
      });
  };
  const move = (from: number, to: number) => {
    const ids = messages.map((message) => message.id);
    const [taken] = ids.splice(from, 1);
    if (taken === undefined) return;
    ids.splice(to, 0, taken);
    setMoved({ over: shown, order: ids });
    void change({ change: QUEUE_CHANGE.REORDER, order: ids });
  };
  const remove = (message: QueuedMessage) =>
    change({ change: QUEUE_CHANGE.DELETE, messageId: message.id }).then(
      (answer): ActionResult =>
        "failure" in answer
          ? { status: ACTION_RESULT_STATUS.REJECTED, reason: DELETE_REFUSED }
          : { status: ACTION_RESULT_STATUS.ACCEPTED },
    );
  return { messages, paused: shown?.paused, change, move, remove };
}

/** The box's words and files kept aside while it holds a queued message's words being edited. */
interface Stashed {
  readonly id: string;
  readonly text: string;
  readonly attachments: readonly CodingAgentAttachment[];
}

/** How an agent's box queues its message and edits one queued already, as the composer's `queueing` takes it. */
export interface QueueEditing {
  /** The message the box is editing, by its id; none while none is. */
  readonly editing: string | undefined;
  /** The box's message queued behind the turn, the box emptied for the next. */
  readonly queue: () => void;
  /** The message's words taken into the box to edit, the box's own kept aside, and the message held out of the hand-off. */
  readonly edit: (message: QueuedMessage) => void;
  /** The box's words saved back into the message's place, and the box given back what it held. */
  readonly save: () => void;
  /** The edit given up, the message left as it was, and the box given back what it held. */
  readonly cancel: () => void;
}

/**
 * The box's part in the queue. An edit moves the queued message's words into
 * the box, keeping what the box held aside, and holds the message out of the
 * hand-off, which passes over it meanwhile; Save writes the words back in its
 * place once the queue took them, and Cancel, Escape, Save with the box
 * emptied, or the tab closing lets it go as it was. Its files stay with it,
 * as the queue lists only their names.
 */
export function useQueueEditing(
  composer: AgentComposerControl,
  queue: AgentQueueControl,
): QueueEditing {
  const [stashed, setStashed] = useState<Stashed | undefined>();
  const held = useRef<string | undefined>(undefined);
  held.current = stashed?.id;
  // The box's words as they stand now, which an answer that lands later reads rather than those of the draw that asked.
  const draft = useRef(composer.draft);
  draft.current = composer.draft;
  const { change } = queue;
  const latestChange = useRef(change);
  latestChange.current = change;
  // An edit open as the tab closes is let go, so the message goes on as it was.
  useEffect(
    () => () => {
      const id = held.current;
      if (id !== undefined)
        void latestChange.current({ change: QUEUE_CHANGE.HOLD, messageId: id, held: false });
    },
    [],
  );
  const giveBack = (stash: Stashed) => {
    composer.setDraft(stash.text);
    composer.setAttachments(() => stash.attachments);
    setStashed(undefined);
  };
  const cancel = () => {
    if (stashed === undefined) return;
    void change({ change: QUEUE_CHANGE.HOLD, messageId: stashed.id, held: false });
    giveBack(stashed);
  };
  return {
    editing: stashed?.id,
    queue: () => {
      const text = composer.draft.trim();
      const { attachments } = composer;
      if (!hasWordsOrFiles(text, attachments)) return;
      const clientKey = crypto.randomUUID();
      composer.setDraft("");
      composer.setAttachments(() => []);
      void change({
        change: QUEUE_CHANGE.ADD,
        text,
        clientKey,
        ...(attachments.length === 0 ? undefined : { attachments }),
      }).then((answer) => {
        // A message the queue did not take comes back into the box, where the box holds nothing newer.
        if ("failure" in answer && draft.current === "") {
          composer.setDraft(text);
          composer.setAttachments(() => attachments);
        }
      });
    },
    edit: (message) => {
      if (stashed !== undefined)
        void change({ change: QUEUE_CHANGE.HOLD, messageId: stashed.id, held: false });
      const kept = stashed ?? {
        id: message.id,
        text: composer.draft,
        attachments: composer.attachments,
      };
      const stash = { ...kept, id: message.id };
      setStashed(stash);
      composer.setDraft(message.text);
      composer.setAttachments(() => []);
      // A message the queue would not hold, already on its way, is no longer the box's to edit.
      void change({ change: QUEUE_CHANGE.HOLD, messageId: message.id, held: true }).then(
        (answer) => {
          if ("failure" in answer && held.current === message.id) giveBack(stash);
        },
      );
    },
    save: () => {
      if (stashed === undefined) return;
      const text = composer.draft.trim();
      if (text === "") return cancel();
      // Note that the edit stays open until the queue took the words, so a refused save loses none of them.
      void change({ change: QUEUE_CHANGE.EDIT, messageId: stashed.id, text }).then((answer) => {
        if (!("failure" in answer) && held.current === stashed.id) giveBack(stashed);
      });
    },
    cancel,
  };
}
