import { AGENT_MACHINE } from "@repo/features/agent-wire";
import {
  DEVICE_AGENT_BOUNDS,
  DEVICE_AGENT_LINE_CAPABILITY,
  DEVICE_AGENT_LINE_KIND,
  DEVICE_AGENT_REQUEST_KIND,
  DEVICE_CAPABILITY,
  DEVICE_LAUNCH_STEPS,
  type DeviceAgentAnswer,
  type DeviceAgentLineKind,
  type DeviceAgentObject,
  type DeviceAgentRequestKind,
  type DeviceLaunchStep,
  deviceAgentAnswerSchema,
  deviceAgentObjectSchema,
  HOST_UPDATE,
} from "@repo/features/device-agent-wire";
import {
  and,
  arrayContains,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
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
import { conversations, turns } from "../schemas/storage.js";
import { ENDED_TURN_STATUSES } from "./agent-store.js";

type DeviceAgentEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const LineKindSchema = Schema.Literals(Object.values(DEVICE_AGENT_LINE_KIND));

const RequestKindSchema = Schema.Literals(Object.values(DEVICE_AGENT_REQUEST_KIND));

const DeviceRowKeySchema = Schema.Struct({
  userId: Schema.String,
  deviceId: Schema.String,
  id: Schema.String,
});

const WaitingLineSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  seq: Schema.Number,
  kind: LineKindSchema,
  payload: deviceAgentObjectSchema,
});

export type DeviceAgentWaitingLine = typeof WaitingLineSchema.Type;

const ClaimedLineSchema = Schema.Struct({
  ...WaitingLineSchema.fields,
  sealedSecrets: Schema.NullOr(Schema.String),
});

export type DeviceAgentClaimedLine = typeof ClaimedLineSchema.Type & {
  readonly secretsGone: boolean;
};

const WaitingRequestSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  kind: RequestKindSchema,
  args: deviceAgentObjectSchema,
});

export type DeviceAgentWaitingRequest = typeof WaitingRequestSchema.Type;

const AnswerRowSchema = Schema.Struct({
  kind: RequestKindSchema,
  bytes: Schema.NullOr(Schema.Uint8Array),
});

const decodeAnswer = Schema.decodeUnknownEffect(deviceAgentAnswerSchema);

const lineBefore = alias(deviceAgentLine, "line_before");

function pinnedAgent(userId: string, agentId: string) {
  return and(
    eq(agentTable.id, agentId),
    eq(agentTable.userId, userId),
    eq(agentTable.machine, AGENT_MACHINE.DEVICE),
    eq(device.userId, userId),
  );
}

const DeviceAgentPinSchema = Schema.Struct({
  userId: Schema.String,
  agentId: Schema.String,
  deviceId: Schema.NullOr(Schema.String),
});

export type DeviceAgentPin = typeof DeviceAgentPinSchema.Type;

const DeviceAgentLaunchSchema = Schema.Struct({
  id: Schema.String,
  payload: deviceAgentObjectSchema,
  createdAt: Schema.Date,
  claimed: Schema.Boolean,
  step: Schema.NullOr(Schema.String),
  settled: Schema.Boolean,
  exitCode: Schema.NullOr(Schema.Number),
  stopped: Schema.Boolean,
});

export type DeviceAgentLaunch = typeof DeviceAgentLaunchSchema.Type;

const DeviceAgentSettledLineSchema = Schema.Struct({
  agentId: Schema.String,
  kind: LineKindSchema,
});

export type DeviceAgentSettledLine = typeof DeviceAgentSettledLineSchema.Type;

const DeviceAgentLineStandingSchema = Schema.Struct({
  ...DeviceAgentSettledLineSchema.fields,
  settled: Schema.Boolean,
  exitCode: Schema.NullOr(Schema.Number),
  deviceId: Schema.String,
});

export type DeviceAgentLineStanding = typeof DeviceAgentLineStandingSchema.Type;

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

const findAwaitsUpdate = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ id: device.id })
        .from(agentTable)
        .innerJoin(device, eq(device.id, agentTable.deviceId))
        .where(and(pinnedAgent(userId, agentId), eq(device.updatePhase, HOST_UPDATE.WAITING))),
    ),
});

const stopLine = alias(deviceAgentLine, "stop_line");

const laterLine = alias(deviceAgentLine, "later_line");

