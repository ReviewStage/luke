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

export type AgentRunnerRecord = typeof AgentRunnerRecordSchema.Type;

const SessionFields = { userId: Schema.String, sessionId: Schema.String };

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

export function readAgentRunnerRecord(
  userId: string,
  sessionId: string,
): RecordEffect<Option.Option<AgentRunnerRecord>> {
  return findRecord({ userId, sessionId });
}

export function writeAgentRunnerRecord(
  userId: string,
  sessionId: string,
  record: AgentRunnerRecord,
): RecordEffect<void> {
  return upsertRecord({ userId, sessionId, ...record });
}

export function forgetAgentRunnerRecord(
  userId: string,
  sessionId: string,
  sandboxName: string,
): RecordEffect<void> {
  return deleteRecord({ userId, sessionId, sandboxName });
}
