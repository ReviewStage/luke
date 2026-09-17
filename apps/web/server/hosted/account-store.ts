import { type AccountPreferences, accountPreferencesFromStored } from "@sidecar/settings";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { user } from "../db/auth-schema.js";
import { accountPreference, accountWorkspacePreference } from "../db/preferences-schema.js";
import { db } from "../db/query.js";
import { InstantColumnSchema } from "./store/database.js";

/**
 * What the account group reads and writes of an account: the erasure, and
 * the cross-device preferences snapshot behind `/api/account/preferences`.
 * Every function here is an effect over the ambient `SqlClient` and names no
 * database of its own; `account-seams.ts` beside it runs them at the web
 * edge and is the only file of the two that reaches the auth session.
 */

type AccountSeamFailure = SqlError | Schema.SchemaError;

/** One account's stored snapshot: the preferences every device shares, and the instant they were written. */
export interface AccountPreferencesRow {
  preferences: AccountPreferences;
  updatedAt: Date;
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

const PreferenceRowSchema = Schema.Struct({
  voice: Schema.NullOr(Schema.String),
  defaultWorkspaceProvider: Schema.NullOr(Schema.String),
  updatedAt: InstantColumnSchema,
});

const WorkspacePreferenceRowSchema = Schema.Struct({
  providerId: Schema.String,
  defaultProjectId: Schema.NullOr(Schema.String),
  agent: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
});

const findPreference = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: PreferenceRowSchema,
  execute: (userId) =>
    db
      .select({
        voice: accountPreference.voice,
        defaultWorkspaceProvider: accountPreference.defaultWorkspaceProvider,
        updatedAt: accountPreference.updatedAt,
      })
      .from(accountPreference)
      .where(eq(accountPreference.userId, userId))
      .limit(1),
});

const findWorkspacePreferences = SqlSchema.findAll({
  Request: Schema.String,
  Result: WorkspacePreferenceRowSchema,
  execute: (userId) =>
    db
      .select({
        providerId: accountWorkspacePreference.providerId,
        defaultProjectId: accountWorkspacePreference.defaultProjectId,
        agent: accountWorkspacePreference.agent,
        model: accountWorkspacePreference.model,
        effort: accountWorkspacePreference.effort,
      })
      .from(accountWorkspacePreference)
      .where(eq(accountWorkspacePreference.userId, userId)),
});

function rowPreferences(
  preference: {
    voice: string | null;
    defaultWorkspaceProvider: string | null;
  },
  workspacePreferences: readonly {
    providerId: string;
    defaultProjectId: string | null;
    agent: string | null;
    model: string | null;
    effort: string | null;
  }[],
): AccountPreferences {
  const workspaceProjectDefaults: Record<string, string> = {};
  const workspaceAgentDefaults: Record<string, { agent: string; model?: string; effort?: string }> =
    {};

  for (const row of workspacePreferences) {
    if (row.defaultProjectId) {
      workspaceProjectDefaults[row.providerId] = row.defaultProjectId;
    }
    if (row.agent) {
      workspaceAgentDefaults[row.providerId] = {
        agent: row.agent,
        ...(row.model ? { model: row.model } : undefined),
        ...(row.effort ? { effort: row.effort } : undefined),
      };
    }
  }

  return (
    accountPreferencesFromStored({
      ...(preference.voice ? { voice: preference.voice } : undefined),
      ...(preference.defaultWorkspaceProvider
        ? { defaultWorkspaceProvider: preference.defaultWorkspaceProvider }
        : undefined),
      ...(Object.keys(workspaceProjectDefaults).length > 0
        ? { workspaceProjectDefaults }
        : undefined),
      ...(Object.keys(workspaceAgentDefaults).length > 0 ? { workspaceAgentDefaults } : undefined),
    }) ?? {}
  );
}

/**
 * One account's stored snapshot, or nothing for an account that has stored
 * none. The scalar row and its per-provider rows are read in one transaction,
 * so a write landing between the two cannot answer half of each.
 */
export function readAccountPreferences(
  userId: string,
): Effect.Effect<AccountPreferencesRow | undefined, AccountSeamFailure, SqlClient.SqlClient> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const preference = yield* findPreference(userId);
        if (Option.isNone(preference)) return undefined;
        const workspacePreferences = yield* findWorkspacePreferences(userId);
        return {
          preferences: rowPreferences(preference.value, workspacePreferences),
          updatedAt: preference.value.updatedAt,
        };
      }),
    ),
  );
}

