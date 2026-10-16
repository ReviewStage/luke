import { ownFailedRunsLiveStatement } from "@luke/database/models/automation-store";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountInboxLiveStatements } from "../inbox/inbox-store.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { LiveSealing } from "./realtime.js";

/**
 * live-app.ts -- the reads the desktop follows over Neon Realtime, sealed for the account the bearer names.
 *
 * `GET /api/live/inbox` answers what waits on the developer across the
 * account as sealed statements, one per part of the account inbox's answer,
 * and the address to subscribe at (`live-wire.ts`). It is Neon's "Exposing
 * an endpoint" step: the bearer is resolved first, each statement is built
 * with that account's id in it, as its held read's is, and sealed, so a
 * subscription reads that account's rows and no other's, and stays bound to
 * the same rule of who may read them as the rows change. A deployment with
 * no Realtime answers `unavailable`, and the desktop holds its read open as
 * it did before. Nothing here reads a row: the store is read by Realtime.
 */

const HTTP_METHOD = { GET: "GET" } as const;

export interface LiveAppSeams {
  resolveUserId: UserIdResolver;
}

const accountInboxLiveEndpoint = /* @__PURE__ */ Effect.fn("web/accountInboxLiveEndpoint")(
  function* (
    seams: LiveAppSeams,
  ): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    HttpServerRequest.HttpServerRequest
  > {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (incoming.method !== HTTP_METHOD.GET) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const account = yield* seams.resolveUserId(request);
    if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    const sealing = yield* LiveSealing;
    const statements = Option.zipWith(
      accountInboxLiveStatements(account.value),
      ownFailedRunsLiveStatement(account.value),
      (parts, failedRuns) => ({ ...parts, failedRuns }),
    );
    if (Option.isNone(sealing) || Option.isNone(statements)) {
      return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    }
    const { seal, url } = sealing.value;
    const queries = yield* Effect.all({
      items: seal(statements.value.items),
      planless: seal(statements.value.planless),
      plans: seal(statements.value.plans),
      automations: seal(statements.value.automations),
      failedRuns: seal(statements.value.failedRuns),
    }).pipe(Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { url, queries });
  },
);

/** The group: each live read's path, and the hosted vocabulary's own refusal for any other. */
export function liveApp(seams: LiveAppSeams): WebRoutes<never> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.LIVE_INBOX,
      hostedRefusing(accountInboxLiveEndpoint(seams)),
    ),
    hostedNotFoundRoute,
  );
}
