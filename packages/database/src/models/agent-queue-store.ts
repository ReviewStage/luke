/**
 * agent-queue-store.ts -- a coding agent's queue: the messages members queued behind its running turn, read, written, put in order, and handed on one at a time, and whether it stands paused.
 *
 * What a member reads or writes of the queue is gated by whether they reach
 * the agent (`agentReachableBy`), so no account lists, queues on, edits, puts
 * in order, or resumes another's queue it could not message. What the
 * service does at the agent's turn's end (`queueHead`, `dropQueuedMessage`,
 * `pauseAgentQueue`) acts for the agent and names no member.
 *
 * Every write that draws a place, or puts the queue in a new order, holds
 * the agent's queue lock until it commits, so two queued at once each draw
 * a place of their own and a new order never crosses a message queued
 * meanwhile. A queue standing empty stands unpaused: a pause is written
 * only over messages, and the last message going takes it with it, so a
 * Stop with nothing queued holds back nothing queued later.
 */

import type { HostedApiError } from "@luke/features";
import { AGENT_QUEUE_BOUNDS, QUEUE_PAUSE, type QueuePause } from "@luke/features/agent-queue-wire";
import { LINE_GRACE_MILLIS } from "@luke/features/coding-agent-status";
import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import { and, asc, count, eq, exists, max, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentQueuePause, queuedMessage } from "../schemas/agent-queue.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { agentReachableBy } from "./workspace-store.js";

type AgentQueueEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** One queued message as its row keeps it. */
const QueuedRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  clientKey: Schema.String,
  text: Schema.String,
  attachments: Schema.NullOr(Schema.Array(Schema.Unknown)),
  heldUntil: Schema.NullOr(Schema.Date),
});

/** One queued message: its words and files, the member who queued it, the key it goes under, and until when an edit holds it out of the hand-off. */
export interface QueuedMessageRow {
  readonly id: string;
  readonly userId: string;
  readonly clientKey: string;
  readonly text: string;
  readonly attachments: readonly CodingAgentAttachment[];
  readonly heldUntil: Date | undefined;
}

/** Why a queue stands paused, and what refused a hand-off where one did. */
export interface QueuePauseRow {
  readonly because: QueuePause;
  readonly refusal: HostedApiError | undefined;
}

/** An agent's queue: its messages in the order they go, and its pause where it stands paused. */
export interface AgentQueueRead {
  readonly messages: readonly QueuedMessageRow[];
  readonly paused: QueuePauseRow | undefined;
}

/** What queueing a message answered: queued (or queued already under its key), or refused because the queue is full. */
export const QUEUE_OUTCOME = {
  QUEUED: "queued",
  FULL: "full",
} as const;

export type QueueOutcome = (typeof QUEUE_OUTCOME)[keyof typeof QUEUE_OUTCOME];

const PAUSES: readonly QueuePause[] = Object.values(QUEUE_PAUSE);

const PauseRowSchema = Schema.Struct({
  because: Schema.Literals(PAUSES),
  refusal: Schema.NullOr(Schema.String),
});

/** A row as the store reads it, its files as the request carried them. */
function messageOf(row: typeof QueuedRowSchema.Type): QueuedMessageRow {
  // SAFETY: the column is written only from a message request's files, which their schema read.
  const attachments = (row.attachments ?? []) as readonly CodingAgentAttachment[];
  return { ...row, attachments, heldUntil: row.heldUntil ?? undefined };
}

const findReached = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ id: codingAgent.id })
        .from(codingAgent)
        .where(and(eq(codingAgent.id, agentId), agentReachableBy(userId))),
    ),
});

