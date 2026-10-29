import { useAtomValue } from "@effect/atom-react";
import type { AgentQueue, QueuedMessage } from "@luke/features/agent-queue-wire";
import { LINE_GRACE_MILLIS } from "@luke/features/agent-status";
import { AGENT_CALL_FAILURE, type AgentQueueAnswerView } from "@luke/features/agent-view";
import {
  type AgentAttachment,
  type AgentQueueChange,
  hasWordsOrFiles,
  QUEUE_CHANGE,
} from "@luke/features/agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { Clock, Duration, Option, Schedule, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import { rendererRuntime } from "../renderer-runtime.js";
import type { HeldComposer } from "./use-agent-composer.js";

/**
 * use-agent-queue.ts -- an agent's queue as its tab draws and changes it: the messages queued behind its turn, in the order they go, and the one door every change goes through.
 *
 * What the tab draws is the service's queue, read live with the newest
 * transcript page (`use-agent-transcript.ts`), or the queue a change's
 * answer named where that stands at a higher revision; every change to the
 * queue moves its revision on, which wakes the page. Nothing here polls. A
 * message queued, as the box empties at once, and a new order, as a drag
 * drops it, are drawn before their answer, keyed to their own request and
 * let go as it answers; every other change waits its round trip. A message
 * queued is drawn at the queue's end as it goes, taking no press until it
 * has landed, since the service knows it by no id before.
 */

/** What a change answered where the act itself failed. */
const UNANSWERED: AgentQueueAnswerView = { failure: AGENT_CALL_FAILURE.UNANSWERED };

/** What a refused delete says in its dialog. */
const DELETE_REFUSED = "Luke could not delete the message. Try again.";

/** How often an open edit's hold is sent again: within the grace it lapses after (`LINE_GRACE_MILLIS`). */
const HOLD_RENEWAL = Duration.millis(LINE_GRACE_MILLIS / 2);

/** The renderer clock read each `HOLD_RENEWAL`, which an open edit renews its hold on. */
const holdRenewalAtom = rendererRuntime.atom(
  // Note that its first reading, as the edit opens, is dropped, since the edit's own hold has just gone.
  Stream.fromEffectSchedule(Clock.currentTimeMillis, Schedule.spaced(HOLD_RENEWAL)).pipe(
    Stream.drop(1),
  ),
);

/** No reading, while no edit stands open. */
const NO_RENEWAL = Atom.make(AsyncResult.initial<number>());

/** A queue with nothing in it, as an agent's page before its first change carries none. */
const EMPTY: AgentQueue = { messages: [], revision: 0 };

/** One change the tab drew at once, still out: its own id, and the change. */
interface Out {
  readonly id: number;
  readonly change: DrawnAtOnce;
}

/** A change the tab draws before the service answers it: a message queued, as the box empties at once, and a new order, as a drag drops it. */
type DrawnAtOnce = Extract<
  AgentQueueChange,
  { readonly change: typeof QUEUE_CHANGE.ADD | typeof QUEUE_CHANGE.REORDER }
>;

/** Whether a change is drawn before the service answers it; every other waits on its answer. */
function drawnAtOnce(change: AgentQueueChange): change is DrawnAtOnce {
  return change.change === QUEUE_CHANGE.ADD || change.change === QUEUE_CHANGE.REORDER;
}

/** The queue as a change still out would leave it. */
function drawnWith(queue: AgentQueue, change: DrawnAtOnce): AgentQueue {
  if (change.change === QUEUE_CHANGE.REORDER) {
    const at = new Map(change.order.map((id, index) => [id, index]));
    const placed = (message: QueuedMessage) => at.get(message.id) ?? change.order.length;
    return { ...queue, messages: queue.messages.toSorted((a, b) => placed(a) - placed(b)) };
  }
  // A message the queue lists under its key has landed, and is drawn as the queue draws it.
  if (queue.messages.some((message) => message.clientKey === change.clientKey)) return queue;
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
}

