import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import { HostedEnvironment } from "./hosted/environment.js";
import { effectPassthrough, hostedNotFoundRoute } from "./hosted/http-effect.js";
import { MAINTENANCE_PLAN_DOCUMENTS_PATH } from "./hosted/maintenance-bounds.js";
import { handlePlanBackfill } from "./hosted/plan-backfill.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * plan-backfill-app.ts -- the switch's carrying over of every plan still kept as fields, asked by hand under the deployment's secret.
 *
 * The logic is `hosted/plan-backfill.ts`; this group hands it the request and
 * the deployment's `CRON_SECRET`, and answers the vocabulary's own refusal
 * for any other path.
 */

const planBackfillEffect = /* @__PURE__ */ Effect.fn("web/planBackfillEffect")(function* (
  request: Request,
): Effect.fn.Return<Response, unknown, SqlClient.SqlClient | HostedEnvironment> {
  const environment = yield* HostedEnvironment;
  return yield* handlePlanBackfill({ request, cronSecret: environment.cronSecret });
});

/** The backfill's group: its one path, and the hosted vocabulary's own refusal for any other. */
export function planBackfillApp(): WebRoutes<SqlClient.SqlClient | HostedEnvironment> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      MAINTENANCE_PLAN_DOCUMENTS_PATH,
      effectPassthrough(planBackfillEffect),
    ),
    hostedNotFoundRoute,
  );
}
