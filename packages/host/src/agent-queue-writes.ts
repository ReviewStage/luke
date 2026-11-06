import type { AgentQueue, QueuedMessage } from "@repo/features/agent-queue-wire";
import type { AgentQueueAnswerView, AgentQueueParams } from "@repo/features/agent-view";
import {
  type AgentAttachment,
  type AgentQueueChange,
  QUEUE_CHANGE,
} from "@repo/features/agent-wire";
import { carried } from "@repo/gateway";
import type { EntityKind, EntityPool, Refused, WriteDeclaration, Written } from "@repo/sync";
import type { WireValue } from "@repo/wire";
import { Effect, Equal, MutableHashMap, Option, type Scope } from "effect";
import type { AppTranscript } from "./app-state.js";
import { type CarriedWaits, carriedWaits, type HeldAnswers } from "./live-collection.js";
import type { HeldTranscript } from "./transcript-follow.js";

interface QueueRow {
  readonly agentId: string;
  readonly queue: AgentQueue;
}

type QueueChange = (queue: AgentQueue) => AgentQueue;

const AGENT_QUEUE: EntityKind<QueueRow, QueueChange> = {
  key: (row) => row.agentId,
  drawn: (change, row) => {
    if (row === undefined) return undefined;
    const queue = change(row.queue);
    return Equal.equals(queue, row.queue) ? undefined : { agentId: row.agentId, queue };
  },
};

export type QueueWrite = AgentQueueParams & { readonly queuedBy: string };

function filesOf(
  attachments: readonly AgentAttachment[] | undefined,
  pictures: readonly string[] | undefined,
): Pick<QueuedMessage, "files"> {
  if (attachments === undefined || attachments.length === 0) return {};
  return {
    files: attachments.map((file, index) => {
      const id = pictures?.[index];
      return {
        name: file.name,
        mediaType: file.mediaType,
        ...(id === undefined ? undefined : { id }),
      };
    }),
  };
}

function withMessage(
  queue: AgentQueue,
  id: string,
  changed: (message: QueuedMessage) => QueuedMessage,
): AgentQueue {
  return {
    ...queue,
    messages: queue.messages.map((message) => (message.id === id ? changed(message) : message)),
  };
}

function drawnChange({ change, pictures, queuedBy }: QueueWrite): QueueChange {
  switch (change.change) {
    case QUEUE_CHANGE.ADD:
      return (queue) =>
        queue.messages.some((message) => message.id === change.id)
          ? queue
          : {
              ...queue,
              messages: [
                ...queue.messages,
                {
                  id: change.id,
                  text: change.text,
                  queuedBy,
                  ...filesOf(change.attachments, pictures),
                },
              ],
            };
    case QUEUE_CHANGE.EDIT:
      return (queue) =>
        withMessage(queue, change.messageId, ({ editing: _editing, files: _files, ...kept }) => ({
          ...kept,
          text: change.text,
          ...filesOf(change.attachments, pictures),
        }));
    case QUEUE_CHANGE.HOLD:
      return (queue) =>
        withMessage(queue, change.messageId, ({ editing: _editing, ...kept }) =>
          change.held ? { ...kept, editing: true } : kept,
        );
    case QUEUE_CHANGE.DELETE:
      return (queue) => ({
        ...queue,
        messages: queue.messages.filter((message) => message.id !== change.messageId),
      });
    case QUEUE_CHANGE.REORDER: {
      const at = new Map(change.order.map((id, index) => [id, index]));
      const placed = (message: QueuedMessage) => at.get(message.id) ?? change.order.length;
      return (queue) => ({
        ...queue,
        messages: queue.messages.toSorted((one, other) => placed(one) - placed(other)),
      });
    }
    case QUEUE_CHANGE.RESUME:
      return ({ paused: _paused, ...queue }) => queue;
    case QUEUE_CHANGE.STEER:
      return (queue) => queue;
  }
}

function answeredOver(answered: AgentQueue): QueueChange {
  return (queue) => (queue.revision >= answered.revision ? queue : answered);
}

