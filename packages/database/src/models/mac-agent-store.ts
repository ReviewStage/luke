/**
 * mac-agent-store.ts -- the lines and requests the service queues for a local agent's Mac, claimed, settled, answered, and withdrawn.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account queues for, claims, settles, or reads another's
 * agent. A row is queued only for an agent of the account that runs on a
 * Mac, and goes to the Mac the agent is pinned to, which must be the
 * account's too; a Mac reads and claims only the rows naming it. A row is
 * claimed once, by the first claim that finds it waiting, and settled or
 * answered once, after it was claimed. A launch line's sealed secrets are
 * read by its claim alone, which clears them in the same statement, so a
 * second claim, a listing, or a read after it finds none
 * (`../schemas/mac-agent.ts`). The secrets are opaque here: the service
 * seals them before the queue and opens them after the claim.
 */

import { CODING_AGENT_MACHINE } from "@luke/features/coding-agent-wire";
import {
  MAC_AGENT_LINE_KIND,
  MAC_AGENT_REQUEST_KIND,
  type MacAgentAnswer,
  type MacAgentLineKind,
  type MacAgentObject,
  type MacAgentRequestKind,
  macAgentAnswerSchema,
  macAgentObjectSchema,
} from "@luke/features/mac-agent-wire";
import { and, asc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { macAgentLine, macAgentRequest } from "../schemas/mac-agent.js";
import { macDevice } from "../schemas/mac-device.js";

type MacAgentEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const LineKindSchema = Schema.Literals(Object.values(MAC_AGENT_LINE_KIND));

const RequestKindSchema = Schema.Literals(Object.values(MAC_AGENT_REQUEST_KIND));

const DeviceRowKeySchema = Schema.Struct({
  userId: Schema.String,
  deviceId: Schema.String,
  id: Schema.String,
});

/** A line as a Mac lists it: everything but its secrets. */
const WaitingLineSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  seq: Schema.Number,
  kind: LineKindSchema,
  payload: macAgentObjectSchema,
});

export type MacAgentWaitingLine = typeof WaitingLineSchema.Type;

/** A line as its claim hands it over: with its sealed secrets, which no one reads after. */
const ClaimedLineSchema = Schema.Struct({
  ...WaitingLineSchema.fields,
  sealedSecrets: Schema.NullOr(Schema.String),
});

export type MacAgentClaimedLine = typeof ClaimedLineSchema.Type;

/** A request as a Mac lists and claims it. */
const WaitingRequestSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  kind: RequestKindSchema,
  args: macAgentObjectSchema,
});

export type MacAgentWaitingRequest = typeof WaitingRequestSchema.Type;

/** A settled request's answer columns as the row holds them. */
const AnswerRowSchema = Schema.Struct({
  kind: RequestKindSchema,
  bytes: Schema.NullOr(Schema.Uint8Array),
  exitCode: Schema.NullOr(Schema.Number),
  stdout: Schema.NullOr(Schema.String),
  stderr: Schema.NullOr(Schema.String),
});

const decodeAnswer = Schema.decodeUnknownEffect(macAgentAnswerSchema);

/** The line as it stood before its claim, read beside the update for the secrets the update clears. */
const lineBefore = alias(macAgentLine, "line_before");

/**
 * The agent of the account, running on a Mac, joined to the Mac it is
 * pinned to where the account holds that Mac too: what a queue's insert
 * selects from, so it writes nothing for anyone else's agent or Mac.
 */
function pinnedAgent(userId: string, agentId: string) {
  return and(
    eq(codingAgent.id, agentId),
    eq(codingAgent.userId, userId),
    eq(codingAgent.machine, CODING_AGENT_MACHINE.MAC),
    eq(macDevice.userId, userId),
  );
}

/** The agent's next place in its order: one past its latest line's, or one for its first. */
const nextSeq = (agentId: string) =>
  sql<number>`(select coalesce(max(${macAgentLine.seq}), 0) + 1 from ${macAgentLine} where ${macAgentLine.agentId} = ${agentId})`;

