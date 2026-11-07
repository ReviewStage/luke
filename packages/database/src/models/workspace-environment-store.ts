/**
 * workspace-environment-store.ts -- a workspace's shared environment variables: list their names, set one, remove one, and open them all for an agent's launch.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * workspace, so no workspace reads, replaces, or removes another's
 * variables; who may call each is the caller's to check. A value goes in
 * sealed (`provider-key-seal.ts`'s `sealWorkspaceVariable`) and comes out
 * only through `openWorkspaceEnvironment`, which opens every value with the
 * ring it is handed; the list answers names alone. Setting a name that
 * stands replaces its value.
 */

import { and, asc, eq } from "drizzle-orm";
import { Effect, Redacted, Result, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { workspaceEnvironmentVariable as variable } from "../schemas/workspace-environment-variable.js";
import { InstantColumnSchema } from "./columns.js";
import {
  type KeyRing,
  openWorkspaceVariable,
  type SealedWorkspaceVariable,
} from "./provider-key-seal.js";

type EnvironmentEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const ListedSchema = Schema.Struct({ name: Schema.String, updatedAt: InstantColumnSchema });

/** One variable as the list answers it: its name and when it was last set, never its value. */
export type ListedWorkspaceVariable = typeof ListedSchema.Type;

const SealedSchema = Schema.Struct({
  name: Schema.String,
  keyVersion: Schema.Int,
  sealedDataKey: Schema.String,
  sealedValue: Schema.String,
});

const findListed = SqlSchema.findAll({
  Request: Schema.String,
  Result: ListedSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({ name: variable.name, updatedAt: variable.updatedAt })
        .from(variable)
        .where(eq(variable.organizationId, organizationId))
        .orderBy(asc(variable.name)),
    ),
});

const findSealed = SqlSchema.findAll({
  Request: Schema.String,
  Result: SealedSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({
          name: variable.name,
          keyVersion: variable.keyVersion,
          sealedDataKey: variable.sealedDataKey,
          sealedValue: variable.sealedValue,
        })
        .from(variable)
        .where(eq(variable.organizationId, organizationId))
        .orderBy(asc(variable.name)),
    ),
});

const upsertRow = SqlSchema.void({
  Request: Schema.Struct({
    organizationId: Schema.String,
    name: Schema.String,
    keyVersion: Schema.Int,
    sealedDataKey: Schema.String,
    sealedValue: Schema.String,
    now: Schema.Date,
  }),
  execute: ({ now, ...row }) =>
    Database.use((db) =>
      db
        .insert(variable)
        .values({ ...row, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [variable.organizationId, variable.name],
          set: {
            keyVersion: row.keyVersion,
            sealedDataKey: row.sealedDataKey,
            sealedValue: row.sealedValue,
            updatedAt: now,
          },
        }),
    ),
});

const deleteRow = SqlSchema.findAll({
  Request: Schema.Struct({ organizationId: Schema.String, name: Schema.String }),
  Result: Schema.Struct({ name: Schema.String }),
  execute: ({ organizationId, name }) =>
    Database.use((db) =>
      db
        .delete(variable)
        .where(and(eq(variable.organizationId, organizationId), eq(variable.name, name)))
        .returning({ name: variable.name }),
    ),
});

/** The workspace's variables by name, in name order, each with when it was last set. */
export function listWorkspaceVariables(
  organizationId: string,
): EnvironmentEffect<readonly ListedWorkspaceVariable[]> {
  return findListed(organizationId);
}

/** The variable set to the sealed value in the workspace, replacing the value of one of that name. */
export function setWorkspaceVariable(
  organizationId: string,
  name: string,
  sealed: SealedWorkspaceVariable,
  now: Date,
): EnvironmentEffect<void> {
  return upsertRow({ organizationId, name, ...sealed, now });
}

/** The workspace's variable of that name removed, answering whether one stood. */
export function removeWorkspaceVariable(
  organizationId: string,
  name: string,
): EnvironmentEffect<boolean> {
  return Effect.map(deleteRow({ organizationId, name }), (rows) => rows.length > 0);
}

/**
 * Every variable of the workspace opened with the ring, by name, for an
 * agent's environment. A value the ring cannot open is left out and logged
 * by its name alone.
 */
export const openWorkspaceEnvironment = /* @__PURE__ */ Effect.fnUntraced(function* (
  ring: KeyRing,
  organizationId: string,
): Effect.fn.Return<Record<string, string>, StoreFailure, DatabaseServices> {
  const rows = yield* findSealed(organizationId);
  const environment: Record<string, string> = {};
  for (const row of rows) {
    const opened = openWorkspaceVariable(ring, { organizationId, name: row.name }, row);
    if (Result.isFailure(opened)) {
      yield* Effect.logWarning(`The workspace variable ${row.name} cannot be opened.`);
      continue;
    }
    environment[row.name] = Redacted.value(opened.success);
  }
  return environment;
});