function withQueue(rows: AppTranscript, queue: AgentQueue | undefined): AppTranscript {
  if (rows.word?.queue === undefined || queue === undefined) return rows;
  return { ...rows, word: { ...rows.word, queue } };
}

export interface AgentQueues {
  readonly held: (
    agentId: string,
    answers: HeldAnswers<AppTranscript>,
  ) => Effect.Effect<HeldTranscript, never, Scope.Scope>;
  readonly write: (
    send: (agentId: string, change: AgentQueueChange) => Effect.Effect<AgentQueueAnswerView>,
  ) => WriteDeclaration<QueueRow, QueueChange, QueueWrite, WireValue>;
}

export function agentQueues(pool: EntityPool): Effect.Effect<AgentQueues, never, Scope.Scope> {
  return Effect.sync(() => {
    const standing = MutableHashMap.empty<string, CarriedWaits<QueueRow>>();
    const stand = (agentId: string, waits: CarriedWaits<QueueRow>) =>
      Effect.acquireRelease(
        Effect.sync(() => MutableHashMap.set(standing, agentId, waits)),
        () =>
          Effect.sync(() => {
            if (Option.getOrUndefined(MutableHashMap.get(standing, agentId)) === waits) {
              MutableHashMap.remove(standing, agentId);
            }
          }),
      );
    const held = (agentId: string, answers: HeldAnswers<AppTranscript>) =>
      Effect.gen(function* () {
        const redraw = Effect.sync(() => {
          const rows = answers.rows();
          if (rows !== undefined) answers.answered(withQueue(rows, queues.row(agentId)?.queue));
        });
        const queues = yield* pool.stand(AGENT_QUEUE, {
          redraw: () => redraw,
          confirmation: () => undefined,
        });
        const waits = yield* carriedWaits(() => queues.synced());
        yield* stand(agentId, waits);
        const taken = (queue: AgentQueue) =>
          Effect.andThen(
            queues.answer([{ agentId, queue }], { at: BigInt(queue.revision) }),
            waits.answered,
          );
        const kept = answers.rows()?.word?.queue;
        if (kept !== undefined) yield* Effect.andThen(taken(kept), redraw);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            const rows = answers.rows();
            if (rows === undefined || queues.pending().length === 0) return;
            answers.answered(withQueue(rows, queues.synced()[0]?.queue));
          }),
        );
        return {
          rows: () => {
            const rows = answers.rows();
            return rows === undefined ? undefined : withQueue(rows, queues.synced()[0]?.queue);
          },
          answered: (rows) =>
            Effect.gen(function* () {
              const queue = rows.word?.queue;
              if (queue !== undefined) yield* taken(queue);
              answers.answered(withQueue(rows, queues.row(agentId)?.queue));
            }),
        } satisfies HeldTranscript;
      });
    const carriedFor = (agentId: string, until: (rows: readonly QueueRow[]) => boolean) =>
      Effect.suspend(() => {
        const waits = Option.getOrUndefined(MutableHashMap.get(standing, agentId));
        return waits === undefined ? Effect.void : waits.carried(until);
      });
    const write = (
      send: (agentId: string, change: AgentQueueChange) => Effect.Effect<AgentQueueAnswerView>,
    ): WriteDeclaration<QueueRow, QueueChange, QueueWrite, WireValue> => ({
      kind: AGENT_QUEUE,
      keys: ({ agentId }) => [agentId],
      change: drawnChange,
      send: ({ agentId, change }) =>
        Effect.map(
          send(agentId, change),
          (answer): Written<QueueChange, WireValue> | Refused<WireValue> => {
            if (!("queue" in answer)) return { refused: carried<AgentQueueAnswerView>(answer) };
            const { revision } = answer.queue;
            const over = answeredOver(answer.queue);
            return {
              answer: carried<AgentQueueAnswerView>(answer),
              txid: undefined,
              standsAs: over,
              taken: over,
              carried: carriedFor(agentId, (rows) =>
                rows.some((row) => row.queue.revision >= revision),
              ),
            };
          },
        ),
    });
    return { held, write };
  });
}
