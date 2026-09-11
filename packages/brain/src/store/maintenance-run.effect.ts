/**
 * One maintenance pass in Effect's own terms. `maintenance-run.ts` is a port
 * of OpenClaw `b7528507`'s conversation directory maintenance and imports
 * nothing from `effect`, so its Effect surface lives here:
 * `runConversationMaintenance` restated as an effect. The pass has no
 * refusal of its own — every boundary it runs already reports what it did
 * rather than failing — so there is nothing to type beyond the wrap itself.
 */
import { Effect } from "effect";
import type { StoreDatabase } from "./database.js";
import {
  type MaintenanceReport,
  type MaintenanceRunOptions,
  runConversationMaintenance,
} from "./maintenance-run.js";

/** One maintenance pass over the agent's history, in the pinned order. */
export const runConversationMaintenanceEffect = (
  database: StoreDatabase,
  agentRoot: string,
  options: MaintenanceRunOptions,
): Effect.Effect<MaintenanceReport> =>
  Effect.sync(() => runConversationMaintenance(database, agentRoot, options));
