import type { AgentQueue, QueuedMessage } from "@repo/features/agent-queue-wire";
import { AGENT_CALL_FAILURE, type AgentQueueAnswerView } from "@repo/features/agent-view";
import {
  type AgentAttachment,
  type AgentQueueChange,
  agentAttachmentsSchema,
  hasWordsOrFiles,
  QUEUE_CHANGE,
} from "@repo/features/agent-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import { STATUS_TONE } from "@repo/ui";
import { keepPictureRead, PICTURE_STATE, pictureNow } from "@repo/ui/picture-cache";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { Option, Schema } from "effect";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAct } from "../act.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import type { AgentPictureDoor } from "./agent-pictures.js";
import type { HeldComposer } from "./use-agent-composer.js";

/**
 * use-agent-queue.ts -- an agent's queue as its tab draws and changes it: the messages queued behind its turn, in the order they go, and the one door every change goes through.
 *
 * What the tab draws is the queue its transcript's page carries, with every
 * change asked of it drawn over it by the host the moment it is asked
 * (`@repo/host`'s `agent-queue-writes.ts`), each sent after every change of
 * the agent's queue asked before it and standing until a page carries it,
 * so nothing here waits on one. A change the service refused is taken back
 * by the host and said here in a toast. A message is queued under an id the
 * tab mints (`crypto.randomUUID`), so it is drawn at the queue's end as it
 * goes, under the id it keeps, and takes presses at once. The files of a
 * message queued or edited here are kept in the window's pictures under
 * ids of the tab's own, which the host draws them by, and, before the row
 * naming them by the service's ids is painted, under those, so its
 * thumbnails never give way to a read of what the window already holds.
 */

/** What a change answered where the act itself failed. */
const UNANSWERED: AgentQueueAnswerView = { failure: AGENT_CALL_FAILURE.UNANSWERED };

/** What the toast says of a change the host drew and took back, by what it asked; a hold's refusal closes its edit, which says it. */
const REFUSED_WORDS: { readonly [Change in AgentQueueChange["change"]]?: string } = {
  [QUEUE_CHANGE.ADD]: "Could not queue the message.",
  [QUEUE_CHANGE.EDIT]: "Could not save the queued message.",
  [QUEUE_CHANGE.DELETE]: "Could not delete the queued message.",
  [QUEUE_CHANGE.STEER]: "Could not send the queued message.",
  [QUEUE_CHANGE.REORDER]: "Could not reorder the queue.",
  [QUEUE_CHANGE.RESUME]: "Could not resume the queue.",
};

/** What the toast says beneath them where the service said the message is no longer in the queue. */
const LEFT_WORDS = "It already left the queue.";

/** The messages of a queue its page carries none of, as an agent's page before its first change. */
const NO_MESSAGES: readonly QueuedMessage[] = [];

/** The files of a message queued or edited from this tab: the box's bytes, the ids it drew them under, and whether a row has named those yet. */
interface KeptFiles {
  readonly attachments: readonly AgentAttachment[];
  readonly drawnAs: readonly string[];
  drawn: boolean;
}

/** A file the box held, as the window draws it from its own bytes. */
function fileUrl(file: AgentAttachment): string {
  return `data:${file.mediaType};base64,${file.data}`;
}

/** The files a change sends with a message, where it sends any. */
function filesOf(change: AgentQueueChange): readonly AgentAttachment[] {
  if (change.change !== QUEUE_CHANGE.ADD && change.change !== QUEUE_CHANGE.EDIT) return [];
  return change.attachments ?? [];
}

/** The message a change names, by its id; none for one of the whole queue. */
function messageOf(change: AgentQueueChange): string | undefined {
  if (change.change === QUEUE_CHANGE.ADD) return change.id;
  return "messageId" in change ? change.messageId : undefined;
}

/**
 * The files of each message queued or edited from this tab, kept in the
 * agent's pictures under the ids the service's queue names them by, once a
 * row named them by the tab's own and then by the service's, so the landed
 * row draws the bytes the box held rather than reading them back.
 */
function keepLandedFiles(
  owner: string,
  messages: readonly QueuedMessage[],
  kept: Map<string, KeptFiles>,
): void {
  for (const [id, files] of kept) {
    const listed = messages.find((message) => message.id === id)?.files ?? [];
    const drawn = listed.some((file) => file.id !== undefined && files.drawnAs.includes(file.id));
    if (drawn) files.drawn = true;
    // Note that a row still naming the files it was edited from, before the host drew the edit, is not yet the service's.
    if (drawn || !files.drawn || listed.length === 0) continue;
    for (const [index, file] of listed.entries()) {
      const held = files.attachments[index];
      if (file.id === undefined || held === undefined) continue;
      if (pictureNow(owner, file.id).kind !== PICTURE_STATE.READY) {
        keepPictureRead(owner, file.id, fileUrl(held));
      }
    }
    kept.delete(id);
  }
}

