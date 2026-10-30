/**
 * host-pairing-store.ts -- the pairings a box starts to join a member's devices with a code: opened, polled and handed its secret, read, approved, and denied by code, and swept; each account's wrong guesses counted.
 *
 * Every function is an effect over the ambient `SqlClient`. The poll secret
 * and the device secret arrive here as their SHA-256 alone (the service
 * mints both and hashes them), so nothing here ever holds one; the user
 * code arrives as its eight letters with no dash (`../schemas/host-pairing.ts`).
 *
 * A pairing is opened pending, for `HOST_PAIRING.LIFETIME`. A read, an
 * approve, or a deny names it by user code, on a signed-in account, and
 * finds only a pending pairing whose code has not lapsed: an approve or a
 * deny settles it once, in the statement that finds it, so two settles
 * racing settle it once, and once one account settled it no account reads
 * or settles it again. Each of those three is a guess: one that finds no
 * pending pairing counts against its account, and an account at
 * `HOST_PAIRING.MISS_LIMIT` within its window is held until the window ends,
 * its guesses refused unread. The count is kept in the store, under a lock
 * on the account's row, so every function instance shares it and guesses
 * the account sends at once are counted one after another.
 *
 * An approve makes the account's host row under an id the service minted,
 * never one the box named, so a pairing never takes over a device that
 * stands; the row holds no secret, and is listed as the account's host
 * while its pairing names it (`./host-store.ts`). The box's next poll keys
 * the row with the secret it is handed and deletes the pairing, so the
 * secret is handed over once.
 */

