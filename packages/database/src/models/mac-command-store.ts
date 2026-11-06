import {
  AUTOMATION_FIRING,
  AUTOMATION_RUN_STATUS,
  FIRING_HANDS_OUTSIDE_WORDS,
} from "@repo/features/automation-wire";
import {
  MAC_COMMAND_KIND,
  type MacCommand,
  type MacCommandKind,
  type MacCommandResult,
  macCommandResultSchema,
} from "@repo/features/mac-command-wire";
import { MESSAGE_CHANNEL, MESSAGE_ROLE } from "@repo/wire";
import {
  and,
  asc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notLike,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, queryBuilder } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { automationRun } from "../schemas/automation.js";
import { macCommand, macCommandListener } from "../schemas/mac-command.js";
import { conversations, messages, standingLine } from "../schemas/storage.js";
import { task } from "../schemas/task.js";
import { MESSAGE_SENDER, messageSenderSchema } from "../storage-vocabulary.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect } from "./task-store.js";
import type { ConversationTarget } from "./writer.js";

const CommandKeySchema = Schema.Struct({ userId: Schema.String, id: Schema.String });

const KindSchema = Schema.Literals(Object.values(MAC_COMMAND_KIND));

const KindsSchema = Schema.Array(KindSchema);

const ClaimedSchema = Schema.Struct({
  id: Schema.String,
  kind: KindSchema,
  command: Schema.String,
  timeoutSeconds: Schema.Number,
});

const upsertListener = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, now: Schema.Date }),
  execute: ({ userId, now }) =>
    Database.use((db) =>
      db
        .insert(macCommandListener)
        .values({ userId, seenAt: now })
        .onConflictDoUpdate({ target: macCommandListener.userId, set: { seenAt: now } }),
    ),
});

const findListener = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, since: Schema.Date }),
  Result: Schema.Struct({ userId: Schema.String }),
  execute: ({ userId, since }) =>
    Database.use((db) =>
      db
        .select({ userId: macCommandListener.userId })
        .from(macCommandListener)
        .where(and(eq(macCommandListener.userId, userId), gte(macCommandListener.seenAt, since))),
    ),
});

const insertCommand = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    userId: Schema.String,
    kind: KindSchema,
    command: Schema.String,
    timeoutSeconds: Schema.Number,
    now: Schema.Date,
  }),
  execute: (row) =>
    Database.use((db) =>
      db.insert(macCommand).values({
        id: row.id,
        userId: row.userId,
        kind: row.kind,
        command: row.command,
        timeoutSeconds: row.timeoutSeconds,
        queuedAt: row.now,
      }),
    ),
});

function waiting(
  userId: string,
  queuedSince: Date,
  kinds: readonly MacCommandKind[],
): SQL | undefined {
  return and(
    eq(macCommand.userId, userId),
    inArray(macCommand.kind, kinds),
    isNull(macCommand.claimedAt),
    gte(macCommand.queuedAt, queuedSince),
  );
}

const claimWaiting = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    queuedSince: Schema.Date,
    kinds: KindsSchema,
    now: Schema.Date,
  }),
  Result: ClaimedSchema,
  execute: ({ userId, queuedSince, kinds, now }) =>
    Database.use((db) =>
      db
        .update(macCommand)
        .set({ claimedAt: now })
        .where(waiting(userId, queuedSince, kinds))
        .returning({
          id: macCommand.id,
          kind: macCommand.kind,
          command: macCommand.command,
          timeoutSeconds: macCommand.timeoutSeconds,
        }),
    ),
});

const claimOne = SqlSchema.findOneOption({
  Request: Schema.Struct({
    ...CommandKeySchema.fields,
    queuedSince: Schema.Date,
    kinds: KindsSchema,
    now: Schema.Date,
  }),
  Result: ClaimedSchema,
  execute: ({ userId, id, queuedSince, kinds, now }) =>
    Database.use((db) =>
      db
        .update(macCommand)
        .set({ claimedAt: now })
        .where(and(eq(macCommand.id, id), waiting(userId, queuedSince, kinds)))
        .returning({
          id: macCommand.id,
          kind: macCommand.kind,
          command: macCommand.command,
          timeoutSeconds: macCommand.timeoutSeconds,
        }),
    ),
});

const findWaiting = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, queuedSince: Schema.Date, kinds: KindsSchema }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, queuedSince, kinds }) =>
    Database.use((db) =>
      db
        .select({ id: macCommand.id })
        .from(macCommand)
        .where(waiting(userId, queuedSince, kinds))
        .orderBy(asc(macCommand.queuedAt)),
    ),
});

