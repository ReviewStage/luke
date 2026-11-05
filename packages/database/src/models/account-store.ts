import { storedAgentChoice } from "@repo/features/account-preferences-live";
import { contextWindowSchema } from "@repo/features/agent-wire";
import {
  CHAPTERS_MODEL_LIST,
  type ChaptersModelId,
  chaptersModelFrom,
} from "@repo/features/chapters-model-choice";
import { LINK_OPEN_LIST, type LinkOpen } from "@repo/features/link-open";
import type { ModelChoice } from "@repo/features/models-wire";
import {
  type AccountPreferences,
  AGENT_ENTER_LIST,
  type AgentEnter,
  accountPreferencesFromStored,
  COMMIT_AUTHOR_LIST,
  type CommitAuthor,
  type Experiment,
  type ExperimentChoices,
  experimentChoicesFrom,
  experimentOn,
  NO_EXPERIMENTS,
} from "@repo/settings";
import { WireValueSchema } from "@repo/wire";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { member, user } from "../schemas/auth.js";
import { accountPreference } from "../schemas/preferences.js";
import { conversations } from "../schemas/storage.js";
import { InstantColumnSchema } from "./columns.js";
import { queueSessionSandboxes, sessionsOf } from "./session-sandbox-cleanup.js";
import { stampConversationsDeleted } from "./soft-delete.js";

/**
 * What the account group reads and writes of an account: what its erasure
 * settles beside Better Auth's own delete, the cross-device snapshot behind `/api/account/preferences`, which is the
 * settings preferences, the coding agents' default model, effort, and
 * context window, the model the account's Generate chapters runs on, and
 * the experiments the account turned on. Every function here is an effect over the ambient `SqlClient`
 * and names no database of its own; `account-seams.ts` beside it runs them
 * at the web edge and is the only file of the two that reaches the auth
 * session.
 */

/** One account's stored snapshot: the preferences every device shares, the coding agents' default, and when the preferences were last written. */
export interface AccountPreferencesRow {
  /** The settings every device shares, the link choice among them where the account made one. */
  preferences: AccountPreferences;
  /** What a click on Start runs on; none until the account chooses, which the service answers with the fallback its credentials pay for. */
  agent: ModelChoice | undefined;
  /** What a Generate chapters the account presses runs on; Haiku until the account chooses, and for a stored value no build lists any more. */
  chaptersModel: ChaptersModelId;
  /** Each experiment the account turned on or back off; one it never chose is absent, and off. */
  experiments: ExperimentChoices;
  /**
   * When the preferences part was last written; none on a row only a
   * coding-agent choice opened. The desktop reads its presence as a snapshot
   * to apply over its own settings, so it stands for the preferences alone.
   */
  updatedAt: Date | undefined;
}

/** One account's snapshot as a write left it, with the transaction the write committed in, which a reader holding the row waits for. */
export interface AccountPreferencesWritten extends AccountPreferencesRow {
  readonly txid: string;
}

/**
 * What a write carries: each part present replaces what stood, and a part
 * left out stands as it was, so the desktop's settings sync and Settings'
 * default model each write their own part without reading the other first.
 * The experiments part is the one patch: its keys are merged over what
 * stood, so a Mac that knows fewer experiments never erases another's.
 * `preferences` is the shared part; the link choice, Enter's choice, the
 * commit author, and setup finished are parts of their own, which a build that predates them
 * never sends.
 */
export interface AccountPreferencesWrite {
  preferences?: AccountPreferences;
  linkOpen?: LinkOpen;
  agentEnter?: AgentEnter;
  commitAuthor?: CommitAuthor;
  setupFinished?: boolean;
  agent?: ModelChoice;
  chaptersModel?: ChaptersModelId;
  experiments?: ExperimentChoices;
}

/** What an account seam answers: an effect over the ambient client, composed into the request that made it. */
export type AccountSeamEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/**
 * What an account's deletion keeps of its own beside Better Auth's
 * `deleteUser` (`auth-policy.ts`'s `accountDeletion`), which deletes the user
 * row and the workspaces the account is the only member of, every dependent
 * row cascading with them. Two things outlast those rows, so they are read
 * before the delete and settled after it: the eve session each of the
 * account's conversations ran in, a deleted task's too, which is queued for
 * its sandbox's deletion since nothing after the delete names it; and the
 * conversations of the agents in the account's workspaces, which name the
 * account that ran them rather than the workspace, so a deleted workspace's
 * agents of other members leave theirs behind, stamped deleted for the purge
 * as a deleted task's are (`soft-delete.ts`).
 */
