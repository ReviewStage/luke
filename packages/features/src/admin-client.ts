/**
 * admin-client.ts -- the admin dashboard's reads and its one star write, asked of the service by the app's host under the account's session.
 *
 * The admin gate takes a Better Auth session, never the Mac's OAuth token
 * (`@luke/service/admin/admin-access`), so every call here goes under the
 * session credential: the Mac's signed session bearer, asked for again once
 * where none is held (`sendInSession`), and a browser tab's own cookie.
 *
 * A read answers the service's answer as it came, the page's shape for the
 * procedure it named, or the word a screen tells its refusal apart by, read
 * off the status: the gate's two refusals, a detail read whose account is
 * gone, and the service not answering. Anything else, a status the admin
 * routes do not document or a body that is no JSON, is unanswered, which a
 * screen words as its own failure.
 */

import { HTTP_METHOD } from "@luke/wire";
import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  accountCall,
  CALL_FAULT,
  type CallAnswer,
  type CallCredential,
  callAnswered,
  sendInSession,
} from "./account-call.js";
import {
  ADMIN_HTTP_STATUS,
  ADMIN_READ_PATH,
  ADMIN_REFUSED,
  ADMIN_ROUTE_PATH,
  ADMIN_UNANSWERED,
  ADMIN_USER_ID_PARAM,
  type AdminReadAnswer,
  type AdminReadParams,
  type AdminRefused,
} from "./admin-wire.js";

interface HostedAdminClientOptions {
  serviceBaseUrl: string;
  /** The account's session: the Mac's signed session bearer, or a browser tab's cookie. */
  sessionCredential: CallCredential;
  requestTimeoutMs?: number | undefined;
}

/** The word a screen tells a refusal apart by, from the status the admin routes answer it under. */
const REFUSED_BY_STATUS: ReadonlyMap<number, AdminRefused> = new Map([
  [ADMIN_HTTP_STATUS.UNAUTHORIZED, ADMIN_REFUSED.SIGNED_OUT],
  [ADMIN_HTTP_STATUS.FORBIDDEN, ADMIN_REFUSED.FORBIDDEN],
  [ADMIN_HTTP_STATUS.NOT_FOUND, ADMIN_REFUSED.MISSING],
  [ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE, ADMIN_REFUSED.UNAVAILABLE],
]);

/** A path under the service with its query parameters, the way the admin routes read them. */
function withQuery(path: string, query: Readonly<Record<string, string>>): string {
  const parameters = new URLSearchParams(query).toString();
  return parameters ? `${path}?${parameters}` : path;
}

/**
 * Why a call that reached no answer has none: no session the account could
 * be asked for, or another account's standing by the time it was renewed,
 * is a sign-in to ask for; a network that dropped is the service not
 * answering.
 */
function faultRefused(answer: Exclude<CallAnswer, { response: Response }>): AdminReadAnswer {
  return answer.fault === CALL_FAULT.NETWORK
    ? { refused: ADMIN_REFUSED.UNAVAILABLE }
    : { refused: ADMIN_REFUSED.SIGNED_OUT };
}

/** A body read as JSON, or nothing where it is not JSON at all. */
function jsonOf(response: Response): Effect.Effect<{ readonly json: unknown } | undefined> {
  return Effect.promise(() =>
    response.json().then(
      (json: unknown) => ({ json }),
      () => undefined,
    ),
  );
}

export class HostedAdminClient {
  readonly #send: ReturnType<typeof sendInSession>;

  constructor(options: HostedAdminClientOptions) {
    const call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: options.sessionCredential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#send = sendInSession(call, options.sessionCredential);
  }

  /** One admin read: the service's answer as it came, or why there is none. */
  read(params: AdminReadParams): Effect.Effect<AdminReadAnswer, never, HttpClient.HttpClient> {
    const send = this.#send;
    return Effect.gen(function* () {
      const answer = yield* send({
        method: HTTP_METHOD.GET,
        path: withQuery(ADMIN_READ_PATH[params.procedure], params.query),
      });
      if (!callAnswered(answer)) return faultRefused(answer);
      const { response } = answer;
      if (response.redirected) return { refused: ADMIN_REFUSED.INTERCEPTED };
      if (!response.ok)
        return { refused: REFUSED_BY_STATUS.get(response.status) ?? ADMIN_UNANSWERED };
      const body = yield* jsonOf(response);
      return body === undefined ? { refused: ADMIN_UNANSWERED } : { answer: body.json };
    });
  }

  /** The star set or taken back on one account, for the viewing admin alone; whether it landed. */
  favorite(id: string, favorite: boolean): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    const send = this.#send;
    return Effect.map(
      send({
        method: favorite ? HTTP_METHOD.PUT : HTTP_METHOD.DELETE,
        path: withQuery(ADMIN_ROUTE_PATH.FAVORITE, { [ADMIN_USER_ID_PARAM]: id }),
      }),
      (answer) => callAnswered(answer) && answer.response.ok,
    );
  }
}
