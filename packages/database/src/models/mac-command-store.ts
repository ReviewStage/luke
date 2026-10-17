import {
  type MacCommand,
  type MacCommandResult,
  macCommandResultSchema,
} from "@luke/features/mac-command-wire";
import { and, asc, eq, gte, isNotNull, isNull, type SQL } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, queryBuilder } from "../core/query.js";
import { macCommand, macCommandListener } from "../schemas/mac-command.js";
import type { TaskStoreEffect } from "./task-store.js";

/**
 * mac-command-store.ts -- the shell commands an account's agents queued for its Mac, and when a Mac last listened for them.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account claims, settles, or reads another's commands. A
 * command is claimed once, by the first Mac whose read takes it, and
 * settled once, by a Mac after it was claimed; the call that queued it
 * reads the result and withdraws the row.
 */

const CommandKeySchema = Schema.Struct({ userId: Schema.String, id: Schema.String });

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
    command: Schema.String,
    timeoutSeconds: Schema.Number,
    now: Schema.Date,
  }),
  execute: (row) =>
    Database.use((db) =>
      db.insert(macCommand).values({
        id: row.id,
        userId: row.userId,
        command: row.command,
        timeoutSeconds: row.timeoutSeconds,
        queuedAt: row.now,
      }),
    ),
});

/**
 * Whether a command still waits to be claimed: unclaimed, and queued at or
 * after the instant given, so a command no Mac took in time, or a row a
 * call that died left behind, is never run by a Mac that reads later.
 */
function waiting(userId: string, queuedSince: Date): SQL | undefined {
  return and(
    eq(macCommand.userId, userId),
    isNull(macCommand.claimedAt),
    gte(macCommand.queuedAt, queuedSince),
  );
}

const claimWaiting = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, queuedSince: Schema.Date, now: Schema.Date }),
  Result: Schema.Struct({
    id: Schema.String,
    command: Schema.String,
    timeoutSeconds: Schema.Number,
  }),
  execute: ({ userId, queuedSince, now }) =>
    Database.use((db) =>
      db.update(macCommand).set({ claimedAt: now }).where(waiting(userId, queuedSince)).returning({
        id: macCommand.id,
        command: macCommand.command,
        timeoutSeconds: macCommand.timeoutSeconds,
      }),
    ),
});

const findWaiting = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, queuedSince: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, queuedSince }) =>
    Database.use((db) =>
      db
        .select({ id: macCommand.id })
        .from(macCommand)
        .where(waiting(userId, queuedSince))
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

/**
 * Whether the account's command is settled, written for Neon Realtime to
 * wake the call waiting on its result: its id and whether a result is kept,
 * never the result itself. None where it names a value Realtime cannot carry.
 */
export function macCommandSettledLiveStatement(
  userId: string,
  id: string,
): Option.Option<LiveStatement> {
  return liveStatementOf(
    queryBuilder
      .select(liveSelection({ id: macCommand.id, settled: isNotNull(macCommand.result) }))
      .from(macCommand)
      .where(and(eq(macCommand.id, id), eq(macCommand.userId, userId))),
  );
}

/**
 * The account's commands no Mac has claimed, written for Neon Realtime to
 * wake the Mac's held read as one is queued: their ids alone, never what
 * they run. It names no claim window, because a live statement measures
 * nothing from the clock: the read looks again with its own statement,
 * which keeps the window. None where it names a value Realtime cannot carry.
 */
export function macCommandsWaitingLiveStatement(userId: string): Option.Option<LiveStatement> {
  return liveStatementOf(
    queryBuilder
      .select(liveSelection({ id: macCommand.id }))
      .from(macCommand)
      .where(and(eq(macCommand.userId, userId), isNull(macCommand.claimedAt))),
  );
}

const deleteCommand = SqlSchema.void({
  Request: CommandKeySchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db.delete(macCommand).where(and(eq(macCommand.id, id), eq(macCommand.userId, userId))),
    ),
});

/** Records that a Mac of the account is listening now. */
export function markMacListening(userId: string): TaskStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => upsertListener({ userId, now }));
}

/** Whether a Mac of the account listened at or after the instant given. */
export function macListeningSince(userId: string, since: Date): TaskStoreEffect<boolean> {
  return Effect.map(findListener({ userId, since }), Option.isSome);
}

/** Queues one command for the account's Mac, under the id its caller minted. */
export function queueMacCommand(userId: string, queued: MacCommand): TaskStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => insertCommand({ ...queued, userId, now }));
}

/** Whether any command of the account queued at or after `queuedSince` waits to be claimed, which is what a held read looks at. */
export function macCommandsWaiting(userId: string, queuedSince: Date): TaskStoreEffect<boolean> {
  return Effect.map(findWaiting({ userId, queuedSince }), (rows) => rows.length > 0);
}

/** Claims every command of the account queued at or after `queuedSince` that waits, for the Mac whose read this is. */
export function claimMacCommands(
  userId: string,
  queuedSince: Date,
): TaskStoreEffect<readonly MacCommand[]> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => claimWaiting({ userId, queuedSince, now }));
}

/** Keeps a claimed command's result; false where the account holds no such command claimed and unsettled. */
export function settleMacCommand(
  userId: string,
  id: string,
  result: MacCommandResult,
): TaskStoreEffect<boolean> {
  return Effect.map(writeResult({ userId, id, result }), (rows) => rows.length > 0);
}

/** A command's result once a Mac settled it; nothing while it waits or runs. */
export function macCommandResult(
  userId: string,
  id: string,
): TaskStoreEffect<Option.Option<MacCommandResult>> {
  return Effect.map(
    findResult({ userId, id }),
    Option.map((row) => row.result),
  );
}

/** Withdraws a command, settled or not, once its call stops waiting on it. */
export function withdrawMacCommand(userId: string, id: string): TaskStoreEffect<void> {
  return deleteCommand({ userId, id });
}
