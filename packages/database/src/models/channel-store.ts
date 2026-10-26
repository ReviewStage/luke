import { and, asc, desc, eq, isNotNull, isNull, ne, notExists, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Option, Result, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, queryBuilder } from "../core/query.js";
import { channel, channelLook, GENERAL_CHANNEL } from "../schemas/channel.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect } from "./task-store.js";
import { isWorkspaceMember, workspaceReachableBy } from "./workspace-store.js";

/**
 * channel-store.ts -- a workspace's channels and when each member last looked at each.
 *
 * Every read and every look is keyed by the account asking and touches a
 * row only where the account is a member of the channel's workspace, so no
 * account reads another workspace's channels or stamps a look on one.
 * Any member creates, edits, archives, and unarchives a workspace's
 * channels, but never renames or archives its #general, which stays named
 * and open for every thread that names no channel; its purpose is edited as
 * any other's. `ensureGeneralChannel` is the one write keyed by the
 * workspace alone, for the service to call once it has settled who asks.
 */

/** Why a channel was not created, edited, archived, or unarchived. Nothing was written. */
export const CHANNEL_WRITE_REFUSAL = {
  /** No channel the write takes, open or archived as it asks, nor workspace the account is a member of, goes by that id. */
  NOT_FOUND: "not-found",
  /** Another open channel of the workspace goes by that name: the one asked, or the archived channel's own. */
  NAME_TAKEN: "name-taken",
  /** The channel is the workspace's #general, which is never renamed or archived. */
  GENERAL: "general",
} as const;

export type ChannelWriteRefusal =
  (typeof CHANNEL_WRITE_REFUSAL)[keyof typeof CHANNEL_WRITE_REFUSAL];

/** Why a channel's name found no channel to post to. */
export const CHANNEL_NAME_REFUSAL = {
  /** No channel of the workspace, open or archived, goes by that name. */
  UNKNOWN: "unknown",
  /** Only an archived channel of the workspace goes by that name. */
  ARCHIVED: "archived",
} as const;

export type ChannelNameRefusal = (typeof CHANNEL_NAME_REFUSAL)[keyof typeof CHANNEL_NAME_REFUSAL];

/** What a new channel is: its name, a lowercase slug, what it is for, and whether it is one project's. */
export interface ChannelDraft {
  readonly name: string;
  readonly purpose: string;
  readonly project: boolean;
}

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

/** One archived channel of a workspace, as its row holds it, and when it was archived. */
export interface ArchivedChannelRow extends ChannelRow {
  /** Epoch milliseconds. */
  readonly archivedAt: number;
}

/** What an edit changes of a channel: its name, its purpose, or both; what it leaves out stands. */
export interface ChannelEdit {
  readonly name?: string | undefined;
  readonly purpose?: string | undefined;
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

const ArchivedChannelRowSchema = Schema.Struct({
  ...ChannelRowSchema.fields,
  archivedAt: InstantColumnSchema,
});

const PlaceSchema = Schema.Struct({ userId: Schema.String, organizationId: Schema.String });

const IdSchema = Schema.Struct({ id: Schema.String });

/** What a channel row holds that its list carries. */
const CHANNEL_COLUMNS = {
  id: channel.id,
  name: channel.name,
  purpose: channel.purpose,
  project: channel.project,
  createdBy: channel.createdBy,
  createdAt: channel.createdAt,
};

/** A row as its list carries it, its instant in epoch milliseconds. */
function channelRow(row: typeof ChannelRowSchema.Type): ChannelRow {
  return { ...row, createdAt: row.createdAt.getTime() };
}

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
        .select(CHANNEL_COLUMNS)
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

/** Another open channel of the workspace, read beside the one a statement writes, under its own name. */
const other = alias(channel, "other");

/** The condition that no open channel of the written one's workspace but itself goes by the name. */
function nameFree(name: string | typeof channel.name): SQL {
  return notExists(
    queryBuilder
      .select({ one: other.id })
      .from(other)
      .where(
        and(
          eq(other.organizationId, channel.organizationId),
          eq(other.name, name),
          isNull(other.archivedAt),
          ne(other.id, channel.id),
        ),
      ),
  );
}

/** The channel minted, where no open one of its workspace goes by its name; nothing where one does. */
const insertChannel = SqlSchema.findOneOption({
  Request: Schema.Struct({
    organizationId: Schema.String,
    userId: Schema.String,
    name: Schema.String,
    purpose: Schema.String,
    project: Schema.Boolean,
    now: Schema.Date,
  }),
  Result: ChannelRowSchema,
  execute: ({ organizationId, userId, name, purpose, project, now }) =>
    Database.use((db) =>
      db
        .insert(channel)
        .values({ organizationId, name, purpose, project, createdBy: userId, createdAt: now })
        .onConflictDoNothing({
          target: [channel.organizationId, channel.name],
          where: sql`${channel.archivedAt} is null`,
        })
        .returning(CHANNEL_COLUMNS),
    ),
});

/** The workspace's open channel by its id, where the account is a member of that workspace. */
const findOpenChannel = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...PlaceSchema.fields, channelId: Schema.String }),
  Result: ChannelRowSchema,
  execute: ({ userId, organizationId, channelId }) =>
    Database.use((db) =>
      db
        .select(CHANNEL_COLUMNS)
        .from(channel)
        .where(
          and(
            eq(channel.id, channelId),
            eq(channel.organizationId, organizationId),
            isNull(channel.archivedAt),
            workspaceReachableBy(userId, channel.organizationId),
          ),
        ),
    ),
});

