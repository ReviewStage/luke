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
 *   QUEUED   waiting its turn: not `editing`, `claimed_at` null or lapsed.
 *   EDITING  a member is editing it: `editing`, with no time to it. The
 *            hand-off stops at it, sending what stands ahead of it and
 *            nothing past it, until the mark is cleared.
 *   CLAIMED  the hand-off or a member's steer is sending it: `claimed_at`
 *            within the line grace. No window lists it.
 *   (gone)   the row deleted: sent, steered, or deleted.
 *
 * The transitions, and nothing else:
 *
 *   (none)  -> QUEUED   queueAgentMessage, under the id its window minted (a
 *                       repeat under the id is a no-op)
 *   QUEUED  -> EDITING  holdQueuedMessage(held)
 *   EDITING -> QUEUED   holdQueuedMessage(let go: the edit cancelled), or
 *                       editQueuedMessage (the edit saved)
 *   QUEUED  -> QUEUED   editQueuedMessage, reorderAgentQueue
 *   QUEUED  -> CLAIMED  claimQueueHead (the hand-off: the head, where it is
 *                       not being edited, the queue unpaused, and nothing
 *                       else stands claimed)
 *   QUEUED | EDITING -> CLAIMED  claimQueuedMessage (a member's steer, with
 *                       the edit's words and files where it steers an edit)
 *   CLAIMED -> (gone)   dropQueuedMessage, once its send answered
 *   CLAIMED -> QUEUED   releaseQueuedMessage (its send refused), or the
 *                       claim lapsing (its send cut off; sent again under
 *                       its id, which answers REPEATED where it went)
 *   QUEUED | EDITING -> (gone)  takeQueuedMessage (a member's delete)
 *
 * A member's change to a CLAIMED message finds no message and changes
 * nothing, which the route answers as not found: it has left the queue. A
 * mark left standing, a window closed mid-edit, holds the queue until any
 * of the member's windows cancels it from the row.
 *
 * Every write holds the agent's queue lock until it commits, so two changes
 * at once land one after the other, and each that changed anything moves
 * the queue's revision on in the same transaction (`agent_queue.revision`),
 * which wakes every live read of the queue and tells a window that a change
 * it made has landed once a read stands at the revision its answer named. A
 * queue standing empty stands unpaused: a pause is written only over
 * messages, and the last message going takes it with it, so a Stop with
 * nothing queued holds back nothing queued later.
 */

import { randomUUID } from "node:crypto";
import type { HostedApiError } from "@luke/features";
import { AGENT_QUEUE_BOUNDS, QUEUE_PAUSE, type QueuePause } from "@luke/features/agent-queue-wire";
import { LINE_GRACE_MILLIS } from "@luke/features/agent-status";
import type { AgentAttachment } from "@luke/features/agent-wire";
import { TURN_STATUS } from "@luke/wire";
import {
  and,
  asc,
  count,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lte,
  max,
  or,
  sql,
} from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { agentQueue, queuedMessage } from "../schemas/agent-queue.js";
import { turns } from "../schemas/storage.js";
import { agentReachableBy } from "./workspace-store.js";

type AgentQueueEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** One queued message as its row keeps it. */
const QueuedRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  text: Schema.String,
  attachments: Schema.NullOr(Schema.Array(Schema.Unknown)),
  editing: Schema.Boolean,
  claimedAt: Schema.NullOr(Schema.Date),
});

/** The columns a queued message is read by, as `QueuedRowSchema` decodes them. */
const ROW_COLUMNS = {
  id: queuedMessage.id,
  userId: queuedMessage.userId,
  text: queuedMessage.text,
  attachments: queuedMessage.attachments,
  editing: queuedMessage.editing,
  claimedAt: queuedMessage.claimedAt,
};

/**
 * One file of a queued message: the file as the request carried it, and the
 * id it was minted as it was written, by which a window reads its bytes
 * (`readQueuedFile`). Note that a file an edit saves is minted a new id,
 * so a window that read the file it replaced reads it afresh.
 */
export interface QueuedFile extends AgentAttachment {
  readonly id: string;
}