export interface AccountDeletionReach {
  readonly conversationIds: readonly string[];
  readonly sessionIds: readonly string[];
}

const findWorkspaceConversations = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ conversationId: Schema.String }),
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({ conversationId: agentTable.conversationId })
        .from(agentTable)
        .innerJoin(member, eq(member.organizationId, agentTable.organizationId))
        .where(eq(member.userId, userId)),
    ),
});

const findAccountSessions = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ runtimeSessionId: Schema.NullOr(Schema.String) }),
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({ runtimeSessionId: conversations.runtimeSessionId })
        .from(conversations)
        .where(eq(conversations.userId, userId)),
    ),
});

const findUnnamedConversations = SqlSchema.findAll({
  Request: Schema.Array(Schema.String),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (conversationIds) =>
    Database.use((db) =>
      db
        .select({ id: conversations.id })
        .from(conversations)
        .leftJoin(agentTable, eq(agentTable.conversationId, conversations.id))
        .where(and(inArray(conversations.id, conversationIds), isNull(agentTable.id))),
    ),
});

/** What the account's deletion settles once Better Auth has deleted it, read while its rows stand. */
export function readAccountDeletionReach(
  userId: string,
): Effect.Effect<AccountDeletionReach, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const agents = yield* findWorkspaceConversations(userId);
    const sessions = yield* findAccountSessions(userId);
    return {
      conversationIds: agents.map(({ conversationId }) => conversationId),
      sessionIds: sessionsOf(sessions),
    };
  });
}

/**
 * Settles what the deletion read: each conversation no agent names any more,
 * its workspace gone, is stamped deleted, and each session is queued for its
 * sandbox's deletion. A conversation whose agent still stands, in a
 * workspace others kept, is left as it is.
 */
export function settleAccountDeletion(
  reach: AccountDeletionReach,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        if (reach.conversationIds.length > 0) {
          const unnamed = yield* findUnnamedConversations(reach.conversationIds);
          yield* stampConversationsDeleted(unnamed.map(({ id }) => id));
        }
        yield* queueSessionSandboxes(reach.sessionIds);
      }),
    ),
  );
}

/** The columns every read and the write's `returning` project, so a row decodes one way whatever wrote it. */
const PREFERENCE_COLUMNS = {
  linkOpen: accountPreference.linkOpen,
  agentEnter: accountPreference.agentEnter,
  commitAuthor: accountPreference.commitAuthor,
  setupFinished: accountPreference.setupFinished,
  agentModel: accountPreference.agentModel,
  agentEffort: accountPreference.agentEffort,
  agentContextWindow: accountPreference.agentContextWindow,
  chaptersModel: accountPreference.chaptersModel,
  experiments: accountPreference.experiments,
  updatedAt: accountPreference.updatedAt,
};

const PreferenceRowSchema = Schema.Struct({
  linkOpen: Schema.NullOr(Schema.String),
  agentEnter: Schema.NullOr(Schema.String),
  commitAuthor: Schema.NullOr(Schema.String),
  setupFinished: Schema.NullOr(Schema.Boolean),
  agentModel: Schema.NullOr(Schema.String),
  agentEffort: Schema.NullOr(Schema.String),
  agentContextWindow: Schema.NullOr(contextWindowSchema),
  chaptersModel: Schema.NullOr(Schema.String),
  experiments: Schema.NullOr(WireValueSchema),
  updatedAt: Schema.NullOr(InstantColumnSchema),
});

type PreferenceRow = typeof PreferenceRowSchema.Type;

/**
 * The row as the group answers it, its coding-agent default read as the
 * account's live read reads it (`storedAgentChoice`), so the two never
 * disagree.
 */
