import {
  WORKSPACE_ENVIRONMENT_KIND,
  type WorkspaceEnvironmentKind,
} from "@luke/features/workspace-environment-wire";
import { and, asc, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { workspaceEnvironmentVariable } from "../schemas/workspace-environment.js";
import { InstantColumnSchema } from "./columns.js";
import type { SealedProviderKey } from "./provider-key-seal.js";
import type { TaskStoreEffect } from "./task-store.js";

/**
 * workspace-environment-store.ts -- the rows of a workspace's environment variables and secrets, sealed as `provider-key-seal.ts` seals them.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * workspace, so no workspace reads, replaces, or removes another's. What
 * goes in and out is sealed: this module never sees a value in the clear,
 * and a row read here is opened by its caller with the ring the
 * environment holds. Whether the caller may read or write the workspace's
 * rows is the caller's to have settled.
 */

const SealedRowSchema = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(Object.values(WORKSPACE_ENVIRONMENT_KIND)),
  keyVersion: Schema.Int,
  sealedDataKey: Schema.String,
  sealedValue: Schema.String,
  hint: Schema.String,
  updatedAt: InstantColumnSchema,
});

/** One stored variable or secret as its row holds it: sealed, beside what a member is shown of it. */
export type WorkspaceEnvironmentRow = typeof SealedRowSchema.Type;

const OwnedRowSchema = Schema.Struct({ organizationId: Schema.String, ...SealedRowSchema.fields });

/** One stored variable or secret with its workspace, for the rewrap that walks every row. */
export type OwnedWorkspaceEnvironmentRow = typeof OwnedRowSchema.Type;

const KeySchema = Schema.Struct({ organizationId: Schema.String, name: Schema.String });

const ROW_COLUMNS = {
  name: workspaceEnvironmentVariable.name,
  kind: workspaceEnvironmentVariable.kind,
  keyVersion: workspaceEnvironmentVariable.keyVersion,
  sealedDataKey: workspaceEnvironmentVariable.sealedDataKey,
  sealedValue: workspaceEnvironmentVariable.sealedValue,
  hint: workspaceEnvironmentVariable.hint,
  updatedAt: workspaceEnvironmentVariable.updatedAt,
} as const;

const findRows = SqlSchema.findAll({
  Request: Schema.String,
  Result: SealedRowSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select(ROW_COLUMNS)
        .from(workspaceEnvironmentVariable)
        .where(eq(workspaceEnvironmentVariable.organizationId, organizationId))
        .orderBy(asc(workspaceEnvironmentVariable.name)),
    ),
});

const findEveryRow = SqlSchema.findAll({
  Request: Schema.Void,
  Result: OwnedRowSchema,
  execute: () =>
    Database.use((db) =>
      db
        .select({ organizationId: workspaceEnvironmentVariable.organizationId, ...ROW_COLUMNS })
        .from(workspaceEnvironmentVariable)
        .orderBy(
          asc(workspaceEnvironmentVariable.organizationId),
          asc(workspaceEnvironmentVariable.name),
        ),
    ),
});

const upsertRow = SqlSchema.void({
  Request: Schema.Struct({
    ...KeySchema.fields,
    kind: Schema.Literals(Object.values(WORKSPACE_ENVIRONMENT_KIND)),
    keyVersion: Schema.Int,
    sealedDataKey: Schema.String,
    sealedValue: Schema.String,
    hint: Schema.String,
    userId: Schema.String,
    now: Schema.Date,
  }),
  execute: (write) => {
    const row = {
      kind: write.kind,
      keyVersion: write.keyVersion,
      sealedDataKey: write.sealedDataKey,
      sealedValue: write.sealedValue,
      hint: write.hint,
      updatedByUserId: write.userId,
      updatedAt: write.now,
    };
    return Database.use((db) =>
      db
        .insert(workspaceEnvironmentVariable)
        .values({ organizationId: write.organizationId, name: write.name, ...row })
        .onConflictDoUpdate({
          target: [workspaceEnvironmentVariable.organizationId, workspaceEnvironmentVariable.name],
          set: row,
        }),
    );
  },
});