const findQueuedAfter = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    launchId: Schema.String,
    kind: LineKindSchema,
    payload: deviceAgentObjectSchema,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, launchId, kind, payload }) =>
    Database.use((db) =>
      db
        .select({ id: laterLine.id })
        .from(deviceAgentLine)
        .innerJoin(
          laterLine,
          and(
            eq(laterLine.agentId, deviceAgentLine.agentId),
            gt(laterLine.seq, deviceAgentLine.seq),
          ),
        )
        .where(
          and(
            eq(deviceAgentLine.id, launchId),
            eq(deviceAgentLine.userId, userId),
            eq(deviceAgentLine.kind, DEVICE_AGENT_LINE_KIND.LAUNCH),
            eq(laterLine.userId, userId),
            eq(laterLine.kind, kind),
            sql`${laterLine.payload} = ${JSON.stringify(payload)}::jsonb`,
          ),
        )
        .limit(1),
    ),
});

const findLatestLaunch = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: DeviceAgentLaunchSchema,
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({
          id: deviceAgentLine.id,
          payload: deviceAgentLine.payload,
          createdAt: deviceAgentLine.createdAt,
          claimed: sql<boolean>`${deviceAgentLine.claimedAt} is not null`,
          step: deviceAgentLine.launchStep,
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
    Database.use((db) => {
      const inOrder = sql`over (order by ${deviceAgentLine.seq})`;
      const waiting = db
        .select({
          id: deviceAgentLine.id,
          agentId: deviceAgentLine.agentId,
          seq: deviceAgentLine.seq,
          kind: deviceAgentLine.kind,
          payload: deviceAgentLine.payload,
          place: sql<number>`row_number() ${inOrder}`.as("place"),
          through: sql<number>`sum(octet_length(${deviceAgentLine.payload}::text)) ${inOrder}`.as(
            "through",
          ),
        })
        .from(deviceAgentLine)
        .where(
          and(
            eq(deviceAgentLine.userId, userId),
            eq(deviceAgentLine.deviceId, deviceId),
            isNull(deviceAgentLine.claimedAt),
          ),
        )
        .as("waiting");
      return db
        .select({
          id: waiting.id,
          agentId: waiting.agentId,
          seq: waiting.seq,
          kind: waiting.kind,
          payload: waiting.payload,
        })
        .from(waiting)
        .where(
          or(eq(waiting.place, 1), lte(waiting.through, DEVICE_AGENT_BOUNDS.MAX_LINES_READ_BYTES)),
        )
        .orderBy(asc(waiting.seq));
    }),
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
          sealedSecrets: lineBefore.sealedSecrets,
        }),
    ),
});

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

const LAUNCH_STEP_ORDER = sql`array[${sql.join(
  DEVICE_LAUNCH_STEPS.map((step) => sql`${step}`),
  sql`, `,
)}]::text[]`;

const writeLaunchStep = SqlSchema.findAll({
  Request: Schema.Struct({
    ...DeviceRowKeySchema.fields,
    step: Schema.Literals(DEVICE_LAUNCH_STEPS),
  }),
  Result: Schema.Struct({ agentId: Schema.String }),
  execute: ({ userId, deviceId, id, step }) =>
    Database.use((db) =>
      db
        .update(deviceAgentLine)
        .set({
          launchStep: sql<DeviceLaunchStep>`case
            when ${deviceAgentLine.launchStep} is not null and coalesce(
              array_position(${LAUNCH_STEP_ORDER}, ${deviceAgentLine.launchStep})
                >= array_position(${LAUNCH_STEP_ORDER}, ${step}::text),
              true
            )
            then ${deviceAgentLine.launchStep}
            else ${step}::text
          end`,
        })
        .where(
          and(
            eq(deviceAgentLine.id, id),
            eq(deviceAgentLine.userId, userId),
            eq(deviceAgentLine.deviceId, deviceId),
            eq(deviceAgentLine.kind, DEVICE_AGENT_LINE_KIND.LAUNCH),
            isNotNull(deviceAgentLine.claimedAt),
            isNull(deviceAgentLine.settledAt),
          ),
        )
        .returning({ agentId: deviceAgentLine.agentId }),
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
      db
        .delete(deviceAgentLine)
        .where(
          and(
            eq(deviceAgentLine.userId, userId),
            lt(deviceAgentLine.createdAt, before),
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

const findLiveAgents = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, deviceId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, deviceId }) =>
    Database.use((db) =>
      db
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(
          and(
            eq(agentTable.userId, userId),
            eq(agentTable.deviceId, deviceId),
            isNull(agentTable.archivedAt),
          ),
        )
        .orderBy(asc(agentTable.createdAt), asc(agentTable.id)),
    ),
});

const LapsedLaunchSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  agentId: Schema.String,
  deviceName: Schema.String,
});

