import type { DatabaseServices } from "@luke/database/core/query";
import { readWorkspacePhoto } from "@luke/database/models/workspace-store";
import { workspaceIdSchema } from "@luke/features/task-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
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
  type UserIdResolver,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";

/**
 * workspaces-app.ts -- a workspace's photo, served as its bytes.
 *
 * `GET /api/workspaces/<id>/photo` serves a workspace's photo as its bytes
 * to a member of it; the list names only which version of it stands. The
 * bearer is resolved before any row is touched. Everything else a
 * workspace answers is the hosted oRPC router's: the list, a workspace
 * created, renamed, given a photo, or handed over, and its members read,
 * removed, given a role, or left (`workspaces-procedures.ts`); its GitHub
 * (`workspace-github-procedures.ts`); and its invitations
 * (`workspace-invitations-procedures.ts`).
 */

/** GET serves a workspace's photo; the rewrite moves the path's workspace id into the `id` query. */
const PHOTO_PATH = "/api/workspaces/photo";

/** The query the photo's rewrite names its workspace under. */
const PHOTO_QUERY = { ID: "id" } as const;

const HTTP_METHOD_GET = "GET";

export interface WorkspacesAppSeams {
  resolveUserId: UserIdResolver;
}

/** The bearer's account, or the request refused as unauthenticated. */
const accountOf = Effect.fn("web/workspacesAccount")(function* (seams: WorkspacesAppSeams) {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return account.value;
});

/**
 * GET: a workspace's photo as its bytes under its media type, to a member
 * of it alone. A workspace the account is not in, an id that names none,
 * and one with no photo are all not found, so a non-member learns nothing.
 */
const photoEndpoint = Effect.fn("web/workspacePhotoEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices
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

/** The group: the photo's bytes, and the hosted vocabulary's own refusal for any other path. */
export function workspacesApp(seams: WorkspacesAppSeams): WebRoutes<DatabaseServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, PHOTO_PATH, hostedRefusing(photoEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