/**
 * The open channel's name, purpose, or both written, where no other open
 * channel of its workspace goes by the name; nothing where one does. Note
 * that an edit racing another to one name is refused by the open-name
 * unique index instead, and fails as the store does.
 */
const updateEdit = SqlSchema.findOneOption({
  Request: Schema.Struct({ channelId: Schema.String, name: Schema.String, purpose: Schema.String }),
  Result: ChannelRowSchema,
  execute: ({ channelId, name, purpose }) =>
    Database.use((db) =>
      db
        .update(channel)
        .set({ name, purpose })
        .where(and(eq(channel.id, channelId), isNull(channel.archivedAt), nameFree(name)))
        .returning(CHANNEL_COLUMNS),
    ),
});

/** The open channel archived, which frees its name; nothing where it was archived first. */
const updateArchived = SqlSchema.findOneOption({
  Request: Schema.Struct({ channelId: Schema.String, now: Schema.Date }),
  Result: IdSchema,
  execute: ({ channelId, now }) =>
    Database.use((db) =>
      db
        .update(channel)
        .set({ archivedAt: now })
        .where(and(eq(channel.id, channelId), isNull(channel.archivedAt)))
        .returning({ id: channel.id }),
    ),
});

/** The workspace's archived channels, the latest archived first, where the account is a member of it. */
const findArchivedChannels = SqlSchema.findAll({
  Request: PlaceSchema,
  Result: ArchivedChannelRowSchema,
  execute: (place) =>
    Database.use((db) =>
      db
        .select({ ...CHANNEL_COLUMNS, archivedAt: channel.archivedAt })
        .from(channel)
        .where(
          and(
            eq(channel.organizationId, place.organizationId),
            isNotNull(channel.archivedAt),
            workspaceReachableBy(place.userId, channel.organizationId),
          ),
        )
        .orderBy(desc(channel.archivedAt), asc(channel.id)),
    ),
});

/** The workspace's channel by its id, open or archived, and whether it is archived, where the account is a member of that workspace. */
const findAnyChannel = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...PlaceSchema.fields, channelId: Schema.String }),
  Result: Schema.Struct({ ...ChannelRowSchema.fields, archived: Schema.Boolean }),
  execute: ({ userId, organizationId, channelId }) =>
    Database.use((db) =>
      db
        .select({ ...CHANNEL_COLUMNS, archived: sql<boolean>`${channel.archivedAt} is not null` })
        .from(channel)
        .where(
          and(
            eq(channel.id, channelId),
            eq(channel.organizationId, organizationId),
            workspaceReachableBy(userId, channel.organizationId),
          ),
        ),
    ),
});

/**
 * The archived channel opened again, where no open channel of its
 * workspace goes by its name; nothing where one does, or it was opened
 * first. Note that an unarchive racing a channel made under its name is
 * refused by the open-name unique index instead, and fails as the store does.
 */