export type DeviceAgentLapsedLaunch = typeof LapsedLaunchSchema.Type;

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

const writeGoneSettled = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    deviceIds: Schema.Array(Schema.String),
    now: Schema.Date,
  }),
  execute: ({ userId, deviceIds, now }) =>
    Database.use((db) =>
      db
        .update(deviceAgentLine)
        .set({
          settledAt: now,
          exitCode: null,
          claimedAt: sql`coalesce(${deviceAgentLine.claimedAt}, ${now}::timestamptz)`,
          sealedSecrets: null,
        })
        .where(
          and(
            eq(deviceAgentLine.userId, userId),
            inArray(deviceAgentLine.deviceId, [...deviceIds]),
            eq(deviceAgentLine.kind, DEVICE_AGENT_LINE_KIND.LAUNCH),
            isNull(deviceAgentLine.settledAt),
          ),
        ),
    ),
});

const WarmLaunchSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  agentId: Schema.String,
  sessionId: Schema.String,
});

export type DeviceAgentWarmLaunch = typeof WarmLaunchSchema.Type;

const newerLaunch = alias(deviceAgentLine, "newer_launch");

const findWarmLaunches = SqlSchema.findAll({
  Request: Schema.Struct({
    seenSince: Schema.Date,
    endedBefore: Schema.Date,
    waitingEndedBefore: Schema.Date,
    limit: Schema.Int,
  }),
  Result: WarmLaunchSchema,
  execute: ({ seenSince, endedBefore, waitingEndedBefore, limit }) =>
    Database.use((db) => {
      const newestTurn = db
        .select({ status: turns.status, settledAt: turns.settledAt })
        .from(turns)
        .where(eq(turns.conversationId, conversations.id))
        .orderBy(desc(turns.queuedAt), desc(turns.id))
        .limit(1)
        .as("newest_turn");
      const endedBy = (instant: Date) =>
        or(isNull(newestTurn.settledAt), lt(newestTurn.settledAt, instant));
      return db
        .select({
          id: deviceAgentLine.id,
          userId: deviceAgentLine.userId,
          agentId: deviceAgentLine.agentId,
          sessionId: sql<string>`${conversations.runtimeSessionId}`,
        })
        .from(deviceAgentLine)
        .innerJoin(device, eq(device.id, deviceAgentLine.deviceId))
        .innerJoin(agentTable, eq(agentTable.id, deviceAgentLine.agentId))
        .innerJoin(conversations, eq(conversations.id, agentTable.conversationId))
        .innerJoinLateral(newestTurn, sql`true`)
        .where(
          and(
            eq(deviceAgentLine.kind, DEVICE_AGENT_LINE_KIND.LAUNCH),
            isNull(deviceAgentLine.settledAt),
            eq(agentTable.machine, AGENT_MACHINE.DEVICE),
            isNotNull(conversations.runtimeSessionId),
            gte(device.lastSeenAt, seenSince),
            inArray(newestTurn.status, [...ENDED_TURN_STATUSES]),
            or(
              endedBy(endedBefore),
              and(eq(device.updatePhase, HOST_UPDATE.WAITING), endedBy(waitingEndedBefore)),
            ),
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
            sql`not exists (${db
              .select({ one: sql`1` })
              .from(newerLaunch)
              .where(
                and(
                  eq(newerLaunch.agentId, deviceAgentLine.agentId),
                  eq(newerLaunch.kind, DEVICE_AGENT_LINE_KIND.LAUNCH),
                  gt(newerLaunch.seq, deviceAgentLine.seq),
                ),
              )})`,
          ),
        )
        .orderBy(asc(deviceAgentLine.seq))
        .limit(limit);
    }),
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

export function queueDeviceAgentLine(
  userId: string,
  line: {
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

export function deviceAgentOfSession(
  runtimeSessionId: string,
): DeviceAgentEffect<Option.Option<DeviceAgentPin>> {
  return findPinOfSession({ runtimeSessionId });
}

export function deviceAgentPin(agentId: string): DeviceAgentEffect<Option.Option<DeviceAgentPin>> {
  return findPin({ agentId });
}

export function deviceAgentAwaitsUpdate(
  userId: string,
  agentId: string,
): DeviceAgentEffect<boolean> {
  return Effect.map(findAwaitsUpdate({ userId, agentId }), (rows) => rows.length > 0);
}

export function deviceAgentLineQueuedAfter(
  userId: string,
  launchId: string,
  line: { readonly kind: DeviceAgentLineKind; readonly payload: DeviceAgentObject },
): DeviceAgentEffect<boolean> {
  return Effect.map(
    findQueuedAfter({ userId, launchId, kind: line.kind, payload: line.payload }),
    (rows) => rows.length > 0,
  );
}

export function latestDeviceAgentLaunch(
  userId: string,
  agentId: string,
): DeviceAgentEffect<Option.Option<DeviceAgentLaunch>> {
  return findLatestLaunch({ userId, agentId });
}

export function deviceAgentLineStanding(
  userId: string,
  id: string,
): DeviceAgentEffect<Option.Option<DeviceAgentLineStanding>> {
  return findLineStanding({ userId, id });
}

export function deviceAgentLinesWaiting(
  userId: string,
  deviceId: string,
): DeviceAgentEffect<readonly DeviceAgentWaitingLine[]> {
  return findWaitingLines({ userId, deviceId });
}

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

export function stepDeviceAgentLaunch(
  userId: string,
  deviceId: string,
  id: string,
  step: DeviceLaunchStep,
): DeviceAgentEffect<boolean> {
  return Effect.map(writeLaunchStep({ userId, deviceId, id, step }), (rows) => rows.length > 0);
}

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

export function deviceAgentLineSettlement(
  userId: string,
  id: string,
): DeviceAgentEffect<Option.Option<{ readonly exitCode: number | null }>> {
  return findLineSettled({ userId, id });
}

export function openDeviceAgentLaunches(
  userId: string,
  deviceId: string,
): DeviceAgentEffect<readonly string[]> {
  return Effect.map(findOpenLaunches({ userId, deviceId }), (rows) => rows.map((row) => row.id));
}

export function liveDeviceAgents(
  userId: string,
  deviceId: string,
): DeviceAgentEffect<readonly string[]> {
  return Effect.map(findLiveAgents({ userId, deviceId }), (rows) => rows.map((row) => row.id));
}

export function lapsedDeviceAgentLaunches(
  seenBefore: Date,
  limit: number,
): DeviceAgentEffect<readonly DeviceAgentLapsedLaunch[]> {
  return findLapsedLaunches({ seenBefore, limit });
}

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

export function settleGoneDeviceAgentLaunches(
  userId: string,
  deviceIds: readonly string[],
): DeviceAgentEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => writeGoneSettled({ userId, deviceIds, now }));
}

export function warmDeviceAgentLaunches(read: {
  readonly seenSince: Date;
  readonly endedBefore: Date;
  readonly waitingEndedBefore: Date;
  readonly limit: number;
}): DeviceAgentEffect<readonly DeviceAgentWarmLaunch[]> {
  return findWarmLaunches(read);
}

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

export function deviceAgentRequestsWaiting(
  userId: string,
  deviceId: string,
): DeviceAgentEffect<readonly DeviceAgentWaitingRequest[]> {
  return findWaitingRequests({ userId, deviceId });
}

export function claimDeviceAgentRequest(
  userId: string,
  deviceId: string,
  id: string,
): DeviceAgentEffect<Option.Option<DeviceAgentWaitingRequest>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => claimRequest({ userId, deviceId, id, now }));
}

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

export function withdrawDeviceAgentRequest(userId: string, id: string): DeviceAgentEffect<void> {
  return deleteRequest({ userId, id });
}

export function withdrawExpiredDeviceAgentRows(
  userId: string,
  before: Date,
): DeviceAgentEffect<void> {
  return Effect.andThen(
    deleteExpiredLines({ userId, before }),
    deleteExpiredRequests({ userId, before }),
  );
}
