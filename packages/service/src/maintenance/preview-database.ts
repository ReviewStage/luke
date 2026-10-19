/**
 * preview-database.ts -- a deployment build's database step: the migrations, then, on a Preview, production's work in flight switched off.
 *
 * A Preview's database is Neon's branch of production's, taken with every row
 * production held, so it holds production's running turns, working agents,
 * open calls, and queued Mac commands and sandbox jobs.
 * `@luke/database/models/preview-copy` switches them off. It runs on a
 * Preview's build alone, as Vercel's own `VERCEL_ENV` names it, since run
 * against production it would stop every account's agents; every other build
 * only migrates.
 */

import { runWebMigrations } from "@luke/database/core/migrator";
import { switchOffCopiedWork } from "@luke/database/models/preview-copy";
import { storeWriter } from "@luke/database/models/writer";
import { text } from "@luke/wire";
import { Clock, Effect } from "effect";
import { HOSTED_TOOL_SET } from "../tasks/brain-tool-set.js";

/** Vercel's own name for the environment a build deploys to. */
const DEPLOYMENT_ENVIRONMENT = "VERCEL_ENV";

/** `VERCEL_ENV` on a Preview's build. */
const PREVIEW_ENVIRONMENT = "preview";

/**
 * A deployment build's database step, which `apps/web/server/db/migrate.ts`
 * runs on the direct connection: every migration the database has not
 * recorded, then, on a Preview's build, the copy's work in flight switched
 * off. The order is the point: a branch's build migrates the copy before
 * anything is written to it. What the Preview step did goes to the build's
 * log as counts. Answers the migrations applied.
 */
export const migrateDeploymentDatabase = /* @__PURE__ */ Effect.fn("web/migrateDeploymentDatabase")(
  function* (variables: Record<string, string | undefined>) {
    const applied = yield* runWebMigrations();
    yield* Effect.logInfo(`Applied ${applied.length} migrations`, applied);
    if (text(variables[DEPLOYMENT_ENVIRONMENT]) !== PREVIEW_ENVIRONMENT) return applied;

    const writer = yield* storeWriter({ tools: HOSTED_TOOL_SET });
    const now = yield* Clock.currentTimeMillis;
    const counts = yield* switchOffCopiedWork({ writer }, now);
    yield* Effect.logInfo(
      `Preview database: settled ${counts.settledTurns} turns and archived ${counts.archivedAgents} coding agents copied from production`,
    );
    return applied;
  },
);
