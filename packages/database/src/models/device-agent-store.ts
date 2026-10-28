/**
 * device-agent-store.ts -- the lines and requests the service queues for a local agent's Mac, claimed, settled, answered, and withdrawn.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account queues for, claims, settles, or reads another's
 * agent. A row is queued only for an agent of the account that runs on a
 * Mac, and goes to the Mac the agent is pinned to, which must be the
 * account's too; a Mac reads and claims only the rows naming it. A row is
 * claimed once, by the first claim that finds it waiting, and settled or
 * answered once, after it was claimed. A line's claim may carry a token its
 * Mac minted for it, and the same claim asked again under that token, as
 * after its answer was lost, is answered the line again until it is
 * settled. A launch line's sealed secrets are read by its first claim
 * alone, which clears them in the same statement, so a second claim, a
 * claim asked again, a listing, or a read after it finds none
 * (`../schemas/device-agent.ts`). The secrets are opaque here: the service
 * seals them before the queue and opens them after the claim.
 *
 * A line of a kind that needs a capability (`DEVICE_AGENT_LINE_CAPABILITY`)
 * is queued only where the agent's Mac registered it, since a follower that
 * predates the kind fails its whole held read on one.
 *
 * Every line queued for one agent is queued under that agent's runner
 * lease (`./agent-runner-lease.ts`), as every write to a cloud
 * runner is. That is what keeps an agent's lines committed in the order of
 * their `seq`: the sequence is shared by every agent and holds no lock, so
 * two lines queued at once outside the lease could commit out of order.
 */

import { AGENT_MACHINE } from "@luke/features/agent-wire";
import {
  DEVICE_AGENT_LINE_CAPABILITY,
  DEVICE_AGENT_LINE_KIND,
  DEVICE_AGENT_REQUEST_KIND,
  DEVICE_CAPABILITY,
  type DeviceAgentAnswer,
  type DeviceAgentLineKind,
  type DeviceAgentObject,
  type DeviceAgentRequestKind,
  deviceAgentAnswerSchema,
  deviceAgentObjectSchema,
} from "@luke/features/device-agent-wire";
import {
  and,
  arrayContains,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { device } from "../schemas/device.js";
import { deviceAgentLine, deviceAgentRequest } from "../schemas/device-agent.js";
import { conversations } from "../schemas/storage.js";

type DeviceAgentEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const LineKindSchema = Schema.Literals(Object.values(DEVICE_AGENT_LINE_KIND));

const RequestKindSchema = Schema.Literals(Object.values(DEVICE_AGENT_REQUEST_KIND));

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
  payload: deviceAgentObjectSchema,
});

export type DeviceAgentWaitingLine = typeof WaitingLineSchema.Type;

/** A line as its claim hands it over: with its sealed secrets, which no one reads after. */
const ClaimedLineSchema = Schema.Struct({
  ...WaitingLineSchema.fields,
  sealedSecrets: Schema.NullOr(Schema.String),
});

/**
 * A line as a claim answers it: as its first claim handed it over, or, for
 * the same claim asked again, without secrets, and saying where it is a
 * launch line whose secrets the first claim took.
 */
export type DeviceAgentClaimedLine = typeof ClaimedLineSchema.Type & {
  readonly secretsGone: boolean;
};

/** A request as a Mac lists and claims it. */
const WaitingRequestSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  kind: RequestKindSchema,
  args: deviceAgentObjectSchema,
});

export type DeviceAgentWaitingRequest = typeof WaitingRequestSchema.Type;

/** A settled request's answer columns as the row holds them. */
const AnswerRowSchema = Schema.Struct({
  kind: RequestKindSchema,
  bytes: Schema.NullOr(Schema.Uint8Array),
});

const decodeAnswer = Schema.decodeUnknownEffect(deviceAgentAnswerSchema);

/** The line as it stood before its claim, read beside the update for the secrets the update clears. */
const lineBefore = alias(deviceAgentLine, "line_before");

/**
 * The agent of the account, running on a Mac, joined to the Mac it is
 * pinned to where the account holds that Mac too: what a queue's insert
 * selects from, so it writes nothing for anyone else's agent or Mac.
 */