const updateUnarchived = SqlSchema.findOneOption({
  Request: Schema.Struct({ channelId: Schema.String }),
  Result: ChannelRowSchema,
  execute: ({ channelId }) =>
    Database.use((db) =>
      db
        .update(channel)
        .set({ archivedAt: null })
        .where(
          and(eq(channel.id, channelId), isNotNull(channel.archivedAt), nameFree(channel.name)),
        )
        .returning(CHANNEL_COLUMNS),
    ),
});

/** The workspace of the channel, open or archived, where the account is a member of it. */
const findChannelWorkspace = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, channelId: Schema.String }),
  Result: Schema.Struct({ organizationId: Schema.String }),
  execute: ({ userId, channelId }) =>
    Database.use((db) =>
      db
        .select({ organizationId: channel.organizationId })
        .from(channel)
        .where(
          and(eq(channel.id, channelId), workspaceReachableBy(userId, channel.organizationId)),
        ),
    ),
});

/** Whether an archived channel of the workspace goes by the name, where the account is a member of it. */
const findArchivedNamed = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...PlaceSchema.fields, name: Schema.String }),
  Result: IdSchema,
  execute: ({ userId, organizationId, name }) =>
    Database.use((db) =>
      db
        .select({ id: channel.id })
        .from(channel)
        .where(
          and(
            eq(channel.organizationId, organizationId),
            eq(channel.name, name),
            isNotNull(channel.archivedAt),
            workspaceReachableBy(userId, channel.organizationId),
          ),
        )
        .limit(1),
    ),
});

/** The workspace's open channel of that name, where the account is a member of it. */
const findOpenNamed = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...PlaceSchema.fields, name: Schema.String }),
  Result: ChannelRowSchema,
  execute: ({ userId, organizationId, name }) =>
    Database.use((db) =>
      db
        .select(CHANNEL_COLUMNS)
        .from(channel)
        .where(
          and(
            openNamed(organizationId, name),
            workspaceReachableBy(userId, channel.organizationId),
          ),
        ),
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
  return Effect.map(findChannels({ userId, organizationId }), (rows) => rows.map(channelRow));
}

/** The workspace a channel, open or archived, belongs to; nothing where the account is not a member of it, or no channel goes by the id. */
export function channelWorkspaceOf(
  userId: string,
  channelId: string,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.map(
    findChannelWorkspace({ userId, channelId }),
    Option.map((row) => row.organizationId),
  );
}

/**
 * The workspace's open channels by name, its #general minted first where
 * it has none yet, so a member or an agent choosing where a thread goes
 * always finds one; none where the account is not a member of it.
 */
