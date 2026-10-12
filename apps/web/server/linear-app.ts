/**
 * linear-app.ts -- the Linear group: an account's connection read, begun, ended, and settled.
 *
 * Three endpoints the signed-in desktop calls with its bearer, and one
 * browser navigation that carries none:
 *
 * - `GET /api/account/linear` answers where the account's connection stands.
 *   A sign-in still under way is settled here too, by asking Connect for a
 *   token afresh, so a desktop that reads again after the browser closed
 *   learns the outcome whatever address the browser was returned to.
 * - `POST /api/account/linear/connect` asks Vercel Connect to begin a browser
 *   sign-in for the account, records the sign-in's one-time state, and
 *   answers the address the desktop opens.
 * - `POST /api/account/linear/disconnect` deletes the account's row before
 *   anything else, which is what stops every agent's next token read, then
 *   asks Connect to revoke the grant; a revoke that fails is logged, and the
 *   account is disconnected all the same.
 * - `GET /api/account/linear/connected` is where Connect returns the browser:
 *   the sign-in's state names the account, Connect is asked for a token
 *   afresh, and the browser is sent on to the landing page with one word.
 *
 * Root AGENTS.md pins that no credential travels in an answer: what each
 * endpoint answers is a status word or the sign-in address, never a token.
 * The sign-in address is not logged either, since it begins a grant for
 * the account it was issued for.
 */

import { randomBytes } from "node:crypto";
import {
  HOSTED_SERVICE_PATH,
  LINEAR_LANDING_STATUS,
  LINEAR_STATUS,
  type LinearLandingStatus,
  type LinearStatus,
  linearLandingPath,
} from "@sidecar/hosted";
import { Effect, Layer, Option, Result } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedMethod,
  hostedNotFoundRoute,
  hostedRefusalResponse,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "./hosted/http-effect.js";
import { LINEAR_CONNECT_FAILURE, LinearConnect } from "./hosted/linear-connect.js";
import {
  LINEAR_ROW_STATUS,
  type LinearConnectionRow,
  type LinearStoreEffect,
} from "./hosted/linear-store.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/** How long a sign-in may stay under way before its state no longer settles it: Connect's own requests last about as long. */
export const LINEAR_SIGN_IN_WINDOW_MS = 15 * 60 * 1000;

/** The query Connect returns the browser with, which is the one Luke put on the callback. */
const CALLBACK_QUERY = { STATE: "state" } as const;

/** A sign-in's state as one is minted: 32 random bytes, url-safe. */
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const STATE_BYTES = 32;

const HTTP_METHOD = { GET: "GET", POST: "POST" } as const;

/** A browser is sent on with 303, so whatever Connect sends becomes the GET the page is. */
const SEE_OTHER = 303;

export interface LinearAppSeams {
  resolveUserId: UserIdResolver;
  readConnection: (userId: string) => LinearStoreEffect<LinearConnectionRow | undefined>;
  readSignIn: (state: string) => LinearStoreEffect<LinearConnectionRow | undefined>;
  beginSignIn: (userId: string, state: string) => LinearStoreEffect<void>;
  completeSignIn: (userId: string) => LinearStoreEffect<boolean>;
  deleteConnection: (userId: string) => LinearStoreEffect<void>;
  /** A fresh sign-in state; random in production, fixed in a test. */
  mintState: () => string;
  /** Now, in milliseconds since the epoch. */
  now: () => number;
}

/** A sign-in state as production mints it. */
export function mintLinearState(): string {
  return randomBytes(STATE_BYTES).toString("base64url");
}

/** The bearer resolved against the deployment's own account store, or the invalid-token refusal. */
const resolvedUserId = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: LinearAppSeams,
): Effect.fn.Return<string, HostedRefusal, HttpServerRequest.HttpServerRequest> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return account.value;
});

/** Whether a sign-in begun at this instant may still settle. */
function signInStands(seams: LinearAppSeams, issuedAt: Date | undefined): boolean {
  return issuedAt !== undefined && seams.now() - issuedAt.getTime() <= LINEAR_SIGN_IN_WINDOW_MS;
}

