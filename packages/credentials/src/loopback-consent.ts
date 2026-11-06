import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { SIGN_IN_FAILURE } from "@repo/features/words";
import { Deferred, Duration, Effect, Exit, Option, Result, type Scope, Semaphore } from "effect";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as NetAddress from "effect/net/NetAddress";
import {
  LOOPBACK_CONSENT_CANCELED,
  type LoopbackConsent,
  type LoopbackConsentCard,
  type LoopbackConsentOptions,
  type LoopbackConsentOutcome,
} from "./consent.js";
import { accountLoopbackPage, LOOPBACK_PAGE_TONE, type LoopbackPageTone } from "./loopback-page.js";
import { codeChallenge, createCodeVerifier } from "./pkce.js";

const LOOPBACK_HOST = "127.0.0.1";

const EPHEMERAL_PORT = 0;

const DEFAULT_TIMEOUT_MS = 180_000;

const ARRIVAL_GRACE_MS = 1_000;

const SHARED_REASON = {
  UNAVAILABLE: "Could not open a sign-in callback on this machine.",
  ALREADY_WAITING: "A sign-in is already waiting in your browser.",
  BROWSER: "Could not open the sign-in page in your browser.",
  CHALLENGE: "Could not prepare a secure sign-in on this machine.",
  OFFLINE: "This machine is offline.",
} as const;

const ALREADY_USED_CARD = {
  badge: "Already used",
  title: "This sign-in has already been used",
  body: `You can close this tab and return to ${PRODUCT_NAME}.`,
} as const;

const RESPONSE_STATUS = {
  ANSWERED: 200,
  SEE_OTHER: 303,
  NOT_FOUND: 404,
  ALREADY_USED: 409,
} as const;

const CARD_CONTENT_TYPE = "text/html; charset=utf-8";

const NOT_FOUND = HttpServerResponse.text("Not found", {
  status: RESPONSE_STATUS.NOT_FOUND,
});

function loopbackState(prefix: string | undefined): string {
  const random = randomBytes(32).toString("base64url");
  return prefix ? `${prefix}.${random}` : random;
}

function parameter(
  parameters: Readonly<Record<string, string | Array<string>>>,
  name: string,
): string | undefined {
  const value = parameters[name];
  return Array.isArray(value) ? value[0] : value;
}

const serveConsent = /* @__PURE__ */ Effect.fnUntraced(function* (
  app: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    never,
    HttpServerRequest.HttpServerRequest | Scope.Scope
  >,
  ports: readonly number[],
  onRequest: () => void,
): Effect.fn.Return<number | undefined, never, Scope.Scope> {
  for (const port of ports) {
    const node = yield* Effect.sync(() => createServer());
    const bound = yield* Effect.result(
      NodeHttpServer.make(() => node, { port, host: LOOPBACK_HOST }),
    );
    if (Result.isFailure(bound)) continue;
    const server = bound.success;
    yield* Effect.provideService(HttpServer.serveEffect(app), HttpServer.HttpServer, server);
    yield* Effect.sync(() => node.on("request", onRequest));
    yield* Effect.addFinalizer(() => Effect.sync(() => node.closeAllConnections()));
    return NetAddress.isInetAddress(server.address) ? server.address.port : undefined;
  }
  return undefined;
});