const insertLine = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    kind: LineKindSchema,
    payload: macAgentObjectSchema,
    sealedSecrets: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String, seq: Schema.Number }),
  execute: ({ userId, agentId, kind, payload, sealedSecrets, now }) =>
    Database.use((db) =>
      db
        .insert(macAgentLine)
        .select((qb) =>
          qb
            .select({
              agentId: sql<string>`${codingAgent.id}`.as("agent_id"),
              userId: sql<string>`${codingAgent.userId}`.as("user_id"),
              deviceId: sql<string>`${macDevice.id}`.as("device_id"),
              seq: nextSeq(agentId).as("seq"),
              kind: sql<MacAgentLineKind>`${kind}`.as("kind"),
              payload: sql<MacAgentObject>`${JSON.stringify(payload)}::jsonb`.as("payload"),
              sealedSecrets: sql<string | null>`${sealedSecrets}::text`.as("sealed_secrets"),
              createdAt: sql<Date>`${now}::timestamptz`.as("created_at"),
            })
            .from(codingAgent)
            .innerJoin(macDevice, eq(macDevice.id, codingAgent.deviceId))
            .where(pinnedAgent(userId, agentId)),
        )
        .returning({ id: macAgentLine.id, seq: macAgentLine.seq }),
    ),
});

const findWaitingLines = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, deviceId: Schema.String }),
  Result: WaitingLineSchema,
  execute: ({ userId, deviceId }) =>
    Database.use((db) =>
      db
        .select({
          id: macAgentLine.id,
          agentId: macAgentLine.agentId,
          seq: macAgentLine.seq,
          kind: macAgentLine.kind,
          payload: macAgentLine.payload,
        })
        .from(macAgentLine)
        .where(
          and(
            eq(macAgentLine.userId, userId),
            eq(macAgentLine.deviceId, deviceId),
            isNull(macAgentLine.claimedAt),
          ),
        )
        .orderBy(asc(macAgentLine.createdAt), asc(macAgentLine.seq)),
    ),
});

const claimLine = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...DeviceRowKeySchema.fields, now: Schema.Date }),
  Result: ClaimedLineSchema,
  execute: ({ userId, deviceId, id, now }) =>
    Database.use((db) =>
      db
        .update(macAgentLine)
        .set({ claimedAt: now, sealedSecrets: null })
        .from(lineBefore)
        .where(
          and(
            eq(lineBefore.id, macAgentLine.id),
            eq(macAgentLine.id, id),
            eq(macAgentLine.userId, userId),
            eq(macAgentLine.deviceId, deviceId),
            isNull(macAgentLine.claimedAt),
          ),
        )
        .returning({
          id: macAgentLine.id,
          agentId: macAgentLine.agentId,
          seq: macAgentLine.seq,
          kind: macAgentLine.kind,
          payload: macAgentLine.payload,
          // Note that we read the secrets off the row as it stood, because
          // `returning` reads the updated row, whose secrets are cleared.
          sealedSecrets: lineBefore.sealedSecrets,
        }),
    ),
});

const writeLineSettled = SqlSchema.findAll({
  Request: Schema.Struct({
    ...DeviceRowKeySchema.fields,
    exitCode: Schema.NullOr(Schema.Number),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, deviceId, id, exitCode, now }) =>
    Database.use((db) =>
      db
        .update(macAgentLine)
        .set({ settledAt: now, exitCode })
        .where(
          and(
            eq(macAgentLine.id, id),
            eq(macAgentLine.userId, userId),
            eq(macAgentLine.deviceId, deviceId),
            isNotNull(macAgentLine.claimedAt),
            isNull(macAgentLine.settledAt),
          ),
        )
        .returning({ id: macAgentLine.id }),
    ),
});

const findLineSettled = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String }),
  Result: Schema.Struct({ exitCode: Schema.NullOr(Schema.Number) }),
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({ exitCode: macAgentLine.exitCode })
        .from(macAgentLine)
        .where(
          and(
            eq(macAgentLine.id, id),
            eq(macAgentLine.userId, userId),
            isNotNull(macAgentLine.settledAt),
          ),
        ),
    ),
});

const insertRequest = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    id: Schema.String,
    agentId: Schema.String,
    kind: RequestKindSchema,
    args: macAgentObjectSchema,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, agentId, kind, args, now }) =>
    Database.use((db) =>
      db
        .insert(macAgentRequest)
        .select((qb) =>
          qb
            .select({
              id: sql<string>`${id}::uuid`.as("id"),
              agentId: sql<string>`${codingAgent.id}`.as("agent_id"),
              userId: sql<string>`${codingAgent.userId}`.as("user_id"),
              deviceId: sql<string>`${macDevice.id}`.as("device_id"),
              kind: sql<MacAgentRequestKind>`${kind}`.as("kind"),
              args: sql<MacAgentObject>`${JSON.stringify(args)}::jsonb`.as("args"),
              createdAt: sql<Date>`${now}::timestamptz`.as("created_at"),
            })
            .from(codingAgent)
            .innerJoin(macDevice, eq(macDevice.id, codingAgent.deviceId))
            .where(pinnedAgent(userId, agentId)),
        )
        .returning({ id: macAgentRequest.id }),
    ),
});

