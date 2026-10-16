import type { RepositoryRun } from "@luke/features/repository-run-wire";
import { and, asc, eq } from "drizzle-orm";
import { DateTime, Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { workspaceRepositoryRun } from "../schemas/workspace-repository-run.js";
import type { TaskStoreEffect } from "./task-store.js";

/**
 * repository-run-store.ts -- how a workspace's repositories are set up and run on a Mac, read and written for `/api/repository-runs`.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * workspace, so nothing reads or writes another workspace's commands; the
 * route admits only a member of the workspace. A repository is keyed by its
 * full name lowercased. Setting both commands to nothing deletes the row,
 * so a repository with none set has no row.
 */

const RunRowSchema = Schema.Struct({
  repository: Schema.String,
  setupCommand: Schema.NullOr(Schema.String),
  runCommand: Schema.NullOr(Schema.String),
});

const findRuns = SqlSchema.findAll({
  Request: Schema.String,
  Result: RunRowSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({
          repository: workspaceRepositoryRun.repository,
          setupCommand: workspaceRepositoryRun.setupCommand,
          runCommand: workspaceRepositoryRun.runCommand,
        })
        .from(workspaceRepositoryRun)
        .where(eq(workspaceRepositoryRun.organizationId, organizationId))
        .orderBy(asc(workspaceRepositoryRun.repository)),
    ),
});

const WriteSchema = Schema.Struct({
  organizationId: Schema.String,
  repository: Schema.String,
  setupCommand: Schema.NullOr(Schema.String),
  runCommand: Schema.NullOr(Schema.String),
  userId: Schema.String,
  now: Schema.Date,
});

const upsertRun = SqlSchema.void({
  Request: WriteSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(workspaceRepositoryRun)
        .values({
          organizationId: write.organizationId,
          repository: write.repository,
          setupCommand: write.setupCommand,
          runCommand: write.runCommand,
          updatedByUserId: write.userId,
          updatedAt: write.now,
        })
        .onConflictDoUpdate({
          target: [workspaceRepositoryRun.organizationId, workspaceRepositoryRun.repository],
          set: {
            setupCommand: write.setupCommand,
            runCommand: write.runCommand,
            updatedByUserId: write.userId,
            updatedAt: write.now,
          },
        }),
    ),
});

const deleteRun = SqlSchema.void({
  Request: Schema.Struct({ organizationId: Schema.String, repository: Schema.String }),
  execute: (key) =>
    Database.use((db) =>
      db
        .delete(workspaceRepositoryRun)
        .where(
          and(
            eq(workspaceRepositoryRun.organizationId, key.organizationId),
            eq(workspaceRepositoryRun.repository, key.repository),
          ),
        ),
    ),
});

/** The workspace's repositories with a command set, by name. */
export function listRepositoryRuns(
  organizationId: string,
): TaskStoreEffect<readonly RepositoryRun[]> {
  return findRuns(organizationId);
}

/**
 * Sets one repository's commands for the workspace, by the member named,
 * or forgets them where both are nothing; answers the workspace's commands
 * as they then stand.
 */
export function setRepositoryRun(
  organizationId: string,
  userId: string,
  run: RepositoryRun,
): TaskStoreEffect<readonly RepositoryRun[]> {
  return Effect.gen(function* () {
    const repository = run.repository.toLowerCase();
    if (run.setupCommand === null && run.runCommand === null) {
      yield* deleteRun({ organizationId, repository });
    } else {
      const now = yield* DateTime.nowAsDate;
      yield* upsertRun({ ...run, organizationId, repository, userId, now });
    }
    return yield* listRepositoryRuns(organizationId);
  });
}