export function openChannels(
  userId: string,
  organizationId: string,
  now: Date,
): TaskStoreEffect<readonly ChannelRow[]> {
  return Effect.gen(function* () {
    const member = yield* isWorkspaceMember(userId, organizationId);
    if (!member) return [];
    yield* ensureGeneralChannel(organizationId, now);
    return yield* listChannels(userId, organizationId);
  });
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

/**
 * A channel the member makes in their workspace, made by them at the
 * instant given; refused where they are not a member of it, or an open
 * channel of it already goes by the name. The workspace's #general is
 * minted first, so a channel never takes its name before it stands.
 */
export function createChannel(
  userId: string,
  organizationId: string,
  draft: ChannelDraft,
  now: Date,
): TaskStoreEffect<Result.Result<ChannelRow, ChannelWriteRefusal>> {
  return Effect.gen(function* () {
    const member = yield* isWorkspaceMember(userId, organizationId);
    if (!member) return Result.fail(CHANNEL_WRITE_REFUSAL.NOT_FOUND);
    yield* ensureGeneralChannel(organizationId, now);
    const made = yield* insertChannel({ organizationId, userId, ...draft, now });
    if (Option.isNone(made)) return Result.fail(CHANNEL_WRITE_REFUSAL.NAME_TAKEN);
    return Result.succeed(channelRow(made.value));
  });
}

/**
 * The open channel of the member's workspace given the name, the purpose,
 * or both the edit names, what it leaves out standing; refused where it is
 * none of that workspace's open channels or they are not a member of it, it
 * is #general and the edit names another name, or another open channel goes
 * by the name. #general's purpose is edited as any channel's.
 */
export function editChannel(
  userId: string,
  organizationId: string,
  channelId: string,
  edit: ChannelEdit,
): TaskStoreEffect<Result.Result<ChannelRow, ChannelWriteRefusal>> {
  return Effect.gen(function* () {
    const standing = yield* findOpenChannel({ userId, organizationId, channelId });
    if (Option.isNone(standing)) return Result.fail(CHANNEL_WRITE_REFUSAL.NOT_FOUND);
    const name = edit.name ?? standing.value.name;
    const purpose = edit.purpose ?? standing.value.purpose;
    if (standing.value.name === GENERAL_CHANNEL.NAME && name !== GENERAL_CHANNEL.NAME) {
      return Result.fail(CHANNEL_WRITE_REFUSAL.GENERAL);
    }
    const edited = yield* updateEdit({ channelId, name, purpose });
    if (Option.isNone(edited)) return Result.fail(CHANNEL_WRITE_REFUSAL.NAME_TAKEN);
    return Result.succeed(channelRow(edited.value));
  });
}

/**
 * The open channel of the member's workspace archived at the instant
 * given, which frees its name and leaves its threads where they are;
 * refused where it is none of that workspace's open channels or they are
 * not a member of it, or it is #general.
 */
export function archiveChannel(
  userId: string,
  organizationId: string,
  channelId: string,
  now: Date,
): TaskStoreEffect<Result.Result<void, ChannelWriteRefusal>> {
  return Effect.gen(function* () {
    const standing = yield* findOpenChannel({ userId, organizationId, channelId });
    if (Option.isNone(standing)) return Result.fail(CHANNEL_WRITE_REFUSAL.NOT_FOUND);
    if (standing.value.name === GENERAL_CHANNEL.NAME) {
      return Result.fail(CHANNEL_WRITE_REFUSAL.GENERAL);
    }
    const archived = yield* updateArchived({ channelId, now });
    if (Option.isNone(archived)) return Result.fail(CHANNEL_WRITE_REFUSAL.NOT_FOUND);
    return Result.void;
  });
}

/** The workspace's archived channels, the latest archived first; none where the account is not a member of it. */
export function listArchivedChannels(
  userId: string,
  organizationId: string,
): TaskStoreEffect<readonly ArchivedChannelRow[]> {
  return Effect.map(findArchivedChannels({ userId, organizationId }), (rows) =>
    rows.map((row) => ({ ...channelRow(row), archivedAt: row.archivedAt.getTime() })),
  );
}

/**
 * The channel of the member's workspace opened again under its own name,
 * its threads where they stood; one already open answers as it stands, so
 * two members unarchiving it at once both see it open. Refused where it is
 * none of that workspace's channels or they are not a member of it, or an
 * open channel now goes by its name.
 */
export function unarchiveChannel(
  userId: string,
  organizationId: string,
  channelId: string,
): TaskStoreEffect<Result.Result<ChannelRow, ChannelWriteRefusal>> {
  return Effect.gen(function* () {
    const standing = yield* findAnyChannel({ userId, organizationId, channelId });
    if (Option.isNone(standing)) return Result.fail(CHANNEL_WRITE_REFUSAL.NOT_FOUND);
    const { archived, ...row } = standing.value;
    if (!archived) return Result.succeed(channelRow(row));
    const opened = yield* updateUnarchived({ channelId });
    if (Option.isSome(opened)) return Result.succeed(channelRow(opened.value));
    // Note that a channel another member opened first answers as it now stands, rather than as a name taken.
    const now = yield* findOpenChannel({ userId, organizationId, channelId });
    if (Option.isSome(now)) return Result.succeed(channelRow(now.value));
    return Result.fail(CHANNEL_WRITE_REFUSAL.NAME_TAKEN);
  });
}

/** The workspace's open channel the name names, as an agent names one to post to; refused where only an archived one goes by it, or none, or the account is not a member of the workspace. */
export function resolveChannel(
  userId: string,
  organizationId: string,
  name: string,
): TaskStoreEffect<Result.Result<ChannelRow, ChannelNameRefusal>> {
  return Effect.gen(function* () {
    const open = yield* findOpenNamed({ userId, organizationId, name });
    if (Option.isSome(open)) return Result.succeed(channelRow(open.value));
    const archived = yield* findArchivedNamed({ userId, organizationId, name });
    return Result.fail(
      Option.isSome(archived) ? CHANNEL_NAME_REFUSAL.ARCHIVED : CHANNEL_NAME_REFUSAL.UNKNOWN,
    );
  });
}
