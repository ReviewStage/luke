/**
 * device-store.ts -- an account's devices that can run its local agents: registered, beaten, and read for the ones there now.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account moves, beats, or reads another's Mac. A register
 * under an id another account holds writes nothing and answers false, so a
 * desktop cannot take over a Mac by naming its id (`../schemas/device.ts`).
 */

import {
  DEVICE_ARCH,
  DEVICE_CAPABILITY,
  DEVICE_ISOLATION,
  DEVICE_KIND,
  DEVICE_PLATFORM,
  DEVICE_SETUP,
  type DeviceArch,
  type DeviceCapability,
  type DeviceIsolation,
  type DevicePlatform,
  type DeviceSetup,
  type DeviceSignedIn,
  deviceSetupSchema,
  deviceSignedInSchema,
} from "@luke/features/device-agent-wire";
import { and, desc, eq, exists, gte, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { DateTime, Effect, type Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { device } from "../schemas/device.js";
import { task } from "../schemas/task.js";
import { agentReachableBy, taskReachableBy } from "./workspace-store.js";

type DeviceEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const DeviceKeySchema = Schema.Struct({ userId: Schema.String, id: Schema.String });

/** One device as Start reads it: its id, the account it is, its name and kind, when it last beat, which harnesses it is signed in to, the Codex it checked, where it has one, and where its setup stands, none once it is ready. */
const DeviceSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  name: Schema.String,
  kind: Schema.Literals(Object.values(DEVICE_KIND)),
  lastSeenAt: Schema.Date,
  signedIn: deviceSignedInSchema,
  codexExecutable: Schema.NullOr(Schema.String),
  setup: Schema.NullOr(deviceSetupSchema),
  setupFailure: Schema.NullOr(Schema.String),
});

export type Device = typeof DeviceSchema.Type;

/** Where a Mac keeps what its local agents need: its home folder, the CLI it bundles, and the Codex it checked, none where it has none. */
const DeviceLayoutSchema = Schema.Struct({
  home: Schema.String,
  claudeExecutable: Schema.String,
  codexExecutable: Schema.NullOr(Schema.String),
});

/** A Mac's layout, which harnesses it is signed in to, and how it runs its agents, as a local agent's launch reads them. */
const DeviceStandingSchema = Schema.Struct({
  ...DeviceLayoutSchema.fields,
  signedIn: deviceSignedInSchema,
  isolation: Schema.Literals(Object.values(DEVICE_ISOLATION)),
});

export type DeviceStanding = typeof DeviceStandingSchema.Type;

type DeviceLayout = typeof DeviceLayoutSchema.Type;

/** What a Mac registers with beside its id and name: its platform and architecture, how it runs its agents, its layout, its Codex where it checked one, which harnesses it is signed in to where it says, what its follower takes beyond the first lines, none where it names none, and where its setup stands and why it failed, none once it is ready. */
export type DeviceRegistration = Omit<DeviceLayout, "codexExecutable"> & {
  readonly platform: DevicePlatform;
  readonly arch: DeviceArch;
  readonly isolation?: DeviceIsolation | undefined;
  readonly codexExecutable?: string | undefined;
  readonly signedIn?: DeviceSignedIn | undefined;
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
    capabilities: Schema.Array(Schema.Literals(Object.values(DEVICE_CAPABILITY))),
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
    isolation,
    home,
    claudeExecutable,
    codexExecutable,
    signedIn,
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
          // Note that a register is the desktop's own call, so what it registers is a desktop.
          kind: DEVICE_KIND.DESKTOP,
          platform,
          arch,
          isolation,
          home,
          claudeExecutable,
          codexExecutable,
          signedIn,
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
            isolation,
            home,
            claudeExecutable,
            codexExecutable,
            signedIn,
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
    signedIn: Schema.UndefinedOr(deviceSignedInSchema),
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, now, signedIn }) =>
    Database.use((db) =>
      db
        .update(device)
        .set(signedIn === undefined ? { lastSeenAt: now } : { lastSeenAt: now, signedIn })
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
          kind: device.kind,
          lastSeenAt: device.lastSeenAt,
          signedIn: device.signedIn,
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
          kind: device.kind,
          lastSeenAt: device.lastSeenAt,
          signedIn: device.signedIn,
          codexExecutable: device.codexExecutable,
          setup: device.setup,
          setupFailure: device.setupFailure,
        })
        .from(device)
        .where(inArray(device.id, [...ids])),
    ),
});

const findVisible = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, ids: Schema.Array(Schema.String) }),
  Result: DeviceSchema,
  execute: ({ userId, ids }) =>
    Database.use((db) =>
      db
        .select({
          id: device.id,
          userId: device.userId,
          name: device.name,
          kind: device.kind,
          lastSeenAt: device.lastSeenAt,
          signedIn: device.signedIn,
          codexExecutable: device.codexExecutable,
        })
        .from(device)
        .where(
          and(
            inArray(device.id, [...ids]),
            or(
              eq(device.userId, userId),
              // Note that a teammate's device is seen as its agent or its task is, so a member sees no more of it than the label already says.
              exists(
                queryBuilder
                  .select({ one: codingAgent.id })
                  .from(codingAgent)
                  .where(and(eq(codingAgent.deviceId, device.id), agentReachableBy(userId))),
              ),
              exists(
                queryBuilder
                  .select({ one: task.id })
                  .from(task)
                  .where(and(eq(task.deviceId, device.id), taskReachableBy(userId))),
              ),
            ),
          ),
        ),
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
          claudeExecutable: device.claudeExecutable,
          codexExecutable: device.codexExecutable,
          signedIn: device.signedIn,
          isolation: device.isolation,
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
 * where the account holds it already; false where another account holds the
 * id, and nothing was written.
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
        // Note that a register naming no Codex clears the last one, since the Mac checks it on every start.
        codexExecutable: registered.codexExecutable ?? null,
        // Likewise a register naming no isolation runs its agents bare, as every desktop from before the field does.
        isolation: registered.isolation ?? DEVICE_ISOLATION.BARE,
        signedIn: registered.signedIn ?? {},
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

/** The account's Mac's home folder, bundled CLI, and isolation, as it last registered them, and which harnesses it last said it is signed in to; nothing where the account holds no such Mac. */
export function deviceLayout(
  userId: string,
  id: string,
): DeviceEffect<Option.Option<DeviceStanding>> {
  return findLayout({ userId, id });
}

/** Records that the account's Mac is there now, and which harnesses it is signed in to where it says; false where the account holds no such Mac. */
export function beatDevice(
  userId: string,
  id: string,
  signedIn?: DeviceSignedIn,
): DeviceEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(touchDevice({ userId, id, now, signedIn }), (rows) => rows.length > 0),
  );
}

/** The account's Macs that beat at or after the instant given, the latest first. */
export function devicesSeenSince(userId: string, since: Date): DeviceEffect<readonly Device[]> {
  return findSeen({ userId, since });
}

/**
 * The devices of `ids` the account may see: its own, and one a teammate's
 * agent or task names where the account is a member of that agent's or
 * task's workspace and reaches it (`agentReachableBy`, `taskReachableBy`), as
 * the label on the agent's tab says which device it runs on. Any other id
 * reads as no device, so this answers the account nothing of an id it merely
 * knows.
 */
export function devicesVisibleTo(
  userId: string,
  ids: readonly string[],
): DeviceEffect<ReadonlyMap<string, Device>> {
  if (ids.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findVisible({ userId, ids: [...new Set(ids)] }),
    (devices) => new Map(devices.map((each) => [each.id, each])),
  );
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
