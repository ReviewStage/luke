import type { DatabaseServices } from "@luke/database/core/query";
import { readAttachment } from "@luke/database/models/chat-store";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { CHAT_ATTACHMENT_QUERY } from "@luke/features/chat-wire";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { wireUuidSchema } from "../core.js";
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
import { chatAccount, workspaceOf } from "./workspace-chat.js";

/**
 * chat-attachment-app.ts -- one picture a workspace's chat message carries, served as its bytes.
 *
 * `GET /api/workspaces/chat/attachment?workspaceId=&messageId=&attachmentId=`
 * answers the picture a message's image block names, under the type its
 * bytes were sniffed to be as the post kept them (`workspace-chat.ts`),
 * not to be sniffed, cached, or run as a page, as an inbox item's picture
 * is. The bearer is resolved before any row is touched; a person in the
 * workspace reads it, and anyone else, an account that has not turned on
 * the Chat experiment among them, finds nothing there.
 */

const HTTP_METHOD = { GET: "GET" } as const;

export interface ChatAttachmentAppSeams {
  resolveUserId: UserIdResolver;
}

/** The one value the query names under the name; nothing where it names none, or two. */
function queryOf(request: Request, name: string): string | undefined {
  const named = new URL(request.url).searchParams.getAll(name);
  return named.length === 1 ? named[0] : undefined;
}

/** The id the query names under the name, refused where it names none, two, or one that is no id. */
const idOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
  name: string,
): Effect.fn.Return<string, HostedRefusal> {
  const id = readEither(wireUuidSchema)(unparsedWire(queryOf(request, name) ?? ""));
  if (Result.isFailure(id)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return id.success;
});

/**
 * GET serves one picture a message carries, by the attachment its image
 * block names, as its bytes under the type they were sniffed to be, to a
 * person in the workspace; not found for anyone else, and for a message
 * that carries no such picture.
 */
const attachmentEndpoint = /* @__PURE__ */ Effect.fn("web/chatAttachmentEndpoint")(function* (
  seams: ChatAttachmentAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  DatabaseServices | HttpServerRequest.HttpServerRequest
> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const workspace = yield* workspaceOf(queryOf(request, CHAT_ATTACHMENT_QUERY.WORKSPACE_ID));
  const messageId = yield* idOf(request, CHAT_ATTACHMENT_QUERY.MESSAGE_ID);
  const attachmentId = yield* idOf(request, CHAT_ATTACHMENT_QUERY.ATTACHMENT_ID);
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const userId = yield* chatAccount(account.value);
  const found = yield* hostedStoreOrUnavailable(
    readAttachment(userId, workspace, messageId, attachmentId),
  );
  if (Option.isNone(found)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return HttpServerResponse.uint8Array(found.value.bytes, {
    status: HOSTED_HTTP_STATUS.OK,
    contentType: found.value.contentType,
    headers: HOSTED_BYTES_HEADERS,
  });
});

/** The group: the picture's path, and the hosted vocabulary's own refusal for any other. */
export function chatAttachmentApp(seams: ChatAttachmentAppSeams): WebRoutes<DatabaseServices> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.WORKSPACES_CHAT_ATTACHMENT,
      hostedRefusing(attachmentEndpoint(seams)),
    ),
    hostedNotFoundRoute,
  );
}