import {
  DEVICE_ARCH,
  DEVICE_KIND,
  DEVICE_PLATFORM,
  type DeviceArch,
  type DevicePlatform,
} from "@luke/features/device-agent-wire";
import { HOST_PAIRING_POLL_STATUS } from "@luke/features/host-wire";
import { and, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { DateTime, Duration, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import { device } from "../schemas/device.js";
import { HOST_PAIRING_STATUS, hostPairing, hostPairingGuess } from "../schemas/host-pairing.js";

type PairingEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

export const HOST_PAIRING = {
  /** How long a code may be approved after its start. */
  LIFETIME: Duration.minutes(10),
  /** How long an approved pairing stands past its approve, where that runs past its code's lifetime, for its box to collect its secret. */
  COLLECT_GRACE: Duration.minutes(1),
  /** How often a box is asked to poll. */
  POLL_INTERVAL: Duration.seconds(5),
  /** How soon after an answered poll the next is answered slow down: a second under the interval, for a timer's slack. */
  POLL_FLOOR: Duration.seconds(4),
  /** How many guesses that found no pending pairing an account may make in one window. */
  MISS_LIMIT: 10,
  /** How long an account's window of guesses lasts from its first. */
  MISS_WINDOW: Duration.minutes(15),
  /** The most lapsed pairings one sweep deletes. */
  SWEEP_BATCH: 500,
} as const;

/** What a box opens a pairing with: its poll secret's hash, the code it shows, its name, platform, architecture, and daemon version, and the address it called from where one was named. */
export interface HostPairingOpening {
  readonly pollSecretHash: string;
  readonly userCode: string;
  readonly name: string;
  readonly platform: DevicePlatform;
  readonly arch: DeviceArch;
  readonly version: string;
  readonly ip: string | null;
}

/** What a poll answers: the pairing's state, and where it was handed over, the host and its account. */
export type HostPairingPolled =
  | { readonly status: typeof HOST_PAIRING_POLL_STATUS.PENDING }
  | { readonly status: typeof HOST_PAIRING_POLL_STATUS.SLOW_DOWN }
  | { readonly status: typeof HOST_PAIRING_POLL_STATUS.DENIED }
  | { readonly status: typeof HOST_PAIRING_POLL_STATUS.EXPIRED }
  | {
      readonly status: typeof HOST_PAIRING_POLL_STATUS.APPROVED;
      readonly deviceId: string;
      readonly userId: string;
    };

/** What a guess by user code came to. */
export const HOST_PAIRING_GUESS = {
  /** It found a pending pairing. */
  FOUND: "found",
  /** It found none, and counted against its account. */
  MISSED: "missed",
  /** Its account is past the limit until its window ends, so it was not read. */
  HELD: "held",
} as const;

export type HostPairingGuessed<A> =
  | { readonly guess: typeof HOST_PAIRING_GUESS.FOUND; readonly found: A }
  | { readonly guess: typeof HOST_PAIRING_GUESS.MISSED }
  | { readonly guess: typeof HOST_PAIRING_GUESS.HELD; readonly heldUntil: Date };

/** A pending pairing as the approve screen reads it: the box, the address its start came from, and when its code lapses. */
const PendingSchema = Schema.Struct({
  name: Schema.String,
  platform: Schema.Literals(Object.values(DEVICE_PLATFORM)),
  arch: Schema.Literals(Object.values(DEVICE_ARCH)),
  ip: Schema.NullOr(Schema.String),
  expiresAt: Schema.Date,
});

export type HostPairingPending = typeof PendingSchema.Type;

const CodeKeySchema = Schema.Struct({ userCode: Schema.String, now: Schema.Date });

/** A pairing still pending whose code has not lapsed, by its code. */
function pendingByCode(userCode: string, now: Date) {
  return and(
    eq(hostPairing.userCode, userCode),
    eq(hostPairing.status, HOST_PAIRING_STATUS.PENDING),
    gt(hostPairing.expiresAt, now),
  );
}

const insertPairing = SqlSchema.findAll({
  Request: Schema.Struct({
    pollSecretHash: Schema.String,
    userCode: Schema.String,
    name: Schema.String,
    platform: Schema.Literals(Object.values(DEVICE_PLATFORM)),
    arch: Schema.Literals(Object.values(DEVICE_ARCH)),
    version: Schema.String,
    ip: Schema.NullOr(Schema.String),
    now: Schema.Date,
    expiresAt: Schema.Date,
  }),
  Result: Schema.Struct({ expiresAt: Schema.Date }),
  execute: ({ now, ...opening }) =>
    Database.use((db) =>
      db
        .insert(hostPairing)
        .values({ ...opening, status: HOST_PAIRING_STATUS.PENDING, createdAt: now })
        // Note that a code a standing pairing shows writes nothing, so its start is asked again under another.
        .onConflictDoNothing()
        .returning({ expiresAt: hostPairing.expiresAt }),
    ),
});

/** The pairing a poll secret names, stamped polled now where its last answered poll was at or before the floor given. */
const stampPolled = SqlSchema.findOneOption({
  Request: Schema.Struct({ pollSecretHash: Schema.String, now: Schema.Date, floor: Schema.Date }),
  Result: Schema.Struct({
    id: Schema.String,
    status: Schema.Literals(Object.values(HOST_PAIRING_STATUS)),
    expiresAt: Schema.Date,
  }),
  execute: ({ pollSecretHash, now, floor }) =>
    Database.use((db) =>
      db
        .update(hostPairing)
        .set({ polledAt: now })
        .where(
          and(
            eq(hostPairing.pollSecretHash, pollSecretHash),
            or(isNull(hostPairing.polledAt), lte(hostPairing.polledAt, floor)),
          ),
        )
        .returning({
          id: hostPairing.id,
          status: hostPairing.status,
          expiresAt: hostPairing.expiresAt,
        }),
    ),
});

const findByPollSecret = SqlSchema.findAll({
  Request: Schema.Struct({ pollSecretHash: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ pollSecretHash }) =>
    Database.use((db) =>
      db
        .select({ id: hostPairing.id })
        .from(hostPairing)
        .where(eq(hostPairing.pollSecretHash, pollSecretHash)),
    ),
});

/** An approved pairing deleted as its secret is handed over, answering the host its approve made and that host's account. */
const deleteApproved = SqlSchema.findOneOption({
  Request: Schema.Struct({ id: Schema.String }),
  Result: Schema.Struct({ deviceId: Schema.String, userId: Schema.String }),
  execute: ({ id }) =>
    Database.use((db) =>
      db
        .delete(hostPairing)
        .where(
          and(
            eq(hostPairing.id, id),
            eq(hostPairing.status, HOST_PAIRING_STATUS.APPROVED),
            isNotNull(hostPairing.deviceId),
            isNotNull(hostPairing.userId),
          ),
        )
        .returning({ deviceId: hostPairing.deviceId, userId: hostPairing.userId }),
    ),
});

/** The host an approve made keyed with its secret, where it still holds none and was not removed. */
const keyPairedHost = SqlSchema.findAll({
  Request: Schema.Struct({
    deviceId: Schema.String,
    userId: Schema.String,
    secretHash: Schema.String,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ deviceId, userId, secretHash, now }) =>
    Database.use((db) =>
      db
        .update(device)
        .set({ secretHash, lastSeenAt: now })
        .where(
          and(
            eq(device.id, deviceId),
            eq(device.userId, userId),
            isNull(device.secretHash),
            isNull(device.removedAt),
          ),
        )
        .returning({ id: device.id }),
    ),
});

/**
 * The account's window of guesses, opened where it has none or its last
 * ended, and its row locked for the rest of the transaction, so the
 * account's guesses are counted one after another.
 */
const openGuessWindow = SqlSchema.findOne({
  Request: Schema.Struct({ userId: Schema.String, now: Schema.Date, endsAt: Schema.Date }),
  Result: Schema.Struct({ misses: Schema.Number, windowEndsAt: Schema.Date }),
  execute: ({ userId, now, endsAt }) =>
    Database.use((db) =>
      db
        .insert(hostPairingGuess)
        .values({ userId, misses: 0, windowEndsAt: endsAt })
        .onConflictDoUpdate({
          target: hostPairingGuess.userId,
          set: {
            misses: sql`case when ${hostPairingGuess.windowEndsAt} <= ${now}::timestamptz then 0 else ${hostPairingGuess.misses} end`,
            windowEndsAt: sql`case when ${hostPairingGuess.windowEndsAt} <= ${now}::timestamptz then ${endsAt}::timestamptz else ${hostPairingGuess.windowEndsAt} end`,
          },
        })
        .returning({
          misses: hostPairingGuess.misses,
          windowEndsAt: hostPairingGuess.windowEndsAt,
        }),
    ),
});

const countMiss = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String }),
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .update(hostPairingGuess)
        .set({ misses: sql`${hostPairingGuess.misses} + 1` })
        .where(eq(hostPairingGuess.userId, userId)),
    ),
});

