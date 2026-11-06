import {
  DEVICE_ARCH,
  DEVICE_CAPABILITY,
  DEVICE_PLATFORM,
  DEVICE_SETUP,
  type DeviceArch,
  type DeviceCapability,
  type DeviceMachine,
  type DevicePlatform,
  type DeviceSetup,
  deviceSetupSchema,
  HOST_UPDATE,
  type HostUpdate,
  hostUpdateSchema,
} from "@repo/features/device-agent-wire";
import { and, desc, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import { DateTime, Effect, type Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { device } from "../schemas/device.js";

type DeviceEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const DeviceKeySchema = Schema.Struct({ userId: Schema.String, id: Schema.String });

const DeviceSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  name: Schema.String,
  platform: Schema.Literals(Object.values(DEVICE_PLATFORM)),
  machineId: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  lastSeenAt: Schema.Date,
  codexExecutable: Schema.NullOr(Schema.String),
  setup: Schema.NullOr(deviceSetupSchema),
  setupFailure: Schema.NullOr(Schema.String),
});

export type Device = typeof DeviceSchema.Type;

const DeviceLayoutSchema = Schema.Struct({
  home: Schema.String,
  agentsFolder: Schema.NullOr(Schema.String),
  claudeExecutable: Schema.String,
  codexExecutable: Schema.NullOr(Schema.String),
});

const DeviceStandingSchema = Schema.Struct({
  ...DeviceLayoutSchema.fields,
  capabilities: Schema.Array(Schema.Literals(Object.values(DEVICE_CAPABILITY))),
});

export type DeviceStanding = typeof DeviceStandingSchema.Type;

type DeviceLayout = typeof DeviceLayoutSchema.Type;

export const MachineColumnsSchema = Schema.Struct({
  machineId: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
});

export function machineColumns(machine: {
  readonly machineId?: string | undefined;
  readonly model?: string | undefined;
}): DeviceMachine {
  return {
    ...(machine.machineId === undefined ? undefined : { machineId: machine.machineId }),
    ...(machine.model === undefined ? undefined : { model: machine.model }),
  };
}

export type DeviceRegistration = Omit<DeviceLayout, "agentsFolder" | "codexExecutable"> &
  DeviceMachine & {
    readonly platform: DevicePlatform;
    readonly arch: DeviceArch;
    readonly agentsFolder?: string | undefined;
    readonly codexExecutable?: string | undefined;
    readonly capabilities?: readonly DeviceCapability[] | undefined;
    readonly setup?: DeviceSetup | undefined;
    readonly setupFailure?: string | undefined;
  };

const upsertDevice = SqlSchema.findAll({
  Request: Schema.Struct({
    ...DeviceKeySchema.fields,
    ...DeviceStandingSchema.fields,
    name: Schema.String,
    platform: Schema.Literals(Object.values(DEVICE_PLATFORM)),
    arch: Schema.Literals(Object.values(DEVICE_ARCH)),
    ...MachineColumnsSchema.fields,
    setup: Schema.NullOr(deviceSetupSchema),
    setupFailure: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({
    userId,
    id,
    name,
    platform,
    arch,
    machineId,
    model,
    home,
    agentsFolder,
    claudeExecutable,
    codexExecutable,
    capabilities,
    setup,
    setupFailure,
    now,
  }) =>
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
          home,
          agentsFolder,
          claudeExecutable,
          codexExecutable,
          capabilities: [...capabilities],
          setup,
          setupFailure,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: device.id,
          set: {
            name,
            platform,
            arch,
            ...machineColumns({ machineId, model }),
            home,
            agentsFolder,
            claudeExecutable,
            codexExecutable,
            capabilities: [...capabilities],
            setup,
            setupFailure,
            lastSeenAt: now,
          },
          setWhere: eq(device.userId, userId),
        })
        .returning({ id: device.id }),
    ),
});

