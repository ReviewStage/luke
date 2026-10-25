import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { channel, channelLook, GENERAL_CHANNEL } from "../schemas/channel.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect } from "./task-store.js";
import { workspaceReachableBy } from "./workspace-store.js";

/**
 * channel-store.ts -- a workspace's channels and when each member last looked at each.
 *
 * Every read and every look is keyed by the account asking and touches a
 * row only where the account is a member of the channel's workspace, so no
 * account reads another workspace's channels or stamps a look on one.
 * `ensureGeneralChannel` is the one write keyed by the workspace alone,
 * for the service to call once it has settled who asks.
 */

/** One open channel of a workspace, as its row holds it. */
export interface ChannelRow {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly project: boolean;
  /** Null on a #general the workspace minted itself, and once its member's account is gone. */
  readonly createdBy: string | null;
  /** Epoch milliseconds. */
  readonly createdAt: number;
}

/** When the member last looked at one channel. */
export interface ChannelLook {
  readonly channelId: string;
  /** Epoch milliseconds. */
  readonly lookedAt: number;
}

const ChannelRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  purpose: Schema.String,
  project: Schema.Boolean,
  createdBy: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
});

const PlaceSchema = Schema.Struct({ userId: Schema.String, organizationId: Schema.String });

const IdSchema = Schema.Struct({ id: Schema.String });

/** The workspace's open channel of that name: the lookup the open-name unique index serves. */
function openNamed(organizationId: string, name: string) {
  return and(
    eq(channel.organizationId, organizationId),
    eq(channel.name, name),
    isNull(channel.archivedAt),
  );
}

const findGeneral = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: IdSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({ id: channel.id })
        .from(channel)
        .where(openNamed(organizationId, GENERAL_CHANNEL.NAME)),
    ),
});

/** The workspace's #general minted, its id; nothing where another writer minted it first. */
const insertGeneral = SqlSchema.findOneOption({
  Request: Schema.Struct({ organizationId: Schema.String, now: Schema.Date }),
  Result: IdSchema,
  execute: ({ organizationId, now }) =>
    Database.use((db) =>
      db
        .insert(channel)
        .values({
          organizationId,
          name: GENERAL_CHANNEL.NAME,
          purpose: GENERAL_CHANNEL.PURPOSE,
          project: false,
          createdAt: now,
        })
        .onConflictDoNothing({
          target: [channel.organizationId, channel.name],
          where: sql`${channel.archivedAt} is null`,
        })
        .returning({ id: channel.id }),
    ),
});

const findChannels = SqlSchema.findAll({
  Request: PlaceSchema,
  Result: ChannelRowSchema,
  execute: (place) =>
    Database.use((db) =>
      db
        .select({
          id: channel.id,
          name: channel.name,
          purpose: channel.purpose,
          project: channel.project,
          createdBy: channel.createdBy,
          createdAt: channel.createdAt,
        })
        .from(channel)
        .where(
          and(
            eq(channel.organizationId, place.organizationId),
            isNull(channel.archivedAt),
            workspaceReachableBy(place.userId, channel.organizationId),
          ),
        )
        .orderBy(asc(channel.name)),
    ),
});

/**
 * The member's look at the channel, written only where they are a member of
 * its workspace, and moved only forward, so a stamp that arrives after a
 * later one keeps the later.
 */
const upsertLook = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, channelId: Schema.String, at: Schema.Date }),
  execute: ({ userId, channelId, at }) =>
    Database.use((db) =>
      db
        .insert(channelLook)
        .select((qb) =>
          qb
            .select({
              userId: sql<string>`${userId}`.as("user_id"),
              channelId: channel.id,
              lookedAt: sql<Date>`${at}::timestamptz`.as("looked_at"),
            })
            .from(channel)
            .where(
              and(eq(channel.id, channelId), workspaceReachableBy(userId, channel.organizationId)),
            ),
        )
        .onConflictDoUpdate({
          target: [channelLook.userId, channelLook.channelId],
          set: { lookedAt: sql`greatest(${channelLook.lookedAt}, excluded.looked_at)` },
        }),
    ),
});

const findLooks = SqlSchema.findAll({
  Request: PlaceSchema,
  Result: Schema.Struct({ channelId: Schema.String, lookedAt: InstantColumnSchema }),
  execute: (place) =>
    Database.use((db) =>
      db
        .select({ channelId: channelLook.channelId, lookedAt: channelLook.lookedAt })
        .from(channelLook)
        .innerJoin(channel, eq(channel.id, channelLook.channelId))
        .where(
          and(
            eq(channelLook.userId, place.userId),
            eq(channel.organizationId, place.organizationId),
            workspaceReachableBy(place.userId, channel.organizationId),
          ),
        )
        .orderBy(asc(channelLook.channelId)),
    ),
});

/**
 * The workspace's #general, minted where it has none yet; its id. Calling
 * it again, or from two writers at once, answers the same channel: the
 * loser of a concurrent mint is refused by the open-name unique index and
 * reads back the winner's row, which its statement's own snapshot, taken
 * after the winner committed, sees.
 */
export function ensureGeneralChannel(organizationId: string, now: Date): TaskStoreEffect<string> {
  return Effect.gen(function* () {
    const standing = yield* findGeneral(organizationId);
    if (Option.isSome(standing)) return standing.value.id;
    const minted = yield* insertGeneral({ organizationId, now });
    if (Option.isSome(minted)) return minted.value.id;
    const won = yield* findGeneral(organizationId);
    if (Option.isNone(won)) return yield* Effect.die(new Error("a #general refused is missing"));
    return won.value.id;
  });
}

/** The workspace's open channels by name; none where the account is not a member of it. */
export function listChannels(
  userId: string,
  organizationId: string,
): TaskStoreEffect<readonly ChannelRow[]> {
  return Effect.map(findChannels({ userId, organizationId }), (rows) =>
    rows.map((row) => ({ ...row, createdAt: row.createdAt.getTime() })),
  );
}

/** Stamps the member's look at the channel at the instant given; nothing where they are not a member of its workspace, or a later look stands. */
export function stampChannelLook(
  userId: string,
  channelId: string,
  at: Date,
): TaskStoreEffect<void> {
  return upsertLook({ userId, channelId, at });
}

/** When the member last looked at each channel of the workspace they ever looked at; none where they are not a member of it. */
export function listChannelLooks(
  userId: string,
  organizationId: string,
): TaskStoreEffect<readonly ChannelLook[]> {
  return Effect.map(findLooks({ userId, organizationId }), (rows) =>
    rows.map((row) => ({ channelId: row.channelId, lookedAt: row.lookedAt.getTime() })),
  );
}