const PreferenceWriteSchema = Schema.Struct({
  userId: Schema.String,
  voice: Schema.NullOr(Schema.String),
  // Deliberately an unvalidated string, not a provider id: a shipped phone
  // echoes whatever workspace provider it last held, including ids this build
  // no longer knows, and the desktop already reads an unknown one as unset.
  // Narrowing this column would refuse that phone's every preference write.
  defaultWorkspaceProvider: Schema.NullOr(Schema.String),
  updatedAt: Schema.Date,
});

/**
 * Note that the conflicting update sets the values the insert carried rather
 * than reading them back out of `excluded`, because a single-row insert's
 * `excluded` row is exactly those values.
 */
const upsertPreference = SqlSchema.void({
  Request: PreferenceWriteSchema,
  execute: (write) =>
    db
      .insert(accountPreference)
      .values({
        userId: write.userId,
        voice: write.voice,
        defaultWorkspaceProvider: write.defaultWorkspaceProvider,
        updatedAt: write.updatedAt,
      })
      .onConflictDoUpdate({
        target: accountPreference.userId,
        set: {
          voice: write.voice,
          defaultWorkspaceProvider: write.defaultWorkspaceProvider,
          updatedAt: write.updatedAt,
        },
      }),
});

const deleteWorkspacePreferences = SqlSchema.void({
  Request: Schema.String,
  execute: (userId) =>
    db.delete(accountWorkspacePreference).where(eq(accountWorkspacePreference.userId, userId)),
});

const WorkspacePreferenceWriteSchema = Schema.Struct({
  userId: Schema.String,
  providerId: Schema.String,
  defaultProjectId: Schema.NullOr(Schema.String),
  agent: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
  updatedAt: Schema.Date,
});

/** Every per-provider row in one statement: the transaction holds them together already, and one round-trip writes them as one. */
const insertWorkspacePreferences = SqlSchema.void({
  Request: Schema.Array(WorkspacePreferenceWriteSchema),
  execute: (writes) =>
    db.insert(accountWorkspacePreference).values(
      writes.map((write) => ({
        userId: write.userId,
        providerId: write.providerId,
        defaultProjectId: write.defaultProjectId,
        agent: write.agent,
        model: write.model,
        effort: write.effort,
        updatedAt: write.updatedAt,
      })),
    ),
});

interface WorkspacePreferenceWrite {
  userId: string;
  providerId: string;
  defaultProjectId: string | null;
  agent: string | null;
  model: string | null;
  effort: string | null;
  updatedAt: Date;
}

function workspacePreferenceRows(
  userId: string,
  preferences: AccountPreferences,
  updatedAt: Date,
): WorkspacePreferenceWrite[] {
  const projects = preferences.workspaceProjectDefaults ?? {};
  const agents = preferences.workspaceAgentDefaults ?? {};
  const rows = new Map<string, WorkspacePreferenceWrite>();
  const rowFor = (providerId: string) => {
    const existing = rows.get(providerId);
    if (existing) return existing;
    const row = {
      userId,
      providerId,
      defaultProjectId: null,
      agent: null,
      model: null,
      effort: null,
      updatedAt,
    };
    rows.set(providerId, row);
    return row;
  };

  for (const [providerId, defaultProjectId] of Object.entries(projects)) {
    if (defaultProjectId) rowFor(providerId).defaultProjectId = defaultProjectId;
  }
  for (const [providerId, agent] of Object.entries(agents)) {
    if (!agent) continue;
    const row = rowFor(providerId);
    row.agent = agent.agent;
    row.model = agent.model ?? null;
    row.effort = agent.effort ?? null;
  }

  return [...rows.values()];
}

/**
 * Replaces the account's stored snapshot whole: the scalar row is written,
 * then the per-provider rows are deleted and written again, all under one
 * transaction, so a reader never sees the old providers beside the new
 * scalars and a refused write leaves the snapshot exactly as it stood.
 */
export function writeAccountPreferences(
  userId: string,
  preferences: AccountPreferences,
): Effect.Effect<Date, AccountSeamFailure, SqlClient.SqlClient> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const updatedAt = yield* DateTime.nowAsDate;
        yield* upsertPreference({
          userId,
          voice: preferences.voice ?? null,
          defaultWorkspaceProvider: preferences.defaultWorkspaceProvider ?? null,
          updatedAt,
        });
        yield* deleteWorkspacePreferences(userId);
        // Note that an empty insert is skipped rather than rendered, because the builder refuses a statement with no rows.
        const rows = workspacePreferenceRows(userId, preferences, updatedAt);
        if (rows.length > 0) yield* insertWorkspacePreferences(rows);
        return updatedAt;
      }),
    ),
  );
}