function pinnedAgent(userId: string, agentId: string) {
  return and(
    eq(agentTable.id, agentId),
    eq(agentTable.userId, userId),
    eq(agentTable.machine, AGENT_MACHINE.DEVICE),
    eq(device.userId, userId),
  );
}

/** A local agent as its machine finds it: its starter, and the Mac it is pinned to, none once that Mac is gone. */
const DeviceAgentPinSchema = Schema.Struct({
  userId: Schema.String,
  agentId: Schema.String,
  deviceId: Schema.NullOr(Schema.String),
});

export type DeviceAgentPin = typeof DeviceAgentPinSchema.Type;

/** An agent's newest launch line as its machine reads it: whether its Mac settled it, with what exit, and whether a stop line followed it. */
const DeviceAgentLaunchSchema = Schema.Struct({
  id: Schema.String,
  payload: deviceAgentObjectSchema,
  settled: Schema.Boolean,
  exitCode: Schema.NullOr(Schema.Number),
  stopped: Schema.Boolean,
});

export type DeviceAgentLaunch = typeof DeviceAgentLaunchSchema.Type;

/** A line as its settle answers it: the agent it is for, and its kind. */
const DeviceAgentSettledLineSchema = Schema.Struct({
  agentId: Schema.String,
  kind: LineKindSchema,
});

export type DeviceAgentSettledLine = typeof DeviceAgentSettledLineSchema.Type;

/** A line as it stands: whether its Mac settled it and with what exit, and the agent, the Mac, and the kind it is. */
const DeviceAgentLineStandingSchema = Schema.Struct({
  ...DeviceAgentSettledLineSchema.fields,
  settled: Schema.Boolean,
  exitCode: Schema.NullOr(Schema.Number),
  deviceId: Schema.String,
});

export type DeviceAgentLineStanding = typeof DeviceAgentLineStandingSchema.Type;

/** The columns a pin reads off an agent. */
const PIN_COLUMNS = {
  userId: agentTable.userId,
  agentId: agentTable.id,
  deviceId: agentTable.deviceId,
};

const findPinOfSession = SqlSchema.findOneOption({
  Request: Schema.Struct({ runtimeSessionId: Schema.String }),
  Result: DeviceAgentPinSchema,
  execute: ({ runtimeSessionId }) =>
    Database.use((db) =>
      db
        .select(PIN_COLUMNS)
        .from(conversations)
        .innerJoin(agentTable, eq(agentTable.conversationId, conversations.id))
        .where(
          and(
            eq(conversations.runtimeSessionId, runtimeSessionId),
            eq(agentTable.machine, AGENT_MACHINE.DEVICE),
          ),
        )
        .limit(1),
    ),
});

const findPin = SqlSchema.findOneOption({
  Request: Schema.Struct({ agentId: Schema.String }),
  Result: DeviceAgentPinSchema,
  execute: ({ agentId }) =>
    Database.use((db) =>
      db
        .select(PIN_COLUMNS)
        .from(agentTable)
        .where(and(eq(agentTable.id, agentId), eq(agentTable.machine, AGENT_MACHINE.DEVICE))),
    ),
});

/** A stop line queued for the agent after its launch line. */
const stopLine = alias(deviceAgentLine, "stop_line");

const findLatestLaunch = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: DeviceAgentLaunchSchema,
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({
          id: deviceAgentLine.id,
          payload: deviceAgentLine.payload,
          settled: sql<boolean>`${deviceAgentLine.settledAt} is not null`,
          exitCode: deviceAgentLine.exitCode,
          stopped: sql<boolean>`exists (${db
            .select({ one: sql`1` })
            .from(stopLine)
            .where(
              and(
                eq(stopLine.agentId, deviceAgentLine.agentId),
                eq(stopLine.kind, DEVICE_AGENT_LINE_KIND.STOP),
                gt(stopLine.seq, deviceAgentLine.seq),
              ),
            )})`,
        })
        .from(deviceAgentLine)
        .where(
          and(
            eq(deviceAgentLine.userId, userId),
            eq(deviceAgentLine.agentId, agentId),
            eq(deviceAgentLine.kind, DEVICE_AGENT_LINE_KIND.LAUNCH),
          ),
        )
        .orderBy(desc(deviceAgentLine.seq))
        .limit(1),
    ),
});

