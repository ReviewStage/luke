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
  DEVICE_KIND,
  DEVICE_PLATFORM,
  type DeviceArch,
  type DevicePlatform,
  type DeviceSignedIn,
  deviceSignedInSchema,
} from "@luke/features/device-agent-wire";
import { and, desc, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import { DateTime, Effect, type Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { device } from "../schemas/device.js";

type DeviceEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const DeviceKeySchema = Schema.Struct({ userId: Schema.String, id: Schema.String });

/** One Mac as Start reads it: its id, its name, when it last beat, which harnesses it is signed in to, and the Codex it checked, where it has one. */
const DeviceSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  lastSeenAt: Schema.Date,
  signedIn: deviceSignedInSchema,
  codexExecutable: Schema.NullOr(Schema.String),
});

export type Device = typeof DeviceSchema.Type;

/** Where a Mac keeps what its local agents need: its home folder, the CLI it bundles, and the Codex it checked, none where it has none. */
const DeviceLayoutSchema = Schema.Struct({
  home: Schema.String,
  claudeExecutable: Schema.String,
  codexExecutable: Schema.NullOr(Schema.String),
});

/** A Mac's layout and which harnesses it is signed in to, as a local agent's launch reads them. */
const DeviceStandingSchema = Schema.Struct({
  ...DeviceLayoutSchema.fields,
  signedIn: deviceSignedInSchema,
});

export type DeviceStanding = typeof DeviceStandingSchema.Type;

type DeviceLayout = typeof DeviceLayoutSchema.Type;

/** What a Mac registers with beside its id and name: its platform and architecture, its layout, its Codex where it checked one, and which harnesses it is signed in to where it says. */
export type DeviceRegistration = Omit<DeviceLayout, "codexExecutable"> & {
  readonly platform: DevicePlatform;
  readonly arch: DeviceArch;
  readonly codexExecutable?: string | undefined;
  readonly signedIn?: DeviceSignedIn | undefined;
};

const upsertDevice = SqlSchema.findAll({
  Request: Schema.Struct({
    ...DeviceKeySchema.fields,
    ...DeviceStandingSchema.fields,
    name: Schema.String,
    platform: Schema.Literals(Object.values(DEVICE_PLATFORM)),
    arch: Schema.Literals(Object.values(DEVICE_ARCH)),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({
    userId,
    id,
    name,
    platform,
    arch,
    home,
    claudeExecutable,
    codexExecutable,
    signedIn,
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
          home,
          claudeExecutable,
          codexExecutable,
          signedIn,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: device.id,
          set: {
            name,
            platform,
            arch,
            home,
            claudeExecutable,
            codexExecutable,
            signedIn,
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
          name: device.name,
          lastSeenAt: device.lastSeenAt,
          signedIn: device.signedIn,
          codexExecutable: device.codexExecutable,
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
          name: device.name,
          lastSeenAt: device.lastSeenAt,
          signedIn: device.signedIn,
          codexExecutable: device.codexExecutable,
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
          claudeExecutable: device.claudeExecutable,
          codexExecutable: device.codexExecutable,
          signedIn: device.signedIn,
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
        signedIn: registered.signedIn ?? {},
        now,
      }),
      (rows) => rows.length > 0,
    ),
  );
}

/** The account's Mac's home folder and bundled CLI, as it last registered them, and which harnesses it last said it is signed in to; nothing where the account holds no such Mac. */
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
