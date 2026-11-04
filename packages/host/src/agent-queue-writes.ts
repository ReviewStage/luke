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

/**
 * agent-queue-writes.ts -- each agent's queue as the sync engine's pool holds it, fed from its own transcript's pages, and every change of it drawn over it the moment it is asked.
 *
 * An agent's queue reaches the host on its own transcript's pages
 * (`word.queue`), read while a window holds the transcript
 * (`transcript-follow.ts`). Each page's queue is one row of the pool
 * (`@repo/sync`), by the agent's id, taken at its revision, so a page read
 * before a newer one never puts an older queue back; and the transcript the
 * windows draw carries the queue as the pool draws it, every change
 * standing laid over it. A change (`agents.queue`) is one write of the pool:
 * a message queued under the id its window minted, an edit, a hold of one
 * being edited, a deletion, a new order, or the pause dropped, each drawn
 * at once; a steer sends the message as the member's own, which is the
 * service's to say, so it draws nothing until the service answers, but goes
 * in turn behind the agent's other changes. From its answer on, a change
 * stands as the queue the service answered, over any older one.
 *
 * Every change moves the queue's revision in its own transaction, and the
 * service answers the queue it left, revision and all, but no transaction:
 * the page carrying the queue is read only after the transcript's live read
 * moves, so a wait for a transaction there would stand the change down
 * before the queue that carries it lands. So a change stands until the
 * pool's queue is at least as new as the one it answered (`Written.carried`),
 * and is taken back where the service refused it, as the window then says.
 */

/** An agent's queue as the pool holds it, by the agent's id. */
interface QueueRow {
  readonly agentId: string;
  readonly queue: AgentQueue;
}

/** A change of a queue: the queue it leaves, from the queue as it is drawn now. */
type QueueChange = (queue: AgentQueue) => AgentQueue;

/** An agent's queue, by the agent's id, every change of it a queue it leaves; one no read answered is drawn nothing. */
const AGENT_QUEUE: EntityKind<QueueRow, QueueChange> = {
  key: (row) => row.agentId,
  drawn: (change, row) => {
    if (row === undefined) return undefined;
    const queue = change(row.queue);
    // Note that a change the queue already carries leaves the row alone, so a reader holds the very row.
    return Equal.equals(queue, row.queue) ? undefined : { agentId: row.agentId, queue };
  },
};

/** A change of an agent's queue as the host writes it: the window's params, and the member it is queued by. */
export type QueueWrite = AgentQueueParams & { readonly queuedBy: string };

/** The files a message carries, by the ids the window keeps their bytes under, where it named them; none where it carries none. */
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

/** The queue with the message `id` names as `changed` leaves it; as it is where it lists none. */
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

/** The queue as `change` leaves it, drawn before the service answers; a steer leaves it as it is, since the send is the service's to say. */
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

/** The queue the service answered, over any queue older than it; a newer one is the service's later word, and stands. */
function answeredOver(answered: AgentQueue): QueueChange {
  return (queue) => (queue.revision >= answered.revision ? queue : answered);
}

/** The transcript with `queue` in its word's place, where its last page carried a queue. */
function withQueue(rows: AppTranscript, queue: AgentQueue | undefined): AppTranscript {
  if (rows.word?.queue === undefined || queue === undefined) return rows;
  return { ...rows, word: { ...rows.word, queue } };
}

/** The agents' queues in the pool, and the change of one. */
export interface AgentQueues {
  /**
   * An agent's own transcript as its follow lays it, for the caller's
   * scope: each page's queue taken into the pool, and the transcript laid
   * for the windows with the queue as the pool draws it, which every change
   * standing draws again; read back with the queue as the service last said
   * it, so nothing drawn is taken as the service's.
   */
  readonly held: (
    agentId: string,
    answers: HeldAnswers<AppTranscript>,
  ) => Effect.Effect<HeldTranscript, never, Scope.Scope>;
  /** A change of an agent's queue, sent as `send` asks. */
  readonly write: (
    send: (agentId: string, change: AgentQueueChange) => Effect.Effect<AgentQueueAnswerView>,
  ) => WriteDeclaration<QueueRow, QueueChange, QueueWrite, WireValue>;
}

/** The agents' queues in `pool`, each held while its own transcript is followed, for as long as the scope stands. */
export function agentQueues(pool: EntityPool): Effect.Effect<AgentQueues, never, Scope.Scope> {
  return Effect.sync(() => {
    /** Each followed agent's waits on what its pages carry, while its follow stands. */
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
        // Note that no queue change answers a transaction, so the read hands no wait and each change waits on its rows (`carried`).
        const queues = yield* pool.stand(AGENT_QUEUE, {
          redraw: () => redraw,
          confirmation: () => undefined,
        });
        const waits = yield* carriedWaits(() => queues.synced());
        yield* stand(agentId, waits);
        /** A page's queue taken as the agent's, at its revision, and every change it carries let stand down. */
        const taken = (queue: AgentQueue) =>
          Effect.andThen(
            queues.answer([{ agentId, queue }], { at: BigInt(queue.revision) }),
            waits.answered,
          );
        // Note that a transcript held again takes the queue it was left with, so a change still standing is drawn over it before the next page lands.
        const kept = answers.rows()?.word?.queue;
        if (kept !== undefined) yield* Effect.andThen(taken(kept), redraw);
        // Note that a transcript let go is left with its queue as the service last said it, so a change taken back once no window follows it is drawn there no more.
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
    /** Waits until the agent's pages carry what `until` asks of its queue, at once where no follow stands for it. */
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
