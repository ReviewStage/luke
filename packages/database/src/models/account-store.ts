import { CONTEXT_WINDOW, contextWindowSchema } from "@sidecar/hosted/coding-agent-wire";
import type { ModelChoice } from "@sidecar/hosted/models-wire";
import { CODING_AGENT_DEFAULT_CHOICE } from "@sidecar/hosted/models-wire";
import { type AccountPreferences, accountPreferencesFromStored } from "@sidecar/settings";
import { eq } from "drizzle-orm";
import { type Cause, DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { db } from "../core/query.js";
import { user } from "../schemas/auth.js";
import { accountPreference } from "../schemas/preferences.js";
import { conversations } from "../schemas/storage.js";
import { InstantColumnSchema } from "./columns.js";
import { readTemplateRevisionContent, recordTemplateRevision } from "./plan-template-revisions.js";
import { queueSessionSandboxes, sessionsOf } from "./session-sandbox-cleanup.js";
import { deletePersonalWorkspace } from "./workspace-store.js";

/**
 * What the account group reads and writes of an account: the erasure, the
 * cross-device snapshot behind `/api/account/preferences`, which is the
 * settings preferences and the coding agents' default model, effort, and
 * context window beside them, and the plan template behind
 * `/api/account/plan-template`, a column of the same row that neither path
 * reads of the other, whose every change is kept as a revision
 * (`plan-template-revisions.ts`). Every function here is an effect over the ambient `SqlClient`
 * and names no database of its own; `account-seams.ts` beside it runs them
 * at the web edge and is the only file of the two that reaches the auth
 * session.
 */

type AccountSeamFailure = SqlError | Schema.SchemaError;

/** One account's stored snapshot: the preferences every device shares, the coding agents' default, and when the preferences were last written. */
export interface AccountPreferencesRow {
  preferences: AccountPreferences;
  /** What a click on Start runs on; the catalog's default until the account chooses. */
  codingAgent: ModelChoice;
  /**
   * When the preferences part was last written; none on a row only a
   * coding-agent choice or a plan template opened. The desktop reads its presence as a snapshot
   * to apply over its own settings, so it stands for the preferences alone.
   */
  updatedAt: Date | undefined;
}

/**
 * What a write carries: each part present replaces what stood, and a part
 * left out stands as it was, so the desktop's settings sync and the Start
 * menu's choice each write their own part without reading the other first.
 */
export interface AccountPreferencesWrite {
  preferences?: AccountPreferences;
  codingAgent?: ModelChoice;
}

/** What an account seam answers: an effect over the ambient client, composed into the request that made it. */
export type AccountSeamEffect<A> = Effect.Effect<A, AccountSeamFailure, SqlClient.SqlClient>;

/**
 * The account's erasure is the one delete, and the row's own foreign keys are
 * what carry it: every table naming a user declares `on delete cascade`, so
 * the dependent rows go with the row that names them, in one statement and
 * therefore as one unit. Nothing here enumerates the dependents, because a
 * list here could fall behind a table added later and leave a row standing
 * after the account it belongs to is gone. The one exception is the
 * account's personal workspace: its organization names the account rather
 * than being named by it, so it is deleted first, in the same transaction.
 */
const deleteUserRow = SqlSchema.void({
  Request: Schema.String,
  execute: (userId) => db.delete(user).where(eq(user.id, userId)),
});

const lockUserRow = SqlSchema.void({
  Request: Schema.String,
  execute: (userId) =>
    db.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update"),
});

const findAccountSessions = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ runtimeSessionId: Schema.NullOr(Schema.String) }),
  execute: (userId) =>
    db
      .select({ runtimeSessionId: conversations.runtimeSessionId })
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .for("update"),
});

/**
 * Erases the user row; every dependent row cascades with it. The eve session
 * each of the account's conversations ran in, a deleted plan's too, is
 * queued for its sandbox's deletion in the same transaction, since nothing
 * after it names them. The user's row is locked first, so a conversation
 * opened meanwhile waits on it and finds no account, and every conversation
 * of the account is locked as its session is read, so a session claimed
 * meanwhile waits and finds no row to claim, rather than landing unqueued.
 * The account's personal workspace goes in the same transaction, after the
 * lock and before the user row, since nothing would take it otherwise.
 */
export function deleteAccount(
  userId: string,
): Effect.Effect<void, AccountSeamFailure, SqlClient.SqlClient> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* lockUserRow(userId);
        yield* queueSessionSandboxes(sessionsOf(yield* findAccountSessions(userId)));
        yield* deletePersonalWorkspace(userId);
        yield* deleteUserRow(userId);
      }),
    ),
  );
}

/** The columns every read and the write's `returning` project, so a row decodes one way whatever wrote it. */
const PREFERENCE_COLUMNS = {
  voice: accountPreference.voice,
  codingAgentModel: accountPreference.codingAgentModel,
  codingAgentEffort: accountPreference.codingAgentEffort,
  codingAgentContextWindow: accountPreference.codingAgentContextWindow,
  updatedAt: accountPreference.updatedAt,
};