export function loopbackConsent<Grant extends object>(
  options: LoopbackConsentOptions<Grant>,
): LoopbackConsent<Grant> {
  const standing = Semaphore.makeUnsafe(1);
  let abandon: (() => void) | undefined;
  let reopenPage: (() => void) | undefined;

  function card(
    status: number,
    tone: LoopbackPageTone,
    page: LoopbackConsentCard,
  ): HttpServerResponse.HttpServerResponse {
    return HttpServerResponse.text(accountLoopbackPage({ tone, ...page, source: options.source }), {
      status,
      contentType: CARD_CONTENT_TYPE,
    });
  }

  const trip = /* @__PURE__ */ Effect.fnUntraced(function* (): Effect.fn.Return<
    LoopbackConsentOutcome<Grant>,
    never,
    Scope.Scope
  > {
    if (options.isOnline?.() === false) {
      return { reason: SHARED_REASON.OFFLINE, failure: SIGN_IN_FAILURE.OFFLINE };
    }
    const codeVerifier = createCodeVerifier();
    const state = loopbackState(options.statePrefix);
    const settled = yield* Deferred.make<LoopbackConsentOutcome<Grant>>();
    let redirectUri = "";
    let claimed = false;
    let arrived = false;
    let withdrawn = false;
    abandon = () => {
      if (claimed) return;
      withdrawn = true;
      Deferred.doneUnsafe(
        settled,
        Exit.succeed<LoopbackConsentOutcome<Grant>>({ reason: LOOPBACK_CONSENT_CANCELED }),
      );
    };

    const callback = /* @__PURE__ */ Effect.fnUntraced(function* (
      parameters: Readonly<Record<string, string | Array<string>>>,
    ) {
      if (parameter(parameters, "state") !== state) return NOT_FOUND;
      if (claimed) {
        return card(RESPONSE_STATUS.ALREADY_USED, LOOPBACK_PAGE_TONE.COMPLETE, ALREADY_USED_CARD);
      }
      claimed = true;
      let outcome: LoopbackConsentOutcome<Grant> = {
        reason: options.reasons.refused,
        failure: SIGN_IN_FAILURE.REFUSED,
      };
      yield* Effect.addFinalizer(() => Deferred.succeed(settled, outcome));
      const refused = parameter(parameters, "error");
      const code = parameter(parameters, "code");
      if (!refused && code) {
        outcome = yield* options.exchange({
          code,
          state,
          redirectUri,
          codeVerifier,
          clientId: parameter(parameters, "client_id"),
        });
      }
      const granted = !("reason" in outcome);
      const next =
        "reason" in outcome || !options.continueTo ? undefined : yield* options.continueTo(outcome);
      if (next !== undefined) {
        return HttpServerResponse.redirect(next, { status: RESPONSE_STATUS.SEE_OTHER });
      }
      return card(
        RESPONSE_STATUS.ANSWERED,
        granted ? LOOPBACK_PAGE_TONE.COMPLETE : LOOPBACK_PAGE_TONE.ATTENTION,
        granted ? options.pages.granted : options.pages.notGranted,
      );
    });

    const app = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = HttpServerRequest.toURL(request);
      if (Option.isNone(url) || url.value.pathname !== options.callbackPath) return NOT_FOUND;
      return yield* callback(HttpServerRequest.searchParamsFromURL(url.value));
    });
    const port = yield* serveConsent(app, options.ports ?? [EPHEMERAL_PORT], () => {
      arrived = true;
    });
    if (port === undefined) return { reason: SHARED_REASON.UNAVAILABLE };
    redirectUri = `http://${LOOPBACK_HOST}:${port}${options.callbackPath}`;
    const challenge = yield* Effect.result(codeChallenge(codeVerifier));
    if (Result.isFailure(challenge)) {
      return { reason: withdrawn ? LOOPBACK_CONSENT_CANCELED : SHARED_REASON.CHALLENGE };
    }

    yield* Effect.yieldNow;
    if (withdrawn) return { reason: LOOPBACK_CONSENT_CANCELED };

    const authorizationUrl = options.authorizationUrl({
      state,
      redirectUri,
      codeChallenge: challenge.success,
    });
    reopenPage = () => {
      void Promise.resolve(options.openExternal(authorizationUrl)).catch(() => undefined);
    };
    if (withdrawn) return { reason: LOOPBACK_CONSENT_CANCELED };
    const opened = yield* Effect.result(
      Effect.tryPromise(() => Promise.resolve(options.openExternal(authorizationUrl))),
    );
    if (Result.isFailure(opened)) {
      return { reason: SHARED_REASON.BROWSER, failure: SIGN_IN_FAILURE.BROWSER };
    }

    yield* Effect.forkScoped(
      Effect.sleep(Duration.millis(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            while (arrived && !claimed) {
              arrived = false;
              yield* Effect.sleep(Duration.millis(ARRIVAL_GRACE_MS));
            }
          }),
        ),
        Effect.flatMap(() =>
          claimed
            ? Effect.void
            : Deferred.succeed(settled, {
                reason: options.reasons.timedOut,
                failure: SIGN_IN_FAILURE.TIMED_OUT,
              }),
        ),
      ),
    );
    return yield* Deferred.await(settled);
  });

  function signInEffect(): Effect.Effect<LoopbackConsentOutcome<Grant>, never, Scope.Scope> {
    return Effect.map(
      standing.withPermitsIfAvailable(1)(
        Effect.ensuring(
          trip(),
          Effect.sync(() => {
            abandon = undefined;
            reopenPage = undefined;
          }),
        ),
      ),
      Option.getOrElse(
        (): LoopbackConsentOutcome<Grant> => ({
          reason: SHARED_REASON.ALREADY_WAITING,
          failure: SIGN_IN_FAILURE.ALREADY_WAITING,
        }),
      ),
    );
  }

  return {
    signInEffect,
    cancel(): void {
      abandon?.();
    },
    reopen(): void {
      reopenPage?.();
    },
  };
}
