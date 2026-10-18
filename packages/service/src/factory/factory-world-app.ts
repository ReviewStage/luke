/**
 * factory-world-app.ts -- a workspace's Factory world, read whole for a member of it.
 *
 * One endpoint the signed-in desktop calls with its bearer:
 * `POST /api/factory/world` takes `{ workspaceId }` and answers
 * `{ world }`, the world composed as it stands now (`factory-world.ts`), or
 * null where the workspace reaches no repository to draw. A workspace the
 * account is not in is not found; a GitHub or a store the service could not
 * reach is unavailable. Nothing is written.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { workspaceOf } from "@luke/database/models/workspace-store";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import {
  type FactoryWorldAnswer,
  factoryWorldRequestSchema,
} from "@luke/features/factory-world-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import type * as HttpClient from "effect/http/HttpClient";
import type { GitHubApp } from "../github/github-app.js";
import { githubReadOrRefusal } from "../github/github-refusal.js";
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
import type { WorkspaceLinearConnect } from "../integrations/integration-connect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { readFactoryWorld } from "./factory-world.js";

/** The most a request body may hold: a workspace id. */
const MAXIMUM_BODY_BYTES = 1_024;

const HTTP_METHOD = { POST: "POST" } as const;

export interface FactoryWorldAppSeams {
  readonly resolveUserId: UserIdResolver;
}

type Requirements =
  | HttpServerRequest.HttpServerRequest
  | DatabaseServices
  | GitHubApp
  | HttpClient.HttpClient
  | WorkspaceLinearConnect;

/** POST: the workspace's world, to any member of it. */
const worldEndpoint = /* @__PURE__ */ Effect.fn("web/factoryWorldEndpoint")(function* (
  seams: FactoryWorldAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const userId = account.value;
  const asked = readEither(factoryWorldRequestSchema)(
    yield* readJsonBodyEffect(MAXIMUM_BODY_BYTES),
  );
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, asked.success.workspaceId));
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const world = yield* githubReadOrRefusal(readFactoryWorld(userId, workspace.value.id));
  const answer: FactoryWorldAnswer = { world: Option.getOrNull(world) };
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, answer);
});

/** The group: the one world path, and the hosted vocabulary's own refusal for any other. */
export function factoryWorldApp(
  seams: FactoryWorldAppSeams,
): WebRoutes<DatabaseServices | GitHubApp | HttpClient.HttpClient | WorkspaceLinearConnect> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.FACTORY_WORLD,
      hostedRefusing(worldEndpoint(seams)),
    ),
    hostedNotFoundRoute,
  );
}
