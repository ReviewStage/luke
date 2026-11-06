import {
  DEVICE_ARCH,
  DEVICE_PLATFORM,
  type DeviceArch,
  type DeviceMachine,
  type DevicePlatform,
  deviceSetupSchema,
  hostUpdateSchema,
} from "@repo/features/device-agent-wire";
import { and, asc, eq, exists, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { device } from "../schemas/device.js";
import { hostPairing } from "../schemas/host-pairing.js";
import { accountPreference } from "../schemas/preferences.js";
import { runningTurnIds } from "./abandoned-turns.js";
import { settleGoneDeviceAgentLaunches } from "./device-agent-store.js";
import {
  type DeviceRegistration,
  MachineColumnsSchema,
  machineColumns,
  registerDevice,
} from "./device-store.js";

type HostEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const HostCallerSchema = Schema.Struct({
  deviceId: Schema.String,
  userId: Schema.String,
  version: Schema.NullOr(Schema.String),
});

export type HostCaller = typeof HostCallerSchema.Type;

const HostRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  platform: Schema.Literals(Object.values(DEVICE_PLATFORM)),
  machineId: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  lastSeenAt: Schema.Date,
  version: Schema.NullOr(Schema.String),
  home: Schema.NullOr(Schema.String),
  setup: Schema.NullOr(deviceSetupSchema),
  setupFailure: Schema.NullOr(Schema.String),
  update: Schema.NullOr(hostUpdateSchema),
  updateFailure: Schema.NullOr(Schema.String),
});

export type HostRow = typeof HostRowSchema.Type;

const KeptSchema = Schema.Struct({ id: Schema.String });

function listed() {
  return and(
    isNull(device.removedAt),
    or(
      isNotNull(device.secretHash),
      exists(
        queryBuilder
          .select({ id: hostPairing.id })
          .from(hostPairing)
          .where(eq(hostPairing.deviceId, device.id)),
      ),
    ),
  );
}

const insertOwnDevice = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    id: Schema.String,
    name: Schema.String,
    platform: Schema.Literals(Object.values(DEVICE_PLATFORM)),
    arch: Schema.Literals(Object.values(DEVICE_ARCH)),
    ...MachineColumnsSchema.fields,
    version: Schema.String,
    secretHash: Schema.String,
    now: Schema.Date,
  }),
  Result: KeptSchema,
  execute: ({ userId, id, name, platform, arch, machineId, model, version, secretHash, now }) =>
    Database.use((db) =>
      db
        .insert(device)
        .values({
          id,
          userId,
          name,
          platform,
          arch,
          ...machineColumns({ machineId, model }),
          version,
          secretHash,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: device.id,
          set: {
            ...machineColumns({ machineId, model }),
            version,
            secretHash,
            removedAt: null,
          },
          setWhere: sql`${device.userId} = ${userId}`,
        })
        .returning({ id: device.id }),
    ),
});

const keyOwnDevice = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    id: Schema.String,
    ...MachineColumnsSchema.fields,
    version: Schema.String,
    secretHash: Schema.String,
  }),
  Result: KeptSchema,
  execute: ({ userId, id, machineId, model, version, secretHash }) =>
    Database.use((db) =>
      db
        .update(device)
        .set({
          ...machineColumns({ machineId, model }),
          version,
          secretHash,
          removedAt: null,
        })
        .where(and(eq(device.id, id), eq(device.userId, userId)))
        .returning({ id: device.id }),
    ),
});

const findHostAgents = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, deviceId: Schema.String }),
  Result: Schema.Struct({ conversationId: Schema.String }),
  execute: ({ userId, deviceId }) =>
    Database.use((db) =>
      db
        .select({ conversationId: agentTable.conversationId })
        .from(agentTable)
        .where(and(eq(agentTable.userId, userId), eq(agentTable.deviceId, deviceId))),
    ),
});

const findRemoved = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String }),
  Result: KeptSchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({ id: device.id })
        .from(device)
        .where(and(eq(device.id, id), eq(device.userId, userId), isNotNull(device.removedAt))),
    ),
});

