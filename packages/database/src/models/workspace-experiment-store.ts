import {
  isExperiment,
  isWorkspaceExperiment,
  WORKSPACE_EXPERIMENT_LIST,
  type WorkspaceExperiment,
} from "@repo/settings";
import { and, eq, sql } from "drizzle-orm";
import { DateTime, Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { workspaceExperiment } from "../schemas/workspace-experiment.js";
import { InstantColumnSchema } from "./columns.js";

/**
 * workspace-experiment-store.ts -- the experiments a workspace's admins turned on or off for everyone in it, read by each gate and written by the switch.
 *
 * A gate asks whether an experiment is on for the workspace the work is in
 * (`workspaceExperimentOn`), never for the member asking, so every member
 * and agent of one workspace reads the same answer. A workspace with no row
 * for an experiment has it off. Who may change a workspace's experiments is
 * the caller's to hold; this module keeps only the choice, who made it last,
 * and when. A row naming an experiment this build no longer lists, one that
 * graduated, is passed over.
 */

/** One workspace experiment as it stands: on or off, who changed it last, and when. */
export interface WorkspaceExperimentStanding {
  readonly experiment: WorkspaceExperiment;
  readonly on: boolean;
  /** The account that changed it last; none where that account is gone. */
  readonly changedBy: string | undefined;
  readonly changedAt: Date;
}

/** A change to one workspace experiment, made by the account named. */
export interface WorkspaceExperimentChange {
  readonly organizationId: string;
  readonly experiment: WorkspaceExperiment;
  readonly on: boolean;
  readonly by: string;
}

const StandingRowSchema = Schema.Struct({
  experiment: Schema.String,
  on: Schema.Boolean,
  changedBy: Schema.NullOr(Schema.String),
  changedAt: InstantColumnSchema,
});

const WorkspaceExperimentSchema = Schema.Literals(WORKSPACE_EXPERIMENT_LIST);

/** The transaction a statement wrote its row in. */
const WrittenSchema = Schema.Struct({ txid: Schema.String });

const findStandings = SqlSchema.findAll({
  Request: Schema.String,
  Result: StandingRowSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({
          experiment: workspaceExperiment.experiment,
          on: workspaceExperiment.on,
          changedBy: workspaceExperiment.changedBy,
          changedAt: workspaceExperiment.changedAt,
        })
        .from(workspaceExperiment)
        .where(eq(workspaceExperiment.organizationId, organizationId)),
    ),
});

const findOn = SqlSchema.findAll({
  Request: Schema.Struct({ organizationId: Schema.String, experiment: WorkspaceExperimentSchema }),
  Result: Schema.Struct({ on: Schema.Boolean }),
  execute: ({ organizationId, experiment }) =>
    Database.use((db) =>
      db
        .select({ on: workspaceExperiment.on })
        .from(workspaceExperiment)
        .where(
          and(
            eq(workspaceExperiment.organizationId, organizationId),
            eq(workspaceExperiment.experiment, experiment),
          ),
        )
        .limit(1),
    ),
});

const upsertStanding = SqlSchema.findAll({
  Request: Schema.Struct({
    organizationId: Schema.String,
    experiment: WorkspaceExperimentSchema,
    on: Schema.Boolean,
    by: Schema.String,
    now: Schema.Date,
  }),
  Result: WrittenSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(workspaceExperiment)
        .values({
          organizationId: write.organizationId,
          experiment: write.experiment,
          on: write.on,
          changedBy: write.by,
          changedAt: write.now,
        })
        .onConflictDoUpdate({
          target: [workspaceExperiment.organizationId, workspaceExperiment.experiment],
          set: { on: write.on, changedBy: write.by, changedAt: write.now },
        })
        .returning({ txid: sql<string>`pg_current_xact_id()::text` }),
    ),
});

/** Every experiment the workspace has a choice for, as it stands; one it never chose is absent, and off. */
export function workspaceExperimentsOf(
  organizationId: string,
): Effect.Effect<readonly WorkspaceExperimentStanding[], StoreFailure, DatabaseServices> {
  return Effect.map(findStandings(organizationId), (rows) =>
    rows.flatMap(({ experiment, on, changedBy, changedAt }) =>
      isExperiment(experiment) && isWorkspaceExperiment(experiment)
        ? [{ experiment, on, changedBy: changedBy ?? undefined, changedAt }]
        : [],
    ),
  );
}

/**
 * Whether the workspace has the experiment on: what every gate of a
 * workspace experiment asks, for the workspace the work is in.
 */
export function workspaceExperimentOn(
  organizationId: string,
  experiment: WorkspaceExperiment,
): Effect.Effect<boolean, StoreFailure, DatabaseServices> {
  return Effect.map(findOn({ organizationId, experiment }), (rows) => rows[0]?.on === true);
}

/**
 * The experiment turned on or off for the workspace by the account named,
 * now, answered with the transaction it was written in so a follower can
 * wait for its live read to catch up.
 */
export function setWorkspaceExperiment(
  change: WorkspaceExperimentChange,
): Effect.Effect<{ readonly txid: string | undefined }, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const rows = yield* upsertStanding({ ...change, now });
    return { txid: rows[0]?.txid };
  });
}