const findLineStanding = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String }),
  Result: DeviceAgentLineStandingSchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({
          settled: sql<boolean>`${deviceAgentLine.settledAt} is not null`,
          exitCode: deviceAgentLine.exitCode,
          agentId: deviceAgentLine.agentId,
          deviceId: deviceAgentLine.deviceId,
          kind: deviceAgentLine.kind,
        })
        .from(deviceAgentLine)
        .where(and(eq(deviceAgentLine.id, id), eq(deviceAgentLine.userId, userId))),
    ),
});

const insertLine = SqlSchema.findAll({
  Request: Schema.Struct({
    id: Schema.UndefinedOr(Schema.String),
    userId: Schema.String,
    agentId: Schema.String,
    kind: LineKindSchema,
    payload: deviceAgentObjectSchema,
    sealedSecrets: Schema.NullOr(Schema.String),
    /** The capability the Mac must have registered for the line to be queued, none for a kind every Mac takes. */
    capability: Schema.UndefinedOr(Schema.Literals(Object.values(DEVICE_CAPABILITY))),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String, seq: Schema.Number }),
  execute: ({ id, userId, agentId, kind, payload, sealedSecrets, capability, now }) =>
    Database.use((db) =>
      db
        .insert(deviceAgentLine)
        .select((qb) =>
          qb
            .select({
              id: sql<string>`coalesce(${id ?? null}::uuid, gen_random_uuid())`.as("id"),
              agentId: sql<string>`${agentTable.id}`.as("agent_id"),
              userId: sql<string>`${agentTable.userId}`.as("user_id"),
              deviceId: sql<string>`${device.id}`.as("device_id"),
              kind: sql<DeviceAgentLineKind>`${kind}`.as("kind"),
              payload: sql<DeviceAgentObject>`${JSON.stringify(payload)}::jsonb`.as("payload"),
              sealedSecrets: sql<string | null>`${sealedSecrets}::text`.as("sealed_secrets"),
              createdAt: sql<Date>`${now}::timestamptz`.as("created_at"),
            })
            .from(agentTable)
            .innerJoin(device, eq(device.id, agentTable.deviceId))
            .where(
              capability === undefined
                ? pinnedAgent(userId, agentId)
                : and(
                    pinnedAgent(userId, agentId),
                    arrayContains(device.capabilities, [capability]),
                  ),
            ),
        )
        .returning({ id: deviceAgentLine.id, seq: deviceAgentLine.seq }),
    ),
});

const findWaitingLines = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, deviceId: Schema.String }),
  Result: WaitingLineSchema,
  execute: ({ userId, deviceId }) =>
    Database.use((db) =>
      db
        .select({
          id: deviceAgentLine.id,
          agentId: deviceAgentLine.agentId,
          seq: deviceAgentLine.seq,
          kind: deviceAgentLine.kind,
          payload: deviceAgentLine.payload,
        })
        .from(deviceAgentLine)
        .where(
          and(
            eq(deviceAgentLine.userId, userId),
            eq(deviceAgentLine.deviceId, deviceId),
            isNull(deviceAgentLine.claimedAt),
          ),
        )
        .orderBy(asc(deviceAgentLine.seq)),
    ),
});