function snapshotOf(row: PreferenceRow): AccountPreferencesRow {
  return {
    preferences:
      accountPreferencesFromStored({
        ...(row.linkOpen ? { linkOpen: row.linkOpen } : undefined),
        ...(row.agentEnter ? { agentEnter: row.agentEnter } : undefined),
        ...(row.commitAuthor ? { commitAuthor: row.commitAuthor } : undefined),
        ...(row.setupFinished === null ? undefined : { setupFinished: row.setupFinished }),
      }) ?? {},
    agent: storedAgentChoice(row),
    // Note that a stored model no build lists any more reads as Haiku, as a row never written does.
    chaptersModel: chaptersModelFrom(row.chaptersModel),
    // Note that a stored key no build lists any more reads as nothing, because the experiment it named graduated or went.
    experiments: experimentChoicesFrom(row.experiments ?? undefined) ?? NO_EXPERIMENTS,
    updatedAt: row.updatedAt ?? undefined,
  };
}

const findPreference = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: PreferenceRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select(PREFERENCE_COLUMNS)
        .from(accountPreference)
        .where(eq(accountPreference.userId, userId))
        .limit(1),
    ),
});

/**
 * The account's preferences row written for its live read: the coding
 * agents' default as its three columns stand, the chapters model, and
 * whether our Slack bot writes the account, each as stored, null where
 * never chosen, which the reader reads as the snapshot does
 * (`@repo/features/account-preferences-live`). No row for an account that
 * stored none. None where a value cannot be carried.
 */
export function accountPreferencesLiveStatement(userId: string): Option.Option<LiveStatement> {
  return liveStatementOf(
    queryBuilder
      .select(
        liveSelection({
          agentModel: accountPreference.agentModel,
          agentEffort: accountPreference.agentEffort,
          agentContextWindow: accountPreference.agentContextWindow,
          chaptersModel: accountPreference.chaptersModel,
          slackNotifications: accountPreference.slackNotifications,
        }),
      )
      .from(accountPreference)
      .where(eq(accountPreference.userId, userId)),
  );
}

/** One account's stored snapshot, or nothing for an account that has stored none. */
export function readAccountPreferences(
  userId: string,
): Effect.Effect<AccountPreferencesRow | undefined, StoreFailure, DatabaseServices> {
  return Effect.map(
    findPreference(userId),
    Option.match({ onNone: () => undefined, onSome: snapshotOf }),
  );
}

/**
 * Whether the account has turned the experiment on: what a server-side gate
 * asks before it offers an experimental feature to the account. An account
 * that stored no snapshot, or never chose the experiment, reads as off.
 */
export function accountExperimentOn(
  userId: string,
  experiment: Experiment,
): Effect.Effect<boolean, StoreFailure, DatabaseServices> {
  return Effect.map(
    readAccountPreferences(userId),
    (row) => row !== undefined && experimentOn(row.experiments, experiment),
  );
}

const findAccess = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({
    role: Schema.NullOr(Schema.String),
    supportAccessUntil: Schema.NullOr(InstantColumnSchema),
  }),
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({ role: user.role, supportAccessUntil: user.supportAccessUntil })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1),
    ),
});

/** What the account's own `user` row says it may open, and who may open it as them. */
export interface AccountAccessRow {
  /** The role as Better Auth keeps it; what a role means is the service's (`admin-access.ts`). */
  readonly role: string | undefined;
  /** When the member's grant of support access runs out, as it was last written, whether or not that is past. */
  readonly supportAccessUntil: Date | undefined;
}

/**
 * The role and the grant of support access stored on the account's own
 * `user` row, as Better Auth keeps them, each nothing where the row holds
 * none, and both nothing where there is no such account. Read for the one
 * account named and no other.
 */
export function readAccountAccess(
  userId: string,
): Effect.Effect<AccountAccessRow, StoreFailure, DatabaseServices> {
  return Effect.map(findAccess(userId), (row) =>
    Option.match(row, {
      onNone: () => ({ role: undefined, supportAccessUntil: undefined }),
      onSome: ({ role, supportAccessUntil }) => ({
        role: role ?? undefined,
        supportAccessUntil: supportAccessUntil ?? undefined,
      }),
    }),
  );
}

const PreferenceWriteSchema = Schema.Struct({
  userId: Schema.String,
  linkOpen: Schema.optionalKey(Schema.Literals(LINK_OPEN_LIST)),
  agentEnter: Schema.optionalKey(Schema.Literals(AGENT_ENTER_LIST)),
  commitAuthor: Schema.optionalKey(Schema.Literals(COMMIT_AUTHOR_LIST)),
  setupFinished: Schema.optionalKey(Schema.Boolean),
  agent: Schema.optionalKey(
    Schema.Struct({
      model: Schema.String,
      effort: Schema.String,
      contextWindow: Schema.optionalKey(contextWindowSchema),
    }),
  ),
  chaptersModel: Schema.optionalKey(Schema.Literals(CHAPTERS_MODEL_LIST)),
  experiments: Schema.optionalKey(Schema.Record(Schema.String, Schema.Boolean)),
  /** The instant the shared preferences part was written, where the write carries it. */
  updatedAt: Schema.optionalKey(Schema.Date),
});