const findBySecret = SqlSchema.findOneOption({
  Request: Schema.Struct({ secretHash: Schema.String }),
  Result: HostCallerSchema,
  execute: ({ secretHash }) =>
    Database.use((db) =>
      db
        .select({ deviceId: device.id, userId: device.userId, version: device.version })
        .from(device)
        .where(and(eq(device.secretHash, secretHash), isNull(device.removedAt))),
    ),
});

const writeVersion = SqlSchema.void({
  Request: Schema.Struct({ id: Schema.String, version: Schema.String }),
  execute: ({ id, version }) =>
    Database.use((db) => db.update(device).set({ version }).where(eq(device.id, id))),
});

const findHosts = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String }),
  Result: HostRowSchema,
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select({
          id: device.id,
          name: device.name,
          platform: device.platform,
          machineId: device.machineId,
          model: device.model,
          lastSeenAt: device.lastSeenAt,
          version: device.version,
          home: device.home,
          setup: device.setup,
          setupFailure: device.setupFailure,
          update: device.updatePhase,
          updateFailure: device.updateFailure,
        })
        .from(device)
        .where(and(eq(device.userId, userId), listed()))
        .orderBy(asc(device.name), asc(device.id)),
    ),
});

const stampRemoved = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String, now: Schema.Date }),
  Result: Schema.Struct({ txid: Schema.String }),
  execute: ({ userId, id, now }) =>
    Database.use((db) =>
      db
        .update(device)
        .set({ removedAt: now, secretHash: null })
        .where(and(eq(device.id, id), eq(device.userId, userId), listed()))
        .returning({ txid: sql<string>`pg_current_xact_id()::text` }),
    ),
});

const findUnregistered = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String }),
  Result: KeptSchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({ id: device.id })
        .from(device)
        .where(and(eq(device.id, id), eq(device.userId, userId), isNull(device.home))),
    ),
});

const findMacMachine = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String }),
  Result: Schema.Struct({ machineId: Schema.String }),
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({ machineId: device.machineId })
        .from(device)
        .where(
          and(
            eq(device.id, id),
            eq(device.userId, userId),
            eq(device.platform, DEVICE_PLATFORM.DARWIN),
            isNotNull(device.machineId),
            isNull(device.removedAt),
          ),
        ),
    ),
});

const stampFolded = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    id: Schema.String,
    machineId: Schema.String,
    now: Schema.Date,
  }),
  Result: KeptSchema,
  execute: ({ userId, id, machineId, now }) =>
    Database.use((db) =>
      db
        .update(device)
        .set({ removedAt: now, secretHash: null })
        .where(
          and(
            eq(device.userId, userId),
            eq(device.machineId, machineId),
            eq(device.platform, DEVICE_PLATFORM.DARWIN),
            ne(device.id, id),
            listed(),
          ),
        )
        .returning({ id: device.id }),
    ),
});

const FoldSchema = Schema.Struct({
  userId: Schema.String,
  from: Schema.Array(Schema.String),
  to: Schema.String,
});

const moveAgents = SqlSchema.findAll({
  Request: FoldSchema,
  Result: Schema.Struct({ conversationId: Schema.String }),
  execute: ({ userId, from, to }) =>
    Database.use((db) =>
      db
        .update(agentTable)
        .set({ deviceId: to, runnerTokenHash: null })
        .where(and(eq(agentTable.userId, userId), inArray(agentTable.deviceId, [...from])))
        .returning({ conversationId: agentTable.conversationId }),
    ),
});

const movePick = SqlSchema.void({
  Request: FoldSchema,
  execute: ({ userId, from, to }) =>
    Database.use((db) =>
      db
        .update(accountPreference)
        .set({ runsOnDeviceId: to })
        .where(
          and(
            eq(accountPreference.userId, userId),
            inArray(accountPreference.runsOnDeviceId, [...from]),
          ),
        ),
    ),
});

