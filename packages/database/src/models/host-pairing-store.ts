import {
  DEVICE_ARCH,
  DEVICE_PLATFORM,
  type DeviceArch,
  type DevicePlatform,
} from "@repo/features/device-agent-wire";
import { HOST_PAIRING_POLL_STATUS } from "@repo/features/host-wire";
import { and, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { DateTime, Duration, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import { device } from "../schemas/device.js";
import { HOST_PAIRING_STATUS, hostPairing, hostPairingGuess } from "../schemas/host-pairing.js";

type PairingEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

export const HOST_PAIRING = {
  LIFETIME: Duration.minutes(10),
  COLLECT_GRACE: Duration.minutes(1),
  POLL_INTERVAL: Duration.seconds(5),
  POLL_FLOOR: Duration.seconds(4),
  MISS_LIMIT: 10,
  MISS_WINDOW: Duration.minutes(15),
  SWEEP_BATCH: 500,
} as const;

export interface HostPairingOpening {
  readonly pollSecretHash: string;
  readonly userCode: string;
  readonly name: string;
  readonly platform: DevicePlatform;
  readonly arch: DeviceArch;
  readonly version: string;
  readonly ip: string | null;
}

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

export const HOST_PAIRING_GUESS = {
  FOUND: "found",
  MISSED: "missed",
  HELD: "held",
} as const;

export type HostPairingGuessed<A> =
  | { readonly guess: typeof HOST_PAIRING_GUESS.FOUND; readonly found: A }
  | { readonly guess: typeof HOST_PAIRING_GUESS.MISSED }
  | { readonly guess: typeof HOST_PAIRING_GUESS.HELD; readonly heldUntil: Date };

const PendingSchema = Schema.Struct({
  name: Schema.String,
  platform: Schema.Literals(Object.values(DEVICE_PLATFORM)),
  arch: Schema.Literals(Object.values(DEVICE_ARCH)),
  ip: Schema.NullOr(Schema.String),
  expiresAt: Schema.Date,
});

export type HostPairingPending = typeof PendingSchema.Type;

const CodeKeySchema = Schema.Struct({ userCode: Schema.String, now: Schema.Date });

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
        .onConflictDoNothing()
        .returning({ expiresAt: hostPairing.expiresAt }),
    ),
});

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
    Database.use((db) => db.insert(device).values({ ...host, lastSeenAt: now })),
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

function transacted<A>(work: PairingEffect<A>): PairingEffect<A> {
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(work));
}

function guessed<A>(
  userId: string,
  attempt: (now: Date) => PairingEffect<Option.Option<A>>,
): PairingEffect<HostPairingGuessed<A>> {
  return transacted(
    Effect.gen(function* () {
      const now = yield* DateTime.nowAsDate;
      const endsAt = new Date(now.getTime() + Duration.toMillis(HOST_PAIRING.MISS_WINDOW));
      const window = yield* openGuessWindow({ userId, now, endsAt }).pipe(
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

export function openHostPairing(opening: HostPairingOpening): PairingEffect<Option.Option<Date>> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const expiresAt = new Date(now.getTime() + Duration.toMillis(HOST_PAIRING.LIFETIME));
    const opened = yield* insertPairing({ ...opening, now, expiresAt });
    return Option.map(Option.fromNullishOr(opened[0]), (row) => row.expiresAt);
  });
}

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
          if (pairing.expiresAt <= now)
            return { status: HOST_PAIRING_POLL_STATUS.EXPIRED } as const;
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

export function readHostPairing(
  userId: string,
  userCode: string,
): PairingEffect<HostPairingGuessed<HostPairingPending>> {
  return guessed(userId, (now) => findPending({ userCode, now }));
}

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