const findMessages = SqlSchema.findAll({
  Request: Schema.Struct({ agentId: Schema.String }),
  Result: QueuedRowSchema,
  execute: ({ agentId }) =>
    Database.use((db) =>
      db
        .select({
          id: queuedMessage.id,
          userId: queuedMessage.userId,
          clientKey: queuedMessage.clientKey,
          text: queuedMessage.text,
          attachments: queuedMessage.attachments,
          heldUntil: queuedMessage.heldUntil,
        })
        .from(queuedMessage)
        .where(eq(queuedMessage.agentId, agentId))
        .orderBy(asc(queuedMessage.position), asc(queuedMessage.createdAt)),
    ),
});

const findPause = SqlSchema.findAll({
  Request: Schema.Struct({ agentId: Schema.String }),
  Result: PauseRowSchema,
  execute: ({ agentId }) =>
    Database.use((db) =>
      db
        .select({ because: agentQueuePause.because, refusal: agentQueuePause.refusal })
        .from(agentQueuePause)
        .where(eq(agentQueuePause.agentId, agentId)),
    ),
});

const findTail = SqlSchema.findAll({
  Request: Schema.Struct({ agentId: Schema.String }),
  Result: Schema.Struct({ size: Schema.Number, last: Schema.NullOr(Schema.Number) }),
  execute: ({ agentId }) =>
    Database.use((db) =>
      db
        .select({ size: count(), last: max(queuedMessage.position) })
        .from(queuedMessage)
        .where(eq(queuedMessage.agentId, agentId)),
    ),
});

const insertMessage = SqlSchema.void({
  Request: Schema.Struct({
    agentId: Schema.String,
    userId: Schema.String,
    position: Schema.Number,
    clientKey: Schema.String,
    text: Schema.String,
    attachments: Schema.NullOr(Schema.Array(Schema.Unknown)),
    now: Schema.Date,
  }),
  execute: ({ attachments, now, ...row }) =>
    Database.use((db) =>
      db
        .insert(queuedMessage)
        .values({
          ...row,
          // SAFETY: the files are a message request's, which their schema read.
          attachments: attachments as readonly CodingAgentAttachment[] | null,
          createdAt: now,
          updatedAt: now,
        })
        // Note that a queue repeated under its key keeps the message queued first, in its place.
        .onConflictDoNothing({ target: [queuedMessage.agentId, queuedMessage.clientKey] }),
    ),
});

const updateText = SqlSchema.findAll({
  Request: Schema.Struct({
    agentId: Schema.String,
    messageId: Schema.String,
    text: Schema.String,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ agentId, messageId, text, now }) =>
    Database.use((db) =>
      db
        .update(queuedMessage)
        .set({ text, heldUntil: null, updatedAt: now })
        .where(and(eq(queuedMessage.agentId, agentId), eq(queuedMessage.id, messageId)))
        .returning({ id: queuedMessage.id }),
    ),
});

const updateHold = SqlSchema.findAll({
  Request: Schema.Struct({
    agentId: Schema.String,
    messageId: Schema.String,
    heldUntil: Schema.NullOr(Schema.Date),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ agentId, messageId, heldUntil, now }) =>
    Database.use((db) =>
      db
        .update(queuedMessage)
        .set({ heldUntil, updatedAt: now })
        .where(and(eq(queuedMessage.agentId, agentId), eq(queuedMessage.id, messageId)))
        .returning({ id: queuedMessage.id }),
    ),
});

const updatePosition = SqlSchema.void({
  Request: Schema.Struct({
    agentId: Schema.String,
    messageId: Schema.String,
    position: Schema.Number,
    now: Schema.Date,
  }),
  execute: ({ agentId, messageId, position, now }) =>
    Database.use((db) =>
      db
        .update(queuedMessage)
        .set({ position, updatedAt: now })
        .where(
          and(
            eq(queuedMessage.agentId, agentId),
            eq(queuedMessage.id, messageId),
            sql`${queuedMessage.position} is distinct from ${position}`,
          ),
        ),
    ),
});

