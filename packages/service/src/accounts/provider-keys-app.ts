import type { DatabaseServices } from "@luke/database/core/query";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { HostedEnvironment } from "../environment.js";
import { effectPassthrough, hostedNotFoundRoute } from "../http/http-effect.js";
import { MAINTENANCE_PROVIDER_KEYS_REWRAP_PATH } from "../maintenance/maintenance-bounds.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { handleProviderKeyRewrap } from "./provider-key-rewrap.js";

/**
 * provider-keys-app.ts -- the provider keys' rotation rewrap, asked by hand under the deployment's secret.
 *
 * The rewrap (`accounts/provider-key-rewrap.ts`) is a group of its own,
 * asked under the deployment's `CRON_SECRET` rather than any account's
 * bearer, and kept out of the maintenance group so its function carries
 * none of the voice socket the sweep reaches. The account's own keys are
 * `provider-keys-procedures.ts`'s.
 */

/** The rotation's rewrap, asked by hand under the deployment's secret, over the ring the deployment holds. */
const providerKeyRewrapEffect = /* @__PURE__ */ Effect.fn("web/providerKeyRewrapEffect")(function* (
  request: Request,
): Effect.fn.Return<Response, unknown, DatabaseServices | HostedEnvironment> {
  const environment = yield* HostedEnvironment;
  return yield* handleProviderKeyRewrap({
    request,
    cronSecret: environment.cronSecret,
    keys: environment.providerKeyEncryptionKeys,
  });
});

/** The rewrap's group: its one path, and the hosted vocabulary's own refusal for any other. */
export function providerKeyRewrapApp(): WebRoutes<DatabaseServices | HostedEnvironment> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      MAINTENANCE_PROVIDER_KEYS_REWRAP_PATH,
      effectPassthrough(providerKeyRewrapEffect),
    ),
    hostedNotFoundRoute,
  );
}
