/**
 * agent-queue-store.ts -- a coding agent's queue: the messages members queued behind its running turn, read, written, put in order, and handed on one at a time, and whether it stands paused.
 *
 * What a member reads or writes of the queue is gated by whether they reach
 * the agent (`agentReachableBy`), so no account lists, queues on, edits, puts
 * in order, or resumes another's queue it could not message. What the
 * service does at the agent's turn's end (`claimQueueHead`,
 * `dropQueuedMessage`, `releaseQueuedMessage`, `pauseAgentQueue`) acts for
 * the agent and names no member. A message the hand-off claimed to send is
 * the hand-off's alone: no member's edit, hold, delete, steer, or new order
 * reaches it, and no window lists it, since its line is on its way into the
 * transcript.
 *
 * A queued message is in one of three states, and then gone:
 *
 *   QUEUED   waiting its turn: `held_until` and `claimed_at` null or lapsed.
 *   HELD     a member is editing it: `held_until` in the future. The
 *            hand-off passes over it; it keeps its place.
 *   CLAIMED  the hand-off or a member's steer is sending it: `claimed_at`
 *            within the line grace. No window lists it.
 *   (gone)   the row deleted: sent, steered, or deleted.
 *
 * The transitions, and nothing else:
 *
 *   (none)  -> QUEUED   queueAgentMessage (a repeat under its key is a no-op)
 *   QUEUED  -> HELD     holdQueuedMessage(held)
 *   HELD    -> QUEUED   holdQueuedMessage(let go), editQueuedMessage (the
 *                       edit saved), or the hold lapsing
 *   QUEUED  -> QUEUED   editQueuedMessage, reorderAgentQueue
 *   QUEUED  -> CLAIMED  claimQueueHead (the hand-off: the first unheld, where
 *                       the queue is unpaused and nothing else stands claimed)
 *   QUEUED | HELD -> CLAIMED  claimQueuedMessage (a member's steer, with the
 *                       edit's words where it steers an edit)
 *   CLAIMED -> (gone)   dropQueuedMessage, once its send answered
 *   CLAIMED -> QUEUED   releaseQueuedMessage (its send refused), or the
 *                       claim lapsing (its send cut off; sent again under
 *                       its key, which answers REPEATED where it went)
 *   QUEUED | HELD -> (gone)  takeQueuedMessage (a member's delete)
 *
 * A member's change to a CLAIMED message finds no message and changes
 * nothing, which the route answers as not found: it has left the queue.
 *
 * Every write holds the agent's queue lock until it commits, so two changes
 * at once land one after the other, and each that changed anything moves
 * the queue's revision on in the same transaction (`agent_queue_revision`),
 * which wakes every live read of the queue and tells a window that a change
 * it made has landed once a read stands at the revision its answer named. A
 * queue standing empty stands unpaused: a pause is written only over
 * messages, and the last message going takes it with it, so a Stop with
 * nothing queued holds back nothing queued later.
 */

import type { HostedApiError } from "@luke/features";
import { AGENT_QUEUE_BOUNDS, QUEUE_PAUSE, type QueuePause } from "@luke/features/agent-queue-wire";
import { LINE_GRACE_MILLIS } from "@luke/features/coding-agent-status";
import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import { TURN_STATUS } from "@luke/wire";
import { and, asc, count, eq, exists, inArray, isNull, lte, max, or, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentQueuePause, agentQueueRevision, queuedMessage } from "../schemas/agent-queue.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { turns } from "../schemas/storage.js";
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
  claimedAt: Schema.NullOr(Schema.Date),
});

/** One queued message: its words and files, the member who queued it, the key it goes under, until when an edit holds it out of the hand-off, and when the hand-off claimed it to send. */
export interface QueuedMessageRow {
  readonly id: string;
  readonly userId: string;
  readonly clientKey: string;
  readonly text: string;
  readonly attachments: readonly CodingAgentAttachment[];
  readonly heldUntil: Date | undefined;
  readonly claimedAt: Date | undefined;
}

/** Why a queue stands paused, and what refused a hand-off where one did. */
export interface QueuePauseRow {
  readonly because: QueuePause;
  readonly refusal: HostedApiError | undefined;
}

