/**
 * host-store.ts -- an account's install tokens and the hosts they enrolled: minted, revoked, traded for a device, resolved by a device secret, listed, and removed.
 *
 * Every function is an effect over the ambient `SqlClient`. Tokens and
 * secrets arrive here as their SHA-256 alone (the service mints both and
 * hashes them), so nothing here ever holds one. Every read and write the
 * account names is keyed by it, so no account lists, revokes, or removes
 * another's; the enroll is keyed by the token, whose own account it writes
 * under, and the secret read by the secret's hash alone, which names one
 * standing host (`../schemas/device.ts`, `../schemas/host-install-token.ts`).
 */

import {
  DEVICE_ARCH,
  DEVICE_KIND,
  DEVICE_PLATFORM,
  type DeviceArch,
  type DevicePlatform,
} from "@luke/features/device-agent-wire";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { Data, DateTime, Duration, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
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

/** One of the account's hosts, as Settings lists it. */
const HostRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  lastSeenAt: Schema.Date,
  version: Schema.NullOr(Schema.String),
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

/** An enroll whose id is not the token account's host to key, failed so its transaction rolls back. */
class EnrollRefused extends Data.TaggedError("EnrollRefused") {}

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
          set: { name, platform, arch, version, secretHash, removedAt: null, lastSeenAt: now },
          // Note that only the account's own removed host is keyed again: never a standing host, whose secret a token holder could otherwise take over, another account's device, or its own desktop.
          setWhere: sql`${device.userId} = ${userId} and ${device.kind} = ${DEVICE_KIND.HOST} and ${device.removedAt} is not null`,
        })
        .returning({ id: device.id }),
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
        .where(
          and(
            eq(device.secretHash, secretHash),
            eq(device.kind, DEVICE_KIND.HOST),
            isNull(device.removedAt),
          ),
        ),
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
          lastSeenAt: device.lastSeenAt,
          version: device.version,
        })
        .from(device)
        .where(
          and(
            eq(device.userId, userId),
            eq(device.kind, DEVICE_KIND.HOST),
            isNull(device.removedAt),
          ),
        )
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
        .where(
          and(
            eq(device.id, id),
            eq(device.userId, userId),
            eq(device.kind, DEVICE_KIND.HOST),
            isNull(device.removedAt),
          ),
        )
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
 * hash, seen now. The id of a host the account removed may be enrolled
 * again, which brings that host back with the new secret, so a box is never
 * listed twice; a standing host's id may not, so a token alone never takes
 * over a box already enrolled. Answers the account, or nothing where the
 * token is unknown, revoked, or expired, or the id is a standing host,
 * another account's device, or the account's own desktop, and then nothing
 * was written.
 */
export function enrollHost(
  tokenHash: string,
  enrollment: HostEnrollment,
): HostEffect<Option.Option<string>> {
  const enroll = Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const token = yield* useToken({ tokenHash, now });
    if (Option.isNone(token)) return Option.none<string>();
    const { userId } = token.value;
    const kept = yield* upsertHost({ userId, ...enrollment, now });
    // Note that a refused id rolls the token's stamp back with it, so a refused enroll writes nothing.
    if (kept.length === 0) return yield* Effect.fail(new EnrollRefused());
    return Option.some(userId);
  });
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(enroll)).pipe(
    Effect.catchTag("EnrollRefused", () => Effect.succeed(Option.none<string>())),
  );
}

/** The standing host a device secret's hash names, its account, and the version it last called with; nothing for a removed host, an old secret, or none. */
export function hostBySecret(secretHash: string): HostEffect<Option.Option<HostCaller>> {
  return findBySecret({ secretHash });
}

/** Records the daemon version the host called with. */
export function recordHostVersion(id: string, version: string): HostEffect<void> {
  return writeVersion({ id, version });
}

/** The account's standing hosts, by name. */
export function hostsOf(userId: string): HostEffect<readonly HostRow[]> {
  return findHosts({ userId });
}

/** Removes the account's host and refuses its secret from now on; false where the account holds no such standing host. */
export function removeHost(userId: string, id: string): HostEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(stampRemoved({ userId, id, now }), (rows) => rows.length > 0),
  );
}