const deleteMessage = SqlSchema.findAll({
  Request: Schema.Struct({ agentId: Schema.String, messageId: Schema.String }),
  Result: QueuedRowSchema,
  execute: ({ agentId, messageId }) =>
    Database.use((db) =>
      db
        .delete(queuedMessage)
        .where(and(eq(queuedMessage.agentId, agentId), eq(queuedMessage.id, messageId)))
        .returning({
          id: queuedMessage.id,
          userId: queuedMessage.userId,
          clientKey: queuedMessage.clientKey,
          text: queuedMessage.text,
          attachments: queuedMessage.attachments,
          heldUntil: queuedMessage.heldUntil,
        }),
    ),
});

/** The pause dropped where no message stands queued any more, so an empty queue stands unpaused. */
const deletePauseIfEmpty = SqlSchema.void({
  Request: Schema.Struct({ agentId: Schema.String }),
  execute: ({ agentId }) =>
    Database.use((db) =>
      db
        .delete(agentQueuePause)
        .where(
          and(
            eq(agentQueuePause.agentId, agentId),
            sql`not ${exists(
              db
                .select({ id: queuedMessage.id })
                .from(queuedMessage)
                .where(eq(queuedMessage.agentId, agentId)),
            )}`,
          ),
        ),
    ),
});

const deletePause = SqlSchema.findAll({
  Request: Schema.Struct({ agentId: Schema.String }),
  Result: Schema.Struct({ agentId: Schema.String }),
  execute: ({ agentId }) =>
    Database.use((db) =>
      db
        .delete(agentQueuePause)
        .where(eq(agentQueuePause.agentId, agentId))
        .returning({ agentId: agentQueuePause.agentId }),
    ),
});

/** The pause written over the queue's messages, where any stand; a queue already paused keeps the reason it paused for first. */
const insertPause = SqlSchema.void({
  Request: Schema.Struct({
    agentId: Schema.String,
    because: Schema.Literals(PAUSES),
    refusal: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  execute: ({ agentId, because, refusal, now }) =>
    Database.use((db) =>
      db
        .insert(agentQueuePause)
        .select((qb) =>
          qb
            .select({
              agentId: sql<string>`${agentId}::uuid`.as("agent_id"),
              because: sql<QueuePause>`${because}::text`.as("because"),
              refusal: sql<HostedApiError | null>`${refusal}::text`.as("refusal"),
              pausedAt: sql<Date>`${now}::timestamptz`.as("paused_at"),
            })
            .from(queuedMessage)
            .where(eq(queuedMessage.agentId, agentId))
            .limit(1),
        )
        .onConflictDoNothing({ target: agentQueuePause.agentId }),
    ),
});

/** Whether the account reaches the agent, which every member's read and write of its queue asks first. */
function reaches(userId: string, agentId: string): AgentQueueEffect<boolean> {
  return Effect.map(findReached({ userId, agentId }), (rows) => rows.length > 0);
}

/** The agent's queue as it stands, its messages in order and its pause, for a caller that already asked whether the reader reaches the agent. */
export function agentQueueNow(agentId: string): AgentQueueEffect<AgentQueueRead> {
  return Effect.gen(function* () {
    const rows = yield* findMessages({ agentId });
    const [pause] = yield* findPause({ agentId });
    return {
      messages: rows.map(messageOf),
      paused:
        pause === undefined
          ? undefined
          : {
              because: pause.because,
              // SAFETY: the column is written only from a hosted refusal's word for itself.
              refusal: (pause.refusal ?? undefined) as HostedApiError | undefined,
            },
    };
  });
}

/** Runs `body` in a transaction holding the agent's queue lock, so a place drawn or a new order is the agent's alone until it commits. */
function underQueueLock<A>(agentId: string, body: AgentQueueEffect<A>): AgentQueueEffect<A> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.andThen(client`select pg_advisory_xact_lock(hashtextextended(${agentId}, 7))`, body),
    ),
  );
}

/** The account's agent's queue, or none where the account does not reach the agent. */
export function readAgentQueue(
  userId: string,
  agentId: string,
): AgentQueueEffect<Option.Option<AgentQueueRead>> {
  return Effect.gen(function* () {
    if (!(yield* reaches(userId, agentId))) return Option.none();
    return Option.some(yield* agentQueueNow(agentId));
  });
}

