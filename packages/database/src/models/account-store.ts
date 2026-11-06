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
import { eq, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import { user } from "../schemas/auth.js";
import { accountPreference } from "../schemas/preferences.js";
import { conversations } from "../schemas/storage.js";
import { InstantColumnSchema } from "./columns.js";
import { queueSessionSandboxes, sessionsOf } from "./session-sandbox-cleanup.js";

export interface AccountPreferencesRow {
  preferences: AccountPreferences;
  agent: ModelChoice | undefined;
  chaptersModel: ChaptersModelId;
  experiments: ExperimentChoices;
  updatedAt: Date | undefined;
}

export interface AccountPreferencesWritten extends AccountPreferencesRow {
  readonly txid: string;
}

export interface AccountPreferencesWrite {
  preferences?: AccountPreferences;
  linkOpen?: LinkOpen;
  agentEnter?: AgentEnter;
  commitAuthor?: CommitAuthor;
  setupFinished?: boolean;
  setupPlace?: string;
  agent?: ModelChoice;
  chaptersModel?: ChaptersModelId;
  experiments?: ExperimentChoices;
}

export type AccountSeamEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const deleteUserRow = SqlSchema.void({
  Request: Schema.String,
  execute: (userId) => Database.use((db) => db.delete(user).where(eq(user.id, userId))),
});

const lockUserRow = SqlSchema.void({
  Request: Schema.String,
  execute: (userId) =>
    Database.use((db) =>
      db.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update"),
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
        .where(eq(conversations.userId, userId))
        .for("update"),
    ),
});

export function deleteAccount(userId: string): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* lockUserRow(userId);
        yield* queueSessionSandboxes(sessionsOf(yield* findAccountSessions(userId)));
        yield* deleteUserRow(userId);
      }),
    ),
  );
}

const PREFERENCE_COLUMNS = {
  linkOpen: accountPreference.linkOpen,
  agentEnter: accountPreference.agentEnter,
  commitAuthor: accountPreference.commitAuthor,
  setupFinished: accountPreference.setupFinished,
  setupPlace: accountPreference.setupPlace,
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
  setupPlace: Schema.NullOr(Schema.String),
  agentModel: Schema.NullOr(Schema.String),
  agentEffort: Schema.NullOr(Schema.String),
  agentContextWindow: Schema.NullOr(contextWindowSchema),
  chaptersModel: Schema.NullOr(Schema.String),
  experiments: Schema.NullOr(WireValueSchema),
  updatedAt: Schema.NullOr(InstantColumnSchema),
});

type PreferenceRow = typeof PreferenceRowSchema.Type;

function snapshotOf(row: PreferenceRow): AccountPreferencesRow {
  return {
    preferences:
      accountPreferencesFromStored({
        ...(row.linkOpen ? { linkOpen: row.linkOpen } : undefined),
        ...(row.agentEnter ? { agentEnter: row.agentEnter } : undefined),
        ...(row.commitAuthor ? { commitAuthor: row.commitAuthor } : undefined),
        ...(row.setupFinished === null ? undefined : { setupFinished: row.setupFinished }),
        ...(row.setupPlace ? { setupPlace: row.setupPlace } : undefined),
      }) ?? {},
    agent: storedAgentChoice(row),
    chaptersModel: chaptersModelFrom(row.chaptersModel),
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

export function readAccountPreferences(
  userId: string,
): Effect.Effect<AccountPreferencesRow | undefined, StoreFailure, DatabaseServices> {
  return Effect.map(
    findPreference(userId),
    Option.match({ onNone: () => undefined, onSome: snapshotOf }),
  );
}

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

export interface AccountAccessRow {
  readonly role: string | undefined;
  readonly supportAccessUntil: Date | undefined;
}

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
  setupPlace: Schema.optionalKey(Schema.String),
  agent: Schema.optionalKey(
    Schema.Struct({
      model: Schema.String,
      effort: Schema.String,
      contextWindow: Schema.optionalKey(contextWindowSchema),
    }),
  ),
  chaptersModel: Schema.optionalKey(Schema.Literals(CHAPTERS_MODEL_LIST)),
  experiments: Schema.optionalKey(Schema.Record(Schema.String, Schema.Boolean)),
  updatedAt: Schema.optionalKey(Schema.Date),
});

type PreferenceWrite = typeof PreferenceWriteSchema.Type;

function writtenColumns(write: PreferenceWrite) {
  return {
    ...(write.experiments === undefined ? undefined : { experiments: write.experiments }),
    ...(write.linkOpen === undefined ? undefined : { linkOpen: write.linkOpen }),
    ...(write.agentEnter === undefined ? undefined : { agentEnter: write.agentEnter }),
    ...(write.commitAuthor === undefined ? undefined : { commitAuthor: write.commitAuthor }),
    ...(write.setupFinished === undefined ? undefined : { setupFinished: write.setupFinished }),
    ...(write.setupPlace === undefined ? undefined : { setupPlace: write.setupPlace }),
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

const upsertPreference = SqlSchema.findOne({
  Request: PreferenceWriteSchema,
  Result: Schema.Struct({ ...PreferenceRowSchema.fields, txid: Schema.String }),
  execute: (write) => {
    const columns = writtenColumns(write);
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

export function writeAccountPreferences(
  userId: string,
  write: AccountPreferencesWrite,
): Effect.Effect<AccountPreferencesWritten, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const updatedAt = yield* DateTime.nowAsDate;
    const stored: PreferenceWrite = {
      userId,
      ...(write.preferences === undefined ? undefined : { updatedAt }),
      ...(write.linkOpen === undefined ? undefined : { linkOpen: write.linkOpen }),
      ...(write.agentEnter === undefined ? undefined : { agentEnter: write.agentEnter }),
      ...(write.commitAuthor === undefined ? undefined : { commitAuthor: write.commitAuthor }),
      ...(write.setupFinished === undefined ? undefined : { setupFinished: write.setupFinished }),
      ...(write.setupPlace === undefined ? undefined : { setupPlace: write.setupPlace }),
      ...(write.agent === undefined ? undefined : { agent: write.agent }),
      ...(write.chaptersModel === undefined ? undefined : { chaptersModel: write.chaptersModel }),
      ...(write.experiments === undefined ? undefined : { experiments: write.experiments }),
    };
    const row = yield* upsertPreference(stored).pipe(
      Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
    );
    return { ...snapshotOf(row), txid: row.txid };
  });
}
