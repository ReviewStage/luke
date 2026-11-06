import type { DatabaseServices } from "@repo/database/core/query";
import { readWorkspacePhoto } from "@repo/database/models/workspace-store";
import { workspaceIdSchema } from "@repo/features/task-wire";
import { readEither } from "@repo/wire/effect";
import { Effect, Layer, Option, Result, type Scope } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { unparsedWire } from "../core.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_BYTES_HEADERS,
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  resolvedUserId,
  type UserIdResolver,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";

const PHOTO_PATH = "/api/workspaces/photo";

const PHOTO_QUERY = { ID: "id" } as const;

const HTTP_METHOD_GET = "GET";

export interface WorkspacesAppSeams {
  resolveUserId: UserIdResolver;
}

const accountOf = Effect.fn("web/workspacesAccount")(function* (seams: WorkspacesAppSeams) {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  return yield* resolvedUserId(seams, request);
});

const photoEndpoint = Effect.fn("web/workspacePhotoEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices | Scope.Scope
> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD_GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const userId = yield* accountOf(seams);
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const named = new URL(request.url).searchParams.getAll(PHOTO_QUERY.ID);
  const asked = readEither(workspaceIdSchema)(unparsedWire(named[0]));
  if (named.length !== 1 || Result.isFailure(asked)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  const photo = yield* hostedStoreOrUnavailable(readWorkspacePhoto(userId, asked.success));
  if (Option.isNone(photo)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return HttpServerResponse.uint8Array(photo.value.bytes, {
    status: HOSTED_HTTP_STATUS.OK,
    contentType: photo.value.contentType,
    headers: HOSTED_BYTES_HEADERS,
  });
});

export function workspacesApp(seams: WorkspacesAppSeams): WebRoutes<DatabaseServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, PHOTO_PATH, hostedRefusing(photoEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