/** One queued message: its id, which its window minted and it goes under, the member who queued it, its words and files, whether a member is editing it, and when the hand-off claimed it to send. */
export interface QueuedMessageRow {
  readonly id: string;
  readonly userId: string;
  readonly text: string;
  readonly attachments: readonly QueuedFile[];
  readonly editing: boolean;
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

/** What queueing a message answered: queued (or queued already under its id), or refused because the queue is full. */
export const QUEUE_OUTCOME = {
  QUEUED: "queued",
  FULL: "full",
} as const;

export type QueueOutcome = (typeof QUEUE_OUTCOME)[keyof typeof QUEUE_OUTCOME];

const PAUSES: readonly QueuePause[] = Object.values(QUEUE_PAUSE);

/** A row as the store reads it, its files as the request carried them. */
function messageOf(row: typeof QueuedRowSchema.Type): QueuedMessageRow {
  // SAFETY: the column is written only by `filesColumn`, from a queue change's files, which their schema read.
  const attachments = (row.attachments ?? []) as readonly QueuedFile[];
  return {
    ...row,
    attachments,
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
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(and(eq(agentTable.id, agentId), agentReachableBy(userId))),
    ),
});

const findMessages = SqlSchema.findAll({
  Request: Schema.Struct({ agentId: Schema.String }),
  Result: QueuedRowSchema,
  execute: ({ agentId }) =>
    Database.use((db) =>
      db
        .select(ROW_COLUMNS)
        .from(queuedMessage)
        .where(eq(queuedMessage.agentId, agentId))
        .orderBy(asc(queuedMessage.position), asc(queuedMessage.createdAt)),
    ),
});

/** The queue's own row: its revision, and its pause where it stands paused. */
const findQueueRow = SqlSchema.findAll({
  Request: Schema.Struct({ agentId: Schema.String }),
  Result: Schema.Struct({
    revision: Schema.Number,
    pausedBecause: Schema.NullOr(Schema.Literals(PAUSES)),
    pausedRefusal: Schema.NullOr(Schema.String),
  }),
  execute: ({ agentId }) =>
    Database.use((db) =>
      db
        .select({
          revision: agentQueue.revision,
          pausedBecause: agentQueue.pausedBecause,
          pausedRefusal: agentQueue.pausedRefusal,
        })
        .from(agentQueue)
        .where(eq(agentQueue.agentId, agentId)),
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
    id: Schema.String,
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
          attachments: attachments as readonly QueuedFile[] | null,
          createdAt: now,
          updatedAt: now,
        })
        // Note that a queue repeated under its id keeps the message queued first, in its place.
        .onConflictDoNothing({ target: queuedMessage.id })
        .returning({ id: queuedMessage.id }),
    ),
});

