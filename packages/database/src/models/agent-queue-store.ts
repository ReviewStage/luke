import { randomUUID } from "node:crypto";
import type { HostedApiError } from "@repo/features";
import { AGENT_QUEUE_BOUNDS, QUEUE_PAUSE, type QueuePause } from "@repo/features/agent-queue-wire";
import { LINE_GRACE_MILLIS } from "@repo/features/agent-status";
import type { AgentAttachment } from "@repo/features/agent-wire";
import { TURN_STATUS } from "@repo/wire";
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

const QueuedRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  text: Schema.String,
  attachments: Schema.NullOr(Schema.Array(Schema.Unknown)),
  editing: Schema.Boolean,
  claimedAt: Schema.NullOr(Schema.Date),
});

const ROW_COLUMNS = {
  id: queuedMessage.id,
  userId: queuedMessage.userId,
  text: queuedMessage.text,
  attachments: queuedMessage.attachments,
  editing: queuedMessage.editing,
  claimedAt: queuedMessage.claimedAt,
};

export interface QueuedFile extends AgentAttachment {
  readonly id: string;
}

export interface QueuedMessageRow {
  readonly id: string;
  readonly userId: string;
  readonly text: string;
  readonly attachments: readonly QueuedFile[];
  readonly editing: boolean;
  readonly claimedAt: Date | undefined;
}

export interface QueuePauseRow {
  readonly because: QueuePause;
  readonly refusal: HostedApiError | undefined;
}

export interface AgentQueueRead {
  readonly messages: readonly QueuedMessageRow[];
  readonly paused: QueuePauseRow | undefined;
  readonly revision: number;
}

export const QUEUE_OUTCOME = {
  QUEUED: "queued",
  FULL: "full",
} as const;

export type QueueOutcome = (typeof QUEUE_OUTCOME)[keyof typeof QUEUE_OUTCOME];

const PAUSES: readonly QueuePause[] = Object.values(QUEUE_PAUSE);

function messageOf(row: typeof QueuedRowSchema.Type): QueuedMessageRow {
  const attachments = (row.attachments ?? []) as readonly QueuedFile[];
  return {
    ...row,
    attachments,
    claimedAt: row.claimedAt ?? undefined,
  };
}

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
          attachments: attachments as readonly QueuedFile[] | null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: queuedMessage.id })
        .returning({ id: queuedMessage.id }),
    ),
});

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

function reaches(userId: string, agentId: string): AgentQueueEffect<boolean> {
  return Effect.map(findReached({ userId, agentId }), (rows) => rows.length > 0);
}

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
              refusal: (row.pausedRefusal ?? undefined) as HostedApiError | undefined,
            },
      revision: row?.revision ?? 0,
    };
  });
}

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

const changedSome = (answer: Option.Option<boolean>) => Option.getOrElse(answer, () => false);

export function readQueuedFile(
  agentId: string,
  fileId: string,
): AgentQueueEffect<Option.Option<AgentAttachment>> {
  return Effect.map(findFileHolder({ agentId, fileId }), ([holder]) => {
    const files = (holder?.attachments ?? []) as readonly QueuedFile[];
    const file = files.find((each) => each.id === fileId);
    return file === undefined
      ? Option.none()
      : Option.some({ name: file.name, mediaType: file.mediaType, data: file.data });
  });
}

export function readAgentQueue(
  userId: string,
  agentId: string,
): AgentQueueEffect<Option.Option<AgentQueueRead>> {
  return Effect.gen(function* () {
    if (!(yield* reaches(userId, agentId))) return Option.none();
    return Option.some(yield* agentQueueNow(agentId));
  });
}

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

function filesColumn(attachments: readonly AgentAttachment[]): readonly QueuedFile[] | null {
  return attachments.length === 0
    ? null
    : attachments.map(({ name, mediaType, data }) => ({ name, mediaType, data, id: randomUUID() }));
}

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

export function claimQueueHead(agentId: string): AgentQueueEffect<Option.Option<QueuedMessageRow>> {
  return underQueueLock(
    agentId,
    Effect.gen(function* () {
      const queue = yield* agentQueueNow(agentId);
      const now = yield* DateTime.nowAsDate;
      if (queue.paused !== undefined) return Option.none();
      if (queue.messages.some((message) => claimedAt(message, now))) return Option.none();
      const [head] = queue.messages;
      if (head === undefined || head.editing) return Option.none();
      const [claimed] = yield* updateClaim({ agentId, messageId: head.id, edit: null, now });
      return Option.map(Option.fromNullishOr(claimed), messageOf);
    }),
    Option.isSome,
  );
}

export function releaseQueuedMessage(
  agentId: string,
  message: Pick<QueuedMessageRow, "id" | "claimedAt">,
): AgentQueueEffect<void> {
  return Effect.asVoid(
    underQueueLock(agentId, released(agentId, message), (wasReleased) => wasReleased),
  );
}

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

export function unpausedQueues(
  limit: number,
): AgentQueueEffect<readonly { readonly agentId: string; readonly userId: string }[]> {
  return findUnpausedQueues({ limit });
}

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
