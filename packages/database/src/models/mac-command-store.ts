import {
  type MacCommand,
  type MacCommandResult,
  macCommandResultSchema,
} from "@sidecar/hosted/mac-command-wire";
import { and, asc, eq, gte, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/unstable/sql";
import { db } from "../core/query.js";
import { macCommand, macCommandListener } from "../schemas/mac-command.js";
import type { PlanStoreEffect } from "./plan-store.js";

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
    db
      .insert(macCommandListener)
      .values({ userId, seenAt: now })
      .onConflictDoUpdate({ target: macCommandListener.userId, set: { seenAt: now } }),
});

const findListener = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, since: Schema.Date }),
  Result: Schema.Struct({ userId: Schema.String }),
  execute: ({ userId, since }) =>
    db
      .select({ userId: macCommandListener.userId })
      .from(macCommandListener)
      .where(and(eq(macCommandListener.userId, userId), gte(macCommandListener.seenAt, since))),
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
    db.insert(macCommand).values({
      id: row.id,
      userId: row.userId,
      command: row.command,
      timeoutSeconds: row.timeoutSeconds,
      queuedAt: row.now,
    }),
});

/**
 * Whether a command still waits to be claimed: unclaimed, and queued
 * recently enough that its call is still looking for its result, so a row a
 * call that died left behind is never run by a Mac that reads later.
 */
function waiting(userId: string, now: Date, graceSeconds: number): SQL | undefined {
  return and(
    eq(macCommand.userId, userId),
    isNull(macCommand.claimedAt),
    sql`${macCommand.queuedAt} + make_interval(secs => ${macCommand.timeoutSeconds} + ${graceSeconds}) > ${now}`,
  );
}

const WaitingSchema = Schema.Struct({
  userId: Schema.String,
  now: Schema.Date,
  graceSeconds: Schema.Number,
});

const claimWaiting = SqlSchema.findAll({
  Request: WaitingSchema,
  Result: Schema.Struct({
    id: Schema.String,
    command: Schema.String,
    timeoutSeconds: Schema.Number,
  }),
  execute: ({ userId, now, graceSeconds }) =>
    db
      .update(macCommand)
      .set({ claimedAt: now })
      .where(waiting(userId, now, graceSeconds))
      .returning({
        id: macCommand.id,
        command: macCommand.command,
        timeoutSeconds: macCommand.timeoutSeconds,
      }),
});

const findWaiting = SqlSchema.findAll({
  Request: WaitingSchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, now, graceSeconds }) =>
    db
      .select({ id: macCommand.id })
      .from(macCommand)
      .where(waiting(userId, now, graceSeconds))
      .orderBy(asc(macCommand.queuedAt)),
});

const writeResult = SqlSchema.findAll({
  Request: Schema.Struct({ ...CommandKeySchema.fields, result: macCommandResultSchema }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, result }) =>
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
});

const findResult = SqlSchema.findOneOption({
  Request: CommandKeySchema,
  Result: Schema.Struct({ result: macCommandResultSchema }),
  execute: ({ userId, id }) =>
    db
      .select({ result: macCommand.result })
      .from(macCommand)
      .where(
        and(eq(macCommand.id, id), eq(macCommand.userId, userId), isNotNull(macCommand.result)),
      ),
});

const deleteCommand = SqlSchema.void({
  Request: CommandKeySchema,
  execute: ({ userId, id }) =>
    db.delete(macCommand).where(and(eq(macCommand.id, id), eq(macCommand.userId, userId))),
});

/** Records that a Mac of the account is listening now. */
export function markMacListening(userId: string): PlanStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => upsertListener({ userId, now }));
}

/** Whether a Mac of the account listened at or after the instant given. */
export function macListeningSince(userId: string, since: Date): PlanStoreEffect<boolean> {
  return Effect.map(findListener({ userId, since }), Option.isSome);
}

/** Queues one command for the account's Mac, under the id its caller minted. */
export function queueMacCommand(userId: string, queued: MacCommand): PlanStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => insertCommand({ ...queued, userId, now }));
}

/**
 * Whether any command of the account waits to be claimed, which is what a
 * held read looks at: one whose call waits `graceSeconds` past its timeout
 * for its result counts until then.
 */
export function macCommandsWaiting(userId: string, graceSeconds: number): PlanStoreEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(findWaiting({ userId, now, graceSeconds }), (rows) => rows.length > 0),
  );
}

/** Claims every command of the account that waits, for the Mac whose read this is. */
export function claimMacCommands(
  userId: string,
  graceSeconds: number,
): PlanStoreEffect<readonly MacCommand[]> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => claimWaiting({ userId, now, graceSeconds }));
}

/** Keeps a claimed command's result; false where the account holds no such command claimed and unsettled. */
export function settleMacCommand(
  userId: string,
  id: string,
  result: MacCommandResult,
): PlanStoreEffect<boolean> {
  return Effect.map(writeResult({ userId, id, result }), (rows) => rows.length > 0);
}

/** A command's result once a Mac settled it; nothing while it waits or runs. */
export function macCommandResult(
  userId: string,
  id: string,
): PlanStoreEffect<Option.Option<MacCommandResult>> {
  return Effect.map(
    findResult({ userId, id }),
    Option.map((row) => row.result),
  );
}

/** Withdraws a command, settled or not, once its call stops waiting on it. */
export function withdrawMacCommand(userId: string, id: string): PlanStoreEffect<void> {
  return deleteCommand({ userId, id });
}