/** A request waiting for the account's Mac given. */
function requestWaiting(userId: string, deviceId: string) {
  return and(
    eq(macAgentRequest.userId, userId),
    eq(macAgentRequest.deviceId, deviceId),
    isNull(macAgentRequest.claimedAt),
  );
}

const findWaitingRequests = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, deviceId: Schema.String }),
  Result: WaitingRequestSchema,
  execute: ({ userId, deviceId }) =>
    Database.use((db) =>
      db
        .select({
          id: macAgentRequest.id,
          agentId: macAgentRequest.agentId,
          kind: macAgentRequest.kind,
          args: macAgentRequest.args,
        })
        .from(macAgentRequest)
        .where(requestWaiting(userId, deviceId))
        .orderBy(asc(macAgentRequest.createdAt)),
    ),
});

const claimRequest = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...DeviceRowKeySchema.fields, now: Schema.Date }),
  Result: WaitingRequestSchema,
  execute: ({ userId, deviceId, id, now }) =>
    Database.use((db) =>
      db
        .update(macAgentRequest)
        .set({ claimedAt: now })
        .where(and(eq(macAgentRequest.id, id), requestWaiting(userId, deviceId)))
        .returning({
          id: macAgentRequest.id,
          agentId: macAgentRequest.agentId,
          kind: macAgentRequest.kind,
          args: macAgentRequest.args,
        }),
    ),
});

const writeAnswer = SqlSchema.findAll({
  Request: Schema.Struct({
    ...DeviceRowKeySchema.fields,
    answer: macAgentAnswerSchema,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, deviceId, id, answer, now }) =>
    Database.use((db) =>
      db
        .update(macAgentRequest)
        .set(
          answer.kind === MAC_AGENT_REQUEST_KIND.READ_FILE
            ? { settledAt: now, bytes: answer.bytes }
            : {
                settledAt: now,
                exitCode: answer.exitCode,
                stdout: answer.stdout,
                stderr: answer.stderr,
              },
        )
        .where(
          and(
            eq(macAgentRequest.id, id),
            eq(macAgentRequest.userId, userId),
            eq(macAgentRequest.deviceId, deviceId),
            // An answer of one kind never settles a request of the other.
            eq(macAgentRequest.kind, answer.kind),
            isNotNull(macAgentRequest.claimedAt),
            isNull(macAgentRequest.settledAt),
          ),
        )
        .returning({ id: macAgentRequest.id }),
    ),
});

const findAnswer = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String }),
  Result: AnswerRowSchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({
          kind: macAgentRequest.kind,
          bytes: macAgentRequest.bytes,
          exitCode: macAgentRequest.exitCode,
          stdout: macAgentRequest.stdout,
          stderr: macAgentRequest.stderr,
        })
        .from(macAgentRequest)
        .where(
          and(
            eq(macAgentRequest.id, id),
            eq(macAgentRequest.userId, userId),
            isNotNull(macAgentRequest.settledAt),
          ),
        ),
    ),
});

const deleteRequest = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String }),
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .delete(macAgentRequest)
        .where(and(eq(macAgentRequest.id, id), eq(macAgentRequest.userId, userId))),
    ),
});

const deleteExpiredLines = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, before: Schema.Date }),
  execute: ({ userId, before }) =>
    Database.use((db) =>
      db.delete(macAgentLine).where(
        and(
          eq(macAgentLine.userId, userId),
          lt(macAgentLine.createdAt, before),
          // A line claimed and not yet settled is a runner still at work, whose exit is still to come.
          or(isNull(macAgentLine.claimedAt), isNotNull(macAgentLine.settledAt)),
        ),
      ),
    ),
});

const deleteExpiredRequests = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, before: Schema.Date }),
  execute: ({ userId, before }) =>
    Database.use((db) =>
      db
        .delete(macAgentRequest)
        .where(and(eq(macAgentRequest.userId, userId), lt(macAgentRequest.createdAt, before))),
    ),
});

/**
 * Queues one line for the account's agent, to the Mac it is pinned to, at
 * the next place in the agent's order, with the sealed secrets a launch
 * line carries; its id and place, or none where the account holds no such
 * agent running on a Mac of its own.
 */
export function queueMacAgentLine(
  userId: string,
  line: {
    readonly agentId: string;
    readonly kind: MacAgentLineKind;
    readonly payload: MacAgentObject;
    readonly sealedSecrets?: string;
  },
): MacAgentEffect<Option.Option<{ readonly id: string; readonly seq: number }>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      insertLine({
        userId,
        agentId: line.agentId,
        kind: line.kind,
        payload: line.payload,
        sealedSecrets: line.sealedSecrets ?? null,
        now,
      }),
      (rows) => Option.fromNullishOr(rows[0]),
    ),
  );
}