const claimLine = SqlSchema.findOneOption({
  Request: Schema.Struct({
    ...DeviceRowKeySchema.fields,
    claimToken: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  Result: ClaimedLineSchema,
  execute: ({ userId, deviceId, id, claimToken, now }) =>
    Database.use((db) =>
      db
        .update(deviceAgentLine)
        .set({ claimedAt: now, claimToken, sealedSecrets: null })
        .from(lineBefore)
        .where(
          and(
            eq(lineBefore.id, deviceAgentLine.id),
            eq(deviceAgentLine.id, id),
            eq(deviceAgentLine.userId, userId),
            eq(deviceAgentLine.deviceId, deviceId),
            isNull(deviceAgentLine.claimedAt),
          ),
        )
        .returning({
          id: deviceAgentLine.id,
          agentId: deviceAgentLine.agentId,
          seq: deviceAgentLine.seq,
          kind: deviceAgentLine.kind,
          payload: deviceAgentLine.payload,
          // Note that we read the secrets off the row as it stood, because
          // `returning` reads the updated row, whose secrets are cleared.
          sealedSecrets: lineBefore.sealedSecrets,
        }),
    ),
});

/** A line the Mac claimed under the token given and has not settled, without its secrets, which its claim took. */
const findClaimedUnder = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...DeviceRowKeySchema.fields, claimToken: Schema.String }),
  Result: WaitingLineSchema,
  execute: ({ userId, deviceId, id, claimToken }) =>
    Database.use((db) =>
      db
        .select({
          id: deviceAgentLine.id,
          agentId: deviceAgentLine.agentId,
          seq: deviceAgentLine.seq,
          kind: deviceAgentLine.kind,
          payload: deviceAgentLine.payload,
        })
        .from(deviceAgentLine)
        .where(
          and(
            eq(deviceAgentLine.id, id),
            eq(deviceAgentLine.userId, userId),
            eq(deviceAgentLine.deviceId, deviceId),
            eq(deviceAgentLine.claimToken, claimToken),
            isNotNull(deviceAgentLine.claimedAt),
            isNull(deviceAgentLine.settledAt),
          ),
        ),
    ),
});

const writeLineSettled = SqlSchema.findAll({
  Request: Schema.Struct({
    ...DeviceRowKeySchema.fields,
    exitCode: Schema.NullOr(Schema.Number),
    now: Schema.Date,
  }),
  Result: DeviceAgentSettledLineSchema,
  execute: ({ userId, deviceId, id, exitCode, now }) =>
    Database.use((db) =>
      db
        .update(deviceAgentLine)
        .set({ settledAt: now, exitCode })
        .where(
          and(
            eq(deviceAgentLine.id, id),
            eq(deviceAgentLine.userId, userId),
            eq(deviceAgentLine.deviceId, deviceId),
            isNotNull(deviceAgentLine.claimedAt),
            isNull(deviceAgentLine.settledAt),
          ),
        )
        .returning({ agentId: deviceAgentLine.agentId, kind: deviceAgentLine.kind }),
    ),
});

const findLineSettled = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String }),
  Result: Schema.Struct({ exitCode: Schema.NullOr(Schema.Number) }),
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({ exitCode: deviceAgentLine.exitCode })
        .from(deviceAgentLine)
        .where(
          and(
            eq(deviceAgentLine.id, id),
            eq(deviceAgentLine.userId, userId),
            isNotNull(deviceAgentLine.settledAt),
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
    args: deviceAgentObjectSchema,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, agentId, kind, args, now }) =>
    Database.use((db) =>
      db
        .insert(deviceAgentRequest)
        .select((qb) =>
          qb
            .select({
              id: sql<string>`${id}::uuid`.as("id"),
              agentId: sql<string>`${agentTable.id}`.as("agent_id"),
              userId: sql<string>`${agentTable.userId}`.as("user_id"),
              deviceId: sql<string>`${device.id}`.as("device_id"),
              kind: sql<DeviceAgentRequestKind>`${kind}`.as("kind"),
              args: sql<DeviceAgentObject>`${JSON.stringify(args)}::jsonb`.as("args"),
              createdAt: sql<Date>`${now}::timestamptz`.as("created_at"),
            })
            .from(agentTable)
            .innerJoin(device, eq(device.id, agentTable.deviceId))
            .where(pinnedAgent(userId, agentId)),
        )
        .returning({ id: deviceAgentRequest.id }),
    ),
});

/**
 * A request waiting for the account's Mac given, of a kind this build
 * knows. Note that a row of a kind an earlier build queued and never
 * withdrew is passed over rather than read, because one row the decode
 * refuses would fail the Mac's whole read until the expiry took it.
 */