/** An agent's queue as its tab holds it. */
export interface AgentQueueControl {
  /** Its messages in the order they go, every change asked of it drawn over the page. */
  readonly messages: readonly QueuedMessage[];
  /** The messages the queue lists now, by id. */
  readonly listed: ReadonlySet<string>;
  readonly paused: AgentQueue["paused"];
  /** One change, drawn by the host at once and answered as the service answered it, asked once `after` settles where one is given. */
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
  const toast = useToast();
  const messages = queue?.messages ?? NO_MESSAGES;
  const kept = useRef(new Map<string, KeptFiles>());
  // The files of a message queued or edited here are kept under the service's ids before the row naming them is painted.
  useLayoutEffect(() => keepLandedFiles(agentId, messages, kept.current), [agentId, messages]);
  const listed = useMemo(() => new Set(messages.map((message) => message.id)), [messages]);
  const change = (next: AgentQueueChange, after?: Promise<unknown>) => {
    const files = filesOf(next);
    const messageId = messageOf(next);
    const drawnAs = files.map((file) => {
      const id = crypto.randomUUID();
      keepPictureRead(agentId, id, fileUrl(file));
      return id;
    });
    if (messageId !== undefined && drawnAs.length > 0) {
      kept.current.set(messageId, { attachments: files, drawnAs, drawn: false });
    }
    const params = {
      agentId,
      change: next,
      ...(drawnAs.length === 0 ? undefined : { pictures: drawnAs }),
    };
    // Note that a message queued behind the box's own sends is asked only once they settle, so it never reaches the service ahead of them.
    const asked =
      after === undefined
        ? act(ACT_KIND.AGENTS_QUEUE, params)
        : after.then(() => act(ACT_KIND.AGENTS_QUEUE, params));
    return asked
      .catch(() => UNANSWERED)
      .then((answer) => {
        const words = REFUSED_WORDS[next.change];
        if (!("failure" in answer) || words === undefined) return answer;
        if (messageId !== undefined) kept.current.delete(messageId);
        toast({
          words,
          ...(answer.failure === AGENT_CALL_FAILURE.NOT_FOUND && messageId !== undefined
            ? { detail: LEFT_WORDS }
            : undefined),
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: {
            surface:
              next.change === QUEUE_CHANGE.DELETE
                ? FAILURE_SURFACE.AGENT_QUEUE_DELETE
                : FAILURE_SURFACE.AGENT_QUEUE_CHANGE,
            cause: answer,
            about: { agentId },
          },
        });
        return answer;
      });
  };
  const move = (from: number, to: number) => {
    const ids = messages.map((message) => message.id);
    const [taken] = ids.splice(from, 1);
    if (taken === undefined) return;
    ids.splice(to, 0, taken);
    void change({ change: QUEUE_CHANGE.REORDER, order: ids });
  };
  // Note that the host draws the deletion on the press, so the dialog closes at once; one refused is taken back and said in a toast.
  const remove = (message: QueuedMessage) => {
    void change({ change: QUEUE_CHANGE.DELETE, messageId: message.id });
    return Promise.resolve<ActionResult>({ status: ACTION_RESULT_STATUS.ACCEPTED });
  };
  return { messages, listed, paused: queue?.paused, change, move, remove };
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
 * place, drawn there by the host at once, and closes the edit on the press,
 * its words coming back into the box where the queue refused them and the
 * box holds nothing newer; Steer sends them now as that message, which only
 * the service can say it did, so it closes the edit once the queue took it,
 * and a refusal leaves the words where they are. Cancel,
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
  /** The edit closed once the queue took the steer, where it is still this message's; left open where it was refused. */
  const steered = (stash: Stashed, steer: AgentQueueChange) => {
    void change(steer).then((answer) => {
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
      giveBack(stashed);
      void change({
        change: QUEUE_CHANGE.EDIT,
        messageId: stashed.id,
        text,
        ...(attachments.length === 0 ? undefined : { attachments }),
      }).then((answer) => {
        // An edit the queue did not save comes back into the box, where the box holds nothing newer.
        if ("failure" in answer && draft.current === "") {
          composer.setDraft(text);
          composer.setAttachments(() => attachments);
        }
      });
    },
    steer: () => {
      if (stashed === undefined || reading.current === stashed.id) return;
      const text = composer.draft.trim();
      const { attachments } = composer;
      if (!hasWordsOrFiles(text, attachments)) return cancel();
      steered(stashed, {
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