/**
 * Queues one message at the end of the agent's queue, as the account's; a
 * queue repeated under its key keeps the message it queued first. Answers
 * whether it is queued or the queue was full, or none where the account does
 * not reach the agent.
 */
export function queueAgentMessage(
  userId: string,
  agentId: string,
  message: {
    readonly clientKey: string;
    readonly text: string;
    readonly attachments?: readonly CodingAgentAttachment[] | undefined;
  },
): AgentQueueEffect<Option.Option<QueueOutcome>> {
  return underQueueLock(
    agentId,
    Effect.gen(function* () {
      if (!(yield* reaches(userId, agentId))) return Option.none();
      const [tail] = yield* findTail({ agentId });
      if ((tail?.size ?? 0) >= AGENT_QUEUE_BOUNDS.MAX_MESSAGES) {
        return Option.some(QUEUE_OUTCOME.FULL);
      }
      yield* insertMessage({
        agentId,
        userId,
        position: (tail?.last ?? -1) + 1,
        clientKey: message.clientKey,
        text: message.text,
        attachments:
          message.attachments === undefined || message.attachments.length === 0
            ? null
            : message.attachments,
        now: yield* DateTime.nowAsDate,
      });
      return Option.some(QUEUE_OUTCOME.QUEUED);
    }),
  );
}

/** A queued message's words written again in its place; answers whether it stood queued, or none where the account does not reach the agent. */
export function editQueuedMessage(
  userId: string,
  agentId: string,
  messageId: string,
  text: string,
): AgentQueueEffect<Option.Option<boolean>> {
  return Effect.gen(function* () {
    if (!(yield* reaches(userId, agentId))) return Option.none();
    const now = yield* DateTime.nowAsDate;
    const updated = yield* updateText({ agentId, messageId, text, now });
    return Option.some(updated.length > 0);
  });
}

/**
 * A queued message held out of the hand-off while a member edits it, or let
 * go of, its edit cancelled. Note that a hold left standing, an edit in a
 * window closed meanwhile, lapses once it has stood as long as a sent line
 * reads as awaiting its turn (`LINE_GRACE_MILLIS`), since nobody's edit
 * stays open past it. Answers whether it stood queued, or none where the
 * account does not reach the agent.
 */
export function holdQueuedMessage(
  userId: string,
  agentId: string,
  messageId: string,
  held: boolean,
): AgentQueueEffect<Option.Option<boolean>> {
  return Effect.gen(function* () {
    if (!(yield* reaches(userId, agentId))) return Option.none();
    const now = yield* DateTime.nowAsDate;
    const heldUntil = held ? new Date(now.getTime() + LINE_GRACE_MILLIS) : null;
    const updated = yield* updateHold({ agentId, messageId, heldUntil, now });
    return Option.some(updated.length > 0);
  });
}

/**
 * A queued message taken out of the queue, deleted or steered into the
 * running turn, the pause going with the last; answers the message where it
 * stood queued, or none where the account does not reach the agent.
 */
export function takeQueuedMessage(
  userId: string,
  agentId: string,
  messageId: string,
): AgentQueueEffect<Option.Option<Option.Option<QueuedMessageRow>>> {
  return underQueueLock(
    agentId,
    Effect.gen(function* () {
      if (!(yield* reaches(userId, agentId))) return Option.none();
      const [taken] = yield* deleteMessage({ agentId, messageId });
      yield* deletePauseIfEmpty({ agentId });
      return Option.some(Option.map(Option.fromNullishOr(taken), messageOf));
    }),
  );
}

/**
 * The queue put in a new order: `order` names every message it holds, each
 * once. Answers whether it did, false where `order` names other messages
 * than the queue holds now, or none where the account does not reach the agent.
 */
