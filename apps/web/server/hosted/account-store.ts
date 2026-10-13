import { db } from "@sidecar/database/core/query";
import { user } from "@sidecar/database/schemas/auth";
import { accountPreference } from "@sidecar/database/schemas/preferences";
import { CONTEXT_WINDOW, contextWindowSchema } from "@sidecar/hosted/coding-agent-wire";
import type { ModelChoice } from "@sidecar/hosted/models-wire";
import { type AccountPreferences, accountPreferencesFromStored } from "@sidecar/settings";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { CODING_AGENT_DEFAULT_CHOICE } from "./model-catalog.js";
import { InstantColumnSchema } from "./store/database.js";

/**
 * What the account group reads and writes of an account: the erasure, the
 * cross-device snapshot behind `/api/account/preferences`, which is the
 * settings preferences and the coding agents' default model, effort, and
 * context window beside them, and the plan template behind
 * `/api/account/plan-template`, a column of the same row that neither path
 * reads of the other. Every function here is an effect over the ambient `SqlClient`
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
 * after the account it belongs to is gone.
 */
const deleteUserRow = SqlSchema.void({
  Request: Schema.String,
  execute: (userId) => db.delete(user).where(eq(user.id, userId)),
});

/** Erases the user row; every dependent row cascades with it. */
export function deleteAccount(
  userId: string,
): Effect.Effect<void, AccountSeamFailure, SqlClient.SqlClient> {
  return deleteUserRow(userId);
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

/**
 * Note that the write sets the template column and nothing else, not even
 * `updated_at`, because that instant tells a Mac the preferences part was
 * written and a template is no part of it. A row the template opens holds
 * no preferences, so it answers none.
 */
const upsertPlanTemplate = SqlSchema.findOne({
  Request: PlanTemplateWriteSchema,
  Result: PlanTemplateRowSchema,
  execute: (write) =>
    db
      .insert(accountPreference)
      .values(write)
      .onConflictDoUpdate({
        target: accountPreference.userId,
        set: { planTemplate: write.planTemplate },
      })
      .returning(PLAN_TEMPLATE_COLUMNS),
});

/** Keeps the account's template verbatim, or null for the default, and answers what is then kept. */
export function writePlanTemplate(
  userId: string,
  template: string | null,
): Effect.Effect<string | null, AccountSeamFailure, SqlClient.SqlClient> {
  return upsertPlanTemplate({ userId, planTemplate: template }).pipe(
    Effect.map((row) => row.planTemplate),
    // An upsert that returned no row is the database breaking its own contract, not an outcome.
    Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
  );
}