function requestWaiting(userId: string, deviceId: string) {
  return and(
    eq(deviceAgentRequest.userId, userId),
    eq(deviceAgentRequest.deviceId, deviceId),
    isNull(deviceAgentRequest.claimedAt),
    inArray(deviceAgentRequest.kind, Object.values(DEVICE_AGENT_REQUEST_KIND)),
  );
}

const findWaitingRequests = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, deviceId: Schema.String }),
  Result: WaitingRequestSchema,
  execute: ({ userId, deviceId }) =>
    Database.use((db) =>
      db
        .select({
          id: deviceAgentRequest.id,
          agentId: deviceAgentRequest.agentId,
          kind: deviceAgentRequest.kind,
          args: deviceAgentRequest.args,
        })
        .from(deviceAgentRequest)
        .where(requestWaiting(userId, deviceId))
        .orderBy(asc(deviceAgentRequest.createdAt)),
    ),
});

const claimRequest = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...DeviceRowKeySchema.fields, now: Schema.Date }),
  Result: WaitingRequestSchema,
  execute: ({ userId, deviceId, id, now }) =>
    Database.use((db) =>
      db
        .update(deviceAgentRequest)
        .set({ claimedAt: now })
        .where(and(eq(deviceAgentRequest.id, id), requestWaiting(userId, deviceId)))
        .returning({
          id: deviceAgentRequest.id,
          agentId: deviceAgentRequest.agentId,
          kind: deviceAgentRequest.kind,
          args: deviceAgentRequest.args,
        }),
    ),
});

const writeAnswer = SqlSchema.findAll({
  Request: Schema.Struct({
    ...DeviceRowKeySchema.fields,
    answer: deviceAgentAnswerSchema,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, deviceId, id, answer, now }) =>
    Database.use((db) =>
      db
        .update(deviceAgentRequest)
        .set({ settledAt: now, bytes: answer.bytes })
        .where(
          and(
            eq(deviceAgentRequest.id, id),
            eq(deviceAgentRequest.userId, userId),
            eq(deviceAgentRequest.deviceId, deviceId),
            isNotNull(deviceAgentRequest.claimedAt),
            isNull(deviceAgentRequest.settledAt),
          ),
        )
        .returning({ id: deviceAgentRequest.id }),
    ),
});

const findAnswer = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String }),
  Result: AnswerRowSchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({
          kind: deviceAgentRequest.kind,
          bytes: deviceAgentRequest.bytes,
        })
        .from(deviceAgentRequest)
        .where(
          and(
            eq(deviceAgentRequest.id, id),
            eq(deviceAgentRequest.userId, userId),
            isNotNull(deviceAgentRequest.settledAt),
          ),
        ),
    ),
});

const deleteRequest = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String }),
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .delete(deviceAgentRequest)
        .where(and(eq(deviceAgentRequest.id, id), eq(deviceAgentRequest.userId, userId))),
    ),
});

const deleteExpiredLines = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, before: Schema.Date }),
  execute: ({ userId, before }) =>
    Database.use((db) =>
      db.delete(deviceAgentLine).where(
        and(
          eq(deviceAgentLine.userId, userId),
          lt(deviceAgentLine.createdAt, before),
          // A line claimed and not yet settled is a runner still at work, whose exit is still to come.
          or(isNull(deviceAgentLine.claimedAt), isNotNull(deviceAgentLine.settledAt)),
        ),
      ),
    ),
});

const findOpenLaunches = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, deviceId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, deviceId }) =>
    Database.use((db) =>
      db
        .select({ id: deviceAgentLine.id })
        .from(deviceAgentLine)
        .where(
          and(
            eq(deviceAgentLine.userId, userId),
            eq(deviceAgentLine.deviceId, deviceId),
            eq(deviceAgentLine.kind, DEVICE_AGENT_LINE_KIND.LAUNCH),
            isNull(deviceAgentLine.settledAt),
            sql`not exists (${db
              .select({ one: sql`1` })
              .from(stopLine)
              .where(
                and(
                  eq(stopLine.agentId, deviceAgentLine.agentId),
                  eq(stopLine.kind, DEVICE_AGENT_LINE_KIND.STOP),
                  gt(stopLine.seq, deviceAgentLine.seq),
                ),
              )})`,
          ),
        )
        .orderBy(asc(deviceAgentLine.seq)),
    ),
});

