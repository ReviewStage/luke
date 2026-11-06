import { and, asc, desc, eq, type SQL, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { workspaceTokenRepository } from "../schemas/workspace-token-repository.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect } from "./task-store.js";
import { workspaceReachableBy } from "./workspace-store.js";

const RowSchema = Schema.Struct({
  repository: Schema.String,
  addedByUserId: Schema.String,
  addedAt: InstantColumnSchema,
});

export interface WorkspaceTokenRepositoryRow {
  readonly repository: string;
  readonly addedByUserId: string;
  readonly addedAt: number;
}

function namedRepository(repository: string): SQL {
  return sql`lower(${workspaceTokenRepository.repository}) = lower(${repository})`;
}

const PlaceSchema = Schema.Struct({ userId: Schema.String, organizationId: Schema.String });

const KeySchema = Schema.Struct({ ...PlaceSchema.fields, repository: Schema.String });

const findRows = SqlSchema.findAll({
  Request: PlaceSchema,
  Result: RowSchema,
  execute: (place) =>
    Database.use((db) =>
      db
        .select({
          repository: workspaceTokenRepository.repository,
          addedByUserId: workspaceTokenRepository.addedByUserId,
          addedAt: workspaceTokenRepository.addedAt,
        })
        .from(workspaceTokenRepository)
        .where(
          and(
            eq(workspaceTokenRepository.organizationId, place.organizationId),
            workspaceReachableBy(place.userId, workspaceTokenRepository.organizationId),
          ),
        )
        .orderBy(desc(workspaceTokenRepository.addedAt), asc(workspaceTokenRepository.repository)),
    ),
});

const findAdder = SqlSchema.findOneOption({
  Request: KeySchema,
  Result: Schema.Struct({ addedByUserId: Schema.String }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ addedByUserId: workspaceTokenRepository.addedByUserId })
        .from(workspaceTokenRepository)
        .where(
          and(
            eq(workspaceTokenRepository.organizationId, key.organizationId),
            namedRepository(key.repository),
            workspaceReachableBy(key.userId, workspaceTokenRepository.organizationId),
          ),
        ),
    ),
});

const insertRow = SqlSchema.void({
  Request: Schema.Struct({ ...KeySchema.fields, now: Schema.Date }),
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(workspaceTokenRepository)
        .values({
          organizationId: write.organizationId,
          repository: write.repository,
          addedByUserId: write.userId,
          addedAt: write.now,
        })
        .onConflictDoNothing(),
    ),
});

const deleteRow = SqlSchema.void({
  Request: Schema.Struct({ ...KeySchema.fields, addedByUserId: Schema.String }),
  execute: (key) =>
    Database.use((db) =>
      db
        .delete(workspaceTokenRepository)
        .where(
          and(
            eq(workspaceTokenRepository.organizationId, key.organizationId),
            namedRepository(key.repository),
            eq(workspaceTokenRepository.addedByUserId, key.addedByUserId),
            workspaceReachableBy(key.userId, workspaceTokenRepository.organizationId),
          ),
        ),
    ),
});

export function listWorkspaceTokenRepositories(
  userId: string,
  organizationId: string,
): TaskStoreEffect<readonly WorkspaceTokenRepositoryRow[]> {
  return Effect.map(findRows({ userId, organizationId }), (rows) =>
    rows.map((row) => ({
      repository: row.repository,
      addedByUserId: row.addedByUserId,
      addedAt: row.addedAt.getTime(),
    })),
  );
}

export function addWorkspaceTokenRepository(
  userId: string,
  organizationId: string,
  repository: string,
  now: Date,
): TaskStoreEffect<void> {
  return insertRow({ userId, organizationId, repository, now });
}

export function workspaceTokenRepositoryAdder(
  userId: string,
  organizationId: string,
  repository: string,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.map(
    findAdder({ userId, organizationId, repository }),
    Option.map((row) => row.addedByUserId),
  );
}

export function removeWorkspaceTokenRepository(
  userId: string,
  organizationId: string,
  repository: string,
  addedByUserId: string,
): TaskStoreEffect<void> {
  return deleteRow({ userId, organizationId, repository, addedByUserId });
}