type PreferenceWrite = typeof PreferenceWriteSchema.Type;

/** The columns a write replaces: each part the write carries, the instant with the shared preferences part alone. */
function writtenColumns(write: PreferenceWrite) {
  return {
    ...(write.experiments === undefined ? undefined : { experiments: write.experiments }),
    ...(write.linkOpen === undefined ? undefined : { linkOpen: write.linkOpen }),
    ...(write.agentEnter === undefined ? undefined : { agentEnter: write.agentEnter }),
    ...(write.commitAuthor === undefined ? undefined : { commitAuthor: write.commitAuthor }),
    ...(write.setupFinished === undefined ? undefined : { setupFinished: write.setupFinished }),
    ...(write.chaptersModel === undefined ? undefined : { chaptersModel: write.chaptersModel }),
    ...(write.updatedAt === undefined ? undefined : { updatedAt: write.updatedAt }),
    ...(write.agent === undefined
      ? undefined
      : {
          agentModel: write.agent.model,
          agentEffort: write.agent.effort,
          agentContextWindow: write.agent.contextWindow ?? null,
        }),
  };
}

/**
 * Note that the conflicting update sets the values the insert carried rather
 * than reading them back out of `excluded`, because a single-row insert's
 * `excluded` row is exactly those values; a part the write leaves out is
 * not among them, so the column it stands in keeps what it held.
 */
const upsertPreference = SqlSchema.findOne({
  Request: PreferenceWriteSchema,
  Result: Schema.Struct({ ...PreferenceRowSchema.fields, txid: Schema.String }),
  execute: (write) => {
    const columns = writtenColumns(write);
    // The experiments are the one part merged rather than replaced: the patch's keys over what stood.
    const merged =
      write.experiments === undefined
        ? columns
        : {
            ...columns,
            experiments: sql`coalesce(${accountPreference.experiments}, '{}'::jsonb) || ${JSON.stringify(write.experiments)}::jsonb`,
          };
    return Database.use((db) =>
      db
        .insert(accountPreference)
        .values({ userId: write.userId, ...columns })
        .onConflictDoUpdate({ target: accountPreference.userId, set: merged })
        .returning({ ...PREFERENCE_COLUMNS, txid: sql<string>`pg_current_xact_id()::text` }),
    );
  },
});

/**
 * Writes each part the write carries over what stood — the preferences
 * whole, the coding-agent default whole, the chapters model, the experiments key by key — and answers the snapshot as it
 * now stands, with the transaction it committed in. The instant moves with the shared preferences part alone,
 * so a coding-agent choice, a chapters model, or a link choice never reads to a Mac as a
 * settings snapshot it has to take.
 */
export function writeAccountPreferences(
  userId: string,
  write: AccountPreferencesWrite,
): Effect.Effect<AccountPreferencesWritten, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const updatedAt = yield* DateTime.nowAsDate;
    // Note that the shared part holds no preference since the voice went, so its write moves the instant alone.
    const stored: PreferenceWrite = {
      userId,
      ...(write.preferences === undefined ? undefined : { updatedAt }),
      ...(write.linkOpen === undefined ? undefined : { linkOpen: write.linkOpen }),
      ...(write.agentEnter === undefined ? undefined : { agentEnter: write.agentEnter }),
      ...(write.commitAuthor === undefined ? undefined : { commitAuthor: write.commitAuthor }),
      ...(write.setupFinished === undefined ? undefined : { setupFinished: write.setupFinished }),
      ...(write.agent === undefined ? undefined : { agent: write.agent }),
      ...(write.chaptersModel === undefined ? undefined : { chaptersModel: write.chaptersModel }),
      ...(write.experiments === undefined ? undefined : { experiments: write.experiments }),
    };
    const row = yield* upsertPreference(stored).pipe(
      // An upsert that returned no row is the database breaking its own contract, not an outcome.
      Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
    );
    return { ...snapshotOf(row), txid: row.txid };
  });
}