const writeResult = SqlSchema.findAll({
  Request: Schema.Struct({ ...CommandKeySchema.fields, result: macCommandResultSchema }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, result }) =>
    Database.use((db) =>
      db
        .update(macCommand)
        .set({ result })
        .where(
          and(
            eq(macCommand.id, id),
            eq(macCommand.userId, userId),
            isNotNull(macCommand.claimedAt),
            isNull(macCommand.result),
          ),
        )
        .returning({ id: macCommand.id }),
    ),
});

const findResult = SqlSchema.findOneOption({
  Request: CommandKeySchema,
  Result: Schema.Struct({ result: macCommandResultSchema }),
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({ result: macCommand.result })
        .from(macCommand)
        .where(
          and(eq(macCommand.id, id), eq(macCommand.userId, userId), isNotNull(macCommand.result)),
        ),
    ),
});

const parent = alias(conversations, "parent");

const sendingAgent = alias(agentTable, "sending_agent");

const earlierLine = alias(messages, "earlier_line");

const startedAgent = alias(agentTable, "started_agent");

const OUTSIDE_FIRINGS = Object.values(AUTOMATION_FIRING).filter(
  (kind) => FIRING_HANDS_OUTSIDE_WORDS[kind],
);

const STARTED_ON_OUTSIDE_WORDS = inArray(
  sql<string | null>`${startedAgent.automationOrigin} -> 'firing' ->> 'kind'`,
  OUTSIDE_FIRINGS,
);

const HANDED_OUTSIDE_RUN = exists(
  queryBuilder
    .select({ id: automationRun.id })
    .from(automationRun)
    .where(
      and(
        or(
          eq(automationRun.claimedAgentId, startedAgent.id),
          eq(automationRun.agentId, startedAgent.id),
        ),
        eq(automationRun.status, AUTOMATION_RUN_STATUS.STARTED),
        inArray(sql<string>`${automationRun.firing} ->> 'kind'`, OUTSIDE_FIRINGS),
      ),
    ),
);

const LINE_OUTSIDE_WORDS = sql<string | null>`${messages.metadata} ->> 'outside_words'`;

const LINE_CHANNEL = sql<string | null>`${messages.metadata} ->> 'channel'`;

const APP_LOGINS = "%[bot]";

const GITHUB_LINE_HAS_PERSONS_WORDS = and(
  or(
    isNotNull(sql`${messages.metadata} ->> 'words'`),
    isNotNull(sql`${messages.metadata} -> 'comments'`),
  ),
  notLike(sql<string>`${messages.metadata} ->> 'by'`, APP_LOGINS),
);

const ForeignLineSchema = Schema.Struct({
  sender: Schema.NullOr(messageSenderSchema),
  createdAt: InstantColumnSchema,
  shown: Schema.Boolean,
});

const findForeignLine = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: ForeignLineSchema,
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({
          sender: messages.sender,
          createdAt: messages.createdAt,
          shown: sql<boolean>`${standingLine(messages)}`,
        })
        .from(conversations)
        .leftJoin(parent, eq(parent.id, conversations.parentConversationId))
        .innerJoin(
          messages,
          eq(messages.conversationId, sql`coalesce(${parent.id}, ${conversations.id})`),
        )
        .leftJoin(sendingAgent, eq(sendingAgent.id, messages.senderAgentId))
        .leftJoin(
          startedAgent,
          eq(startedAgent.conversationId, sql`coalesce(${parent.id}, ${conversations.id})`),
        )
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, userId),
            or(
              and(
                eq(messages.sender, MESSAGE_SENDER.MEMBER),
                or(isNull(messages.senderUserId), ne(messages.senderUserId, userId)),
              ),
              and(
                eq(messages.sender, MESSAGE_SENDER.AGENT),
                or(isNull(sendingAgent.userId), ne(sendingAgent.userId, userId)),
              ),
              and(
                eq(messages.sender, MESSAGE_SENDER.AUTOMATION),
                or(
                  eq(LINE_OUTSIDE_WORDS, "true"),
                  and(isNull(LINE_OUTSIDE_WORDS), or(STARTED_ON_OUTSIDE_WORDS, HANDED_OUTSIDE_RUN)),
                ),
              ),
              and(
                eq(messages.sender, MESSAGE_SENDER.MEMBER),
                eq(LINE_CHANNEL, MESSAGE_CHANNEL.SLACK),
                eq(LINE_OUTSIDE_WORDS, "true"),
              ),
              and(
                eq(messages.sender, MESSAGE_SENDER.GITHUB),
                or(
                  eq(LINE_OUTSIDE_WORDS, "true"),
                  and(isNull(LINE_OUTSIDE_WORDS), GITHUB_LINE_HAS_PERSONS_WORDS),
                ),
              ),
              and(
                eq(messages.role, MESSAGE_ROLE.USER),
                isNull(messages.sender),
                or(
                  and(isNull(startedAgent.prompt), isNull(startedAgent.descriptionSnapshot)),
                  STARTED_ON_OUTSIDE_WORDS,
                  exists(
                    db
                      .select({ seq: earlierLine.seq })
                      .from(earlierLine)
                      .where(
                        and(
                          eq(earlierLine.conversationId, messages.conversationId),
                          eq(earlierLine.role, MESSAGE_ROLE.USER),
                          lt(earlierLine.seq, messages.seq),
                        ),
                      ),
                  ),
                ),
              ),
            ),
          ),
        )
        .orderBy(asc(messages.seq))
        .limit(1),
    ),
});

