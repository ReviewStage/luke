import type { DatabaseServices } from "@repo/database/core/query";
import { pruneSyncLog } from "@repo/database/models/sync-log";
import { Effect, Layer } from "effect";
import { type HttpClient, HttpRouter } from "effect/http";
import { HostedEnvironment } from "../environment.js";
import { effectPassthrough, hostedNotFoundRoute } from "../http/http-effect.js";
import { type CronMonitor, sentryCronCheckIns } from "../observability/sentry.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { MAINTENANCE_SWEEP, MAINTENANCE_SWEEP_PATH } from "./maintenance-bounds.js";
import { handleMaintenanceSweep } from "./maintenance-sweep.js";
import { sweepPortShares } from "./port-share-sweep.js";

/** The sweep as Sentry's Crons watches it: three minutes in a row missed, late, or failed open an issue. */
const SWEEP_MONITOR: CronMonitor = {
  slug: "maintenance-sweep",
  crontab: MAINTENANCE_SWEEP.CRONTAB,
  // Note that the check-in times the sweep's own work alone, never what it hands on past its answer, so a sweep still running when the next is called is late.
  maxRuntimeMinutes: 1,
  checkInMarginMinutes: 1,
  failuresBeforeIssue: 3,
};

/** The scheduled sweep handed the deployment's real seams. */
const maintenanceSweepEffect = /* @__PURE__ */ Effect.fn("web/maintenanceSweepEffect")(function* (
  request: Request,
): Effect.fn.Return<
  Response,
  unknown,
  DatabaseServices | HostedEnvironment | HttpClient.HttpClient
> {
  const environment = yield* HostedEnvironment;
  return yield* handleMaintenanceSweep({
    request,
    cronSecret: environment.cronSecret,
    monitor: sentryCronCheckIns(SWEEP_MONITOR),
    pruneSyncLog: (now) => pruneSyncLog(new Date(now)),
    sweepPortShares: (now) => sweepPortShares(new Date(now)),
  });
});

/**
 * The group: the sweep carried to an `HttpApp`, and the hosted vocabulary's
 * own refusal for a path it does not declare — unreachable in production,
 * since `vercel.json` sends the function only its own path.
 */
export function maintenanceApp(): WebRoutes<
  DatabaseServices | HostedEnvironment | HttpClient.HttpClient
> {
  return Layer.mergeAll(
    // `ANY_METHOD`, not `GET`: the handler decides its own method refusal, so a
    // request to the right path on the wrong method still answers 405 rather
    // than falling through to the group's own 404.
    HttpRouter.add(ANY_METHOD, MAINTENANCE_SWEEP_PATH, effectPassthrough(maintenanceSweepEffect)),
    hostedNotFoundRoute,
  );
}
