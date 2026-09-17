import { eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { isListedWorkspaceAgentModel, type WorkspaceAgentSelection } from "../../core.js";
import { accountPreference, accountWorkspacePreference } from "../../db/preferences-schema.js";
import { db } from "../../db/query.js";

/**
 * The developer's saved creation tie-breaks, as the projects context narrates
 * them and admission reads them, and beside them the agent pairing a creation
 * or a spawn that named no model rides with: the same `workspaceAgentDefaults`
 * the desktop's settings keep, synced here per provider.
 */
export interface HostedWorkspaceDefaults {
  readonly defaultProviderId?: string;
  readonly defaultProjectIds?: Readonly<Partial<Record<string, string>>>;
  readonly agentDefaults?: Readonly<Partial<Record<string, WorkspaceAgentSelection>>>;
}

/** How a read here fails: the driver's own refusal, or a row the schema refused. */
type WorkspaceDefaultsFailure = SqlError | Schema.SchemaError;

const DefaultProviderSchema = Schema.Struct({
  defaultWorkspaceProvider: Schema.NullOr(Schema.String),
});

const WorkspacePreferenceSchema = Schema.Struct({
  providerId: Schema.String,
  defaultProjectId: Schema.NullOr(Schema.String),
  agent: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
});

const findDefaultProvider = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: DefaultProviderSchema,
  execute: (userId) =>
    db
      .select({ defaultWorkspaceProvider: accountPreference.defaultWorkspaceProvider })
      .from(accountPreference)
      .where(eq(accountPreference.userId, userId)),
});

const findWorkspacePreferences = SqlSchema.findAll({
  Request: Schema.String,
  Result: WorkspacePreferenceSchema,
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

/**
 * The stored pairing of one provider row, held to the build's documented
 * table exactly as the settings store held it when it was written: a row
 * whose agent, model, or effort the build no longer lists is nothing rather
 * than a request the provider would refuse, and an effort is never kept
 * without the model it was chosen beside.
 */
function agentSelectionOf(row: {
  providerId: string;
  agent: string | null;
  model: string | null;
  effort: string | null;
}): WorkspaceAgentSelection | undefined {
  if (!row.agent || !row.model) return undefined;
  const selection: WorkspaceAgentSelection = {
    agent: row.agent,
    model: row.model,
    ...(row.effort ? { effort: row.effort } : undefined),
  };
  return isListedWorkspaceAgentModel(row.providerId, selection) ? selection : undefined;
}

/**
 * The developer's saved creation defaults as the account keeps them: the
 * provider a nameless creation goes to, each provider's default project, and
 * each provider's agent pairing. The first two steer the projects context the
 * brain reads and the admission of a creation that names no project; the
 * pairing rides a creation or a spawn that named no model of its own, exactly
 * as the desktop's settings did before the brain moved to the service.
 */
export const readWorkspaceDefaults = /* @__PURE__ */ Effect.fn("web/readWorkspaceDefaults")(
  function* (
    userId: string,
  ): Effect.fn.Return<HostedWorkspaceDefaults, WorkspaceDefaultsFailure, SqlClient.SqlClient> {
    const preference = yield* findDefaultProvider(userId);
    const rows = yield* findWorkspacePreferences(userId);
    const defaultProjectIds: Partial<Record<string, string>> = {};
    const agentDefaults: Partial<Record<string, WorkspaceAgentSelection>> = {};
    for (const row of rows) {
      if (row.defaultProjectId) defaultProjectIds[row.providerId] = row.defaultProjectId;
      const selection = agentSelectionOf(row);
      if (selection) agentDefaults[row.providerId] = selection;
    }
    const defaultProviderId = preference.pipe(
      Option.flatMapNullishOr((row) => row.defaultWorkspaceProvider),
      Option.getOrUndefined,
    );
    return {
      ...(defaultProviderId ? { defaultProviderId } : undefined),
      ...(Object.keys(defaultProjectIds).length > 0 ? { defaultProjectIds } : undefined),
      ...(Object.keys(agentDefaults).length > 0 ? { agentDefaults } : undefined),
    };
  },
);
