/**
 * host-store.ts -- an account's machines enrolled with a device secret: an own device enrolled, resolved by a device secret, listed, and removed.
 *
 * Every function is an effect over the ambient `SqlClient`. Secrets arrive
 * here as their SHA-256 alone (the service mints them and hashes them), so
 * nothing here ever holds one. Every read and write the account names is
 * keyed by it, so no account lists, removes, or enrolls another's; the
 * secret read is keyed by the secret's hash alone, which names one standing
 * machine (`../schemas/device.ts`).
 *
 * A machine is enrolled where its row holds a secret and was not removed,
 * whatever its kind or platform: a box its approved pairing
 * keyed (`./host-pairing-store.ts`), and a member's own desktop converted in
 * place by its signed-in session (`enrollOwnDevice`), or created by it where
 * the account never registered the id, are read, listed, refused below the
 * floor, and removed alike. A host a pairing's approve made is listed and
 * removed as one from its approve, before its box collects its secret
 * (`listed`).
 */

import {
  DEVICE_ARCH,
  DEVICE_KIND,
  DEVICE_PLATFORM,
  type DeviceArch,
  type DevicePlatform,
  deviceSetupSchema,
} from "@luke/features/device-agent-wire";
import { and, asc, eq, exists, isNotNull, isNull, or, sql } from "drizzle-orm";
import { DateTime, Effect, type Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { device } from "../schemas/device.js";
import { hostPairing } from "../schemas/host-pairing.js";

type HostEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** The device a host's secret names, its account, and the daemon version it last called with. */
const HostCallerSchema = Schema.Struct({
  deviceId: Schema.String,
  userId: Schema.String,
  version: Schema.NullOr(Schema.String),
});

export type HostCaller = typeof HostCallerSchema.Type;

/** One of the account's enrolled machines, as Settings lists it: beside its name and beat, its home folder, none before it first registered, and where its setup stands and why it failed, none once it is ready. */
const HostRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  platform: Schema.Literals(Object.values(DEVICE_PLATFORM)),
  lastSeenAt: Schema.Date,
  version: Schema.NullOr(Schema.String),
  home: Schema.NullOr(Schema.String),
  setup: Schema.NullOr(deviceSetupSchema),
  setupFailure: Schema.NullOr(Schema.String),
});

export type HostRow = typeof HostRowSchema.Type;

const KeptSchema = Schema.Struct({ id: Schema.String });

/**
 * Whether a device row is one of the account's hosts as Settings lists and
 * removes them: enrolled, or made by a pairing's approve and not removed
 * while its box has yet to collect its secret (`./host-pairing-store.ts`).
 */
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

/**
 * The account's own device keyed with a new secret, inserted where no row
 * holds the id, so a machine whose first word to Luke is its enroll is
 * created under the account.
 */
const insertOwnDevice = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    id: Schema.String,
    name: Schema.String,
    platform: Schema.Literals(Object.values(DEVICE_PLATFORM)),
    arch: Schema.Literals(Object.values(DEVICE_ARCH)),
    version: Schema.String,
    secretHash: Schema.String,
    now: Schema.Date,
  }),
  Result: KeptSchema,
  execute: ({ userId, id, name, platform, arch, version, secretHash, now }) =>
    Database.use((db) =>
      db
        .insert(device)
        .values({
          id,
          userId,
          name,
          kind: DEVICE_KIND.HOST,
          platform,
          arch,
          version,
          secretHash,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: device.id,
          set: { kind: DEVICE_KIND.HOST, version, secretHash, removedAt: null },
          // Note that another account's device is never keyed, so its id answers no row, as an id the account never registered once did.
          setWhere: sql`${device.userId} = ${userId}`,
        })
        .returning({ id: device.id }),
    ),
});

