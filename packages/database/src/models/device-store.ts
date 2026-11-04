/**
 * device-store.ts -- an account's devices that can run its local agents: registered, beaten with where a host's update stands, and read for the ones there now.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account moves, beats, or reads another's Mac. A register
 * under an id another account holds writes nothing and answers false, so a
 * desktop cannot take over a Mac by naming its id (`../schemas/device.ts`).
 */

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

/** One device as Start reads it: its id, the account it is, its name and platform, which machine it runs on and its model, none where its host never said, when it last beat, the Codex it checked, where it has one, and where its setup stands, none once it is ready. */
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

/** Where a Mac keeps what its local agents need: its home folder, the folder its agents stand in where its host named one, the CLI it bundles, and the Codex it checked, none where it has none. */
const DeviceLayoutSchema = Schema.Struct({
  home: Schema.String,
  agentsFolder: Schema.NullOr(Schema.String),
  claudeExecutable: Schema.String,
  codexExecutable: Schema.NullOr(Schema.String),
});

/** A Mac's layout and what its follower takes beyond the first lines, as a local agent's launch reads them. */
const DeviceStandingSchema = Schema.Struct({
  ...DeviceLayoutSchema.fields,
  capabilities: Schema.Array(Schema.Literals(Object.values(DEVICE_CAPABILITY))),
});

export type DeviceStanding = typeof DeviceStandingSchema.Type;

type DeviceLayout = typeof DeviceLayoutSchema.Type;

/** Which machine a call names, each part absent where it named none. */
export const MachineColumnsSchema = Schema.Struct({
  machineId: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
});

/**
 * The machine columns a call writes: each part of the machine it named,
 * and none it left out, so a call naming none, from a host older than the
 * field or one whose read failed, leaves what an earlier call wrote.
 */
export function machineColumns(machine: {
  readonly machineId?: string | undefined;
  readonly model?: string | undefined;
}): DeviceMachine {
  return {
    ...(machine.machineId === undefined ? undefined : { machineId: machine.machineId }),
    ...(machine.model === undefined ? undefined : { model: machine.model }),
  };
}

/** What a Mac registers with beside its id and name: its platform and architecture, which machine it runs on where its host read it, its layout, the folder its agents stand in where its host names one, its Codex where it checked one, what its follower takes beyond the first lines, none where it names none, and where its setup stands and why it failed, none once it is ready. */
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
          // Moved only where the account registering it is the one holding it.
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
            // Note that a host that has not registered yet, or was removed, takes no agent.
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

/**
 * Registers the Mac under the account, or renames, relocates, and beats it
 * where the account holds it already, with the machine it runs on where it
 * named one (`machineColumns`); false where another account holds the id,
 * and nothing was written.
 */
export function registerDevice(
  userId: string,
  registered: { readonly id: string; readonly name: string } & DeviceRegistration,
): DeviceEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      upsertDevice({
        userId,
        ...registered,
        // Note that a register naming no agents folder clears the last one, as a host moved back to a build from before the field names none.
        agentsFolder: registered.agentsFolder ?? null,
        // Note that a register naming no Codex clears the last one, since the Mac checks it on every start.
        codexExecutable: registered.codexExecutable ?? null,
        // Note that a register naming none clears the last ones, as a desktop moved back to a build without them takes none.
        capabilities: registered.capabilities ?? [],
        // Likewise a register naming no setup is a device ready to take an agent, as every desktop from before the field is.
        setup: registered.setup ?? null,
        setupFailure:
          registered.setup === DEVICE_SETUP.FAILED ? (registered.setupFailure ?? null) : null,
        now,
      }),
      (rows) => rows.length > 0,
    ),
  );
}

/** The account's Mac's home folder, the folder its agents stand in where its host named one, bundled CLI, and capabilities, as it last registered them; nothing where the account holds no such Mac, or one that never registered. */
export function deviceLayout(
  userId: string,
  id: string,
): DeviceEffect<Option.Option<DeviceStanding>> {
  return findLayout({ userId, id });
}

/** Where a host's update stands as its own beat says it: its phase, and why it failed where it did; neither while no update is under way. */
export interface DeviceUpdating {
  readonly update?: HostUpdate | undefined;
  readonly updateFailure?: string | undefined;
}

/**
 * Records that the account's Mac is there now, and where its update stands
 * where its own beat says, cleared where that names none; a touch that says
 * nothing of its update, a held read's, leaves it. False where the account
 * holds no such Mac.
 */
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
          // Note that only a failed update keeps its words, as only a failed setup does.
          failure: update === HOST_UPDATE.FAILED ? (updating.updateFailure ?? null) : null,
        };
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(touchDevice({ userId, id, now, updating: said }), (rows) => rows.length > 0),
  );
}

/** The account's Macs that beat at or after the instant given, the latest first. */
export function devicesSeenSince(userId: string, since: Date): DeviceEffect<readonly Device[]> {
  return findSeen({ userId, since });
}

/**
 * The Macs the local agents a reader was shown are pinned to, by id: each
 * one's name and when it last beat, for the agent's label and its offline
 * state. Note that this read is keyed by the devices alone, not an account,
 * because a local agent's teammates see which Mac it runs on as they see who
 * started it; its caller hands it only the device ids of agents it already
 * read through their workspaces' gate.
 */
export function devicesNamed(ids: readonly string[]): DeviceEffect<ReadonlyMap<string, Device>> {
  if (ids.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findNamed({ ids: [...new Set(ids)] }),
    (devices) => new Map(devices.map((device) => [device.id, device])),
  );
}
