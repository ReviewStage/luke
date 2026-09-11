import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { accountPreferencesFromStored } from "@sidecar/settings";
import { Effect, Option, type ParseResult, Schema } from "effect";
import { isRealtimeVoiceSpeed } from "../core.js";
import type { AccountPreferencesRow, HostedAccountPreferences } from "./account-preferences.js";

/**
 * What the account group reads and writes of an account: the erasure, and
 * the cross-device preferences snapshot behind `/api/account/preferences`.
 * Every function here is an effect over the ambient `SqlClient` and names no
 * database of its own; `account-seams.ts` beside it runs them at the web
 * edge and is the only file of the two that reaches the auth session.
 */

type AccountSeamFailure = SqlError | ParseResult.ParseError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E, R = never>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E, R>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

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
  execute: (userId) => statement((sql) => sql`delete from "user" where id = ${userId}`),
});

/** Erases the user row; every dependent row cascades with it. */
export function deleteAccount(
  userId: string,
): Effect.Effect<void, AccountSeamFailure, SqlClient.SqlClient> {
  return deleteUserRow(userId);
}

const PreferenceRowSchema = Schema.Struct({
  voice: Schema.NullOr(Schema.String),
  voiceSpeed: Schema.propertySignature(Schema.NullOr(Schema.Number)).pipe(
    Schema.fromKey("voice_speed"),
  ),
  defaultWorkspaceProvider: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("default_workspace_provider"),
  ),
  updatedAt: Schema.propertySignature(Schema.DateFromSelf).pipe(Schema.fromKey("updated_at")),
});

const WorkspacePreferenceRowSchema = Schema.Struct({
  providerId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("provider_id")),
  defaultProjectId: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("default_project_id"),
  ),
  agent: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
});

const findPreference = SqlSchema.findOne({
  Request: Schema.String,
  Result: PreferenceRowSchema,
  execute: (userId) =>
    statement(
      (sql) => sql`
        select voice, voice_speed, default_workspace_provider, updated_at
        from account_preference
        where user_id = ${userId}
        limit 1
      `,
    ),
});

const findWorkspacePreferences = SqlSchema.findAll({
  Request: Schema.String,
  Result: WorkspacePreferenceRowSchema,
  execute: (userId) =>
    statement(
      (sql) => sql`
        select provider_id, default_project_id, agent, model, effort
        from account_workspace_preference
        where user_id = ${userId}
      `,
    ),
});

function rowPreferences(
  preference: {
    voice: string | null;
    voiceSpeed: number | null;
    defaultWorkspaceProvider: string | null;
  },
  workspacePreferences: readonly {
    providerId: string;
    defaultProjectId: string | null;
    agent: string | null;
    model: string | null;
    effort: string | null;
  }[],
): HostedAccountPreferences {
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

  const shared =
    accountPreferencesFromStored({
      ...(preference.voice ? { voice: preference.voice } : undefined),
      ...(preference.defaultWorkspaceProvider
        ? { defaultWorkspaceProvider: preference.defaultWorkspaceProvider }
        : undefined),
      ...(Object.keys(workspaceProjectDefaults).length > 0
        ? { workspaceProjectDefaults }
        : undefined),
      ...(Object.keys(workspaceAgentDefaults).length > 0 ? { workspaceAgentDefaults } : undefined),
    }) ?? {};
  return {
    ...shared,
    ...(isRealtimeVoiceSpeed(preference.voiceSpeed)
      ? { voiceSpeed: preference.voiceSpeed }
      : undefined),
  };
}

/**
 * One account's stored snapshot, or nothing for an account that has stored
 * none. The scalar row and its per-provider rows are read in one transaction,
 * so a write landing between the two cannot answer half of each.
 */
export function readAccountPreferences(
  userId: string,
): Effect.Effect<AccountPreferencesRow | undefined, AccountSeamFailure, SqlClient.SqlClient> {
  return statement((sql) =>
    sql.withTransaction(
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
  voiceSpeed: Schema.NullOr(Schema.Number),
  // Deliberately an unvalidated string, not a provider id: a shipped phone
  // echoes whatever workspace provider it last held, including ids this build
  // no longer knows, and the desktop already reads an unknown one as unset.
  // Narrowing this column would refuse that phone's every preference write.
  defaultWorkspaceProvider: Schema.NullOr(Schema.String),
  updatedAt: Schema.DateFromSelf,
});

const upsertPreference = SqlSchema.void({
  Request: PreferenceWriteSchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into account_preference
          (user_id, voice, voice_speed, default_workspace_provider, updated_at)
        values (
          ${write.userId},
          ${write.voice},
          ${write.voiceSpeed},
          ${write.defaultWorkspaceProvider},
          ${write.updatedAt}
        )
        on conflict (user_id) do update set
          voice = excluded.voice,
          voice_speed = excluded.voice_speed,
          default_workspace_provider = excluded.default_workspace_provider,
          updated_at = excluded.updated_at
      `,
    ),
});

const deleteWorkspacePreferences = SqlSchema.void({
  Request: Schema.String,
  execute: (userId) =>
    statement((sql) => sql`delete from account_workspace_preference where user_id = ${userId}`),
});

const WorkspacePreferenceWriteSchema = Schema.Struct({
  userId: Schema.String,
  providerId: Schema.String,
  defaultProjectId: Schema.NullOr(Schema.String),
  agent: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
  updatedAt: Schema.DateFromSelf,
});

const insertWorkspacePreference = SqlSchema.void({
  Request: WorkspacePreferenceWriteSchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into account_workspace_preference
          (user_id, provider_id, default_project_id, agent, model, effort, updated_at)
        values (
          ${write.userId},
          ${write.providerId},
          ${write.defaultProjectId},
          ${write.agent},
          ${write.model},
          ${write.effort},
          ${write.updatedAt}
        )
      `,
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
  preferences: HostedAccountPreferences,
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
  preferences: HostedAccountPreferences,
): Effect.Effect<Date, AccountSeamFailure, SqlClient.SqlClient> {
  const updatedAt = new Date();
  return statement((sql) =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* upsertPreference({
          userId,
          voice: preferences.voice ?? null,
          voiceSpeed: preferences.voiceSpeed ?? null,
          defaultWorkspaceProvider: preferences.defaultWorkspaceProvider ?? null,
          updatedAt,
        });
        yield* deleteWorkspacePreferences(userId);
        yield* Effect.forEach(
          workspacePreferenceRows(userId, preferences, updatedAt),
          insertWorkspacePreference,
          { discard: true },
        );
        return updatedAt;
      }),
    ),
  );
}
