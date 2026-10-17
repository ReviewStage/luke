import type { DatabaseServices } from "@luke/database/core/query";
import { listRepositoryPins, setRepositoryPin } from "@luke/database/models/repository-pin-store";
import { repositoryPinRequestSchema } from "@luke/features/task-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type UserIdResolver,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";

/**
 * repository-pins-app.ts -- the repositories the account pinned in the Mac's sidebar: read them, and pin or unpin one.
 *
 * `GET /api/repository-pins` answers the account's pins, newest pinned
 * first; `PUT` pins or unpins one repository and answers them all as they
 * then stand, so the window draws the service's word rather than its own
 * guess. A pin names a repository and nothing of it, so it asks GitHub
 * nothing: a repository the account no longer reaches simply groups no task.
 * Every request resolves the bearer before it touches a row, and every row
 * it touches is the bearer's account's own. It stands apart from
 * `/api/plans/*` because that path's rewrite reads its next segment as a
 * task's id.
 */

const REPOSITORY_PINS_PATH = "/api/repository-pins";

const HTTP_METHOD = { GET: "GET", PUT: "PUT" } as const;

/** A pin is a repository's name and a boolean, so a body past this is not one. */
const MAXIMUM_PIN_BODY_BYTES = 1_024;

export interface RepositoryPinsAppSeams {
  resolveUserId: UserIdResolver;
}

const repositoryPinsEndpoint = /* @__PURE__ */ Effect.fn("web/repositoryPinsEndpoint")(function* (
  seams: RepositoryPinsAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices
> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET && incoming.method !== HTTP_METHOD.PUT) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const userId = account.value;
  if (incoming.method === HTTP_METHOD.GET) {
    const pins = yield* hostedStoreOrUnavailable(listRepositoryPins(userId));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { pins });
  }
  const body = yield* readJsonBodyEffect(MAXIMUM_PIN_BODY_BYTES);
  const asked = readEither(repositoryPinRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { repository, pinned } = asked.success;
  const pins = yield* hostedStoreOrUnavailable(setRepositoryPin(userId, repository, pinned));
  // A pin past the bound is a request the service will not keep, as a name past its bound is.
  if (Option.isNone(pins)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { pins: pins.value });
});

/** The group: the one pins path, and the hosted vocabulary's own refusal for any other. */
export function repositoryPinsApp(seams: RepositoryPinsAppSeams): WebRoutes<DatabaseServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, REPOSITORY_PINS_PATH, hostedRefusing(repositoryPinsEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
