import type { AgentQueue, QueuedMessage } from "@luke/features/agent-queue-wire";
import { AGENT_CALL_FAILURE, type AgentQueueAnswerView } from "@luke/features/agent-view";
import {
  type AgentAttachment,
  type AgentQueueChange,
  hasWordsOrFiles,
  QUEUE_CHANGE,
} from "@luke/features/agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import type { HeldComposer } from "./use-agent-composer.js";

/**
 * use-agent-queue.ts -- an agent's queue as its tab draws and changes it: the messages queued behind its turn, in the order they go, and the one door every change goes through.
 *
 * What the tab draws is the service's queue, as the newest transcript page
 * carries it (`use-agent-transcript.ts`), read live: every change to the
 * queue moves its revision on, which wakes the page. Nothing here polls, and
 * nothing is drawn from a second copy of the queue. A change the tab made
 * is drawn over the page while it is out, keyed to its own request: from
 * the press until a page stands at the revision its answer named, or until
 * it fails, so it never outlives its request, an answer that lands after a
 * newer page draws nothing older, and a change refused springs back at
 * once. A message queued is drawn at the queue's end as it goes, taking no
 * press until it has landed, since the service knows it by no id before.
 */

/** What a change answered where the act itself failed. */
const UNANSWERED: AgentQueueAnswerView = { failure: AGENT_CALL_FAILURE.UNANSWERED };

/** What a refused delete says in its dialog. */
const DELETE_REFUSED = "Luke could not delete the message. Try again.";

/** A queue with nothing in it, as an agent's page before its first change carries none. */
const EMPTY: AgentQueue = { messages: [], revision: 0 };

/** One change the tab made, still drawn over the page: its own id, the change, and the revision its answer named once it answered. */
interface Out {
  readonly id: number;
  readonly change: AgentQueueChange;
  readonly revision: number | undefined;
}

/** The queue as one change still out would leave it. */
function drawnWith(queue: AgentQueue, change: AgentQueueChange): AgentQueue {
  switch (change.change) {
    case QUEUE_CHANGE.ADD:
      return {
        ...queue,
        messages: [
          ...queue.messages,
          {
            id: change.clientKey,
            text: change.text,
            queuedBy: "",
            ...(change.attachments === undefined || change.attachments.length === 0
              ? undefined
              : {
                  files: change.attachments.map((file) => ({
                    name: file.name,
                    mediaType: file.mediaType,
                  })),
                }),
          },
        ],
      };
    case QUEUE_CHANGE.DELETE:
    case QUEUE_CHANGE.STEER:
      return {
        ...queue,
        messages: queue.messages.filter((message) => message.id !== change.messageId),
      };
    case QUEUE_CHANGE.EDIT:
      return {
        ...queue,
        messages: queue.messages.map((message) =>
          message.id === change.messageId ? { ...message, text: change.text } : message,
        ),
      };
    case QUEUE_CHANGE.REORDER: {
      const at = new Map(change.order.map((id, index) => [id, index]));
      const placed = (message: QueuedMessage) => at.get(message.id) ?? change.order.length;
      return { ...queue, messages: queue.messages.toSorted((a, b) => placed(a) - placed(b)) };
    }
    case QUEUE_CHANGE.RESUME: {
      const { paused: _paused, ...unpaused } = queue;
      return unpaused;
    }
    case QUEUE_CHANGE.HOLD:
      return queue;
  }
}

/** An agent's queue as its tab holds it. */
export interface AgentQueueControl {
  /** Its messages in the order they go, the tab's own changes still out drawn over the page. */
  readonly messages: readonly QueuedMessage[];
  /** The messages queued from this tab that have not landed yet, by the id they are drawn under, which take no press. */
  readonly landing: ReadonlySet<string>;
  readonly paused: AgentQueue["paused"];
  /** One change, answered as the service answered it, sent once `after` settles where one is given. */
  readonly change: (
    change: AgentQueueChange,
    after?: Promise<unknown>,
  ) => Promise<AgentQueueAnswerView>;
  /** The message at `from` put at `to`, as a drag drops it. */
  readonly move: (from: number, to: number) => void;
  /** One message deleted, answered as a confirm reads it. */
  readonly remove: (message: QueuedMessage) => Promise<ActionResult>;
}

