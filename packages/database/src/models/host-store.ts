/**
 * host-store.ts -- an account's install tokens and the machines enrolled with a device secret: minted, revoked, traded for a device, an own device enrolled, resolved by a device secret, listed, and removed.
 *
 * Every function is an effect over the ambient `SqlClient`. Tokens and
 * secrets arrive here as their SHA-256 alone (the service mints both and
 * hashes them), so nothing here ever holds one. Every read and write the
 * account names is keyed by it, so no account lists, revokes, removes, or
 * enrolls another's; the token enroll is keyed by the token, whose own
 * account it writes under, and the secret read by the secret's hash alone,
 * which names one standing machine (`../schemas/device.ts`,
 * `../schemas/host-install-token.ts`).
 *
 * A machine is enrolled where its row holds a secret and was not removed
 * (`enrolled`), whatever its kind or platform: a Linux box that traded an
 * install token, and a member's own desktop converted in place by its
 * signed-in session (`enrollOwnDevice`), or created by it where the
 * account never registered the id, are read, listed, refused below the
 * floor, and removed alike.
 */

import {
  DEVICE_ARCH,
  DEVICE_KIND,
  DEVICE_PLATFORM,
  type DeviceArch,
  type DevicePlatform,
  deviceSetupSchema,
} from "@luke/features/device-agent-wire";
import { and, asc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { Data, DateTime, Duration, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { device } from "../schemas/device.js";
import { hostInstallToken } from "../schemas/host-install-token.js";

type HostEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

export const HOST_INSTALL_TOKEN = {
  /** How long an install token enrolls boxes after it was minted. */
  LIFETIME: Duration.hours(24),
} as const;

/** A token as its mint answers it: its id and when it expires. */
const MintedSchema = Schema.Struct({ id: Schema.String, expiresAt: Schema.Date });

export type MintedInstallToken = typeof MintedSchema.Type;

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

/** What a box enrolls with beside the token: the id it minted, its name, platform, and architecture, its daemon's version, and its new secret's hash. */
export interface HostEnrollment {
  readonly id: string;
  readonly name: string;
  readonly platform: DevicePlatform;
  readonly arch: DeviceArch;
  readonly version: string;
  readonly secretHash: string;
}

const KeptSchema = Schema.Struct({ id: Schema.String });

/** Whether a device row is enrolled: it holds a secret and was not removed, whatever its kind. */
function enrolled() {
  return and(isNotNull(device.secretHash), isNull(device.removedAt));
}

/** Why an enroll wrote nothing. */
export const HOST_ENROLL_REFUSAL = {
  /** The token is unknown, revoked, or expired, or the id is another account's device or one of the account's own that never enrolled. */
  REFUSED: "refused",
  /** The id is one of the token account's enrolled machines, which only a Remove lets a token enroll again. */
  STILL_ENROLLED: "still-enrolled",
} as const;

export type HostEnrollRefusal = (typeof HOST_ENROLL_REFUSAL)[keyof typeof HOST_ENROLL_REFUSAL];

/** What an enroll answers: the account the host was enrolled under, or why nothing was written. */
export type HostEnrolled = { readonly userId: string } | { readonly refused: HostEnrollRefusal };

/** An enroll whose id is not the token account's host to key, failed so its transaction rolls back. */
class EnrollRefused extends Data.TaggedError("EnrollRefused")<{
  readonly refused: HostEnrollRefusal;
}> {}

const insertToken = SqlSchema.findOne({
  Request: Schema.Struct({ userId: Schema.String, tokenHash: Schema.String, now: Schema.Date }),
  Result: MintedSchema,
  execute: ({ userId, tokenHash, now }) =>
    Database.use((db) =>
      db
        .insert(hostInstallToken)
        .values({
          userId,
          tokenHash,
          createdAt: now,
          expiresAt: new Date(now.getTime() + Duration.toMillis(HOST_INSTALL_TOKEN.LIFETIME)),
        })
        .returning({ id: hostInstallToken.id, expiresAt: hostInstallToken.expiresAt }),
    ),
});

const stampRevoked = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String, now: Schema.Date }),
  Result: KeptSchema,
  execute: ({ userId, id, now }) =>
    Database.use((db) =>
      db
        .update(hostInstallToken)
        .set({ revokedAt: now })
        .where(
          and(
            eq(hostInstallToken.id, id),
            eq(hostInstallToken.userId, userId),
            isNull(hostInstallToken.revokedAt),
          ),
        )
        .returning({ id: hostInstallToken.id }),
    ),
});