/**
 * Asks Connect afresh whether the account now holds a grant, and records it
 * connected where it does; answers whether it does. Connect's own refusal
 * and an outage alike answer no: a sign-in not yet finished reads the same
 * as one Connect could not be asked about, and the next read asks again.
 */
const settledSignIn = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: LinearAppSeams,
  userId: string,
): Effect.fn.Return<boolean, HostedRefusal, SqlClient.SqlClient | LinearConnect> {
  const connect = yield* LinearConnect;
  const issued = yield* Effect.result(connect.token(userId, { fresh: true }));
  if (Result.isFailure(issued)) {
    if (issued.failure.reason !== LINEAR_CONNECT_FAILURE.NOT_AUTHORIZED) {
      yield* Effect.logWarning(
        "Vercel Connect could not settle a Linear sign-in",
        issued.failure.message,
      );
    }
    return false;
  }
  return yield* hostedStoreOrUnavailable(seams.completeSignIn(userId));
});

/** The status a stored row stands for, settling a sign-in still under way. */
const standingStatus = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: LinearAppSeams,
  row: LinearConnectionRow | undefined,
): Effect.fn.Return<LinearStatus, HostedRefusal, SqlClient.SqlClient | LinearConnect> {
  if (row === undefined) return LINEAR_STATUS.DISCONNECTED;
  if (row.status === LINEAR_ROW_STATUS.CONNECTED) return LINEAR_STATUS.CONNECTED;
  const underWay = signInStands(seams, row.stateIssuedAt);
  if (underWay && (yield* settledSignIn(seams, row.userId))) return LINEAR_STATUS.CONNECTED;
  if (row.status === LINEAR_ROW_STATUS.EXPIRED) return LINEAR_STATUS.EXPIRED;
  // A first sign-in that ran out of time never connected anything.
  return underWay ? LINEAR_STATUS.PENDING : LINEAR_STATUS.DISCONNECTED;
});

/** GET: where the caller's connection stands. */
const statusEndpoint = /* @__PURE__ */ Effect.fn("web/linearStatusEndpoint")(function* (
  seams: LinearAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | SqlClient.SqlClient | LinearConnect
> {
  yield* hostedMethod(HTTP_METHOD.GET);
  const userId = yield* resolvedUserId(seams);
  const connect = yield* LinearConnect;
  if (!connect.configured) {
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { status: LINEAR_STATUS.UNAVAILABLE });
  }
  const row = yield* hostedStoreOrUnavailable(seams.readConnection(userId));
  const status = yield* standingStatus(seams, row);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { status });
});

/** The callback Connect returns the browser to, on the host the desktop asked through. */
function callbackUrl(requestUrl: string, state: string): string {
  const url = new URL(HOSTED_SERVICE_PATH.ACCOUNT_LINEAR_CONNECTED, requestUrl);
  url.searchParams.set(CALLBACK_QUERY.STATE, state);
  return url.toString();
}

/**
 * POST: begins a browser sign-in. Connect is asked first, so a sign-in it
 * refused leaves the row as it stood; the state is recorded before the
 * address is answered, so no browser can return before the callback can
 * read it.
 */
const connectEndpoint = /* @__PURE__ */ Effect.fn("web/linearConnectEndpoint")(function* (
  seams: LinearAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | SqlClient.SqlClient | LinearConnect
> {
  yield* hostedMethod(HTTP_METHOD.POST);
  const userId = yield* resolvedUserId(seams);
  const connect = yield* LinearConnect;
  if (!connect.configured) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const state = seams.mintState();
  const url = yield* connect.authorize(userId, callbackUrl(request.url, state)).pipe(
    Effect.tapError((failure) =>
      Effect.logWarning("Vercel Connect could not begin a Linear sign-in", failure.message),
    ),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );
  yield* hostedStoreOrUnavailable(seams.beginSignIn(userId, state));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { url });
});

