import type { DatabaseServices } from "@luke/database/core/query";
import { chatEnabledFor } from "@luke/database/models/account-store";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { CHAT_CURSOR_START, CHAT_QUERY, chatCursorSchema } from "@luke/features/chat-wire";
import { workspaceIdSchema } from "@luke/features/task-wire";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result, Schema } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { workspaceChatPast } from "./coder-host/chat-page.js";

/**
 * chat-app.ts -- a workspace's chat as the window reads it.
 *
 * `GET /api/workspaces/chat?workspaceId=&after=` answers what a person in
 * the workspace sees of its chat past the cursor, held open while nothing
 * moved (`hosted/coder-host/chat-page.ts`): the roster, the channels, the
 * messages posted or changed past the cursor, and the cursor to read on
 * from. The workspace is named in the query as the members read names it.
 * The bearer is resolved before any row is touched, and a workspace the
 * account is not in answers as one that names nothing, as does every
 * workspace for an account that has not turned on the Chat experiment
 * (`EXPERIMENT.CHAT`), which is off until it does.
 */

const HTTP_METHOD = { GET: "GET" } as const;

/** A cursor as the window hands it back: the next place in the workspace's sequence it has yet to read, in decimal. */
const seqCursorSchema = chatCursorSchema.check(Schema.isPattern(/^(0|[1-9][0-9]{0,14})$/u));

export interface ChatAppSeams {
  resolveUserId: UserIdResolver;
}

/** What the routes may require of the function that stands them. */
export type ChatAppServices = DatabaseServices;

type ChatServices = ChatAppServices | HttpServerRequest.HttpServerRequest;

/** The one value the query names under the name; none or two is refused. */
const queryOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
  name: string,
  absent?: string,
): Effect.fn.Return<string, HostedRefusal> {
  const named = new URL(request.url).searchParams.getAll(name);
  if (named.length === 0 && absent !== undefined) return absent;
  const [value] = named;
  if (value === undefined || named.length !== 1) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return value;
});

/** GET reads the workspace's chat past the cursor, held open while nothing moved. */
const chatReadEndpoint = /* @__PURE__ */ Effect.fn("web/chatReadEndpoint")(function* (
  seams: ChatAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, ChatServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const workspace = readEither(workspaceIdSchema)(
    unparsedWire(yield* queryOf(request, CHAT_QUERY.WORKSPACE_ID)),
  );
  const after = readEither(seqCursorSchema)(
    unparsedWire(yield* queryOf(request, CHAT_QUERY.AFTER, CHAT_CURSOR_START)),
  );
  if (Result.isFailure(workspace) || Result.isFailure(after)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  // Note that an account with Chat off is answered as one in no workspace, because Chat is an experiment it never turned on.
  if (!(yield* hostedStoreOrUnavailable(chatEnabledFor(account.value)))) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  const page = yield* hostedStoreOrUnavailable(
    workspaceChatPast(account.value, workspace.success, Number(after.success)),
  );
  if (Option.isNone(page)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, page.value);
});

/** The group: the chat's path, and the hosted vocabulary's own refusal for any other. */
export function chatApp(seams: ChatAppSeams): WebRoutes<ChatAppServices> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.WORKSPACES_CHAT,
      hostedRefusing(chatReadEndpoint(seams)),
    ),
    hostedNotFoundRoute,
  );
}