/** The account's own device keyed with a new secret in place, under the same id, so its agents keep it. */
const keyOwnDevice = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    id: Schema.String,
    version: Schema.String,
    secretHash: Schema.String,
  }),
  Result: KeptSchema,
  execute: ({ userId, id, version, secretHash }) =>
    Database.use((db) =>
      db
        .update(device)
        .set({ kind: DEVICE_KIND.HOST, version, secretHash, removedAt: null })
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
          lastSeenAt: device.lastSeenAt,
          version: device.version,
          home: device.home,
          setup: device.setup,
          setupFailure: device.setupFailure,
        })
        .from(device)
        .where(and(eq(device.userId, userId), listed()))
        .orderBy(asc(device.name), asc(device.id)),
    ),
});

const stampRemoved = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String, now: Schema.Date }),
  Result: KeptSchema,
  execute: ({ userId, id, now }) =>
    Database.use((db) =>
      db
        .update(device)
        .set({ removedAt: now, secretHash: null })
        .where(and(eq(device.id, id), eq(device.userId, userId), listed()))
        .returning({ id: device.id }),
    ),
});

/** What a signed-in session enrolls its own machine with: its id, its daemon's version, its new secret's hash, and the machine as it names itself, which creates the device where the account never registered the id. */
export interface OwnEnrollment {
  readonly id: string;
  readonly version: string;
  readonly secretHash: string;
  readonly machine?: {
    readonly name: string;
    readonly platform: DevicePlatform;
    readonly arch: DeviceArch;
  };
}

/**
 * Enrolls one of the account's own machines with a new secret, on its
 * signed-in session: a row it already has converted in place under the
 * same id, so every agent pinned to it keeps it, and where no row holds
 * the id and the enroll names the machine, a device created under the
 * account with the machine's name, platform and architecture, which its
 * host program's first register fills in. Either is keyed with the new
 * secret's hash and the version it enrolled with. A machine already
 * enrolled is keyed again, its old secret refused from now on, and a
 * removed one brought back, since the session holds the account's whole
 * say over its devices; when to ask is its caller's. False where the id is
 * another account's device, or no row holds it and the enroll named no
 * machine, and nothing was written.
 */
export function enrollOwnDevice(userId: string, enrollment: OwnEnrollment): HostEffect<boolean> {
  const { machine, ...key } = enrollment;
  const kept =
    machine === undefined
      ? keyOwnDevice({ userId, ...key })
      : Effect.flatMap(DateTime.nowAsDate, (now) =>
          insertOwnDevice({ userId, ...key, ...machine, now }),
        );
  return Effect.map(kept, (rows) => rows.length > 0);
}

/** The standing machine a device secret's hash names, of any kind, its account, and the version it last called with; nothing for a removed machine, an old secret, or none. */
export function hostBySecret(secretHash: string): HostEffect<Option.Option<HostCaller>> {
  return findBySecret({ secretHash });
}

/** Records the daemon version the host called with. */
export function recordHostVersion(id: string, version: string): HostEffect<void> {
  return writeVersion({ id, version });
}

/** The account's enrolled machines, of every kind and platform, and the hosts its approves made whose boxes have yet to collect their secret, by name. */
export function hostsOf(userId: string): HostEffect<readonly HostRow[]> {
  return findHosts({ userId });
}

/** Removes the account's enrolled machine, or a host its approve made, and refuses its secret from now on; false where the account lists no such machine. */
export function removeHost(userId: string, id: string): HostEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(stampRemoved({ userId, id, now }), (rows) => rows.length > 0),
  );
}

/** The conversations of the account's agents pinned to its device, whose runners a removed host can no longer settle. */
export function hostAgentConversations(
  userId: string,
  deviceId: string,
): HostEffect<readonly string[]> {
  return Effect.map(findHostAgents({ userId, deviceId }), (rows) =>
    rows.map((row) => row.conversationId),
  );
}

/** Whether the account removed its machine of the id given, so an agent pinned to it is refused by name rather than as unavailable. */
export function hostRemoved(userId: string, id: string): HostEffect<boolean> {
  return Effect.map(findRemoved({ userId, id }), (rows) => rows.length > 0);
}