export interface FoldedAgent {
  readonly conversationId: string;
  readonly runningTurnIds: readonly string[];
}

const folded = (userId: string, id: string) =>
  Effect.gen(function* () {
    const machine = yield* findMacMachine({ userId, id });
    if (Option.isNone(machine)) return [];
    const now = yield* DateTime.nowAsDate;
    const { machineId } = machine.value;
    const removed = yield* stampFolded({ userId, id, machineId, now });
    if (removed.length === 0) return [];
    const fold = { userId, from: removed.map((row) => row.id), to: id };
    const moved = yield* moveAgents(fold);
    yield* movePick(fold);
    yield* settleGoneDeviceAgentLaunches(userId, fold.from);
    return yield* Effect.forEach(moved, ({ conversationId }) =>
      Effect.map(runningTurnIds(conversationId), (ids) => ({
        conversationId,
        runningTurnIds: ids,
      })),
    );
  });

function underJoinLock<A>(userId: string, work: HostEffect<A>): HostEffect<A> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* client`select pg_advisory_xact_lock(hashtextextended(${userId}, 3))`;
        return yield* work;
      }),
    ),
  );
}

export interface OwnEnrollment extends DeviceMachine {
  readonly id: string;
  readonly version: string;
  readonly secretHash: string;
  readonly machine?: {
    readonly name: string;
    readonly platform: DevicePlatform;
    readonly arch: DeviceArch;
  };
}

export function enrollOwnDevice(
  userId: string,
  enrollment: OwnEnrollment,
): HostEffect<Option.Option<readonly FoldedAgent[]>> {
  const { machine, ...key } = enrollment;
  return underJoinLock(
    userId,
    Effect.gen(function* () {
      const kept =
        machine === undefined
          ? yield* keyOwnDevice({ userId, ...key })
          : yield* insertOwnDevice({ userId, ...key, ...machine, now: yield* DateTime.nowAsDate });
      if (kept.length === 0) return Option.none();
      return Option.some(yield* folded(userId, enrollment.id));
    }),
  );
}

export function registerHost(
  userId: string,
  registered: { readonly id: string; readonly name: string } & DeviceRegistration,
): HostEffect<Option.Option<readonly FoldedAgent[]>> {
  return underJoinLock(
    userId,
    Effect.gen(function* () {
      const joining = (yield* findUnregistered({ userId, id: registered.id })).length > 0;
      if (!(yield* registerDevice(userId, registered))) return Option.none();
      return Option.some(joining ? yield* folded(userId, registered.id) : []);
    }),
  );
}

export function hostBySecret(secretHash: string): HostEffect<Option.Option<HostCaller>> {
  return findBySecret({ secretHash });
}

export function recordHostVersion(id: string, version: string): HostEffect<void> {
  return writeVersion({ id, version });
}

export function hostsOf(userId: string): HostEffect<readonly HostRow[]> {
  return findHosts({ userId });
}

export function removeHost(userId: string, id: string): HostEffect<string | undefined> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(stampRemoved({ userId, id, now }), ([removed]) => removed?.txid),
  );
}

export function hostsLiveStatement(userId: string): Option.Option<LiveStatement> {
  return liveStatementOf(
    queryBuilder
      .select(
        liveSelection({
          id: device.id,
          name: device.name,
          platform: device.platform,
          machineId: device.machineId,
          model: device.model,
          update: device.updatePhase,
        }),
      )
      .from(device)
      .where(and(eq(device.userId, userId), isNull(device.removedAt), isNotNull(device.version)))
      .orderBy(asc(device.name), asc(device.id)),
  );
}

export function hostAgentConversations(
  userId: string,
  deviceId: string,
): HostEffect<readonly string[]> {
  return Effect.map(findHostAgents({ userId, deviceId }), (rows) =>
    rows.map((row) => row.conversationId),
  );
}

export function hostRemoved(userId: string, id: string): HostEffect<boolean> {
  return Effect.map(findRemoved({ userId, id }), (rows) => rows.length > 0);
}
