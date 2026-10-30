import type { AgentQueue, QueuedMessage } from "@luke/features/agent-queue-wire";
import { AGENT_CALL_FAILURE, type AgentQueueAnswerView } from "@luke/features/agent-view";
import {
  type AgentAttachment,
  type AgentQueueChange,
  agentAttachmentsSchema,
  hasWordsOrFiles,
  QUEUE_CHANGE,
} from "@luke/features/agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import { keepPictureRead, PICTURE_STATE, pictureNow } from "@luke/ui/picture-cache";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { Option, Schema } from "effect";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import type { AgentPictureDoor } from "./agent-pictures.js";
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
 * is queued under an id the tab mints (`crypto.randomUUID`), so it is drawn
 * at the queue's end as it goes, under the id it keeps, and takes presses at
 * once: every change goes after every change asked before it, as a drag's
 * section writes do (the host's `sidebar-collections.ts`), so a press on a
 * message still landing reaches the service after its add. Its files are
 * drawn from the bytes the box held, kept in the window's pictures under ids
 * of the tab's own and, before the row naming them by the service's ids is
 * painted, under those, so its thumbnails never give way to a read of what
 * the window already holds.
 */

/** What a change answered where the act itself failed. */
const UNANSWERED: AgentQueueAnswerView = { failure: AGENT_CALL_FAILURE.UNANSWERED };

/** What a refused delete says in its dialog. */
const DELETE_REFUSED = "Luke could not delete the message. Try again.";

/** A queue with nothing in it, as an agent's page before its first change carries none. */
const EMPTY: AgentQueue = { messages: [], revision: 0 };

/** One change the tab drew at once, still out: its own id, the change, and for a message queued the ids its files are drawn under until it lands. */
interface Out {
  readonly id: number;
  readonly change: DrawnAtOnce;
  readonly files?: readonly string[];
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

/** A file the box held, as the window draws it from its own bytes. */
function fileUrl(file: AgentAttachment): string {
  return `data:${file.mediaType};base64,${file.data}`;
}

/**
 * The files of a message queued from this tab, kept in the agent's pictures
 * under the ids the service's queue names them by, once it names them, so
 * the landed row draws the bytes the box held rather than reading them back.
 */
function keepLandedFiles(owner: string, queue: AgentQueue, out: readonly Out[]): void {
  for (const { change } of out) {
    if (change.change !== QUEUE_CHANGE.ADD || change.attachments === undefined) continue;
    const landed = queue.messages.find((message) => message.id === change.id);
    for (const [index, file] of (landed?.files ?? []).entries()) {
      const held = change.attachments[index];
      if (file.id === undefined || held === undefined) continue;
      if (pictureNow(owner, file.id).kind !== PICTURE_STATE.READY) {
        keepPictureRead(owner, file.id, fileUrl(held));
      }
    }
  }
}

/** The queue as a change still out would leave it. */
function drawnWith(queue: AgentQueue, { change, files }: Out): AgentQueue {
  if (change.change === QUEUE_CHANGE.REORDER) {
    const at = new Map(change.order.map((id, index) => [id, index]));
    const placed = (message: QueuedMessage) => at.get(message.id) ?? change.order.length;
    return { ...queue, messages: queue.messages.toSorted((a, b) => placed(a) - placed(b)) };
  }
  // A message the queue lists has landed, and is drawn as the queue draws it.
  if (queue.messages.some((message) => message.id === change.id)) return queue;
  return {
    ...queue,
    messages: [
      ...queue.messages,
      {
        id: change.id,
        text: change.text,
        queuedBy: "",
        ...(change.attachments === undefined || change.attachments.length === 0
          ? undefined
          : {
              files: change.attachments.map((file, index) => ({
                name: file.name,
                mediaType: file.mediaType,
                ...(files?.[index] === undefined ? undefined : { id: files[index] }),
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
  /** The messages the service's queue lists now, by id, whatever this tab's changes still out draw over them. */
  readonly listed: ReadonlySet<string>;
  readonly paused: AgentQueue["paused"];
  /** One change, answered as the service answered it, sent after every change asked before it and once `after` settles where one is given. */
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
  // The change asked last, settled or not, which the next one goes after.
  const asked = useRef<Promise<unknown>>(Promise.resolve());
  const page = queue ?? EMPTY;
  // The queue as the service last said it, by whichever of the page and a change's answer stands at the higher revision.
  const standing = answered !== undefined && answered.revision > page.revision ? answered : page;
  const drawn = out.reduce(drawnWith, standing);
  // The files of a message queued from here are kept under the service's ids before the row naming them is painted.
  useLayoutEffect(() => keepLandedFiles(agentId, standing, out), [agentId, standing, out]);
  const listed = new Set(page.messages.map((message) => message.id));
  const change = (next: AgentQueueChange, after?: Promise<unknown>) => {
    counter.current += 1;
    const id = counter.current;
    if (drawnAtOnce(next)) {
      const files =
        next.change === QUEUE_CHANGE.ADD
          ? next.attachments?.map((file) => {
              const drawnAs = crypto.randomUUID();
              keepPictureRead(agentId, drawnAs, fileUrl(file));
              return drawnAs;
            })
          : undefined;
      setOut((was) => [
        ...was,
        { id, change: next, ...(files === undefined ? undefined : { files }) },
      ]);
    }
    const sent = Promise.all([asked.current, after])
      .then(() => act(ACT_KIND.AGENTS_QUEUE, { agentId, change: next }))
      .catch(() => UNANSWERED);
    asked.current = sent;
    return sent.then((answer) => {
      // Note that a change answered is drawn as the queue its answer names, and one refused springs back.
      if ("queue" in answer) keepLandedFiles(agentId, answer.queue, out);
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
    const ids = drawn.messages.map((message) => message.id);
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
  return { messages: drawn.messages, listed, paused: drawn.paused, change, move, remove };
}

/** A queued message's files whole, read through the agent's pictures by the ids the queue names them under; none where any did not read. */
function readQueuedFiles(
  message: QueuedMessage,
  door: AgentPictureDoor,
): Promise<readonly AgentAttachment[] | undefined> {
  const files = message.files ?? [];
  return Promise.all(
    files.map(({ name, mediaType, id }) => {
      if (id === undefined) return undefined;
      // Note that a file the window holds already, one of a message queued here, is taken as it stands.
      const held = pictureNow(door.owner, id);
      if (held.kind === PICTURE_STATE.READY) {
        return { name, mediaType, data: held.url.slice(held.url.indexOf(",") + 1) };
      }
      return door
        .read(door.owner, id)
        .then((answer) =>
          "base64" in answer
            ? { name, mediaType: answer.contentType, data: answer.base64 }
            : undefined,
        );
    }),
  ).then((read) => Option.getOrUndefined(Schema.decodeUnknownOption(agentAttachmentsSchema)(read)));
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
  /** The message's words and files taken into the box to edit, the box's own kept aside, and the message marked, which stops the hand-off at it. */
  readonly edit: (message: QueuedMessage) => void;
  /** The box's words saved back into the message's place, and the box given back what it held. */
  readonly save: () => void;
  /** The message sent now with the box's words, as one change of that message, and the box given back what it held. */
  readonly steer: () => void;
  /** The edit given up, the message left as it was, and the box given back what it held. */
  readonly cancel: () => void;
  /** The edit of `message` given up from its row: this box's own, as `cancel`, or one another window left standing, its mark cleared. */
  readonly cancelRow: (message: QueuedMessage) => void;
}

/**
 * The box's part in the queue. An edit moves the queued message's words into
 * the box, keeping what the box held aside, and marks the message as being
 * edited, which stops the hand-off at it; Save writes the words back in its
 * place, and Steer sends them now as that message, each closing the edit once
 * the queue took it, so a refusal leaves the words where they are. Cancel,
 * Escape, or Save with the box emptied lets it go as it was, and a message
 * the queue would not mark, already on its way, closes the edit. The mark
 * has no time to it: an edit left standing, its window closed, stays until
 * any of the member's windows cancels it from its row. Its files come into the box beside its words, read whole through the
 * agent's pictures as its row reads them (`readQueuedFiles`), where they are
 * taken off or joined as any message's are, and Save and Steer send the
 * box's files with its words; neither goes while they are still read, and an
 * edit whose files did not read closes, the message left as it was. A
 * message the queue did not take comes back into the box under the id it
 * went under, so queueing it again can never queue it twice.
 */
export function useQueueEditing(
  composer: Pick<
    HeldComposer,
    "draft" | "setDraft" | "attachments" | "setAttachments" | "sendsSettled"
  >,
  queue: Pick<AgentQueueControl, "change" | "listed">,
  files: AgentPictureDoor,
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
  // The box's words as they stand now, which an answer that lands later reads rather than those of the draw that asked.
  const draft = useRef(composer.draft);
  draft.current = composer.draft;
  // The words a refused queue gave back, and the id they went under, which queueing them again reuses.
  const refused = useRef<{ readonly text: string; readonly id: string } | undefined>(undefined);
  // The message whose files are still being read into the box, by id, which no Save or Steer sends meanwhile.
  const reading = useRef<string | undefined>(undefined);
  const { change } = queue;
  const giveBack = (stash: Stashed) => {
    composer.setDraft(stash.text);
    composer.setAttachments(() => stash.attachments);
    setStashed(undefined);
  };
  /** The edit closed once the queue took `edit`, where it is still this message's; left open where it was refused. */
  const closing = (stash: Stashed, edit: AgentQueueChange) => {
    void change(edit).then((answer) => {
      if (!("failure" in answer) && held.current === stash.id) giveBack(stash);
    });
  };
  /** The edit of `stash` given up, its mark cleared and the box given back what it held. */
  const cancelOf = (stash: Stashed) => {
    void change({ change: QUEUE_CHANGE.HOLD, messageId: stash.id, held: false });
    giveBack(stash);
  };
  const cancel = () => {
    if (stashed !== undefined) cancelOf(stashed);
  };
  return {
    editing: stashed?.id,
    queue: () => {
      const text = composer.draft.trim();
      const { attachments } = composer;
      if (!hasWordsOrFiles(text, attachments)) return;
      const again = refused.current;
      const id = again !== undefined && again.text === text ? again.id : crypto.randomUUID();
      refused.current = undefined;
      composer.setDraft("");
      composer.setAttachments(() => []);
      void change(
        {
          change: QUEUE_CHANGE.ADD,
          id,
          text,
          ...(attachments.length === 0 ? undefined : { attachments }),
        },
        composer.sendsSettled(),
      ).then((answer) => {
        // A message the queue did not take comes back into the box, where the box holds nothing newer.
        if ("failure" in answer && draft.current === "") {
          refused.current = { text, id };
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
      // A message the queue would not mark, already on its way, is no longer the box's to edit.
      void change({ change: QUEUE_CHANGE.HOLD, messageId: message.id, held: true }).then(
        (answer) => {
          if ("failure" in answer && held.current === message.id) giveBack(stash);
        },
      );
      if ((message.files ?? []).length === 0) return;
      // Its files join the box ahead of any taken on meanwhile, or, where they did not read, the edit closes.
      reading.current = message.id;
      void readQueuedFiles(message, files).then((read) => {
        if (held.current !== message.id) return;
        reading.current = undefined;
        if (read === undefined) return cancelOf(stash);
        composer.setAttachments((added) => [...read, ...added]);
      });
    },
    save: () => {
      if (stashed === undefined || reading.current === stashed.id) return;
      const text = composer.draft.trim();
      const { attachments } = composer;
      if (!hasWordsOrFiles(text, attachments)) return cancel();
      closing(stashed, {
        change: QUEUE_CHANGE.EDIT,
        messageId: stashed.id,
        text,
        ...(attachments.length === 0 ? undefined : { attachments }),
      });
    },
    steer: () => {
      if (stashed === undefined || reading.current === stashed.id) return;
      const text = composer.draft.trim();
      const { attachments } = composer;
      if (!hasWordsOrFiles(text, attachments)) return cancel();
      closing(stashed, {
        change: QUEUE_CHANGE.STEER,
        messageId: stashed.id,
        text,
        ...(attachments.length === 0 ? undefined : { attachments }),
      });
    },
    cancel,
    cancelRow: (message) => {
      if (message.id === stashed?.id) return cancel();
      void change({ change: QUEUE_CHANGE.HOLD, messageId: message.id, held: false });
    },
  };
}
