import { Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/unstable/http";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedMethod,
  hostedNotFoundRoute,
  hostedRefusalResponse,
  type UserIdResolver,
} from "./hosted/http-effect.js";
import { ModelCatalog } from "./hosted/model-catalog.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * models-app.ts -- the models a coding agent may run on, as the Start menu and Settings offer them.
 *
 * `GET /api/models` answers the instance's cached read of AI Gateway's
 * public catalog, filtered to what Luke offers (`hosted/model-catalog.ts`):
 * each model's id, name, provider, and the efforts it lists. The catalog is
 * public and the same for every account, and the bearer is still resolved
 * first, as every hosted endpoint resolves it, so the read is answered to a
 * signed-in desktop alone. A catalog the instance cannot read is an outage,
 * answered as unavailable for the caller to ask again.
 */

const MODELS_PATH = "/api/models";

const HTTP_METHOD = { GET: "GET" } as const;

export interface ModelsAppSeams {
  resolveUserId: UserIdResolver;
}

const modelsEndpoint = /* @__PURE__ */ Effect.fn("web/modelsEndpoint")(function* (
  seams: ModelsAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | ModelCatalog
> {
  yield* hostedMethod(HTTP_METHOD.GET);
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const catalog = yield* ModelCatalog;
  const models = yield* catalog.read.pipe(
    Effect.tapError((unavailable) =>
      Effect.logWarning("the model catalog could not be read", unavailable.cause),
    ),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { models });
});

/** The group: the one models path, and the hosted vocabulary's own refusal for any other. */
export function modelsApp(seams: ModelsAppSeams): WebRoutes<ModelCatalog> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      MODELS_PATH,
      Effect.catch(modelsEndpoint(seams), (refusal) =>
        Effect.succeed(hostedRefusalResponse(refusal)),
      ),
    ),
    hostedNotFoundRoute,
  );
}
