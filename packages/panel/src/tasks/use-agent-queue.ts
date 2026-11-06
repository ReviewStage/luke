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
import { PICTURE_STATE } from "@repo/ui/picture-read";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { Option, Schema } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { keepPictureRead, pictureNow, pictureQuery } from "../picture-query.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import type { AgentPictureDoor } from "./agent-pictures.js";
import type { HeldComposer } from "./use-agent-composer.js";

const UNANSWERED: AgentQueueAnswerView = { failure: AGENT_CALL_FAILURE.UNANSWERED };

const REFUSED_WORDS: { readonly [Change in AgentQueueChange["change"]]?: string } = {
  [QUEUE_CHANGE.ADD]: "Could not queue the message.",
  [QUEUE_CHANGE.EDIT]: "Could not save the queued message.",
  [QUEUE_CHANGE.DELETE]: "Could not delete the queued message.",
  [QUEUE_CHANGE.STEER]: "Could not send the queued message.",
  [QUEUE_CHANGE.REORDER]: "Could not reorder the queue.",
  [QUEUE_CHANGE.RESUME]: "Could not resume the queue.",
};

const LEFT_WORDS = "It already left the queue.";

const NO_MESSAGES: readonly QueuedMessage[] = [];

function fileUrl(file: AgentAttachment): string {
  return `data:${file.mediaType};base64,${file.data}`;
}

function filesOf(change: AgentQueueChange): readonly AgentAttachment[] {
  if (change.change !== QUEUE_CHANGE.ADD && change.change !== QUEUE_CHANGE.EDIT) return [];
  return change.attachments ?? [];
}

function messageOf(change: AgentQueueChange): string | undefined {
  if (change.change === QUEUE_CHANGE.ADD) return change.id;
  return "messageId" in change ? change.messageId : undefined;
}

function keepLandedFiles(
  client: QueryClient,
  owner: string,
  queue: AgentQueue,
  messageId: string,
  attachments: readonly AgentAttachment[],
): void {
  const landed = queue.messages.find((message) => message.id === messageId);
  for (const [index, file] of (landed?.files ?? []).entries()) {
    const held = attachments[index];
    if (file.id === undefined || held === undefined) continue;
    if (pictureNow(client, owner, file.id).kind !== PICTURE_STATE.READY) {
      keepPictureRead(client, owner, file.id, fileUrl(held));
    }
  }
}

export interface AgentQueueControl {
  readonly messages: readonly QueuedMessage[];
  readonly listed: ReadonlySet<string>;
  readonly paused: AgentQueue["paused"];
  readonly change: (
    change: AgentQueueChange,
    after?: Promise<unknown>,
  ) => Promise<AgentQueueAnswerView>;
  readonly move: (from: number, to: number) => void;
  readonly remove: (message: QueuedMessage) => Promise<ActionResult>;
}

export function useAgentQueue(agentId: string, queue: AgentQueue | undefined): AgentQueueControl {
  const { mutateAsync: sendQueue } = useMutation(actMutation(ACT_KIND.AGENTS_QUEUE));
  const queryClient = useQueryClient();
  const toast = useToast();
  const messages = queue?.messages ?? NO_MESSAGES;
  const listed = useMemo(() => new Set(messages.map((message) => message.id)), [messages]);
  const change = (next: AgentQueueChange, after?: Promise<unknown>) => {
    const files = filesOf(next);
    const messageId = messageOf(next);
    const drawnAs = files.map((file) => {
      const id = crypto.randomUUID();
      keepPictureRead(queryClient, agentId, id, fileUrl(file));
      return id;
    });
    const params = {
      agentId,
      change: next,
      ...(drawnAs.length === 0 ? undefined : { pictures: drawnAs }),
    };
    const asked = after === undefined ? sendQueue(params) : after.then(() => sendQueue(params));
    return asked
      .catch(() => UNANSWERED)
      .then((answer) => {
        if ("queue" in answer && messageId !== undefined && files.length > 0) {
          keepLandedFiles(queryClient, agentId, answer.queue, messageId, files);
        }
        const words = REFUSED_WORDS[next.change];
        if (!("failure" in answer) || words === undefined) return answer;
        toast({
          replayUnmasked: true,
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
  const remove = (message: QueuedMessage) => {
    void change({ change: QUEUE_CHANGE.DELETE, messageId: message.id });
    return Promise.resolve<ActionResult>({ status: ACTION_RESULT_STATUS.ACCEPTED });
  };
  return { messages, listed, paused: queue?.paused, change, move, remove };
}

function readQueuedFiles(
  client: QueryClient,
  message: QueuedMessage,
  door: AgentPictureDoor,
): Promise<readonly AgentAttachment[] | undefined> {
  const files = message.files ?? [];
  return Promise.all(
    files.map(({ name, mediaType, id }) => {
      if (id === undefined) return undefined;
      return client.fetchQuery(pictureQuery(door.owner, id, door.read)).then(
        (read) =>
          read.kind === PICTURE_STATE.READY
            ? { name, mediaType, data: read.url.slice(read.url.indexOf(",") + 1) }
            : undefined,
        () => undefined,
      );
    }),
  ).then((read) => Option.getOrUndefined(Schema.decodeUnknownOption(agentAttachmentsSchema)(read)));
}

interface Stashed {
  readonly id: string;
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
}

export interface QueueEditing {
  readonly editing: string | undefined;
  readonly queue: () => void;
  readonly edit: (message: QueuedMessage) => void;
  readonly save: () => void;
  readonly steer: () => void;
  readonly cancel: () => void;
  readonly cancelRow: (message: QueuedMessage) => void;
}

export function useQueueEditing(
  composer: Pick<
    HeldComposer,
    "draft" | "setDraft" | "attachments" | "setAttachments" | "sendsSettled"
  >,
  queue: Pick<AgentQueueControl, "change" | "listed">,
  files: AgentPictureDoor,
): QueueEditing {
  const queryClient = useQueryClient();
  const [stashed, setStashed] = useState<Stashed | undefined>();
  const held = useRef<string | undefined>(undefined);
  held.current = stashed?.id;
  const seen = useRef(false);
  const listed = stashed !== undefined && queue.listed.has(stashed.id);
  if (listed) seen.current = true;
  if (stashed === undefined) seen.current = false;
  const left = stashed !== undefined && seen.current && !listed;
  useEffect(() => {
    if (left) setStashed(undefined);
  }, [left]);
  const draft = useRef(composer.draft);
  draft.current = composer.draft;
  const refused = useRef<{ readonly text: string; readonly id: string } | undefined>(undefined);
  const reading = useRef<string | undefined>(undefined);
  const { change } = queue;
  const giveBack = (stash: Stashed) => {
    composer.setDraft(stash.text);
    composer.setAttachments(() => stash.attachments);
    setStashed(undefined);
  };
  const closing = (stash: Stashed, edit: AgentQueueChange) => {
    void change(edit).then((answer) => {
      if (!("failure" in answer) && held.current === stash.id) giveBack(stash);
    });
  };
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
      void change({ change: QUEUE_CHANGE.HOLD, messageId: message.id, held: true }).then(
        (answer) => {
          if ("failure" in answer && held.current === message.id) giveBack(stash);
        },
      );
      if ((message.files ?? []).length === 0) return;
      reading.current = message.id;
      void readQueuedFiles(queryClient, message, files).then((read) => {
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
