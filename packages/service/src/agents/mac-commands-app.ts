import type { DatabaseServices } from "@luke/database/core/query";
import { markMacListening, settleMacCommand } from "@luke/database/models/mac-command-store";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import {
  macCommandClaimRequestSchema,
  macCommandSettleRequestSchema,
} from "@luke/features/mac-command-wire";
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
import { claimedMacCommand, macCommandsFor } from "./mac-command.js";

/**
 * mac-commands-app.ts -- the developer's Mac takes the shell commands the account's agents queued for it, and says what each did.
 *
 * `GET /api/mac-commands` is the Mac's held read: it counts the Mac
 * listening, and answers every command waiting for the account, claimed
 * for this Mac, as soon as one waits, or none once the hold ends
 * (`agents/mac-command.ts`). `POST` keeps one claimed command's result,
 * which the agent's call is looking for; a command the account does not
 * hold claimed and unsettled is not found.
 *
 * A Mac that follows the account's unclaimed commands over Neon Realtime
 * (`../live/live-app.ts`) reads nothing here: it claims each command it
 * hears of with `POST /api/mac-commands/claim`, answered with the command
 * or not found where another Mac took it first or it waited past the claim
 * window, and says it is listening with `POST /api/mac-commands/listening`
 * on a timer of its own, since its subscription writes nothing. Every request resolves the
 * bearer before it touches a row, and every row it touches is the
 * bearer's account's own.
 */

const HTTP_METHOD = { GET: "GET", POST: "POST" } as const;

/** Two outputs at their bound, and room for the rest of the body. */
const MAXIMUM_RESULT_BODY_BYTES = 256 * 1_024;
/** A claim's body: one id, and room to spare. */
const MAXIMUM_CLAIM_BODY_BYTES = 1_024;

export interface MacCommandsAppSeams {
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

/** The POST the Mac's live side takes, resolved to the bearer's account. */
const postingAccount = (seams: MacCommandsAppSeams) =>
  Effect.gen(function* () {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (incoming.method !== HTTP_METHOD.POST) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const account = yield* seams.resolveUserId(request);
    if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    return account.value;
  });

const macCommandClaimEndpoint = /* @__PURE__ */ Effect.fn("web/macCommandClaimEndpoint")(function* (
  seams: MacCommandsAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices
> {
  const userId = yield* postingAccount(seams);
  const body = yield* readJsonBodyEffect(MAXIMUM_CLAIM_BODY_BYTES);
  const asked = readEither(macCommandClaimRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const claimed = yield* hostedStoreOrUnavailable(claimedMacCommand(userId, asked.success.id));
  if (Option.isNone(claimed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { command: claimed.value });
});

const macListeningEndpoint = /* @__PURE__ */ Effect.fn("web/macListeningEndpoint")(function* (
  seams: MacCommandsAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices
> {
  const userId = yield* postingAccount(seams);
  yield* hostedStoreOrUnavailable(markMacListening(userId));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { listening: true });
});

/** The group: the held read and its results, the live side's claim and presence, and the hosted vocabulary's own refusal for any other path. */
export function macCommandsApp(seams: MacCommandsAppSeams): WebRoutes<DatabaseServices> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.MAC_COMMANDS,
      hostedRefusing(macCommandsEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.MAC_COMMAND_CLAIM,
      hostedRefusing(macCommandClaimEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.MAC_COMMANDS_LISTENING,
      hostedRefusing(macListeningEndpoint(seams)),
    ),
    hostedNotFoundRoute,
  );
}