/** A launch line whose device's lease lapsed, with the device's name for the words its turn ends with. */
const LapsedLaunchSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  agentId: Schema.String,
  deviceName: Schema.String,
});

export type DeviceAgentLapsedLaunch = typeof LapsedLaunchSchema.Type;

/** A launch line still open, claimed or not, whose device last beat before the instant given. */
function lapsedLaunch(seenBefore: Date) {
  return and(
    eq(deviceAgentLine.kind, DEVICE_AGENT_LINE_KIND.LAUNCH),
    isNull(deviceAgentLine.settledAt),
    eq(device.id, deviceAgentLine.deviceId),
    lt(device.lastSeenAt, seenBefore),
  );
}

const findLapsedLaunches = SqlSchema.findAll({
  Request: Schema.Struct({ seenBefore: Schema.Date, limit: Schema.Int }),
  Result: LapsedLaunchSchema,
  execute: ({ seenBefore, limit }) =>
    Database.use((db) =>
      db
        .select({
          id: deviceAgentLine.id,
          userId: deviceAgentLine.userId,
          agentId: deviceAgentLine.agentId,
          deviceName: device.name,
        })
        .from(deviceAgentLine)
        .innerJoin(device, eq(device.id, deviceAgentLine.deviceId))
        .where(lapsedLaunch(seenBefore))
        .orderBy(asc(deviceAgentLine.seq))
        .limit(limit),
    ),
});

const writeLapsedSettled = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    id: Schema.String,
    seenBefore: Schema.Date,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ agentId: Schema.String }),
  execute: ({ userId, id, seenBefore, now }) =>
    Database.use((db) =>
      db
        .update(deviceAgentLine)
        .set({
          settledAt: now,
          exitCode: null,
          // Note that a line still waiting is marked claimed and its secrets cleared too, because
          // a device that comes back must never take a launch whose run was already taken from it.
          claimedAt: sql`coalesce(${deviceAgentLine.claimedAt}, ${now}::timestamptz)`,
          sealedSecrets: null,
        })
        .from(device)
        .where(
          and(
            eq(deviceAgentLine.id, id),
            eq(deviceAgentLine.userId, userId),
            lapsedLaunch(seenBefore),
          ),
        )
        .returning({ agentId: deviceAgentLine.agentId }),
    ),
});

const deleteExpiredRequests = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, before: Schema.Date }),
  execute: ({ userId, before }) =>
    Database.use((db) =>
      db
        .delete(deviceAgentRequest)
        .where(
          and(eq(deviceAgentRequest.userId, userId), lt(deviceAgentRequest.createdAt, before)),
        ),
    ),
});

/**
 * Queues one line for the account's agent, to the Mac it is pinned to, at
 * the next place in the order every line is queued in, with the sealed
 * secrets a launch line carries, its caller holding the agent's runner
 * lease; its id and place, or none where the account holds no such agent
 * running on a Mac of its own, or the Mac never registered the capability
 * the line's kind needs.
 */
export function queueDeviceAgentLine(
  userId: string,
  line: {
    /** The id its caller minted, so it can name the line before it is queued; a fresh one where none is named. */
    readonly id?: string;
    readonly agentId: string;
    readonly kind: DeviceAgentLineKind;
    readonly payload: DeviceAgentObject;
    readonly sealedSecrets?: string;
  },
): DeviceAgentEffect<Option.Option<{ readonly id: string; readonly seq: number }>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      insertLine({
        id: line.id,
        userId,
        agentId: line.agentId,
        kind: line.kind,
        payload: line.payload,
        sealedSecrets: line.sealedSecrets ?? null,
        capability: DEVICE_AGENT_LINE_CAPABILITY[line.kind],
        now,
      }),
      (rows) => Option.fromNullishOr(rows[0]),
    ),
  );
}

/**
 * The local agent whose conversation runs in the session named, its starter
 * and its Mac; nothing where no agent on a Mac runs in it. Read with no
 * account in hand, because a machine is asked by the session alone; only
 * for a session id the service minted, which answers nothing a member wrote.
 */
