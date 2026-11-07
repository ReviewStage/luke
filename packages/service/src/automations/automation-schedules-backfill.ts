import type { DatabaseServices } from "@repo/database/core/query";
import { scheduledAutomations } from "@repo/database/models/automation-store";
import { Effect, Layer, type Redacted } from "effect";
import { HttpRouter } from "effect/http";
import { HostedEnvironment } from "../environment.js";
import {
  bearerMatchesSecret,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
} from "../http/http.js";
import { effectPassthrough, hostedNotFoundRoute } from "../http/http-effect.js";
import { MAINTENANCE_AUTOMATION_SCHEDULES_PATH } from "../maintenance/maintenance-bounds.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { AutomationCadence } from "./automation-cadence.js";

/**
 * automation-schedules-backfill.ts -- the one-off keeping of every scheduled automation's Vercel schedule, asked by hand under the deployment's `CRON_SECRET`.
 *
 * An automation saved before its schedule moved to Vercel Schedules has
 * none, so this keeps each one's as a save would (`automation-cadence.ts`),
 * a page at a time in id order: each call keeps up to `PAGE` and answers
 * how many it kept, how many Vercel refused, and the id to ask after next,
 * none once the last page is kept (`scripts/backfill-automation-schedules.sh`
 * walks the pages). Keeping a schedule twice writes it as it stands, so a
 * page asked again is no harm. It runs on the deployment, under the
 * deployment's own token, because a schedule belongs to the environment
 * whose deployment keeps it; off production the cadence keeps nothing.
 */

const BACKFILL = {
  /** The most automations one call keeps, inside Vercel's request limits and the function's bound. */
  PAGE: 100,
  /** How many are kept at once. */
  CONCURRENCY: 4,
  /** The query naming the id the page starts after. */
  AFTER: "after",
} as const;

interface AutomationSchedulesBackfillOptions {
  readonly request: Request;
  /** CRON_SECRET, sealed; undefined means the deployment holds none and the route is off. */
  readonly cronSecret: Redacted.Redacted | undefined;
}

/** One page kept: how many schedules were kept, how many Vercel refused, and where the next page starts. */
const keepPage = Effect.fnUntraced(function* (after: string | null) {
  const cadence = yield* AutomationCadence;
  const page = yield* scheduledAutomations(after, BACKFILL.PAGE);
  const kept = yield* Effect.forEach(
    page,
    (automation) =>
      cadence.keep(automation).pipe(
        Effect.as(true),
        Effect.catch((failure) =>
          Effect.as(
            Effect.logWarning(
              `an automation's schedule was not kept: ${failure.code ?? "unreachable"}`,
            ),
            false,
          ),
        ),
      ),
    { concurrency: BACKFILL.CONCURRENCY },
  );
  const last = page.at(-1);
  return {
    kept: kept.filter(Boolean).length,
    refused: kept.filter((each) => !each).length,
    next: page.length < BACKFILL.PAGE || last === undefined ? null : last.id,
  };
});

/** POST: one page of the backfill, under the deployment's secret. */
const handleAutomationSchedulesBackfill = /* @__PURE__ */ Effect.fn(
  "web/handleAutomationSchedulesBackfill",
)(function* (
  options: AutomationSchedulesBackfillOptions,
): Effect.fn.Return<Response, unknown, DatabaseServices> {
  const { request } = options;
  if (request.method !== "POST") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }
  if (options.cronSecret === undefined) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }
  if (!bearerMatchesSecret(request, options.cronSecret)) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }
  // The first page names no id to start after.
  const after = new URL(request.url).searchParams.get(BACKFILL.AFTER) || null;
  return jsonResponse(HOSTED_HTTP_STATUS.OK, yield* keepPage(after));
});

/** The backfill's group: its one path, and the hosted vocabulary's own refusal for any other. */
export function automationSchedulesBackfillApp(): WebRoutes<DatabaseServices | HostedEnvironment> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      MAINTENANCE_AUTOMATION_SCHEDULES_PATH,
      effectPassthrough((request: Request) =>
        Effect.flatMap(HostedEnvironment, (environment) =>
          handleAutomationSchedulesBackfill({ request, cronSecret: environment.cronSecret }),
        ),
      ),
    ),
    hostedNotFoundRoute,
  );
}