/** The token's account, where it stands unrevoked and unexpired, and its last use stamped in the same statement. */
const useToken = SqlSchema.findOneOption({
  Request: Schema.Struct({ tokenHash: Schema.String, now: Schema.Date }),
  Result: Schema.Struct({ userId: Schema.String }),
  execute: ({ tokenHash, now }) =>
    Database.use((db) =>
      db
        .update(hostInstallToken)
        .set({ lastUsedAt: now })
        .where(
          and(
            eq(hostInstallToken.tokenHash, tokenHash),
            isNull(hostInstallToken.revokedAt),
            gt(hostInstallToken.expiresAt, now),
          ),
        )
        .returning({ userId: hostInstallToken.userId }),
    ),
});

const upsertHost = SqlSchema.findAll({
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
          set: {
            name,
            kind: DEVICE_KIND.HOST,
            platform,
            arch,
            version,
            secretHash,
            removedAt: null,
            lastSeenAt: now,
          },
          // Note that only the account's own removed machine is keyed again: never a standing one, whose secret a token holder could otherwise take over, another account's device, or one of its own that never enrolled, which only its signed-in session enrolls.
          setWhere: sql`${device.userId} = ${userId} and ${device.removedAt} is not null`,
        })
        .returning({ id: device.id }),
    ),
});

const findStanding = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String }),
  Result: KeptSchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({ id: device.id })
        .from(device)
        .where(and(eq(device.id, id), eq(device.userId, userId), enrolled())),
    ),
});

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
        .where(and(eq(device.userId, userId), enrolled()))
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
        .where(and(eq(device.id, id), eq(device.userId, userId), enrolled()))
        .returning({ id: device.id }),
    ),
});

/** Keeps a fresh install token of the account's by its hash, good for `HOST_INSTALL_TOKEN.LIFETIME` from now. */
export function mintHostInstallToken(
  userId: string,
  tokenHash: string,
): HostEffect<MintedInstallToken> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    insertToken({ userId, tokenHash, now }).pipe(
      // An insert that returned no row is the database breaking its own contract, not an outcome.
      Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
    ),
  );
}

/** Revokes the account's install token, so it enrolls no box again; false where the account holds no such standing token. */
export function revokeHostInstallToken(userId: string, id: string): HostEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(stampRevoked({ userId, id, now }), (rows) => rows.length > 0),
  );
}

/**
 * Trades an install token for a host: the box, under the token's account,
 * as a device of kind host keyed by the id it minted, with the new secret's
 * hash, seen now. The id of a machine the account removed may be enrolled
 * again, which brings that machine back with the new secret, so a box is
 * never listed twice; an enrolled machine's id may not, so a token alone
 * never takes over a box already enrolled. Answers the account, or why
 * nothing was written: still enrolled where the id is one of the token
 * account's enrolled machines, which is said apart so a rerun on an
 * enrolled box can keep its enrollment, and refused for an unknown,
 * revoked, or expired token, or an id that is another account's device or
 * one of the account's own that never enrolled, which a token never takes.
 */
export function enrollHost(
  tokenHash: string,
  enrollment: HostEnrollment,
): HostEffect<HostEnrolled> {
  const enroll = Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const token = yield* useToken({ tokenHash, now });
    if (Option.isNone(token)) return { refused: HOST_ENROLL_REFUSAL.REFUSED } as const;
    const { userId } = token.value;
    const kept = yield* upsertHost({ userId, ...enrollment, now });
    if (kept.length > 0) return { userId };
    const standing = yield* findStanding({ userId, id: enrollment.id });
    // Note that a refused id rolls the token's stamp back with it, so a refused enroll writes nothing.
    return yield* Effect.fail(
      new EnrollRefused({
        refused:
          standing.length > 0 ? HOST_ENROLL_REFUSAL.STILL_ENROLLED : HOST_ENROLL_REFUSAL.REFUSED,
      }),
    );
  });
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(enroll)).pipe(
    Effect.catchTag("EnrollRefused", (failed) => Effect.succeed({ refused: failed.refused })),
  );
}

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
 * say over its devices, as no install token does; when to ask is its
 * caller's. False where the id is another account's device, or no row
 * holds it and the enroll named no machine, and nothing was written.
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

/** The account's enrolled machines, of every kind and platform, by name. */
export function hostsOf(userId: string): HostEffect<readonly HostRow[]> {
  return findHosts({ userId });
}

/** Removes the account's enrolled machine and refuses its secret from now on; false where the account holds no such enrolled machine. */
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