/** An agent's queue: its messages in the order they go, its pause where it stands paused, and its revision, 0 before its first change. */
export interface AgentQueueRead {
  readonly messages: readonly QueuedMessageRow[];
  readonly paused: QueuePauseRow | undefined;
  readonly revision: number;
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
  return {
    ...row,
    attachments,
    heldUntil: row.heldUntil ?? undefined,
    claimedAt: row.claimedAt ?? undefined,
  };
}

/** The rows no send stands claimed on at `now`: never claimed, or claimed by a send cut off a line's grace ago. */
function unclaimedAt(now: Date) {
  return or(
    isNull(queuedMessage.claimedAt),
    lte(queuedMessage.claimedAt, new Date(now.getTime() - LINE_GRACE_MILLIS)),
  );
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
          claimedAt: queuedMessage.claimedAt,
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

const insertMessage = SqlSchema.findAll({
  Request: Schema.Struct({
    agentId: Schema.String,
    userId: Schema.String,
    position: Schema.Number,
    clientKey: Schema.String,
    text: Schema.String,
    attachments: Schema.NullOr(Schema.Array(Schema.Unknown)),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
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
        .onConflictDoNothing({ target: [queuedMessage.agentId, queuedMessage.clientKey] })
        .returning({ id: queuedMessage.id }),
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
        .where(
          and(
            eq(queuedMessage.agentId, agentId),
            eq(queuedMessage.id, messageId),
            unclaimedAt(now),
          ),
        )
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
        .where(
          and(
            eq(queuedMessage.agentId, agentId),
            eq(queuedMessage.id, messageId),
            unclaimedAt(now),
          ),
        )
        .returning({ id: queuedMessage.id }),
    ),
});

/**
 * A message claimed to send at `now`, its hold let go and its words those
 * given where an edit's are, where no send stands claimed on it already;
 * answers it as claimed.
 */
const updateClaim = SqlSchema.findAll({
  Request: Schema.Struct({
    agentId: Schema.String,
    messageId: Schema.String,
    text: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  Result: QueuedRowSchema,
  execute: ({ agentId, messageId, text, now }) =>
    Database.use((db) =>
      db
        .update(queuedMessage)
        .set({
          claimedAt: now,
          heldUntil: null,
          updatedAt: now,
          ...(text === null ? undefined : { text }),
        })
        .where(
          and(
            eq(queuedMessage.agentId, agentId),
            eq(queuedMessage.id, messageId),
            unclaimedAt(now),
          ),
        )
        .returning({
          id: queuedMessage.id,
          userId: queuedMessage.userId,
          clientKey: queuedMessage.clientKey,
          text: queuedMessage.text,
          attachments: queuedMessage.attachments,
          heldUntil: queuedMessage.heldUntil,
          claimedAt: queuedMessage.claimedAt,
        }),
    ),
});

/** A claimed message let go of, its send refused, so it stands queued in its place again; answers it where it stood claimed. */
const updateRelease = SqlSchema.findAll({
  Request: Schema.Struct({ agentId: Schema.String, messageId: Schema.String, now: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ agentId, messageId, now }) =>
    Database.use((db) =>
      db
        .update(queuedMessage)
        .set({ claimedAt: null, updatedAt: now })
        .where(
          and(
            eq(queuedMessage.agentId, agentId),
            eq(queuedMessage.id, messageId),
            sql`${queuedMessage.claimedAt} is not null`,
          ),
        )
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

/** A message deleted; where `unclaimedAt` names a time, only one no send stood claimed on then, as a member's delete or steer takes. */
const deleteMessage = SqlSchema.findAll({
  Request: Schema.Struct({
    agentId: Schema.String,
    messageId: Schema.String,
    unclaimedAt: Schema.NullOr(Schema.Date),
  }),
  Result: QueuedRowSchema,
  execute: ({ agentId, messageId, unclaimedAt: now }) =>
    Database.use((db) =>
      db
        .delete(queuedMessage)
        .where(
          and(
            eq(queuedMessage.agentId, agentId),
            eq(queuedMessage.id, messageId),
            now === null ? undefined : unclaimedAt(now),
          ),
        )
        .returning({
          id: queuedMessage.id,
          userId: queuedMessage.userId,
          clientKey: queuedMessage.clientKey,
          text: queuedMessage.text,
          attachments: queuedMessage.attachments,
          heldUntil: queuedMessage.heldUntil,
          claimedAt: queuedMessage.claimedAt,
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
const insertPause = SqlSchema.findAll({
  Request: Schema.Struct({
    agentId: Schema.String,
    because: Schema.Literals(PAUSES),
    refusal: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ agentId: Schema.String }),
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
        .onConflictDoNothing({ target: agentQueuePause.agentId })
        .returning({ agentId: agentQueuePause.agentId }),
    ),
});

/** The queue's revision moved on by one, answering the revision it moved to. */
const bumpRevision = SqlSchema.findAll({
  Request: Schema.Struct({ agentId: Schema.String }),
  Result: Schema.Struct({ revision: Schema.Number }),
  execute: ({ agentId }) =>
    Database.use((db) =>
      db
        .insert(agentQueueRevision)
        .values({ agentId, revision: 1 })
        .onConflictDoUpdate({
          target: agentQueueRevision.agentId,
          set: { revision: sql`${agentQueueRevision.revision} + 1` },
        })
        .returning({ revision: agentQueueRevision.revision }),
    ),
});

const findRevision = SqlSchema.findAll({
  Request: Schema.Struct({ agentId: Schema.String }),
  Result: Schema.Struct({ revision: Schema.Number }),
  execute: ({ agentId }) =>
    Database.use((db) =>
      db
        .select({ revision: agentQueueRevision.revision })
        .from(agentQueueRevision)
        .where(eq(agentQueueRevision.agentId, agentId)),
    ),
});

/** Whether the account reaches the agent, which every member's read and write of its queue asks first. */
function reaches(userId: string, agentId: string): AgentQueueEffect<boolean> {
  return Effect.map(findReached({ userId, agentId }), (rows) => rows.length > 0);
}

/** The agent's queue as it stands, its messages in order, its pause, and its revision, for a caller that already asked whether the reader reaches the agent. */
export function agentQueueNow(agentId: string): AgentQueueEffect<AgentQueueRead> {
  return Effect.gen(function* () {
    const rows = yield* findMessages({ agentId });
    const [pause] = yield* findPause({ agentId });
    const [revision] = yield* findRevision({ agentId });
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
      revision: revision?.revision ?? 0,
    };
  });
}

/**
 * Runs `body` in a transaction holding the agent's queue lock, moving the
 * queue's revision on where `body` says it changed anything, so every write
 * lands one after another and every change wakes the queue's readers.
 */
function underQueueLock<A>(
  agentId: string,
  body: AgentQueueEffect<A>,
  changed: (answer: A) => boolean,
): AgentQueueEffect<A> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* client`select pg_advisory_xact_lock(hashtextextended(${agentId}, 7))`;
        const answer = yield* body;
        if (changed(answer)) yield* bumpRevision({ agentId });
        return answer;
      }),
    ),
  );
}

/** Whether a member's change, answered as some of whether it changed anything, did. */
const changedSome = (answer: Option.Option<boolean>) => Option.getOrElse(answer, () => false);

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
 * Queues one message at the end of the agent's queue, as the account's
 * (none -> QUEUED); a queue repeated under its key keeps the message it
 * queued first. Answers whether it is queued or the queue was full, or none
 * where the account does not reach the agent.
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
  let inserted = false;
  return underQueueLock(
    agentId,
    Effect.gen(function* () {
      if (!(yield* reaches(userId, agentId))) return Option.none();
      const [tail] = yield* findTail({ agentId });
      if ((tail?.size ?? 0) >= AGENT_QUEUE_BOUNDS.MAX_MESSAGES) {
        return Option.some(QUEUE_OUTCOME.FULL);
      }
      const rows = yield* insertMessage({
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
      inserted = rows.length > 0;
      return Option.some(QUEUE_OUTCOME.QUEUED);
    }),
    () => inserted,
  );
}

/**
 * A queued or held message's words written again in its place, its hold let
 * go (HELD -> QUEUED); answers whether it stood queued and unclaimed, or none
 * where the account does not reach the agent.
 */
export function editQueuedMessage(
  userId: string,
  agentId: string,
  messageId: string,
  text: string,
): AgentQueueEffect<Option.Option<boolean>> {
  return underQueueLock(
    agentId,
    Effect.gen(function* () {
      if (!(yield* reaches(userId, agentId))) return Option.none();
      const now = yield* DateTime.nowAsDate;
      const updated = yield* updateText({ agentId, messageId, text, now });
      return Option.some(updated.length > 0);
    }),
    changedSome,
  );
}

/**
 * A queued message held out of the hand-off while a member edits it
 * (QUEUED -> HELD), or let go of, its edit cancelled (HELD -> QUEUED). Note
 * that a hold left standing, an edit in a window closed meanwhile, lapses
 * once it has stood as long as a sent line reads as awaiting its turn
 * (`LINE_GRACE_MILLIS`), since nobody's edit stays open past it. Answers
 * whether it stood queued and unclaimed, or none where the account does not
 * reach the agent.
 */
export function holdQueuedMessage(
  userId: string,
  agentId: string,
  messageId: string,
  held: boolean,
): AgentQueueEffect<Option.Option<boolean>> {
  return underQueueLock(
    agentId,
    Effect.gen(function* () {
      if (!(yield* reaches(userId, agentId))) return Option.none();
      const now = yield* DateTime.nowAsDate;
      const heldUntil = held ? new Date(now.getTime() + LINE_GRACE_MILLIS) : null;
      const updated = yield* updateHold({ agentId, messageId, heldUntil, now });
      return Option.some(updated.length > 0);
    }),
    changedSome,
  );
}

/**
 * A queued or held message deleted by a member (-> gone), the pause going
 * with the last; answers the message where it stood unclaimed, or none
 * where the account does not reach the agent.
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
      const now = yield* DateTime.nowAsDate;
      const [taken] = yield* deleteMessage({ agentId, messageId, unclaimedAt: now });
      yield* deletePauseIfEmpty({ agentId });
      return Option.some(Option.map(Option.fromNullishOr(taken), messageOf));
    }),
    (answer) => Option.isSome(Option.flatten(answer)),
  );
}

/**
 * A queued or held message claimed by a member to steer it now (QUEUED |
 * HELD -> CLAIMED), its words the edit's where `text` is given, so an edit
 * steered goes as one message with its new words. Answers the message as
 * claimed where it stood unclaimed, or none where the account does not
 * reach the agent; once sent it is dropped, or released where its send was
 * refused.
 */
export function claimQueuedMessage(
  userId: string,
  agentId: string,
  messageId: string,
  text?: string,
): AgentQueueEffect<Option.Option<Option.Option<QueuedMessageRow>>> {
  return underQueueLock(
    agentId,
    Effect.gen(function* () {
      if (!(yield* reaches(userId, agentId))) return Option.none();
      const now = yield* DateTime.nowAsDate;
      const [claimed] = yield* updateClaim({ agentId, messageId, text: text ?? null, now });
      return Option.some(Option.map(Option.fromNullishOr(claimed), messageOf));
    }),
    (answer) => Option.isSome(Option.flatten(answer)),
  );
}

/**
 * The queue put in a new order: `order` names every message it lists, each
 * once, which is every one but a message being sent. Answers whether it
 * did, false where `order` names other messages than the queue lists now,
 * or none where the account does not reach the agent.
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
      const now = yield* DateTime.nowAsDate;
      // Note that a message claimed to send is in no member's order, as no window lists it.
      const rows = (yield* findMessages({ agentId })).map(messageOf);
      const standing = new Set(rows.filter((row) => !claimedAt(row, now)).map((row) => row.id));
      const named = new Set(order);
      const same =
        named.size === order.length &&
        named.size === standing.size &&
        order.every((id) => standing.has(id));
      if (!same) return Option.some(false);
      for (const [position, messageId] of order.entries()) {
        yield* updatePosition({ agentId, messageId, position, now });
      }
      return Option.some(true);
    }),
    changedSome,
  );
}

/** The queue resumed: its pause dropped. Answers whether it stood paused, or none where the account does not reach the agent. */
export function resumeAgentQueue(
  userId: string,
  agentId: string,
): AgentQueueEffect<Option.Option<boolean>> {
  return underQueueLock(
    agentId,
    Effect.gen(function* () {
      if (!(yield* reaches(userId, agentId))) return Option.none();
      return Option.some((yield* deletePause({ agentId })).length > 0);
    }),
    changedSome,
  );
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
  return Effect.asVoid(
    underQueueLock(
      agentId,
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        const paused = yield* insertPause({ agentId, because, refusal: refusal ?? null, now });
        return paused.length > 0;
      }),
      (paused) => paused,
    ),
  );
}

/**
 * The message the agent's queue hands on next, claimed to send (QUEUED ->
 * CLAIMED): its first that no edit holds, where it stands unpaused and no
 * send stands claimed on any of it, so one message goes at a time. Note that
 * a message being edited is passed over rather than holding the queue, and
 * keeps its place for once its edit ends.
 */
export function claimQueueHead(agentId: string): AgentQueueEffect<Option.Option<QueuedMessageRow>> {
  return underQueueLock(
    agentId,
    Effect.gen(function* () {
      const queue = yield* agentQueueNow(agentId);
      const now = yield* DateTime.nowAsDate;
      if (queue.paused !== undefined) return Option.none();
      if (queue.messages.some((message) => claimedAt(message, now))) return Option.none();
      const head = queue.messages.find((message) => !heldAt(message, now));
      if (head === undefined) return Option.none();
      const [claimed] = yield* updateClaim({ agentId, messageId: head.id, text: null, now });
      return Option.map(Option.fromNullishOr(claimed), messageOf);
    }),
    Option.isSome,
  );
}

/** A claimed message let go of, its send refused, so it stands queued in its place again (CLAIMED -> QUEUED). */
export function releaseQueuedMessage(agentId: string, messageId: string): AgentQueueEffect<void> {
  return Effect.asVoid(
    underQueueLock(
      agentId,
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        return (yield* updateRelease({ agentId, messageId, now })).length > 0;
      }),
      (released) => released,
    ),
  );
}

/** Whether an edit holds the message out of the hand-off at `now`. */
export function heldAt(message: QueuedMessageRow, now: Date): boolean {
  return message.heldUntil !== undefined && message.heldUntil.getTime() > now.getTime();
}

/** Whether a send stands claimed on the message at `now`, one cut off lapsing as a hold does. */
export function claimedAt(message: QueuedMessageRow, now: Date): boolean {
  return (
    message.claimedAt !== undefined &&
    message.claimedAt.getTime() > now.getTime() - LINE_GRACE_MILLIS
  );
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
          and(
            sql`not ${exists(
              db
                .select({ agentId: agentQueuePause.agentId })
                .from(agentQueuePause)
                .where(eq(agentQueuePause.agentId, queuedMessage.agentId)),
            )}`,
            // Note that an agent at work is left out before the bound, so busy queues never crowd out an idle one.
            sql`not ${exists(
              db
                .select({ id: turns.id })
                .from(turns)
                .where(
                  and(
                    eq(turns.conversationId, codingAgent.conversationId),
                    inArray(turns.status, [TURN_STATUS.QUEUED, TURN_STATUS.RUNNING]),
                  ),
                ),
            )}`,
          ),
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

/** A claimed message sent, taken out of the agent's queue (CLAIMED -> gone), the pause going with the last; nothing where it stood queued no longer. */
export function dropQueuedMessage(agentId: string, messageId: string): AgentQueueEffect<void> {
  return Effect.asVoid(
    underQueueLock(
      agentId,
      Effect.gen(function* () {
        const dropped = yield* deleteMessage({ agentId, messageId, unclaimedAt: null });
        yield* deletePauseIfEmpty({ agentId });
        return dropped.length > 0;
      }),
      (dropped) => dropped,
    ),
  );
}