const findPending = SqlSchema.findOneOption({
  Request: CodeKeySchema,
  Result: PendingSchema,
  execute: ({ userCode, now }) =>
    Database.use((db) =>
      db
        .select({
          name: hostPairing.name,
          platform: hostPairing.platform,
          arch: hostPairing.arch,
          ip: hostPairing.ip,
          expiresAt: hostPairing.expiresAt,
        })
        .from(hostPairing)
        .where(pendingByCode(userCode, now)),
    ),
});

/** A pending pairing approved for the account, its stand stretched for its box to collect; the box it names. */
const settleApproved = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userCode: Schema.String,
    userId: Schema.String,
    now: Schema.Date,
    collectBy: Schema.Date,
  }),
  Result: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    platform: Schema.Literals(Object.values(DEVICE_PLATFORM)),
    arch: Schema.Literals(Object.values(DEVICE_ARCH)),
    version: Schema.String,
  }),
  execute: ({ userCode, userId, now, collectBy }) =>
    Database.use((db) =>
      db
        .update(hostPairing)
        .set({
          status: HOST_PAIRING_STATUS.APPROVED,
          userId,
          expiresAt: sql`greatest(${hostPairing.expiresAt}, ${collectBy}::timestamptz)`,
        })
        .where(pendingByCode(userCode, now))
        .returning({
          id: hostPairing.id,
          name: hostPairing.name,
          platform: hostPairing.platform,
          arch: hostPairing.arch,
          version: hostPairing.version,
        }),
    ),
});

/** The host an approve makes: the account's, under the id given, with no secret until its box collects one. */
const insertPairedHost = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    userId: Schema.String,
    name: Schema.String,
    platform: Schema.Literals(Object.values(DEVICE_PLATFORM)),
    arch: Schema.Literals(Object.values(DEVICE_ARCH)),
    version: Schema.String,
    now: Schema.Date,
  }),
  execute: ({ now, ...host }) =>
    Database.use((db) =>
      // Note that this is a plain insert, so an id that stands fails it rather than being keyed.
      db.insert(device).values({ ...host, kind: DEVICE_KIND.HOST, lastSeenAt: now }),
    ),
});

const namePairedHost = SqlSchema.void({
  Request: Schema.Struct({ id: Schema.String, deviceId: Schema.String }),
  execute: ({ id, deviceId }) =>
    Database.use((db) => db.update(hostPairing).set({ deviceId }).where(eq(hostPairing.id, id))),
});

