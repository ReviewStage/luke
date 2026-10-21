import type { DatabaseServices } from "@luke/database/core/query";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { HostedEnvironment } from "../environment.js";
import { effectPassthrough, hostedNotFoundRoute } from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { handleLineFilesBackfill } from "./line-files-backfill.js";
import { MAINTENANCE_LINE_FILES_BACKFILL_PATH } from "./maintenance-bounds.js";

/**
 * line-files-backfill-app.ts -- the backfill of lines' inline files, asked by hand under the deployment's secret.
 *
 * A group of its own, as the provider keys' rewrap is
 * (`accounts/provider-keys-app.ts`), so its function carries none of what
 * the scheduled sweep reaches.
 */

const lineFilesBackfillEffect = /* @__PURE__ */ Effect.fn("web/lineFilesBackfillEffect")(function* (
  request: Request,
): Effect.fn.Return<Response, unknown, DatabaseServices | HostedEnvironment> {
  const environment = yield* HostedEnvironment;
  return yield* handleLineFilesBackfill({ request, cronSecret: environment.cronSecret });
});

/** The backfill's group: its one path, and the hosted vocabulary's own refusal for any other. */
export function lineFilesBackfillApp(): WebRoutes<DatabaseServices | HostedEnvironment> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      MAINTENANCE_LINE_FILES_BACKFILL_PATH,
      effectPassthrough(lineFilesBackfillEffect),
    ),
    hostedNotFoundRoute,
  );
}
