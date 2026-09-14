import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";

/** The developer's saved creation tie-breaks, as the projects context narrates them and admission reads them. */
export interface HostedWorkspaceDefaults {
  readonly defaultProviderId?: string;
  readonly defaultProjectIds?: Readonly<Partial<Record<string, string>>>;
}

/** How a read here fails: the driver's own refusal, or a row the schema refused. */
type WorkspaceDefaultsFailure = SqlError | Schema.SchemaError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

const DefaultProviderSchema = Schema.Struct({
  defaultWorkspaceProvider: Schema.NullOr(Schema.String),
}).pipe(Schema.encodeKeys({ defaultWorkspaceProvider: "default_workspace_provider" }));

const DefaultProjectSchema = Schema.Struct({
  providerId: Schema.String,
  defaultProjectId: Schema.NullOr(Schema.String),
}).pipe(Schema.encodeKeys({ providerId: "provider_id", defaultProjectId: "default_project_id" }));

const findDefaultProvider = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: DefaultProviderSchema,
  execute: (userId) =>
    statement(
      (sql) => sql`
        select default_workspace_provider
        from account_preference
        where user_id = ${userId}
      `,
    ),
});

const findDefaultProjects = SqlSchema.findAll({
  Request: Schema.String,
  Result: DefaultProjectSchema,
  execute: (userId) =>
    statement(
      (sql) => sql`
        select provider_id, default_project_id
        from account_workspace_preference
        where user_id = ${userId}
      `,
    ),
});

/**
 * The developer's saved creation tie-breaks as the account keeps them: the
 * provider a nameless creation goes to, and each provider's default project.
 * They steer the projects context the brain reads and the admission of a
 * creation that names no project, exactly as the desktop's settings do.
 */
export const readWorkspaceDefaults = /* @__PURE__ */ Effect.fn("readWorkspaceDefaults")(function* (
  userId: string,
): Effect.fn.Return<HostedWorkspaceDefaults, WorkspaceDefaultsFailure, SqlClient.SqlClient> {
  const preference = yield* findDefaultProvider(userId);
  const projects = yield* findDefaultProjects(userId);
  const defaultProjectIds: Partial<Record<string, string>> = {};
  for (const row of projects) {
    if (row.defaultProjectId) defaultProjectIds[row.providerId] = row.defaultProjectId;
  }
  const defaultProviderId = preference.pipe(
    Option.flatMapNullishOr((row) => row.defaultWorkspaceProvider),
    Option.getOrUndefined,
  );
  return {
    ...(defaultProviderId ? { defaultProviderId } : undefined),
    ...(Object.keys(defaultProjectIds).length > 0 ? { defaultProjectIds } : undefined),
  };
});