const settleDenied = SqlSchema.findOneOption({
  Request: Schema.Struct({ userCode: Schema.String, userId: Schema.String, now: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userCode, userId, now }) =>
    Database.use((db) =>
      db
        .update(hostPairing)
        .set({ status: HOST_PAIRING_STATUS.DENIED, userId })
        .where(pendingByCode(userCode, now))
        .returning({ id: hostPairing.id }),
    ),
});

/** A sweep's worth of lapsed pairings deleted, answering what each was and the host an approve made for it. */
const deleteLapsed = SqlSchema.findAll({
  Request: Schema.Struct({ now: Schema.Date }),
  Result: Schema.Struct({
    status: Schema.Literals(Object.values(HOST_PAIRING_STATUS)),
    deviceId: Schema.NullOr(Schema.String),
  }),
  execute: ({ now }) =>
    Database.use((db) =>
      db
        .delete(hostPairing)
        .where(
          inArray(
            hostPairing.id,
            queryBuilder
              .select({ id: hostPairing.id })
              .from(hostPairing)
              .where(lte(hostPairing.expiresAt, now))
              .limit(HOST_PAIRING.SWEEP_BATCH),
          ),
        )
        .returning({ status: hostPairing.status, deviceId: hostPairing.deviceId }),
    ),
});

/** The hosts approves made whose boxes never collected their secret, deleted: never keyed, never registered, so no agent names them. */
const deleteUncollected = SqlSchema.void({
  Request: Schema.Struct({ ids: Schema.Array(Schema.String) }),
  execute: ({ ids }) =>
    Database.use((db) =>
      db
        .delete(device)
        .where(and(inArray(device.id, [...ids]), isNull(device.secretHash), isNull(device.home))),
    ),
});

const deleteEndedWindows = SqlSchema.void({
  Request: Schema.Struct({ now: Schema.Date }),
  execute: ({ now }) =>
    Database.use((db) =>
      db.delete(hostPairingGuess).where(lte(hostPairingGuess.windowEndsAt, now)),
    ),
});

/** The effect given, in one transaction. */
function transacted<A>(work: PairingEffect<A>): PairingEffect<A> {
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(work));
}

/**
 * A guess by user code on the account's behalf (`attempt`, answering what
 * it found where it found a pending pairing): refused unread where the
 * account is held, and counted against it where it found nothing, in one
 * transaction under the lock on the account's window.
 */
function guessed<A>(
  userId: string,
  attempt: (now: Date) => PairingEffect<Option.Option<A>>,
): PairingEffect<HostPairingGuessed<A>> {
  return transacted(
    Effect.gen(function* () {
      const now = yield* DateTime.nowAsDate;
      const endsAt = new Date(now.getTime() + Duration.toMillis(HOST_PAIRING.MISS_WINDOW));
      const window = yield* openGuessWindow({ userId, now, endsAt }).pipe(
        // An upsert that returned no row is the database breaking its own contract, not an outcome.
        Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
      );
      if (window.misses >= HOST_PAIRING.MISS_LIMIT) {
        return { guess: HOST_PAIRING_GUESS.HELD, heldUntil: window.windowEndsAt } as const;
      }
      const found = yield* attempt(now);
      if (Option.isSome(found)) return { guess: HOST_PAIRING_GUESS.FOUND, found: found.value };
      yield* countMiss({ userId });
      return { guess: HOST_PAIRING_GUESS.MISSED } as const;
    }),
  );
}

/**
 * Opens a pending pairing for `HOST_PAIRING.LIFETIME` from now, answering
 * when its code lapses; nothing where a standing pairing already shows the
 * code, which wrote nothing.
 */
export function openHostPairing(opening: HostPairingOpening): PairingEffect<Option.Option<Date>> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const expiresAt = new Date(now.getTime() + Duration.toMillis(HOST_PAIRING.LIFETIME));
    const opened = yield* insertPairing({ ...opening, now, expiresAt });
    return Option.map(Option.fromNullishOr(opened[0]), (row) => row.expiresAt);
  });
}

/**
 * A box's poll by its poll secret's hash, handed the device secret whose
 * hash is given where its pairing was approved: slow down where its last
 * answered poll was under `HOST_PAIRING.POLL_FLOOR` ago, which stamps
 * nothing; pending until its code lapses, expired after that, or where no
 * pairing stands under the hash (never one, swept, or already handed over);
 * denied where a member denied it, or removed the host its approve made
 * before the box collected it; approved once, which keys that host with
 * the secret and deletes the pairing, so another poll is answered expired.
 */
