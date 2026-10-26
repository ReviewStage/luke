/**
 * mac-device-store.ts -- an account's Macs that can run its local agents: registered, beaten, and read for the ones there now.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account moves, beats, or reads another's Mac. A register
 * under an id another account holds writes nothing and answers false, so a
 * desktop cannot take over a Mac by naming its id (`../schemas/mac-device.ts`).
 */

import { type MacSignedIn, macSignedInSchema } from "@luke/features/mac-agent-wire";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { DateTime, Effect, type Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { macDevice } from "../schemas/mac-device.js";

type MacDeviceEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const DeviceKeySchema = Schema.Struct({ userId: Schema.String, id: Schema.String });

/** One Mac as Start reads it: its id, its name, when it last beat, which harnesses it is signed in to, and the Codex it checked, where it has one. */
const MacDeviceSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  lastSeenAt: Schema.Date,
  signedIn: macSignedInSchema,
  codexExecutable: Schema.NullOr(Schema.String),
});

export type MacDevice = typeof MacDeviceSchema.Type;

/** Where a Mac keeps what its local agents need: its home folder, the CLI it bundles, and the Codex it checked, none where it has none. */
const DeviceLayoutSchema = Schema.Struct({
  home: Schema.String,
  claudeExecutable: Schema.String,
  codexExecutable: Schema.NullOr(Schema.String),
});

/** A Mac's layout and which harnesses it is signed in to, as a local agent's launch reads them. */
const DeviceStandingSchema = Schema.Struct({
  ...DeviceLayoutSchema.fields,
  signedIn: macSignedInSchema,
});

export type MacDeviceStanding = typeof DeviceStandingSchema.Type;

type MacDeviceLayout = typeof DeviceLayoutSchema.Type;

/** What a Mac registers with beside its id and name: its layout, its Codex where it checked one, and which harnesses it is signed in to where it says. */
export type MacDeviceRegistration = Omit<MacDeviceLayout, "codexExecutable"> & {
  readonly codexExecutable?: string | undefined;
  readonly signedIn?: MacSignedIn | undefined;
};

const upsertDevice = SqlSchema.findAll({
  Request: Schema.Struct({
    ...DeviceKeySchema.fields,
    ...DeviceStandingSchema.fields,
    name: Schema.String,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, name, home, claudeExecutable, codexExecutable, signedIn, now }) =>
    Database.use((db) =>
      db
        .insert(macDevice)
        .values({
          id,
          userId,
          name,
          home,
          claudeExecutable,
          codexExecutable,
          signedIn,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: macDevice.id,
          set: { name, home, claudeExecutable, codexExecutable, signedIn, lastSeenAt: now },
          // Moved only where the account registering it is the one holding it.
          setWhere: eq(macDevice.userId, userId),
        })
        .returning({ id: macDevice.id }),
    ),
});

const touchDevice = SqlSchema.findAll({
  Request: Schema.Struct({
    ...DeviceKeySchema.fields,
    now: Schema.Date,
    signedIn: Schema.UndefinedOr(macSignedInSchema),
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, now, signedIn }) =>
    Database.use((db) =>
      db
        .update(macDevice)
        .set(signedIn === undefined ? { lastSeenAt: now } : { lastSeenAt: now, signedIn })
        .where(and(eq(macDevice.id, id), eq(macDevice.userId, userId)))
        .returning({ id: macDevice.id }),
    ),
});

const findSeen = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, since: Schema.Date }),
  Result: MacDeviceSchema,
  execute: ({ userId, since }) =>
    Database.use((db) =>
      db
        .select({
          id: macDevice.id,
          name: macDevice.name,
          lastSeenAt: macDevice.lastSeenAt,
          signedIn: macDevice.signedIn,
          codexExecutable: macDevice.codexExecutable,
        })
        .from(macDevice)
        .where(and(eq(macDevice.userId, userId), gte(macDevice.lastSeenAt, since)))
        .orderBy(desc(macDevice.lastSeenAt)),
    ),
});

const findNamed = SqlSchema.findAll({
  Request: Schema.Struct({ ids: Schema.Array(Schema.String) }),
  Result: MacDeviceSchema,
  execute: ({ ids }) =>
    Database.use((db) =>
      db
        .select({
          id: macDevice.id,
          name: macDevice.name,
          lastSeenAt: macDevice.lastSeenAt,
          signedIn: macDevice.signedIn,
          codexExecutable: macDevice.codexExecutable,
        })
        .from(macDevice)
        .where(inArray(macDevice.id, [...ids])),
    ),
});

const findLayout = SqlSchema.findOneOption({
  Request: DeviceKeySchema,
  Result: DeviceStandingSchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({
          home: macDevice.home,
          claudeExecutable: macDevice.claudeExecutable,
          codexExecutable: macDevice.codexExecutable,
          signedIn: macDevice.signedIn,
        })
        .from(macDevice)
        .where(and(eq(macDevice.id, id), eq(macDevice.userId, userId))),
    ),
});

/**
 * Registers the Mac under the account, or renames, relocates, and beats it
 * where the account holds it already; false where another account holds the
 * id, and nothing was written.
 */
export function registerMacDevice(
  userId: string,
  device: { readonly id: string; readonly name: string } & MacDeviceRegistration,
): MacDeviceEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      upsertDevice({
        userId,
        ...device,
        // Note that a register naming no Codex clears the last one, since the Mac checks it on every start.
        codexExecutable: device.codexExecutable ?? null,
        signedIn: device.signedIn ?? {},
        now,
      }),
      (rows) => rows.length > 0,
    ),
  );
}

/** The account's Mac's home folder and bundled CLI, as it last registered them, and which harnesses it last said it is signed in to; nothing where the account holds no such Mac. */
export function macDeviceLayout(
  userId: string,
  id: string,
): MacDeviceEffect<Option.Option<MacDeviceStanding>> {
  return findLayout({ userId, id });
}

/** Records that the account's Mac is there now, and which harnesses it is signed in to where it says; false where the account holds no such Mac. */
export function beatMacDevice(
  userId: string,
  id: string,
  signedIn?: MacSignedIn,
): MacDeviceEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(touchDevice({ userId, id, now, signedIn }), (rows) => rows.length > 0),
  );
}

/** The account's Macs that beat at or after the instant given, the latest first. */
export function macDevicesSeenSince(
  userId: string,
  since: Date,
): MacDeviceEffect<readonly MacDevice[]> {
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
export function macDevicesNamed(
  ids: readonly string[],
): MacDeviceEffect<ReadonlyMap<string, MacDevice>> {
  if (ids.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findNamed({ ids: [...new Set(ids)] }),
    (devices) => new Map(devices.map((device) => [device.id, device])),
  );
}