export function deviceAgentOfSession(
  runtimeSessionId: string,
): DeviceAgentEffect<Option.Option<DeviceAgentPin>> {
  return findPinOfSession({ runtimeSessionId });
}

/** The local agent under the id, its starter and its Mac; nothing for an agent in a sandbox. Read with no account in hand, as above, only for an id a machine's place carries. */
export function deviceAgentPin(agentId: string): DeviceAgentEffect<Option.Option<DeviceAgentPin>> {
  return findPin({ agentId });
}

/** The account's agent's newest launch line, as its machine reads whether its runner runs; nothing where none stands. */
export function latestDeviceAgentLaunch(
  userId: string,
  agentId: string,
): DeviceAgentEffect<Option.Option<DeviceAgentLaunch>> {
  return findLatestLaunch({ userId, agentId });
}

/** Whether the account's line was settled and with what exit, and whose it is; nothing where no such line stands. */
export function deviceAgentLineStanding(
  userId: string,
  id: string,
): DeviceAgentEffect<Option.Option<DeviceAgentLineStanding>> {
  return findLineStanding({ userId, id });
}

/** The lines waiting for the account's Mac, in the order they were queued, without their secrets. */
export function deviceAgentLinesWaiting(
  userId: string,
  deviceId: string,
): DeviceAgentEffect<readonly DeviceAgentWaitingLine[]> {
  return findWaitingLines({ userId, deviceId });
}

/**
 * Claims one line for the account's Mac under the token its Mac minted for
 * it, where it names one, handing over its sealed secrets and clearing them
 * in the same statement. The same claim asked again under the same token is
 * answered the line again, without its secrets, until the line is settled.
 * None where it is not that Mac's, another claim took it first, it was
 * settled, or the expiry withdrew it.
 *
 * Note that the claim asked again is a read beside the claim rather than a
 * wider claim, because only the statement that takes a waiting line ever
 * reads its secrets, so no two answers can both carry them.
 */
export function claimDeviceAgentLine(
  userId: string,
  deviceId: string,
  id: string,
  claimToken?: string,
): DeviceAgentEffect<Option.Option<DeviceAgentClaimedLine>> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const claimed = yield* claimLine({ userId, deviceId, id, claimToken: claimToken ?? null, now });
    if (Option.isSome(claimed) || claimToken === undefined) {
      return Option.map(claimed, (line) => ({ ...line, secretsGone: false }));
    }
    const again = yield* findClaimedUnder({ userId, deviceId, id, claimToken });
    return Option.map(again, (line) => ({
      ...line,
      sealedSecrets: null,
      secretsGone: line.kind === DEVICE_AGENT_LINE_KIND.LAUNCH,
    }));
  });
}

/**
 * Settles a line the account's Mac claimed, with its runner's exit code
 * where it is a launch line whose runner exited, answering the line's agent
 * and kind; none where that Mac holds no such line claimed and unsettled.
 */
export function settleDeviceAgentLine(
  userId: string,
  deviceId: string,
  id: string,
  exitCode?: number,
): DeviceAgentEffect<Option.Option<DeviceAgentSettledLine>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      writeLineSettled({ userId, deviceId, id, exitCode: exitCode ?? null, now }),
      (rows) => Option.fromNullishOr(rows[0]),
    ),
  );
}

/** A line's exit code once its Mac settled it, null for one settled with none; nothing while it waits or runs. */
export function deviceAgentLineSettlement(
  userId: string,
  id: string,
): DeviceAgentEffect<Option.Option<{ readonly exitCode: number | null }>> {
  return findLineSettled({ userId, id });
}

/**
 * The ids of the account's launch lines to the device given that are still
 * open, claimed or not, with no stop queued after them, oldest first: the
 * runs the service holds the device to, which its beat answers so it stops
 * what it holds no longer and settles what it runs nothing for.
 */
export function openDeviceAgentLaunches(
  userId: string,
  deviceId: string,
): DeviceAgentEffect<readonly string[]> {
  return Effect.map(findOpenLaunches({ userId, deviceId }), (rows) => rows.map((row) => row.id));
}