export function useAgentQueue(agentId: string, queue: AgentQueue | undefined): AgentQueueControl {
  const { act } = useAct();
  const [out, setOut] = useState<readonly Out[]>([]);
  const counter = useRef(0);
  const page = queue ?? EMPTY;
  // A change lets go of the page once a page stands at the revision its answer named.
  const standing = out.filter(
    (each) => each.revision === undefined || each.revision > page.revision,
  );
  useEffect(() => {
    if (standing.length === out.length) return;
    setOut((was) =>
      was.filter((each) => each.revision === undefined || each.revision > page.revision),
    );
  }, [standing.length, out.length, page.revision]);
  const drawn = standing.reduce((held, each) => drawnWith(held, each.change), page);
  const landing = new Set(
    standing.flatMap((each) =>
      each.change.change === QUEUE_CHANGE.ADD ? [each.change.clientKey] : [],
    ),
  );
  const change = (next: AgentQueueChange, after?: Promise<unknown>) => {
    counter.current += 1;
    const id = counter.current;
    setOut((was) => [...was, { id, change: next, revision: undefined }]);
    return (after ?? Promise.resolve())
      .then(() => act(ACT_KIND.AGENTS_QUEUE, { agentId, change: next }))
      .catch(() => UNANSWERED)
      .then((answer) => {
        // Note that a change refused is dropped at once, and one answered stands until a page at its revision.
        setOut((was) =>
          "queue" in answer
            ? was.map((each) =>
                each.id === id ? { ...each, revision: answer.queue.revision } : each,
              )
            : was.filter((each) => each.id !== id),
        );
        return answer;
      });
  };
  const move = (from: number, to: number) => {
    // Note that a message still landing has no id the service knows, so no order names it.
    const ids = drawn.messages.map((message) => message.id).filter((id) => !landing.has(id));
    const [taken] = ids.splice(from, 1);
    if (taken === undefined) return;
    ids.splice(to, 0, taken);
    void change({ change: QUEUE_CHANGE.REORDER, order: ids });
  };
  const remove = (message: QueuedMessage) =>
    change({ change: QUEUE_CHANGE.DELETE, messageId: message.id }).then(
      (answer): ActionResult =>
        "failure" in answer
          ? { status: ACTION_RESULT_STATUS.REJECTED, reason: DELETE_REFUSED }
          : { status: ACTION_RESULT_STATUS.ACCEPTED },
    );
  return { messages: drawn.messages, landing, paused: drawn.paused, change, move, remove };
}

/** The box's words and files kept aside while it holds a queued message's words being edited. */
interface Stashed {
  readonly id: string;
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
}

/** How an agent's box queues its message and edits one queued already, as the composer's `queueing` takes it. */
export interface QueueEditing {
  /** The message the box is editing, by its id; none while none is. */
  readonly editing: string | undefined;
  /** The box's message queued behind the turn, after every line the box sent before it, the box emptied for the next. */
  readonly queue: () => void;
  /** The message's words taken into the box to edit, the box's own kept aside, and the message held out of the hand-off. */
  readonly edit: (message: QueuedMessage) => void;
  /** The box's words saved back into the message's place, and the box given back what it held. */
  readonly save: () => void;
  /** The message sent now with the box's words, as one change of that message, and the box given back what it held. */
  readonly steer: () => void;
  /** The edit given up, the message left as it was, and the box given back what it held. */
  readonly cancel: () => void;
}

/**
 * The box's part in the queue. An edit moves the queued message's words into
 * the box, keeping what the box held aside, and holds the message out of the
 * hand-off, which passes over it meanwhile; Save writes the words back in its
 * place, and Steer sends them now as that message, each closing the edit once
 * the queue took it, so a refusal leaves the words where they are. Cancel,
 * Escape, Save with the box emptied, or the tab closing lets it go as it was,
 * and a message the queue would not hold, already on its way, closes the
 * edit. Its files stay with it, as the queue lists only their names. A
 * message the queue did not take comes back into the box under the key it
 * went under, so queueing it again can never queue it twice.
 */
export function useQueueEditing(
  composer: Pick<
    HeldComposer,
    "draft" | "setDraft" | "attachments" | "setAttachments" | "sendsSettled"
  >,
  queue: Pick<AgentQueueControl, "change">,
): QueueEditing {
  const [stashed, setStashed] = useState<Stashed | undefined>();
  const held = useRef<string | undefined>(undefined);
  held.current = stashed?.id;
  // The box's words as they stand now, which an answer that lands later reads rather than those of the draw that asked.
  const draft = useRef(composer.draft);
  draft.current = composer.draft;
  // The words a refused queue gave back, and the key they went under, which queueing them again reuses.
  const refused = useRef<{ readonly text: string; readonly clientKey: string } | undefined>(
    undefined,
  );
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
  /** The edit closed once the queue took `edit`, where it is still this message's; left open where it was refused. */
  const closing = (stash: Stashed, edit: AgentQueueChange) =>
    void change(edit).then((answer) => {
      if (!("failure" in answer) && held.current === stash.id) giveBack(stash);
    });
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
      const again = refused.current;
      const clientKey =
        again !== undefined && again.text === text ? again.clientKey : crypto.randomUUID();
      refused.current = undefined;
      composer.setDraft("");
      composer.setAttachments(() => []);
      void change(
        {
          change: QUEUE_CHANGE.ADD,
          text,
          clientKey,
          ...(attachments.length === 0 ? undefined : { attachments }),
        },
        composer.sendsSettled(),
      ).then((answer) => {
        // A message the queue did not take comes back into the box, where the box holds nothing newer.
        if ("failure" in answer && draft.current === "") {
          refused.current = { text, clientKey };
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
      closing(stashed, { change: QUEUE_CHANGE.EDIT, messageId: stashed.id, text });
    },
    steer: () => {
      if (stashed === undefined) return;
      const text = composer.draft.trim();
      if (text === "") return cancel();
      closing(stashed, { change: QUEUE_CHANGE.STEER, messageId: stashed.id, text });
    },
    cancel,
  };
}