/** The lines waiting for the account's Mac, oldest first and each agent's in its order, without their secrets. */
export function macAgentLinesWaiting(
  userId: string,
  deviceId: string,
): MacAgentEffect<readonly MacAgentWaitingLine[]> {
  return findWaitingLines({ userId, deviceId });
}

/**
 * Claims one line for the account's Mac, handing over its sealed secrets
 * and clearing them in the same statement; none where it is not that Mac's,
 * another claim took it first, or the expiry withdrew it.
 */
export function claimMacAgentLine(
  userId: string,
  deviceId: string,
  id: string,
): MacAgentEffect<Option.Option<MacAgentClaimedLine>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => claimLine({ userId, deviceId, id, now }));
}

/**
 * Settles a line the account's Mac claimed, with its runner's exit code
 * where it is a launch line whose runner exited; false where that Mac
 * holds no such line claimed and unsettled.
 */
export function settleMacAgentLine(
  userId: string,
  deviceId: string,
  id: string,
  exitCode?: number,
): MacAgentEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      writeLineSettled({ userId, deviceId, id, exitCode: exitCode ?? null, now }),
      (rows) => rows.length > 0,
    ),
  );
}

/** A line's exit code once its Mac settled it, null for one settled with none; nothing while it waits or runs. */
export function macAgentLineSettlement(
  userId: string,
  id: string,
): MacAgentEffect<Option.Option<{ readonly exitCode: number | null }>> {
  return findLineSettled({ userId, id });
}

/**
 * Queues one request for the account's agent, to the Mac it is pinned to,
 * under the id its caller minted; false where the account holds no such
 * agent running on a Mac of its own.
 */
export function queueMacAgentRequest(
  userId: string,
  request: {
    readonly id: string;
    readonly agentId: string;
    readonly kind: MacAgentRequestKind;
    readonly args: MacAgentObject;
  },
): MacAgentEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(insertRequest({ userId, ...request, now }), (rows) => rows.length > 0),
  );
}

/** The requests waiting for the account's Mac, oldest first. */
export function macAgentRequestsWaiting(
  userId: string,
  deviceId: string,
): MacAgentEffect<readonly MacAgentWaitingRequest[]> {
  return findWaitingRequests({ userId, deviceId });
}

/** Claims one request for the account's Mac; none where it is not that Mac's, another claim took it first, or it was withdrawn. */
export function claimMacAgentRequest(
  userId: string,
  deviceId: string,
  id: string,
): MacAgentEffect<Option.Option<MacAgentWaitingRequest>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => claimRequest({ userId, deviceId, id, now }));
}

/**
 * Keeps the answer to a request the account's Mac claimed; false where that
 * Mac holds no such request claimed and unanswered, or the answer is of
 * the other kind. An answer past the bound fails its decode and writes
 * nothing.
 */
export function answerMacAgentRequest(
  userId: string,
  deviceId: string,
  id: string,
  answer: MacAgentAnswer,
): MacAgentEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(writeAnswer({ userId, deviceId, id, answer, now }), (rows) => rows.length > 0),
  );
}

/** A request's answer once its Mac answered it; nothing while it waits or runs. */
export function macAgentRequestAnswer(
  userId: string,
  id: string,
): MacAgentEffect<Option.Option<MacAgentAnswer>> {
  return Effect.flatMap(findAnswer({ userId, id }), (row) =>
    Option.match(row, {
      onNone: () => Effect.succeed(Option.none()),
      onSome: (answer) =>
        Effect.map(
          decodeAnswer(
            answer.kind === MAC_AGENT_REQUEST_KIND.READ_FILE
              ? { kind: answer.kind, bytes: answer.bytes }
              : {
                  kind: answer.kind,
                  exitCode: answer.exitCode,
                  stdout: answer.stdout,
                  stderr: answer.stderr,
                },
          ),
          Option.some,
        ),
    }),
  );
}

/** Withdraws a request, answered or not, once its caller stops waiting on it. */
export function withdrawMacAgentRequest(userId: string, id: string): MacAgentEffect<void> {
  return deleteRequest({ userId, id });
}

/**
 * Withdraws the account's lines and requests queued before the instant
 * given: every request, and every line but one claimed and not yet
 * settled, whose runner is still at work and whose exit is still to come.
 */
export function withdrawExpiredMacAgentRows(userId: string, before: Date): MacAgentEffect<void> {
  return Effect.andThen(
    deleteExpiredLines({ userId, before }),
    deleteExpiredRequests({ userId, before }),
  );
}
