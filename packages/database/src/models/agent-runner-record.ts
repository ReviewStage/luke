/**
 * agent-runner-record.ts -- where a cloud agent's runner stands in its session's sandbox: written by a launch and its end under the agent's runner lease, and read by every call that finds the runner.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account and our session, so no account reads or writes another's record
 * (`../schemas/agent-runner-record.ts`), but the warm sweep's read
 * (`warmCloudAgentLaunches`), which the scheduled sweep makes for every
 * account and which answers ids alone. A write replaces the session's
 * record whole, whichever sandbox it named, since a launch writes it only
 * for the sandbox the session runs in now; a forget deletes it only while it
 * still names the sandbox given, so an older sandbox's end never clears the
 * record of the one that replaced it. Its writers hold the agent's runner
 * lease (`agent-runner-lease.ts`), which is what keeps one call's read and
 * write of it from interleaving with another's.
 */

import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Effect, Option } from "effect";
import { Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { agentRunnerRecord } from "../schemas/agent-runner-record.js";
import { turns } from "../schemas/storage.js";
import { ENDED_TURN_STATUSES } from "./agent-store.js";

type RecordEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const AgentRunnerRecordSchema = Schema.Struct({
  agentId: Schema.String,
  sandboxName: Schema.String,
  firstSequence: Schema.Number,
  fingerprint: Schema.NullOr(Schema.String),
  sandboxSessionId: Schema.NullOr(Schema.String),
  commandId: Schema.NullOr(Schema.String),
});

/**
 * A session's record: the agent and sandbox it was written for, its launch's
 * first event number and fingerprint, and the sandbox session and command
 * its runner runs as, both null while none runs.
 */
export type AgentRunnerRecord = typeof AgentRunnerRecordSchema.Type;

const SessionFields = { userId: Schema.String, sessionId: Schema.String };

/** The account's record of the session given. */
const ownRecord = (userId: string, sessionId: string) =>
  and(eq(agentRunnerRecord.userId, userId), eq(agentRunnerRecord.sessionId, sessionId));

const findRecord = SqlSchema.findOneOption({
  Request: Schema.Struct(SessionFields),
  Result: AgentRunnerRecordSchema,
  execute: ({ userId, sessionId }) =>
    Database.use((db) =>
      db
        .select({
          agentId: agentRunnerRecord.agentId,
          sandboxName: agentRunnerRecord.sandboxName,
          firstSequence: agentRunnerRecord.firstSequence,
          fingerprint: agentRunnerRecord.fingerprint,
          sandboxSessionId: agentRunnerRecord.sandboxSessionId,
          commandId: agentRunnerRecord.commandId,
        })
        .from(agentRunnerRecord)
        .where(ownRecord(userId, sessionId))
        .limit(1),
    ),
});

const upsertRecord = SqlSchema.void({
  Request: Schema.Struct({ ...SessionFields, ...AgentRunnerRecordSchema.fields }),
  execute: ({ userId, sessionId, ...record }) =>
    Database.use((db) =>
      db
        .insert(agentRunnerRecord)
        .values({ userId, sessionId, ...record })
        .onConflictDoUpdate({
          target: [agentRunnerRecord.userId, agentRunnerRecord.sessionId],
          set: record,
        }),
    ),
});

const deleteRecord = SqlSchema.void({
  Request: Schema.Struct({ ...SessionFields, sandboxName: Schema.String }),
  execute: ({ userId, sessionId, sandboxName }) =>
    Database.use((db) =>
      db
        .delete(agentRunnerRecord)
        .where(and(ownRecord(userId, sessionId), eq(agentRunnerRecord.sandboxName, sandboxName))),
    ),
});

/** A cloud runner the warm sweep may retire: the account its record is kept under, the agent, and the session its place is found by. */
const WarmCloudLaunchSchema = Schema.Struct({
  userId: Schema.String,
  agentId: Schema.String,
  sessionId: Schema.String,
});

export type WarmCloudLaunch = typeof WarmCloudLaunchSchema.Type;

const findWarmCloudLaunches = SqlSchema.findAll({
  Request: Schema.Struct({ since: Schema.Date, before: Schema.Date, limit: Schema.Int }),
  Result: WarmCloudLaunchSchema,
  execute: ({ since, before, limit }) =>
    Database.use((db) => {
      // The conversation's newest turn, as `agent-store.ts`'s `readNativeRunStanding` reads whether its run ended.
      const newestTurn = db
        .select({ status: turns.status, settledAt: turns.settledAt })
        .from(turns)
        .where(eq(turns.conversationId, agentTable.conversationId))
        .orderBy(desc(turns.queuedAt), desc(turns.id))
        .limit(1)
        .as("newest_turn");
      // Note that an ended turn with no settle time stamped reads as ended long ago, as the run's standing reads it.
      const lastUse = sql`greatest(coalesce(${newestTurn.settledAt}, 'epoch'::timestamptz), coalesce(${agentTable.seenAt}, 'epoch'::timestamptz))`;
      return db
        .select({
          userId: agentRunnerRecord.userId,
          agentId: agentRunnerRecord.agentId,
          sessionId: agentRunnerRecord.sessionId,
        })
        .from(agentRunnerRecord)
        .innerJoin(agentTable, eq(agentTable.id, agentRunnerRecord.agentId))
        .innerJoinLateral(newestTurn, sql`true`)
        .where(
          and(
            eq(agentTable.machine, AGENT_MACHINE.VERCEL),
            isNotNull(agentRunnerRecord.commandId),
            inArray(newestTurn.status, [...ENDED_TURN_STATUSES]),
            or(isNull(newestTurn.settledAt), lt(newestTurn.settledAt, before)),
            or(isNull(agentTable.seenAt), lt(agentTable.seenAt, before)),
            gt(lastUse, since),
          ),
        )
        .orderBy(asc(lastUse))
        .limit(limit);
    }),
});

/**
 * The cloud runners whose record says they run, whose agent's newest turn
 * ended, and whose last use, the later of that turn's end and the last time
 * a client had the agent on screen (`agent.seen_at`), stands before
 * `before` and after `since`, oldest use first, at most `limit`: read with no
 * account in hand, because the scheduled sweep retires them for every
 * account. A runner whose last use is older than `since` has ended itself
 * at its own idle cap, so its record is not read again.
 */
export function warmCloudAgentLaunches(read: {
  readonly since: Date;
  readonly before: Date;
  readonly limit: number;
}): RecordEffect<readonly WarmCloudLaunch[]> {
  return findWarmCloudLaunches(read);
}

/** The account's record of the session given; none where no launch is recorded for it. */
export function readAgentRunnerRecord(
  userId: string,
  sessionId: string,
): RecordEffect<Option.Option<AgentRunnerRecord>> {
  return findRecord({ userId, sessionId });
}

/** The account's record of the session given, in place of whatever it said. */
export function writeAgentRunnerRecord(
  userId: string,
  sessionId: string,
  record: AgentRunnerRecord,
): RecordEffect<void> {
  return upsertRecord({ userId, sessionId, ...record });
}

/** The account's record of the session given deleted, where it still names the sandbox given. */
export function forgetAgentRunnerRecord(
  userId: string,
  sessionId: string,
  sandboxName: string,
): RecordEffect<void> {
  return deleteRecord({ userId, sessionId, sandboxName });
}