const deleteRow = SqlSchema.void({
  Request: KeySchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .delete(workspaceEnvironmentVariable)
        .where(
          and(
            eq(workspaceEnvironmentVariable.organizationId, key.organizationId),
            eq(workspaceEnvironmentVariable.name, key.name),
          ),
        ),
    ),
});

/** The wrap moved only where the row still holds the seal it was read with, so a value replaced meanwhile keeps its own. */
const rewrapRow = SqlSchema.findAll({
  Request: Schema.Struct({
    ...KeySchema.fields,
    fromVersion: Schema.Int,
    sealedValue: Schema.String,
    keyVersion: Schema.Int,
    sealedDataKey: Schema.String,
  }),
  Result: Schema.Struct({ name: Schema.String }),
  execute: (write) =>
    Database.use((db) =>
      db
        .update(workspaceEnvironmentVariable)
        .set({ keyVersion: write.keyVersion, sealedDataKey: write.sealedDataKey })
        .where(
          and(
            eq(workspaceEnvironmentVariable.organizationId, write.organizationId),
            eq(workspaceEnvironmentVariable.name, write.name),
            eq(workspaceEnvironmentVariable.keyVersion, write.fromVersion),
            eq(workspaceEnvironmentVariable.sealedValue, write.sealedValue),
          ),
        )
        .returning({ name: workspaceEnvironmentVariable.name }),
    ),
});

/** The workspace's stored variables and secrets, sealed, by name. */
export function listWorkspaceEnvironmentRows(
  organizationId: string,
): TaskStoreEffect<readonly WorkspaceEnvironmentRow[]> {
  return findRows(organizationId);
}

/** Keeps the name's value for the workspace, of the kind given, replacing what it held, as saved now by the account given. */
export function saveWorkspaceEnvironmentValue(
  organizationId: string,
  name: string,
  kind: WorkspaceEnvironmentKind,
  sealed: SealedProviderKey,
  hint: string,
  userId: string,
  now: Date,
): TaskStoreEffect<void> {
  return upsertRow({
    organizationId,
    name,
    kind,
    keyVersion: sealed.keyVersion,
    sealedDataKey: sealed.sealedDataKey,
    sealedValue: sealed.sealedKey,
    hint,
    userId,
    now,
  });
}

/** Removes the name from the workspace; removing one it does not hold moves nothing. */
export function removeWorkspaceEnvironmentValue(
  organizationId: string,
  name: string,
): TaskStoreEffect<void> {
  return deleteRow({ organizationId, name });
}

/** Every stored variable and secret of every workspace, sealed, for the rewrap alone. */
export function listEveryWorkspaceEnvironmentRow(): TaskStoreEffect<
  readonly OwnedWorkspaceEnvironmentRow[]
> {
  return findEveryRow(undefined);
}

/** A row's seal as the seal module reads one. */
export function sealedOf(row: WorkspaceEnvironmentRow): SealedProviderKey {
  return {
    keyVersion: row.keyVersion,
    sealedDataKey: row.sealedDataKey,
    sealedKey: row.sealedValue,
  };
}

/**
 * Moves one row onto a new wrap of its data key, and answers whether it
 * did: not where the row was replaced or rewrapped since it was read.
 */
export function rewrapWorkspaceEnvironmentRow(
  row: OwnedWorkspaceEnvironmentRow,
  rewrapped: SealedProviderKey,
): TaskStoreEffect<boolean> {
  return Effect.map(
    rewrapRow({
      organizationId: row.organizationId,
      name: row.name,
      fromVersion: row.keyVersion,
      sealedValue: row.sealedValue,
      keyVersion: rewrapped.keyVersion,
      sealedDataKey: rewrapped.sealedDataKey,
    }),
    (moved) => moved.length > 0,
  );
}
