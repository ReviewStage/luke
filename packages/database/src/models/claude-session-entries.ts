/**
 * claude-session-entries.ts -- an agent's CLI transcript as Anthropic's reference Postgres `SessionStore` keeps it: appended, loaded, listed, and deleted under the agent's conversation.
 *
 * The five methods and their SQL are the example's
 * (`claude-agent-sdk-typescript`'s `examples/session-stores/postgres`), each
 * narrowed to one conversation of the account given, so no account reads or
 * writes another's transcript (`../schemas/claude-session-entry.ts`). A key
 * is the SDK's `SessionKey`: a project, a session, and a subpath, absent for
 * the main transcript. Beside them, a Start copies its source's rows to the
 * conversation it starts, so a continued or forked agent forks the source's
 * transcript as its own.
 */

import { and, asc, desc, eq, isNotNull, isNull, max, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { claudeSessionEntries } from "../schemas/claude-session-entry.js";
import { conversations } from "../schemas/storage.js";

type EntryEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** One transcript line, opaque but for its `type`, as the SDK's `SessionStoreEntry` is. */
const EntrySchema = Schema.Record(Schema.String, Schema.Unknown);
export type SessionEntry = typeof EntrySchema.Type;

/** Where a transcript is kept: the SDK's `SessionKey`, `subpath` absent for the main transcript. */
export interface SessionEntryKey {
  readonly projectKey: string;
  readonly sessionId: string;
  readonly subpath?: string | undefined;
}

/** A session of a project and when its main transcript was last appended to, in epoch milliseconds. */
export interface SessionListing {
  readonly sessionId: string;
  readonly mtime: number;
}

const OwnerFields = { userId: Schema.String, conversationId: Schema.String };
const KeyFields = {
  ...OwnerFields,
  projectKey: Schema.String,
  sessionId: Schema.String,
  subpath: Schema.NullOr(Schema.String),
};

/** The account's own conversation, which every read and write of its rows is narrowed to. */
const ownConversation = (userId: string, conversationId: string) =>
  and(eq(conversations.id, conversationId), eq(conversations.userId, userId));

/** The rows of one session's transcript, or of all its transcripts where `subpath` is absent. */
const sessionRows = (conversationId: string, projectKey: string, sessionId: string) =>
  and(
    eq(claudeSessionEntries.conversationId, conversationId),
    eq(claudeSessionEntries.projectKey, projectKey),
    eq(claudeSessionEntries.sessionId, sessionId),
  );

const findConversation = SqlSchema.findOneOption({
  Request: Schema.Struct(OwnerFields),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ id: conversations.id })
        .from(conversations)
        .where(ownConversation(userId, conversationId))
        .limit(1),
    ),
});

const insertEntries = SqlSchema.void({
  Request: Schema.Struct({ ...KeyFields, entries: Schema.Array(EntrySchema) }),
  execute: ({ conversationId, projectKey, sessionId, subpath, entries }) =>
    Database.use((db) =>
      db
        .insert(claudeSessionEntries)
        .values(
          entries.map((entry) => ({ conversationId, projectKey, sessionId, subpath, entry })),
        ),
    ),
});

const findEntries = SqlSchema.findAll({
  Request: Schema.Struct(KeyFields),
  Result: Schema.Struct({ entry: EntrySchema }),
  execute: ({ userId, conversationId, projectKey, sessionId, subpath }) =>
    Database.use((db) =>
      db
        .select({ entry: claudeSessionEntries.entry })
        .from(claudeSessionEntries)
        .innerJoin(conversations, eq(conversations.id, claudeSessionEntries.conversationId))
        .where(
          and(
            ownConversation(userId, conversationId),
            sessionRows(conversationId, projectKey, sessionId),
            // Note that IS NOT DISTINCT FROM matches null to null, so no subpath reads the main transcript.
            sql`${claudeSessionEntries.subpath} is not distinct from ${subpath}`,
          ),
        )
        .orderBy(asc(claudeSessionEntries.id)),
    ),
});

const findSessions = SqlSchema.findAll({
  Request: Schema.Struct({ ...OwnerFields, projectKey: Schema.String }),
  Result: Schema.Struct({ sessionId: Schema.String, mtime: Schema.Date }),
  execute: ({ userId, conversationId, projectKey }) =>
    Database.use((db) => {
      const mtime = max(claudeSessionEntries.createdAt);
      return db
        .select({ sessionId: claudeSessionEntries.sessionId, mtime })
        .from(claudeSessionEntries)
        .innerJoin(conversations, eq(conversations.id, claudeSessionEntries.conversationId))
        .where(
          and(
            ownConversation(userId, conversationId),
            eq(claudeSessionEntries.conversationId, conversationId),
            eq(claudeSessionEntries.projectKey, projectKey),
            isNull(claudeSessionEntries.subpath),
          ),
        )
        .groupBy(claudeSessionEntries.sessionId)
        .orderBy(desc(mtime));
    }),
});

const deleteEntries = SqlSchema.void({
  Request: Schema.Struct(KeyFields),
  execute: ({ userId, conversationId, projectKey, sessionId, subpath }) =>
    Database.use((db) =>
      db.delete(claudeSessionEntries).where(
        and(
          sessionRows(conversationId, projectKey, sessionId),
          // Note that a main transcript's delete takes its subpaths with it.
          subpath === null ? undefined : eq(claudeSessionEntries.subpath, subpath),
          sql`exists (select 1 from ${conversations} where ${ownConversation(userId, conversationId)})`,
        ),
      ),
    ),
});

