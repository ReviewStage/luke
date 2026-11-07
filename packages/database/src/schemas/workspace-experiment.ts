import type { WorkspaceExperiment } from "@repo/settings";
import { boolean, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";

/**
 * workspace-experiment.ts -- one experiment a workspace's admin turned on or off for everyone in it, who did, and when.
 *
 * An experiment that changes what a workspace's members share and what its
 * agents read and write (`@repo/settings`'s `WORKSPACE_EXPERIMENT_LIST`) is
 * the workspace's choice rather than each member's, so one member's choice
 * never splits a task from another's. A workspace holds at most one row per
 * experiment, written again on each change, so the row says who changed it
 * last and when; a workspace with no row for an experiment has it off.
 * Turning one off deletes nothing it kept, so turning it back on brings it
 * all back. Rows leave with the workspace; one whose changer's account is
 * gone keeps its choice and names no one.
 */
export const workspaceExperiment = pgTable(
  "workspace_experiment",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    experiment: text("experiment").$type<WorkspaceExperiment>().notNull(),
    on: boolean("on").notNull(),
    changedBy: text("changed_by").references(() => user.id, { onDelete: "set null" }),
    changedAt: timestamptz("changed_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.experiment] })],
);
