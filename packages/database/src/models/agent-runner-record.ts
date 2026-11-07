/**
 * agent-runner-record.ts -- where a cloud agent's runner stands in its session's sandbox: written by a launch and its end under the agent's runner lease, and read by every call that finds the runner.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account and our session, so no account reads or writes another's record
 * (`../schemas/agent-runner-record.ts`). A write replaces the session's
 * record whole, whichever sandbox it named, since a launch writes it only
 * for the sandbox the session runs in now; a forget deletes it only while it
 * still names the sandbox given, so an older sandbox's end never clears the
 * record of the one that replaced it. Its writers hold the agent's runner
 * lease (`agent-runner-lease.ts`), which is what keeps one call's read and
 * write of it from interleaving with another's.
 */

import { and, eq } from "drizzle-orm";
import type { Effect, Option } from "effect";
import { Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentRunnerRecord } from "../schemas/agent-runner-record.js";

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