const findSubkeys = SqlSchema.findAll({
  Request: Schema.Struct({ ...OwnerFields, projectKey: Schema.String, sessionId: Schema.String }),
  Result: Schema.Struct({ subpath: Schema.String }),
  execute: ({ userId, conversationId, projectKey, sessionId }) =>
    Database.use((db) =>
      db
        .selectDistinct({ subpath: sql<string>`${claudeSessionEntries.subpath}` })
        .from(claudeSessionEntries)
        .innerJoin(conversations, eq(conversations.id, claudeSessionEntries.conversationId))
        .where(
          and(
            ownConversation(userId, conversationId),
            sessionRows(conversationId, projectKey, sessionId),
            isNotNull(claudeSessionEntries.subpath),
          ),
        ),
    ),
});

const copyEntries = SqlSchema.void({
  Request: Schema.Struct({
    sourceUserId: Schema.String,
    sourceConversationId: Schema.String,
    conversationId: Schema.String,
  }),
  execute: ({ sourceUserId, sourceConversationId, conversationId }) =>
    Database.use((db) =>
      db.insert(claudeSessionEntries).select((qb) =>
        qb
          .select({
            conversationId: sql<string>`${conversationId}::uuid`.as("conversation_id"),
            projectKey: claudeSessionEntries.projectKey,
            sessionId: claudeSessionEntries.sessionId,
            subpath: claudeSessionEntries.subpath,
            entry: claudeSessionEntries.entry,
            createdAt: claudeSessionEntries.createdAt,
          })
          .from(claudeSessionEntries)
          .innerJoin(conversations, eq(conversations.id, claudeSessionEntries.conversationId))
          .where(ownConversation(sourceUserId, sourceConversationId))
          .orderBy(asc(claudeSessionEntries.id)),
      ),
    ),
});

const findAnyEntry = SqlSchema.findOneOption({
  Request: Schema.Struct(OwnerFields),
  Result: Schema.Struct({ id: Schema.Number }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ id: claudeSessionEntries.id })
        .from(claudeSessionEntries)
        .innerJoin(conversations, eq(conversations.id, claudeSessionEntries.conversationId))
        .where(ownConversation(userId, conversationId))
        .limit(1),
    ),
});

/** A key's fields as the requests take them: no subpath as null. */
function keyFields(userId: string, conversationId: string, key: SessionEntryKey) {
  return {
    userId,
    conversationId,
    projectKey: key.projectKey,
    sessionId: key.sessionId,
    subpath: key.subpath ?? null,
  };
}

/** The entries given appended to the key's transcript in the account's conversation, in their order; nothing where the conversation is not the account's. */
export function appendSessionEntries(
  userId: string,
  conversationId: string,
  key: SessionEntryKey,
  entries: readonly SessionEntry[],
): EntryEffect<void> {
  if (entries.length === 0) return Effect.void;
  return Effect.gen(function* () {
    const own = yield* findConversation({ userId, conversationId });
    if (Option.isNone(own)) return;
    yield* insertEntries({ ...keyFields(userId, conversationId, key), entries });
  });
}

/** The key's transcript in the account's conversation, in the order it was appended; none where it holds no entry. */
export function loadSessionEntries(
  userId: string,
  conversationId: string,
  key: SessionEntryKey,
): EntryEffect<Option.Option<readonly SessionEntry[]>> {
  return findEntries(keyFields(userId, conversationId, key)).pipe(
    Effect.map((rows) =>
      rows.length > 0 ? Option.some(rows.map((row) => row.entry)) : Option.none(),
    ),
  );
}

/** The project's sessions in the account's conversation, each with when its main transcript was last appended to, the latest first. */
export function listSessionEntrySessions(
  userId: string,
  conversationId: string,
  projectKey: string,
): EntryEffect<readonly SessionListing[]> {
  return findSessions({ userId, conversationId, projectKey }).pipe(
    Effect.map((rows) =>
      rows.map((row) => ({ sessionId: row.sessionId, mtime: row.mtime.getTime() })),
    ),
  );
}

/** The key's transcript deleted from the account's conversation; a main transcript's with every subpath under its session. */
export function deleteSessionEntries(
  userId: string,
  conversationId: string,
  key: SessionEntryKey,
): EntryEffect<void> {
  return deleteEntries(keyFields(userId, conversationId, key));
}

/** The subpaths the session holds a transcript under in the account's conversation. */
export function listSessionEntrySubkeys(
  userId: string,
  conversationId: string,
  key: Pick<SessionEntryKey, "projectKey" | "sessionId">,
): EntryEffect<readonly string[]> {
  return findSubkeys({ userId, conversationId, ...key }).pipe(
    Effect.map((rows) => rows.map((row) => row.subpath)),
  );
}

/** Whether the account's conversation holds any transcript entry. */
export function holdsSessionEntries(userId: string, conversationId: string): EntryEffect<boolean> {
  return findAnyEntry({ userId, conversationId }).pipe(Effect.map(Option.isSome));
}

/** Every row of the source conversation, read as its own account, copied to the conversation given in their order. */
export function copySessionEntries(
  source: { readonly userId: string; readonly conversationId: string },
  conversationId: string,
): EntryEffect<void> {
  return copyEntries({
    sourceUserId: source.userId,
    sourceConversationId: source.conversationId,
    conversationId,
  });
}
