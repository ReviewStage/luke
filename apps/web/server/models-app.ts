import { listProviderKeyRows } from "@sidecar/database/models/provider-key-store";
import type { ModelProvider } from "@sidecar/hosted/models-wire";
import { failureKind } from "@sidecar/runtime/effect";
import { Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedMethod,
  hostedNotFoundRoute,
  hostedRefusalResponse,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "./hosted/http-effect.js";
import { ModelCatalog, offeredToAccount } from "./hosted/model-catalog.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * models-app.ts -- the models a coding agent may run on, as the Start menu and Settings offer them.
 *
 * `GET /api/models` answers the instance's cached read of AI Gateway's
 * public catalog, filtered to what Luke offers (`hosted/model-catalog.ts`):
 * each model's id, name, provider, the efforts it lists, and its two
 * context windows where it offers a choice of them. The catalog is
 * public and the same for every account, but what an account is offered
 * of it is not quite: a provider the account runs on its own key has its
 * fast versions withheld, each base model saying why, since Luke runs
 * Fast on its own key alone. So the bearer is resolved first, and the read
 * is answered to a signed-in desktop alone. A catalog the instance cannot
 * read, or a store that cannot say which keys are the account's, is an
 * outage, answered as unavailable for the caller to ask again.
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
  HttpServerRequest.HttpServerRequest | ModelCatalog | SqlClient.SqlClient
> {
  yield* hostedMethod(HTTP_METHOD.GET);
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const catalog = yield* ModelCatalog;
  const models = yield* catalog.read.pipe(
    Effect.tapError((unavailable) =>
      Effect.logWarning(`the model catalog could not be read: ${failureKind(unavailable.cause)}`),
    ),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );
  const rows = yield* hostedStoreOrUnavailable(listProviderKeyRows(account.value));
  const ownKeyProviders: ReadonlySet<ModelProvider> = new Set(rows.map((row) => row.provider));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    models: offeredToAccount(models, ownKeyProviders),
  });
});

/** The group: the one models path, and the hosted vocabulary's own refusal for any other. */
export function modelsApp(seams: ModelsAppSeams): WebRoutes<ModelCatalog | SqlClient.SqlClient> {
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