export function pollHostPairing(
  pollSecretHash: string,
  secretHash: string,
): PairingEffect<HostPairingPolled> {
  return transacted(
    Effect.gen(function* () {
      const now = yield* DateTime.nowAsDate;
      const floor = new Date(now.getTime() - Duration.toMillis(HOST_PAIRING.POLL_FLOOR));
      const stamped = yield* stampPolled({ pollSecretHash, now, floor });
      if (Option.isNone(stamped)) {
        const standing = yield* findByPollSecret({ pollSecretHash });
        return standing.length > 0
          ? ({ status: HOST_PAIRING_POLL_STATUS.SLOW_DOWN } as const)
          : ({ status: HOST_PAIRING_POLL_STATUS.EXPIRED } as const);
      }
      const pairing = stamped.value;
      switch (pairing.status) {
        case HOST_PAIRING_STATUS.PENDING:
          return pairing.expiresAt > now
            ? ({ status: HOST_PAIRING_POLL_STATUS.PENDING } as const)
            : ({ status: HOST_PAIRING_POLL_STATUS.EXPIRED } as const);
        case HOST_PAIRING_STATUS.DENIED:
          return { status: HOST_PAIRING_POLL_STATUS.DENIED } as const;
        case HOST_PAIRING_STATUS.APPROVED: {
          // Note that the stamp above holds the row's lock, so a poll racing this one waits and finds it gone.
          const handed = yield* deleteApproved({ id: pairing.id });
          if (Option.isNone(handed)) return { status: HOST_PAIRING_POLL_STATUS.EXPIRED } as const;
          const { deviceId, userId } = handed.value;
          const keyed = yield* keyPairedHost({ deviceId, userId, secretHash, now });
          if (keyed.length === 0) return { status: HOST_PAIRING_POLL_STATUS.DENIED } as const;
          return { status: HOST_PAIRING_POLL_STATUS.APPROVED, deviceId, userId } as const;
        }
      }
    }),
  );
}

/** A pending pairing by its code, as the account's approve screen reads it; a guess (`guessed`). */
export function readHostPairing(
  userId: string,
  userCode: string,
): PairingEffect<HostPairingGuessed<HostPairingPending>> {
  return guessed(userId, (now) => findPending({ userCode, now }));
}

/**
 * Approves a pending pairing by its code for the account, making the
 * account's host under the id given, which the service minted, with the
 * box's name, platform, architecture, and version and no secret, seen now;
 * answers that id. A guess (`guessed`): two approves racing approve once,
 * and the other finds nothing.
 */
export function approveHostPairing(
  userId: string,
  userCode: string,
  deviceId: string,
): PairingEffect<HostPairingGuessed<string>> {
  return guessed(userId, (now) =>
    Effect.gen(function* () {
      const collectBy = new Date(now.getTime() + Duration.toMillis(HOST_PAIRING.COLLECT_GRACE));
      const settled = yield* settleApproved({ userCode, userId, now, collectBy });
      if (Option.isNone(settled)) return Option.none();
      const { id, ...box } = settled.value;
      yield* insertPairedHost({ id: deviceId, userId, ...box, now });
      yield* namePairedHost({ id, deviceId });
      return Option.some(deviceId);
    }),
  );
}

/** Denies a pending pairing by its code for the account, so its box is answered denied; a guess (`guessed`). */
export function denyHostPairing(
  userId: string,
  userCode: string,
): PairingEffect<HostPairingGuessed<true>> {
  return guessed(userId, (now) =>
    Effect.map(
      settleDenied({ userCode, userId, now }),
      Option.map(() => true as const),
    ),
  );
}

/**
 * Deletes a sweep's worth of pairings whose code and stand lapsed, the
 * address each kept with it, and the hosts approves made whose boxes never
 * collected their secret, then every account's window of guesses that
 * ended; answers how many pairings went.
 */
export function sweepHostPairings(now: Date): PairingEffect<number> {
  return transacted(
    Effect.gen(function* () {
      const lapsed = yield* deleteLapsed({ now });
      const uncollected = lapsed.flatMap((pairing) =>
        pairing.status === HOST_PAIRING_STATUS.APPROVED && pairing.deviceId !== null
          ? [pairing.deviceId]
          : [],
      );
      if (uncollected.length > 0) yield* deleteUncollected({ ids: uncollected });
      yield* deleteEndedWindows({ now });
      return lapsed.length;
    }),
  );
}