const touchDevice = SqlSchema.findAll({
  Request: Schema.Struct({
    ...DeviceKeySchema.fields,
    now: Schema.Date,
    updating: Schema.UndefinedOr(
      Schema.Struct({
        phase: Schema.NullOr(hostUpdateSchema),
        failure: Schema.NullOr(Schema.String),
      }),
    ),
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, now, updating }) =>
    Database.use((db) =>
      db
        .update(device)
        .set({
          lastSeenAt: now,
          ...(updating === undefined
            ? undefined
            : { updatePhase: updating.phase, updateFailure: updating.failure }),
        })
        .where(and(eq(device.id, id), eq(device.userId, userId)))
        .returning({ id: device.id }),
    ),
});

const findSeen = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, since: Schema.Date }),
  Result: DeviceSchema,
  execute: ({ userId, since }) =>
    Database.use((db) =>
      db
        .select({
          id: device.id,
          userId: device.userId,
          name: device.name,
          platform: device.platform,
          machineId: device.machineId,
          model: device.model,
          lastSeenAt: device.lastSeenAt,
          codexExecutable: device.codexExecutable,
          setup: device.setup,
          setupFailure: device.setupFailure,
        })
        .from(device)
        .where(
          and(
            eq(device.userId, userId),
            gte(device.lastSeenAt, since),
            isNotNull(device.home),
            isNull(device.removedAt),
          ),
        )
        .orderBy(desc(device.lastSeenAt)),
    ),
});

const findNamed = SqlSchema.findAll({
  Request: Schema.Struct({ ids: Schema.Array(Schema.String) }),
  Result: DeviceSchema,
  execute: ({ ids }) =>
    Database.use((db) =>
      db
        .select({
          id: device.id,
          userId: device.userId,
          name: device.name,
          platform: device.platform,
          machineId: device.machineId,
          model: device.model,
          lastSeenAt: device.lastSeenAt,
          codexExecutable: device.codexExecutable,
          setup: device.setup,
          setupFailure: device.setupFailure,
        })
        .from(device)
        .where(inArray(device.id, [...ids])),
    ),
});

const findLayout = SqlSchema.findOneOption({
  Request: DeviceKeySchema,
  Result: DeviceStandingSchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({
          home: device.home,
          agentsFolder: device.agentsFolder,
          claudeExecutable: device.claudeExecutable,
          codexExecutable: device.codexExecutable,
          capabilities: device.capabilities,
        })
        .from(device)
        .where(
          and(
            eq(device.id, id),
            eq(device.userId, userId),
            isNotNull(device.home),
            isNotNull(device.claudeExecutable),
            isNull(device.removedAt),
          ),
        ),
    ),
});

export function registerDevice(
  userId: string,
  registered: { readonly id: string; readonly name: string } & DeviceRegistration,
): DeviceEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      upsertDevice({
        userId,
        ...registered,
        agentsFolder: registered.agentsFolder ?? null,
        codexExecutable: registered.codexExecutable ?? null,
        capabilities: registered.capabilities ?? [],
        setup: registered.setup ?? null,
        setupFailure:
          registered.setup === DEVICE_SETUP.FAILED ? (registered.setupFailure ?? null) : null,
        now,
      }),
      (rows) => rows.length > 0,
    ),
  );
}

export function deviceLayout(
  userId: string,
  id: string,
): DeviceEffect<Option.Option<DeviceStanding>> {
  return findLayout({ userId, id });
}

export interface DeviceUpdating {
  readonly update?: HostUpdate | undefined;
  readonly updateFailure?: string | undefined;
}

export function beatDevice(
  userId: string,
  id: string,
  updating?: DeviceUpdating,
): DeviceEffect<boolean> {
  const update = updating?.update ?? null;
  const said =
    updating === undefined
      ? undefined
      : {
          phase: update,
          failure: update === HOST_UPDATE.FAILED ? (updating.updateFailure ?? null) : null,
        };
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(touchDevice({ userId, id, now, updating: said }), (rows) => rows.length > 0),
  );
}

export function devicesSeenSince(userId: string, since: Date): DeviceEffect<readonly Device[]> {
  return findSeen({ userId, since });
}

export function devicesNamed(ids: readonly string[]): DeviceEffect<ReadonlyMap<string, Device>> {
  if (ids.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findNamed({ ids: [...new Set(ids)] }),
    (devices) => new Map(devices.map((device) => [device.id, device])),
  );
}