/** A message written again as an edit saved it, its words and its files, its hold let go. */
const updateEdit = SqlSchema.findAll({
  Request: Schema.Struct({
    agentId: Schema.String,
    messageId: Schema.String,
    text: Schema.String,
    attachments: Schema.NullOr(Schema.Array(Schema.Unknown)),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ agentId, messageId, text, attachments, now }) =>
    Database.use((db) =>
      db
        .update(queuedMessage)
        .set({
          text,
          // SAFETY: the files are a queue change's, which their schema read.
          attachments: attachments as readonly QueuedFile[] | null,
          editing: false,
          updatedAt: now,
        })
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
    editing: Schema.Boolean,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ agentId, messageId, editing, now }) =>
    Database.use((db) =>
      db
        .update(queuedMessage)
        .set({ editing, updatedAt: now })
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
 * A message claimed to send at `now`, its hold let go and its words and
 * files an edit's where one is given, where no send stands claimed on it
 * already; answers it as claimed.
 */
const updateClaim = SqlSchema.findAll({
  Request: Schema.Struct({
    agentId: Schema.String,
    messageId: Schema.String,
    edit: Schema.NullOr(
      Schema.Struct({
        text: Schema.String,
        attachments: Schema.NullOr(Schema.Array(Schema.Unknown)),
      }),
    ),
    now: Schema.Date,
  }),
  Result: QueuedRowSchema,
  execute: ({ agentId, messageId, edit, now }) =>
    Database.use((db) =>
      db
        .update(queuedMessage)
        .set({
          claimedAt: now,
          editing: false,
          updatedAt: now,
          ...(edit === null
            ? undefined
            : {
                text: edit.text,
                // SAFETY: the files are a queue change's, which their schema read.
                attachments: edit.attachments as readonly QueuedFile[] | null,
              }),
        })
        .where(
          and(
            eq(queuedMessage.agentId, agentId),
            eq(queuedMessage.id, messageId),
            unclaimedAt(now),
          ),
        )
        .returning(ROW_COLUMNS),
    ),
});

/** A claimed message let go of, its send refused, so it stands queued in its place again; answers it where it stood claimed. */
const updateRelease = SqlSchema.findAll({
  Request: Schema.Struct({
    agentId: Schema.String,
    messageId: Schema.String,
    claimedAt: Schema.Date,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ agentId, messageId, claimedAt, now }) =>
    Database.use((db) =>
      db
        .update(queuedMessage)
        .set({ claimedAt: null, updatedAt: now })
        .where(
          and(
            eq(queuedMessage.agentId, agentId),
            eq(queuedMessage.id, messageId),
            // Note that only the claim that sent it is let go of: one taken again since it lapsed is another send's.
            eq(queuedMessage.claimedAt, claimedAt),
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

/**
 * A message deleted: a member's, only where no send stood claimed on it at
 * `unclaimedAt`; a send's, only under the claim it was sent under
 * (`claimedAt`), so a send that outlived its claim deletes nothing another
 * claim now sends.
 */
const deleteMessage = SqlSchema.findAll({
  Request: Schema.Struct({
    agentId: Schema.String,
    messageId: Schema.String,
    unclaimedAt: Schema.NullOr(Schema.Date),
    claimedAt: Schema.NullOr(Schema.Date),
  }),
  Result: QueuedRowSchema,
  execute: ({ agentId, messageId, unclaimedAt: now, claimedAt }) =>
    Database.use((db) =>
      db
        .delete(queuedMessage)
        .where(
          and(
            eq(queuedMessage.agentId, agentId),
            eq(queuedMessage.id, messageId),
            now === null ? undefined : unclaimedAt(now),
            claimedAt === null ? undefined : eq(queuedMessage.claimedAt, claimedAt),
          ),
        )
        .returning(ROW_COLUMNS),
    ),
});

/** The files of the agent's queued message that holds the file `fileId` names. */
const findFileHolder = SqlSchema.findAll({
  Request: Schema.Struct({ agentId: Schema.String, fileId: Schema.String }),
  Result: Schema.Struct({ attachments: Schema.NullOr(Schema.Array(Schema.Unknown)) }),
  execute: ({ agentId, fileId }) =>
    Database.use((db) =>
      db
        .select({ attachments: queuedMessage.attachments })
        .from(queuedMessage)
        .where(
          and(
            eq(queuedMessage.agentId, agentId),
            sql`${queuedMessage.attachments} @> ${JSON.stringify([{ id: fileId }])}::jsonb`,
          ),
        )
        .limit(1),
    ),
});

/** The pause dropped where no message stands queued any more, so an empty queue stands unpaused. */
const deletePauseIfEmpty = SqlSchema.void({
  Request: Schema.Struct({ agentId: Schema.String }),
  execute: ({ agentId }) =>
    Database.use((db) =>
      db
        .update(agentQueue)
        .set({ pausedBecause: null, pausedRefusal: null })
        .where(
          and(
            eq(agentQueue.agentId, agentId),
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

/** The pause dropped, answering it where the queue stood paused. */
const deletePause = SqlSchema.findAll({
  Request: Schema.Struct({ agentId: Schema.String }),
  Result: Schema.Struct({ agentId: Schema.String }),
  execute: ({ agentId }) =>
    Database.use((db) =>
      db
        .update(agentQueue)
        .set({ pausedBecause: null, pausedRefusal: null })
        .where(and(eq(agentQueue.agentId, agentId), isNotNull(agentQueue.pausedBecause)))
        .returning({ agentId: agentQueue.agentId }),
    ),
});

/**
 * The pause written over the queue's messages, where any stand; a queue
 * already paused keeps the reason it paused for first. Note that a queue
 * with messages has its row already, written by the change that queued them.
 */
const insertPause = SqlSchema.findAll({
  Request: Schema.Struct({
    agentId: Schema.String,
    because: Schema.Literals(PAUSES),
    refusal: Schema.NullOr(Schema.String),
  }),
  Result: Schema.Struct({ agentId: Schema.String }),
  execute: ({ agentId, because, refusal }) =>
    Database.use((db) =>
      db
        .update(agentQueue)
        .set({ pausedBecause: because, pausedRefusal: refusal as HostedApiError | null })
        .where(
          and(
            eq(agentQueue.agentId, agentId),
            isNull(agentQueue.pausedBecause),
            exists(
              db
                .select({ id: queuedMessage.id })
                .from(queuedMessage)
                .where(eq(queuedMessage.agentId, agentId)),
            ),
          ),
        )
        .returning({ agentId: agentQueue.agentId }),
    ),
});

/** The queue's revision moved on by one, writing its row on its first change. */
const bumpRevision = SqlSchema.void({
  Request: Schema.Struct({ agentId: Schema.String }),
  execute: ({ agentId }) =>
    Database.use((db) =>
      db
        .insert(agentQueue)
        .values({ agentId, revision: 1 })
        .onConflictDoUpdate({
          target: agentQueue.agentId,
          set: { revision: sql`${agentQueue.revision} + 1` },
        }),
    ),
});

/** Whether the account reaches the agent, which every member's read and write of its queue asks first. */
function reaches(userId: string, agentId: string): AgentQueueEffect<boolean> {
  return Effect.map(findReached({ userId, agentId }), (rows) => rows.length > 0);
}

/**
 * The agent's queue as it stands, its messages in order, its pause, and its
 * revision, for a caller that already asked whether the reader reaches the
 * agent. Note that the revision is read before the messages, so a read
 * never names a revision newer than the messages it lists, which is all a
 * window drawing its own changes over the queue until it stands at their
 * revision asks.
 */
export function agentQueueNow(agentId: string): AgentQueueEffect<AgentQueueRead> {
  return Effect.gen(function* () {
    const [row] = yield* findQueueRow({ agentId });
    const rows = yield* findMessages({ agentId });
    return {
      messages: rows.map(messageOf),
      paused:
        row?.pausedBecause === null || row === undefined
          ? undefined
          : {
              because: row.pausedBecause,
              // SAFETY: the column is written only from a hosted refusal's word for itself.
              refusal: (row.pausedRefusal ?? undefined) as HostedApiError | undefined,
            },
      revision: row?.revision ?? 0,
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

/**
 * One file of a message queued for the agent, by the id it was minted as;
 * none where no message of this agent's queue holds it. For a caller that
 * already settled the reader may read the agent, as a read of its
 * transcript's queue does (`agentQueueNow`).
 */
export function readQueuedFile(
  agentId: string,
  fileId: string,
): AgentQueueEffect<Option.Option<AgentAttachment>> {
  return Effect.map(findFileHolder({ agentId, fileId }), ([holder]) => {
    // SAFETY: the column is written only by `filesColumn`, from a queue change's files, which their schema read.
    const files = (holder?.attachments ?? []) as readonly QueuedFile[];
    const file = files.find((each) => each.id === fileId);
    return file === undefined
      ? Option.none()
      : Option.some({ name: file.name, mediaType: file.mediaType, data: file.data });
  });
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
 * Queues one message at the end of the agent's queue, as the account's,
 * under the id its window minted (none -> QUEUED); a queue repeated under
 * the id keeps the message it queued first. Answers whether it is queued or
 * the queue was full, or none where the account does not reach the agent.
 */
export function queueAgentMessage(
  userId: string,
  agentId: string,
  message: {
    readonly id: string;
    readonly text: string;
    readonly attachments?: readonly AgentAttachment[] | undefined;
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
        id: message.id,
        text: message.text,
        attachments: filesColumn(message.attachments ?? []),
        now: yield* DateTime.nowAsDate,
      });
      inserted = rows.length > 0;
      return Option.some(QUEUE_OUTCOME.QUEUED);
    }),
    () => inserted,
  );
}

/** The files a message keeps as its row writes them, each minted an id: null where it keeps none. */
function filesColumn(attachments: readonly AgentAttachment[]): readonly QueuedFile[] | null {
  return attachments.length === 0
    ? null
    : attachments.map(({ name, mediaType, data }) => ({ name, mediaType, data, id: randomUUID() }));
}

/**
 * A queued or edited message written again in its place as an edit saved it,
 * its words and its files, which replace its own, none where `attachments`
 * names none, its mark cleared (EDITING -> QUEUED); answers whether it stood
 * queued and unclaimed, or none where the account does not reach the agent.
 */
export function editQueuedMessage(
  userId: string,
  agentId: string,
  messageId: string,
  text: string,
  attachments: readonly AgentAttachment[] = [],
): AgentQueueEffect<Option.Option<boolean>> {
  return underQueueLock(
    agentId,
    Effect.gen(function* () {
      if (!(yield* reaches(userId, agentId))) return Option.none();
      const now = yield* DateTime.nowAsDate;
      const updated = yield* updateEdit({
        agentId,
        messageId,
        text,
        attachments: filesColumn(attachments),
        now,
      });
      return Option.some(updated.length > 0);
    }),
    changedSome,
  );
}

/**
 * A queued message marked as a member edits it (QUEUED -> EDITING), which
 * stops the hand-off at it, or its mark cleared, its edit cancelled
 * (EDITING -> QUEUED). Answers whether it stood unclaimed, or none where the
 * account does not reach the agent.
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
      const updated = yield* updateHold({ agentId, messageId, editing: held, now });
      return Option.some(updated.length > 0);
    }),
    changedSome,
  );
}

/**
 * A queued or edited message deleted by a member (-> gone), the pause going
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
      const [taken] = yield* deleteMessage({
        agentId,
        messageId,
        unclaimedAt: now,
        claimedAt: null,
      });
      yield* deletePauseIfEmpty({ agentId });
      return Option.some(Option.map(Option.fromNullishOr(taken), messageOf));
    }),
    (answer) => Option.isSome(Option.flatten(answer)),
  );
}

/**
 * A queued or edited message claimed by a member to steer it now (QUEUED |
 * EDITING -> CLAIMED), its words and files the edit's where one is given, so an
 * edit steered goes as one message as the edit has it. Answers the message
 * as claimed where it stood unclaimed, or none where the account does not
 * reach the agent; once sent it is dropped, or released where its send was
 * refused.
 */
export function claimQueuedMessage(
  userId: string,
  agentId: string,
  messageId: string,
  edit?: { readonly text: string; readonly attachments?: readonly AgentAttachment[] | undefined },
): AgentQueueEffect<Option.Option<Option.Option<QueuedMessageRow>>> {
  return underQueueLock(
    agentId,
    Effect.gen(function* () {
      if (!(yield* reaches(userId, agentId))) return Option.none();
      const now = yield* DateTime.nowAsDate;
      const [claimed] = yield* updateClaim({
        agentId,
        messageId,
        edit:
          edit === undefined
            ? null
            : { text: edit.text, attachments: filesColumn(edit.attachments ?? []) },
        now,
      });
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
      Effect.map(
        insertPause({ agentId, because, refusal: refusal ?? null }),
        (paused) => paused.length > 0,
      ),
      (paused) => paused,
    ),
  );
}

/**
 * The message the agent's queue hands on next, claimed to send (QUEUED ->
 * CLAIMED): its head, where no member is editing it, the queue stands
 * unpaused, and no send stands claimed on any of it, so one message goes at
 * a time, in order.
 */
export function claimQueueHead(agentId: string): AgentQueueEffect<Option.Option<QueuedMessageRow>> {
  return underQueueLock(
    agentId,
    Effect.gen(function* () {
      const queue = yield* agentQueueNow(agentId);
      const now = yield* DateTime.nowAsDate;
      if (queue.paused !== undefined) return Option.none();
      if (queue.messages.some((message) => claimedAt(message, now))) return Option.none();
      // Note that the hand-off stops at a message being edited rather than passing it, so the queue keeps its order.
      const [head] = queue.messages;
      if (head === undefined || head.editing) return Option.none();
      const [claimed] = yield* updateClaim({ agentId, messageId: head.id, edit: null, now });
      return Option.map(Option.fromNullishOr(claimed), messageOf);
    }),
    Option.isSome,
  );
}

/** A claimed message let go of under the claim it was sent under, its send refused, so it stands queued in its place again (CLAIMED -> QUEUED). */
export function releaseQueuedMessage(
  agentId: string,
  message: Pick<QueuedMessageRow, "id" | "claimedAt">,
): AgentQueueEffect<void> {
  return Effect.asVoid(
    underQueueLock(agentId, released(agentId, message), (wasReleased) => wasReleased),
  );
}

/** The release itself, inside a caller's lock, answering whether it let the claim go. */
function released(
  agentId: string,
  message: Pick<QueuedMessageRow, "id" | "claimedAt">,
): AgentQueueEffect<boolean> {
  return Effect.gen(function* () {
    if (message.claimedAt === undefined) return false;
    const now = yield* DateTime.nowAsDate;
    const rows = yield* updateRelease({
      agentId,
      messageId: message.id,
      claimedAt: message.claimedAt,
      now,
    });
    return rows.length > 0;
  });
}

/**
 * A claimed message whose send the service refused: let go of under its
 * claim, and the queue paused under the refusal, in one transaction, so no
 * hand-off claims it again between the two (CLAIMED -> QUEUED, paused).
 */
export function refuseQueuedMessage(
  agentId: string,
  message: Pick<QueuedMessageRow, "id" | "claimedAt">,
  refusal: HostedApiError,
): AgentQueueEffect<void> {
  return Effect.asVoid(
    underQueueLock(
      agentId,
      Effect.gen(function* () {
        const wasReleased = yield* released(agentId, message);
        const paused = yield* insertPause({
          agentId,
          because: QUEUE_PAUSE.REFUSED,
          refusal,
        });
        return wasReleased || paused.length > 0;
      }),
      (changed) => changed,
    ),
  );
}

/** Whether a send stands claimed on the message at `now`, one cut off lapsing after a line's grace. */
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
        .selectDistinct({ agentId: queuedMessage.agentId, userId: agentTable.userId })
        .from(queuedMessage)
        .innerJoin(agentTable, eq(agentTable.id, queuedMessage.agentId))
        .where(
          and(
            sql`not ${exists(
              db
                .select({ agentId: agentQueue.agentId })
                .from(agentQueue)
                .where(
                  and(
                    eq(agentQueue.agentId, queuedMessage.agentId),
                    isNotNull(agentQueue.pausedBecause),
                  ),
                ),
            )}`,
            // Note that an agent at work is left out before the bound, so busy queues never crowd out an idle one.
            sql`not ${exists(
              db
                .select({ id: turns.id })
                .from(turns)
                .where(
                  and(
                    eq(turns.conversationId, agentTable.conversationId),
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

/** A claimed message sent, taken out of the agent's queue under the claim it was sent under (CLAIMED -> gone), the pause going with the last; nothing where that claim stands no longer. */
export function dropQueuedMessage(
  agentId: string,
  message: Pick<QueuedMessageRow, "id" | "claimedAt">,
): AgentQueueEffect<void> {
  return Effect.asVoid(
    underQueueLock(
      agentId,
      Effect.gen(function* () {
        const dropped = yield* deleteMessage({
          agentId,
          messageId: message.id,
          unclaimedAt: null,
          claimedAt: message.claimedAt ?? null,
        });
        yield* deletePauseIfEmpty({ agentId });
        return dropped.length > 0;
      }),
      (dropped) => dropped,
    ),
  );
}