const PreferenceRowSchema = Schema.Struct({
  voice: Schema.NullOr(Schema.String),
  codingAgentModel: Schema.NullOr(Schema.String),
  codingAgentEffort: Schema.NullOr(Schema.String),
  codingAgentContextWindow: Schema.NullOr(contextWindowSchema),
  updatedAt: Schema.NullOr(InstantColumnSchema),
});

type PreferenceRow = typeof PreferenceRowSchema.Type;

/**
 * The row as the group answers it. A coding-agent default stands only with
 * both halves written; one half alone is no choice the catalog could have
 * accepted, so it reads as the default beside a whole one. The context
 * window is named only where it is the standard one, as the wire names it.
 */
function snapshotOf(row: PreferenceRow): AccountPreferencesRow {
  const standard = row.codingAgentContextWindow === CONTEXT_WINDOW.STANDARD;
  const codingAgent: ModelChoice =
    row.codingAgentModel !== null && row.codingAgentEffort !== null
      ? {
          model: row.codingAgentModel,
          effort: row.codingAgentEffort,
          ...(standard ? { contextWindow: CONTEXT_WINDOW.STANDARD } : undefined),
        }
      : CODING_AGENT_DEFAULT_CHOICE;
  return {
    preferences: accountPreferencesFromStored(row.voice ? { voice: row.voice } : {}) ?? {},
    codingAgent,
    updatedAt: row.updatedAt ?? undefined,
  };
}

const findPreference = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: PreferenceRowSchema,
  execute: (userId) =>
    db
      .select(PREFERENCE_COLUMNS)
      .from(accountPreference)
      .where(eq(accountPreference.userId, userId))
      .limit(1),
});

/** One account's stored snapshot, or nothing for an account that has stored none. */
export function readAccountPreferences(
  userId: string,
): Effect.Effect<AccountPreferencesRow | undefined, AccountSeamFailure, SqlClient.SqlClient> {
  return Effect.map(
    findPreference(userId),
    Option.match({ onNone: () => undefined, onSome: snapshotOf }),
  );
}

const PreferenceWriteSchema = Schema.Struct({
  userId: Schema.String,
  voice: Schema.optionalKey(Schema.NullOr(Schema.String)),
  codingAgent: Schema.optionalKey(
    Schema.Struct({
      model: Schema.String,
      effort: Schema.String,
      contextWindow: Schema.optionalKey(contextWindowSchema),
    }),
  ),
  updatedAt: Schema.Date,
});

type PreferenceWrite = typeof PreferenceWriteSchema.Type;

/** The columns a write replaces: each part the write carries, the instant with the preferences part. */
function writtenColumns(write: PreferenceWrite) {
  return {
    ...(write.voice === undefined ? undefined : { voice: write.voice, updatedAt: write.updatedAt }),
    ...(write.codingAgent === undefined
      ? undefined
      : {
          codingAgentModel: write.codingAgent.model,
          codingAgentEffort: write.codingAgent.effort,
          codingAgentContextWindow: write.codingAgent.contextWindow ?? null,
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
  Result: PreferenceRowSchema,
  execute: (write) => {
    const columns = writtenColumns(write);
    return db
      .insert(accountPreference)
      .values({ userId: write.userId, ...columns })
      .onConflictDoUpdate({ target: accountPreference.userId, set: columns })
      .returning(PREFERENCE_COLUMNS);
  },
});

/**
 * Writes each part the write carries over what stood — the preferences
 * whole, the coding-agent default whole — and answers the snapshot as it
 * now stands. The instant moves with the preferences part alone, so a
 * coding-agent choice never reads to a Mac as a settings snapshot it has
 * to take.
 */
export function writeAccountPreferences(
  userId: string,
  write: AccountPreferencesWrite,
): Effect.Effect<AccountPreferencesRow, AccountSeamFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const updatedAt = yield* DateTime.nowAsDate;
    const stored: PreferenceWrite = {
      userId,
      updatedAt,
      ...(write.preferences === undefined ? undefined : { voice: write.preferences.voice ?? null }),
      ...(write.codingAgent === undefined ? undefined : { codingAgent: write.codingAgent }),
    };
    const row = yield* upsertPreference(stored).pipe(
      // An upsert that returned no row is the database breaking its own contract, not an outcome.
      Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
    );
    return snapshotOf(row);
  });
}

/* ----- The plan template ----- */

/** The template column alone, so a read of it reaches nothing of the preferences beside it. */
const PLAN_TEMPLATE_COLUMNS = { planTemplate: accountPreference.planTemplate };

const PlanTemplateRowSchema = Schema.Struct({ planTemplate: Schema.NullOr(Schema.String) });