/** An agent's queue as its tab holds it. */
export interface AgentQueueControl {
  /** Its messages in the order they go, the tab's own changes still out drawn over the page. */
  readonly messages: readonly QueuedMessage[];
  /** The messages queued from this tab that have not landed yet, by the id they are drawn under, which take no press. */
  readonly landing: ReadonlySet<string>;
  /** The messages the service's queue lists now, by id, whatever this tab's changes still out draw over them. */
  readonly listed: ReadonlySet<string>;
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
  const [answered, setAnswered] = useState<AgentQueue | undefined>();
  const counter = useRef(0);
  const page = queue ?? EMPTY;
  // The queue as the service last said it, by whichever of the page and a change's answer stands at the higher revision.
  const standing = answered !== undefined && answered.revision > page.revision ? answered : page;
  const drawn = out.reduce((held, each) => drawnWith(held, each.change), standing);
  const landing = new Set(
    out.flatMap(({ change: each }) =>
      each.change === QUEUE_CHANGE.ADD &&
      !standing.messages.some((message) => message.clientKey === each.clientKey)
        ? [each.clientKey]
        : [],
    ),
  );

  const listed = new Set(page.messages.map((message) => message.id));
  const change = (next: AgentQueueChange, after?: Promise<unknown>) => {
    counter.current += 1;
    const id = counter.current;
    if (drawnAtOnce(next)) setOut((was) => [...was, { id, change: next }]);
    return (after ?? Promise.resolve())
      .then(() => act(ACT_KIND.AGENTS_QUEUE, { agentId, change: next }))
      .catch(() => UNANSWERED)
      .then((answer) => {
        // Note that a change answered is drawn as the queue its answer names, and one refused springs back.
        setOut((was) => was.filter((each) => each.id !== id));
        if ("queue" in answer) {
          setAnswered((was) =>
            was === undefined || answer.queue.revision > was.revision ? answer.queue : was,
          );
        }
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
  return { messages: drawn.messages, landing, listed, paused: drawn.paused, change, move, remove };
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
  queue: Pick<AgentQueueControl, "change" | "listed">,
): QueueEditing {
  const [stashed, setStashed] = useState<Stashed | undefined>();
  const held = useRef<string | undefined>(undefined);
  held.current = stashed?.id;
  // Whether the service's queue has listed the message since its edit opened, which its leaving the queue is read against.
  const seen = useRef(false);
  const listed = stashed !== undefined && queue.listed.has(stashed.id);
  if (listed) seen.current = true;
  if (stashed === undefined) seen.current = false;
  // A message that left the queue while its edit stood open, sent or deleted elsewhere, is no longer the box's to
  // edit: the edit closes, its words left in the box.
  const left = stashed !== undefined && seen.current && !listed;
  useEffect(() => {
    if (left) setStashed(undefined);
  }, [left]);
  // The hold renewed while the edit stands open, before it lapses, so the hand-off never sends the words it replaces.
  const renewal = Option.getOrUndefined(
    AsyncResult.value(useAtomValue(stashed === undefined ? NO_RENEWAL : holdRenewalAtom)),
  );
  // The box's words as they stand now, which an answer that lands later reads rather than those of the draw that asked.
  const draft = useRef(composer.draft);
  draft.current = composer.draft;
  // The words a refused queue gave back, and the key they went under, which queueing them again reuses.
  const refused = useRef<{ readonly text: string; readonly clientKey: string } | undefined>(
    undefined,
  );
  // The message whose edit is being saved or steered, by id, which its hold is no longer renewed for.
  const settling = useRef<string | undefined>(undefined);
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
  useEffect(() => {
    const id = held.current;
    // Note that an edit being saved or steered renews nothing, so a renewal that lands after it holds no message.
    if (renewal === undefined || id === undefined || settling.current === id) return;
    void latestChange.current({ change: QUEUE_CHANGE.HOLD, messageId: id, held: true });
  }, [renewal]);
  const giveBack = (stash: Stashed) => {
    composer.setDraft(stash.text);
    composer.setAttachments(() => stash.attachments);
    setStashed(undefined);
  };
  /** The edit closed once the queue took `edit`, where it is still this message's; left open, its hold renewed again, where it was refused. */
  const closing = (stash: Stashed, edit: AgentQueueChange) => {
    settling.current = stash.id;
    void change(edit).then((answer) => {
      settling.current = undefined;
      if (!("failure" in answer) && held.current === stash.id) giveBack(stash);
    });
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
