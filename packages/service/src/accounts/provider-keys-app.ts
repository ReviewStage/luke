import type { DatabaseServices } from "@repo/database/core/query";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { HostedEnvironment } from "../environment.js";
import { effectPassthrough, hostedNotFoundRoute } from "../http/http-effect.js";
import { MAINTENANCE_PROVIDER_KEYS_REWRAP_PATH } from "../maintenance/maintenance-bounds.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { handleProviderKeyRewrap } from "./provider-key-rewrap.js";

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