const findPlanTemplate = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: PlanTemplateRowSchema,
  execute: (userId) =>
    db
      .select(PLAN_TEMPLATE_COLUMNS)
      .from(accountPreference)
      .where(eq(accountPreference.userId, userId))
      .limit(1),
});

/** The account's own template, or null where it holds the default: no row, or a reset. */
export function readPlanTemplate(
  userId: string,
): Effect.Effect<string | null, AccountSeamFailure, SqlClient.SqlClient> {
  return Effect.map(
    findPlanTemplate(userId),
    Option.match({ onNone: () => null, onSome: (row) => row.planTemplate }),
  );
}

const PlanTemplateWriteSchema = Schema.Struct({
  userId: Schema.String,
  planTemplate: Schema.NullOr(Schema.String),
});

/** Opens the account's preference row where it has none, so the template's write has a row to lock. */
const openPreferenceRow = SqlSchema.void({
  Request: Schema.String,
  execute: (userId) => db.insert(accountPreference).values({ userId }).onConflictDoNothing(),
});

/** The template the account holds, its row locked until the transaction ends. */
const lockPlanTemplate = SqlSchema.findOne({
  Request: Schema.String,
  Result: PlanTemplateRowSchema,
  execute: (userId) =>
    db
      .select(PLAN_TEMPLATE_COLUMNS)
      .from(accountPreference)
      .where(eq(accountPreference.userId, userId))
      .for("update"),
});

/**
 * Note that the write sets the template column and nothing else, not even
 * `updated_at`, because that instant tells a Mac the preferences part was
 * written and a template is no part of it. A row the template opens holds
 * no preferences, so it answers none.
 */
const updatePlanTemplate = SqlSchema.findOne({
  Request: PlanTemplateWriteSchema,
  Result: PlanTemplateRowSchema,
  execute: (write) =>
    db
      .update(accountPreference)
      .set({ planTemplate: write.planTemplate })
      .where(eq(accountPreference.userId, write.userId))
      .returning(PLAN_TEMPLATE_COLUMNS),
});

/**
 * Runs `body` on the template the account holds, in one transaction with
 * its preference row locked, opened first where the account has none, so
 * two writes never take one revision's number and the template and its
 * history never disagree.
 */
function underTemplateLock<A>(
  userId: string,
  body: (
    before: string | null,
  ) => Effect.Effect<A, AccountSeamFailure | Cause.NoSuchElementError, SqlClient.SqlClient>,
): Effect.Effect<A, AccountSeamFailure, SqlClient.SqlClient> {
  const locked = Effect.gen(function* () {
    yield* openPreferenceRow(userId);
    const { planTemplate: before } = yield* lockPlanTemplate(userId);
    return yield* body(before);
  }).pipe(
    // A row the lock or the write found missing is the database breaking its own contract, not an outcome.
    Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
  );
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(locked));
}

/**
 * The template written over `before`, under the lock, and kept as a
 * revision (`plan-template-revisions.ts`). Note that a write of what stands
 * keeps nothing, but a restore of it is still kept, because the developer
 * asked for that revision back and the history says so.
 */
function writtenUnderLock(
  userId: string,
  before: string | null,
  template: string | null,
  restoredFrom?: number,
): Effect.Effect<
  string | null,
  AccountSeamFailure | Cause.NoSuchElementError,
  SqlClient.SqlClient
> {
  return Effect.gen(function* () {
    if (before === template && restoredFrom === undefined) return before;
    const { planTemplate: after } = yield* updatePlanTemplate({ userId, planTemplate: template });
    yield* recordTemplateRevision({
      userId,
      before,
      after,
      ...(restoredFrom === undefined ? undefined : { restoredFrom }),
    });
    return after;
  });
}

/** Keeps the account's template verbatim, or null for the default, kept as a revision where it changed, and answers what is then kept. */
export function writePlanTemplate(
  userId: string,
  template: string | null,
): Effect.Effect<string | null, AccountSeamFailure, SqlClient.SqlClient> {
  return underTemplateLock(userId, (before) => writtenUnderLock(userId, before, template));
}

/**
 * Puts one revision of the account's template back as the template, a
 * revision of its own that names it, and answers what is then kept; nothing
 * where the account has no such revision. The revision is read under the
 * lock, so a write that moves it on meanwhile is either all before the read
 * or all after the restore.
 */
export function restorePlanTemplate(
  userId: string,
  seq: number,
): Effect.Effect<Option.Option<string | null>, AccountSeamFailure, SqlClient.SqlClient> {
  return underTemplateLock(userId, (before) =>
    Effect.flatMap(readTemplateRevisionContent(userId, seq), (content) =>
      Option.match(content, {
        onNone: () => Effect.succeed(Option.none<string | null>()),
        onSome: (template) =>
          Effect.map(writtenUnderLock(userId, before, template, seq), Option.some),
      }),
    ),
  );
}
