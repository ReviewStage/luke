import type { DatabaseServices } from "@luke/database/core/query";
import { settleMacCommand } from "@luke/database/models/mac-command-store";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { macCommandSettleRequestSchema } from "@luke/features/mac-command-wire";
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
import { macCommandsFor } from "./mac-command.js";

/**
 * mac-commands-app.ts -- the developer's Mac takes the shell commands the account's agents queued for it, and says what each did.
 *
 * `GET /api/mac-commands` is the Mac's held read: it counts the Mac
 * listening, and answers every command waiting for the account, claimed
 * for this Mac, as soon as one waits, or none once the hold ends
 * (`agents/mac-command.ts`). `POST` keeps one claimed command's result,
 * which the agent's call is looking for; a command the account does not
 * hold claimed and unsettled is not found. Every request resolves the
 * bearer before it touches a row, and every row it touches is the
 * bearer's account's own.
 */

const HTTP_METHOD = { GET: "GET", POST: "POST" } as const;

/** Two outputs at their bound, and room for the rest of the body. */
const MAXIMUM_RESULT_BODY_BYTES = 256 * 1_024;

export interface MacCommandsAppSeams {
  /**
   * The Mac's bearer alone, never a browser's session cookie
   * (`auth/bearer.ts`'s `resolveHostedBearerUserId`): a held read claims
   * every waiting command for the Mac that asks, and a result is the word
   * of the Mac that ran its command, so no page may stand in for either.
   */
  resolveUserId: UserIdResolver;
}

const macCommandsEndpoint = /* @__PURE__ */ Effect.fn("web/macCommandsEndpoint")(function* (
  seams: MacCommandsAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices
> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET && incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const userId = account.value;
  if (incoming.method === HTTP_METHOD.GET) {
    const commands = yield* hostedStoreOrUnavailable(macCommandsFor(userId));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { commands });
  }
  const body = yield* readJsonBodyEffect(MAXIMUM_RESULT_BODY_BYTES);
  const asked = readEither(macCommandSettleRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { id, result } = asked.success;
  const settled = yield* hostedStoreOrUnavailable(settleMacCommand(userId, id, result));
  if (!settled) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { settled: true });
});

/** The group: the one path, and the hosted vocabulary's own refusal for any other. */
export function macCommandsApp(seams: MacCommandsAppSeams): WebRoutes<DatabaseServices> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.MAC_COMMANDS,
      hostedRefusing(macCommandsEndpoint(seams)),
    ),
    hostedNotFoundRoute,
  );
}