export function reorderAgentQueue(
  userId: string,
  agentId: string,
  order: readonly string[],
): AgentQueueEffect<Option.Option<boolean>> {
  return underQueueLock(
    agentId,
    Effect.gen(function* () {
      if (!(yield* reaches(userId, agentId))) return Option.none();
      const standing = new Set((yield* findMessages({ agentId })).map((row) => row.id));
      const named = new Set(order);
      const same =
        named.size === order.length &&
        named.size === standing.size &&
        order.every((id) => standing.has(id));
      if (!same) return Option.some(false);
      const now = yield* DateTime.nowAsDate;
      for (const [position, messageId] of order.entries()) {
        yield* updatePosition({ agentId, messageId, position, now });
      }
      return Option.some(true);
    }),
  );
}

/** The queue resumed: its pause dropped. Answers whether it stood paused, or none where the account does not reach the agent. */
export function resumeAgentQueue(
  userId: string,
  agentId: string,
): AgentQueueEffect<Option.Option<boolean>> {
  return Effect.gen(function* () {
    if (!(yield* reaches(userId, agentId))) return Option.none();
    return Option.some((yield* deletePause({ agentId })).length > 0);
  });
}

/**
 * The agent's queue paused for `because` where it holds a message, naming
 * the refusal for a hand-off refused; a queue already paused keeps the reason
 * it paused for first, and an empty queue is not paused.
 */
export function pauseAgentQueue(
  agentId: string,
  because: QueuePause,
  refusal?: HostedApiError,
): AgentQueueEffect<void> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    yield* insertPause({ agentId, because, refusal: refusal ?? null, now });
  });
}

/**
 * The message the agent's queue hands on next: its first that no edit holds,
 * where it stands unpaused. Note that a message being edited is passed over
 * rather than holding the queue, and keeps its place for once its edit ends.
 */
export function queueHead(agentId: string): AgentQueueEffect<Option.Option<QueuedMessageRow>> {
  return Effect.gen(function* () {
    const queue = yield* agentQueueNow(agentId);
    if (queue.paused !== undefined) return Option.none();
    const now = yield* DateTime.nowAsDate;
    return Option.fromNullishOr(queue.messages.find((message) => !heldAt(message, now)));
  });
}

/** Whether an edit holds the message out of the hand-off at `now`. */
export function heldAt(message: QueuedMessageRow, now: Date): boolean {
  return message.heldUntil !== undefined && message.heldUntil.getTime() > now.getTime();
}

const findUnpausedQueues = SqlSchema.findAll({
  Request: Schema.Struct({ limit: Schema.Number }),
  Result: Schema.Struct({ agentId: Schema.String, userId: Schema.String }),
  execute: ({ limit }) =>
    Database.use((db) =>
      db
        .selectDistinct({ agentId: queuedMessage.agentId, userId: codingAgent.userId })
        .from(queuedMessage)
        .innerJoin(codingAgent, eq(codingAgent.id, queuedMessage.agentId))
        .where(
          sql`not ${exists(
            db
              .select({ agentId: agentQueuePause.agentId })
              .from(agentQueuePause)
              .where(eq(agentQueuePause.agentId, queuedMessage.agentId)),
          )}`,
        )
        .limit(limit),
    ),
});

/**
 * The agents whose queue holds messages and stands unpaused, by each agent
 * and its starter, at most `limit`: the queues a sweep hands on where their
 * agent idles, such as one whose only message an edit held past its turn's
 * end until the hold lapsed.
 */
export function unpausedQueues(
  limit: number,
): AgentQueueEffect<readonly { readonly agentId: string; readonly userId: string }[]> {
  return findUnpausedQueues({ limit });
}

/** A message handed on, taken out of the agent's queue, the pause going with the last; nothing where it stood queued no longer. */
export function dropQueuedMessage(agentId: string, messageId: string): AgentQueueEffect<void> {
  return underQueueLock(
    agentId,
    Effect.andThen(deleteMessage({ agentId, messageId }), deletePauseIfEmpty({ agentId })),
  );
}