/**
 * The launch lines still open, claimed or not, of every account's devices
 * that last beat before `seenBefore`, oldest first, at most `limit`: the runs
 * whose device's lease lapsed (`DEVICE_LEASE`). Read with no account in hand,
 * because the maintenance sweep reads every account's.
 */
export function lapsedDeviceAgentLaunches(
  seenBefore: Date,
  limit: number,
): DeviceAgentEffect<readonly DeviceAgentLapsedLaunch[]> {
  return findLapsedLaunches({ seenBefore, limit });
}

/**
 * Settles the account's launch line as its runner gone, with no exit code,
 * while it is still open and its device still last beat before
 * `seenBefore`, answering the line's agent; none where the device settled it
 * first, or beat since. A line its device never claimed is marked claimed and
 * its secrets cleared in the same statement, so no device takes it after.
 */
export function settleLapsedDeviceAgentLine(
  userId: string,
  id: string,
  seenBefore: Date,
): DeviceAgentEffect<Option.Option<{ readonly agentId: string }>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(writeLapsedSettled({ userId, id, seenBefore, now }), (rows) =>
      Option.fromNullishOr(rows[0]),
    ),
  );
}

/**
 * Queues one request for the account's agent, to the Mac it is pinned to,
 * under the id its caller minted; false where the account holds no such
 * agent running on a Mac of its own.
 */
export function queueDeviceAgentRequest(
  userId: string,
  request: {
    readonly id: string;
    readonly agentId: string;
    readonly kind: DeviceAgentRequestKind;
    readonly args: DeviceAgentObject;
  },
): DeviceAgentEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(insertRequest({ userId, ...request, now }), (rows) => rows.length > 0),
  );
}

/** The requests waiting for the account's Mac, oldest first. */
export function deviceAgentRequestsWaiting(
  userId: string,
  deviceId: string,
): DeviceAgentEffect<readonly DeviceAgentWaitingRequest[]> {
  return findWaitingRequests({ userId, deviceId });
}

/** Claims one request for the account's Mac; none where it is not that Mac's, another claim took it first, or it was withdrawn. */
export function claimDeviceAgentRequest(
  userId: string,
  deviceId: string,
  id: string,
): DeviceAgentEffect<Option.Option<DeviceAgentWaitingRequest>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => claimRequest({ userId, deviceId, id, now }));
}

/**
 * Keeps the answer to a request the account's Mac claimed; false where that
 * Mac holds no such request claimed and unanswered. An answer past the
 * bound fails its decode and writes nothing.
 */
export function answerDeviceAgentRequest(
  userId: string,
  deviceId: string,
  id: string,
  answer: DeviceAgentAnswer,
): DeviceAgentEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(writeAnswer({ userId, deviceId, id, answer, now }), (rows) => rows.length > 0),
  );
}

/** A request's answer once its Mac answered it; nothing while it waits or runs. */
export function deviceAgentRequestAnswer(
  userId: string,
  id: string,
): DeviceAgentEffect<Option.Option<DeviceAgentAnswer>> {
  return Effect.flatMap(findAnswer({ userId, id }), (row) =>
    Option.match(row, {
      onNone: () => Effect.succeed(Option.none()),
      onSome: (answer) =>
        Effect.map(decodeAnswer({ kind: answer.kind, bytes: answer.bytes }), Option.some),
    }),
  );
}

/** Withdraws a request, answered or not, once its caller stops waiting on it. */
export function withdrawDeviceAgentRequest(userId: string, id: string): DeviceAgentEffect<void> {
  return deleteRequest({ userId, id });
}

/**
 * Withdraws the account's lines and requests queued before the instant
 * given: every request, and every line but one claimed and not yet
 * settled, whose runner is still at work and whose exit is still to come.
 */
export function withdrawExpiredDeviceAgentRows(
  userId: string,
  before: Date,
): DeviceAgentEffect<void> {
  return Effect.andThen(
    deleteExpiredLines({ userId, before }),
    deleteExpiredRequests({ userId, before }),
  );
}