/**
 * POST: ends the connection. The row goes first, so whatever Connect
 * answers, no agent reads a token again; the revoke after it is the
 * courtesy of telling Linear, and a failed one is logged rather than
 * answered, since the account asked to be disconnected and is.
 */
const disconnectEndpoint = /* @__PURE__ */ Effect.fn("web/linearDisconnectEndpoint")(function* (
  seams: LinearAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | SqlClient.SqlClient | LinearConnect
> {
  yield* hostedMethod(HTTP_METHOD.POST);
  const userId = yield* resolvedUserId(seams);
  yield* hostedStoreOrUnavailable(seams.deleteConnection(userId));
  const connect = yield* LinearConnect;
  if (connect.configured) {
    yield* connect
      .revoke(userId)
      .pipe(
        Effect.catch((failure) =>
          Effect.logWarning("Vercel Connect could not revoke a Linear grant", failure.message),
        ),
      );
  }
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { status: LINEAR_STATUS.DISCONNECTED });
});

function landing(status: LinearLandingStatus): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.redirect(linearLandingPath(status), { status: SEE_OTHER });
}

/** How the sign-in the browser returned from settled. */
const callbackStatus = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: LinearAppSeams,
  state: string | null,
): Effect.fn.Return<LinearLandingStatus, HostedRefusal, SqlClient.SqlClient | LinearConnect> {
  if (state === null || !STATE_PATTERN.test(state)) return LINEAR_LANDING_STATUS.EXPIRED;
  const row = yield* hostedStoreOrUnavailable(seams.readSignIn(state));
  if (row === undefined || !signInStands(seams, row.stateIssuedAt)) {
    return LINEAR_LANDING_STATUS.EXPIRED;
  }
  const connect = yield* LinearConnect;
  const issued = yield* Effect.result(connect.token(row.userId, { fresh: true }));
  if (Result.isFailure(issued)) {
    if (issued.failure.reason === LINEAR_CONNECT_FAILURE.NOT_AUTHORIZED) {
      return LINEAR_LANDING_STATUS.NOT_COMPLETED;
    }
    yield* Effect.logWarning(
      "Vercel Connect could not settle a Linear sign-in",
      issued.failure.message,
    );
    return LINEAR_LANDING_STATUS.UNAVAILABLE;
  }
  const completed = yield* hostedStoreOrUnavailable(seams.completeSignIn(row.userId));
  // A Disconnect pressed while the browser was away wins: the account stays disconnected.
  return completed ? LINEAR_LANDING_STATUS.CONNECTED : LINEAR_LANDING_STATUS.NOT_COMPLETED;
});

/** GET: Connect's return. Whatever it brought, the browser lands on the page with a word. */
const connectedEndpoint = /* @__PURE__ */ Effect.fn("web/linearConnectedEndpoint")(function* (
  seams: LinearAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest | SqlClient.SqlClient | LinearConnect
> {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const query = new URL(request.url, "https://localhost").searchParams;
  const status = yield* callbackStatus(seams, query.get(CALLBACK_QUERY.STATE)).pipe(
    Effect.catch(() => Effect.succeed(LINEAR_LANDING_STATUS.UNAVAILABLE)),
  );
  return landing(status);
});

/** An endpoint's refusal carried back onto the answer channel, as the account group does. */
function refusing<R>(
  endpoint: Effect.Effect<HttpServerResponse.HttpServerResponse, HostedRefusal, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> {
  return Effect.catch(endpoint, (refusal) => Effect.succeed(hostedRefusalResponse(refusal)));
}

/** The group: the four paths, and the hosted vocabulary's own refusal for any other. */
export function linearApp(seams: LinearAppSeams): WebRoutes<SqlClient.SqlClient | LinearConnect> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, HOSTED_SERVICE_PATH.ACCOUNT_LINEAR, refusing(statusEndpoint(seams))),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.ACCOUNT_LINEAR_CONNECT,
      refusing(connectEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.ACCOUNT_LINEAR_DISCONNECT,
      refusing(disconnectEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.ACCOUNT_LINEAR_CONNECTED,
      connectedEndpoint(seams),
    ),
    hostedNotFoundRoute,
  );
}