const ownAgent = alias(agentTable, "own_agent");

const findMacOwner = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ userId: Schema.String }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ userId: sql<string>`coalesce(${task.assigneeId}, ${ownAgent.userId})` })
        .from(conversations)
        .leftJoin(parent, eq(parent.id, conversations.parentConversationId))
        .innerJoin(
          ownAgent,
          eq(ownAgent.conversationId, sql`coalesce(${parent.id}, ${conversations.id})`),
        )
        .leftJoin(task, eq(task.id, ownAgent.taskId))
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
        .limit(1),
    ),
});

const deleteCommand = SqlSchema.void({
  Request: CommandKeySchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db.delete(macCommand).where(and(eq(macCommand.id, id), eq(macCommand.userId, userId))),
    ),
});

export function markMacListening(userId: string): TaskStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => upsertListener({ userId, now }));
}

export function macListeningSince(userId: string, since: Date): TaskStoreEffect<boolean> {
  return Effect.map(findListener({ userId, since }), Option.isSome);
}

export function heardFromAnotherAccount(target: ConversationTarget): TaskStoreEffect<boolean> {
  return Effect.map(findForeignLine(target), Option.isSome);
}

export function macOwnerOf(target: ConversationTarget): TaskStoreEffect<string> {
  return Effect.map(
    findMacOwner(target),
    Option.match({ onNone: () => target.userId, onSome: (row) => row.userId }),
  );
}

export function queueMacCommand(userId: string, queued: MacCommand): TaskStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    insertCommand({
      id: queued.id,
      userId,
      kind: queued.kind,
      command: queued.command,
      timeoutSeconds: queued.timeoutSeconds,
      now,
    }),
  );
}

export function macCommandsWaiting(
  userId: string,
  queuedSince: Date,
  kinds: readonly MacCommandKind[],
): TaskStoreEffect<boolean> {
  return Effect.map(findWaiting({ userId, queuedSince, kinds }), (rows) => rows.length > 0);
}

export function claimMacCommands(
  userId: string,
  queuedSince: Date,
  kinds: readonly MacCommandKind[],
): TaskStoreEffect<readonly MacCommand[]> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    claimWaiting({ userId, queuedSince, kinds, now }),
  );
}

export function claimMacCommand(
  userId: string,
  id: string,
  queuedSince: Date,
  kinds: readonly MacCommandKind[],
): TaskStoreEffect<Option.Option<MacCommand>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    claimOne({ userId, id, queuedSince, kinds, now }),
  );
}

export function macCommandsLiveStatement(
  userId: string,
  kinds: readonly MacCommandKind[],
): Option.Option<LiveStatement> {
  return liveStatementOf(
    queryBuilder
      .select(
        liveSelection(
          {
            id: macCommand.id,
            kind: macCommand.kind,
            command: macCommand.command,
            timeoutSeconds: macCommand.timeoutSeconds,
          },
          { queuedAt: macCommand.queuedAt },
        ),
      )
      .from(macCommand)
      .where(
        and(
          eq(macCommand.userId, userId),
          inArray(macCommand.kind, kinds),
          isNull(macCommand.claimedAt),
        ),
      ),
  );
}

export function settleMacCommand(
  userId: string,
  id: string,
  result: MacCommandResult,
): TaskStoreEffect<boolean> {
  return Effect.map(writeResult({ userId, id, result }), (rows) => rows.length > 0);
}

export function macCommandResult(
  userId: string,
  id: string,
): TaskStoreEffect<Option.Option<MacCommandResult>> {
  return Effect.map(
    findResult({ userId, id }),
    Option.map(({ result }) => result),
  );
}

export function withdrawMacCommand(userId: string, id: string): TaskStoreEffect<void> {
  return deleteCommand({ userId, id });
}
