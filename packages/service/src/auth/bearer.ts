import type { Cause } from "effect";
import { Effect, Option } from "effect";
import {
  isRecord,
  text,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "../core.js";
import { auth } from "./auth.js";
import { resolveBrowserSessionUserId } from "./browser-session.js";
import { CREDENTIAL_HEADER, sessionCredential } from "./session-credential.js";

/** The subject a signed-in OAuth userinfo answer names. */
export interface OAuthUserInfo {
  sub: string;
}

/**
 * The auth service's own userinfo endpoint, called in process. It is the same
 * validation the desktop's identity request goes through over HTTP: expiry,
 * revocation, and scope are all the OAuth provider's answer, never a second
 * implementation here. The call itself is the auth service's promise, so an
 * endpoint is built by wrapping that promise once where it is constructed,
 * and the failure it can answer with is whatever the auth service threw.
 */
export type UserInfoEndpoint = (input: {
  headers: Headers;
}) => Effect.Effect<OAuthUserInfo | undefined, Cause.UnknownError>;

/**
 * The auth service's own session read, called in process: the account the
 * Better Auth session cookie among `headers` names, or none where it names
 * none. As with `UserInfoEndpoint`, the failure it can answer with is
 * whatever the auth service threw.
 */
export type SessionEndpoint = (input: {
  headers: Headers;
}) => Effect.Effect<Option.Option<string>, Cause.UnknownError>;

/** Parses the auth service's raw userinfo answer at the hosted API boundary. */
export function oauthUserInfoFromAuthAnswer(value: UnparsedWireValue): OAuthUserInfo | undefined {
  if (!isRecord(value)) return undefined;
  const sub = text(value.sub);
  return sub ? { sub } : undefined;
}

/** Resolves the signed-in user behind a request's bearer token, on `UserIdResolver`'s terms. */
export function hostedUserId(
  request: Request,
  userInfo: UserInfoEndpoint,
): Effect.Effect<Option.Option<string>> {
  return userIdForAuthorization(request.headers.get(CREDENTIAL_HEADER.AUTHORIZATION), userInfo);
}

/**
 * The same resolution for an `Authorization` value that arrived somewhere
 * other than on its own request: the voice service forwards the header the
 * desktop opened its socket with, and it is read as if it had been sent here.
 */
export function userIdForAuthorization(
  value: string | null | undefined,
  userInfo: UserInfoEndpoint,
): Effect.Effect<Option.Option<string>> {
  const authorization = value?.trim();
  if (!authorization) return Effect.succeedNone;
  return userInfo({ headers: new Headers({ authorization }) }).pipe(
    Effect.map((identity) => Option.fromUndefinedOr(identity?.sub || undefined)),
    Effect.orElseSucceed(Option.none<string>),
  );
}

/**
 * Resolves the account a request names, on `UserIdResolver`'s terms: its
 * bearer where it carries an `Authorization` header at all, and the
 * browser's Better Auth session cookie only where it carries none.
 *
 * Note that an `Authorization` that does not verify resolves nobody rather
 * than falling to a cookie beside it, because Better Auth's bearer plugin
 * leaves the cookie in place under any `Authorization` it did not sign, so
 * a junk header would otherwise pass for the caller's own while the cookie's
 * session answered for it. The session is read from the cookie alone
 * (`session-credential.ts`, the rule every session read follows), so
 * nothing else the request carries names an account on that path, and a
 * failure of the auth service resolves nobody, as a bearer's does.
 */
export function requestUserId(
  request: Request,
  userInfo: UserInfoEndpoint,
  session: SessionEndpoint,
): Effect.Effect<Option.Option<string>> {
  if (request.headers.has(CREDENTIAL_HEADER.AUTHORIZATION)) return hostedUserId(request, userInfo);
  const cookie = sessionCredential(request.headers);
  if (cookie === undefined) return Effect.succeedNone;
  return session({ headers: cookie }).pipe(Effect.orElseSucceed(Option.none<string>));
}

/**
 * The auth service's own userinfo endpoint, read at the hosted API boundary.
 * The call is the auth service's promise, wrapped once here so the
 * resolution below is an effect a route yields rather than a promise each
 * route rewraps.
 */
export const hostedUserInfo: UserInfoEndpoint = (input) =>
  Effect.tryPromise(async () => {
    // SAFETY: Better Auth hands back its parsed userinfo answer as structured-clone data; the wire guards below validate the selected field.
    const answer = (await auth.api.oauth2UserInfo(input)) as WireBoundaryInput;
    return oauthUserInfoFromAuthAnswer(unparsedWire(answer));
  });

/**
 * The account a request names against the deployment's own account store,
 * the same for every hosted route that reads it on its own fiber: its
 * bearer, or with no `Authorization` at all, the browser's session cookie
 * (`requestUserId`). A state-changing request that carries a cookie is held
 * to the deployment's own pages before any route reads it
 * (`http/origin-guard.ts`).
 */
export function resolveHostedUserId(request: Request): Effect.Effect<Option.Option<string>> {
  return requestUserId(request, hostedUserInfo, resolveBrowserSessionUserId);
}

/**
 * The bearer alone, against the same store, for a route that acts for the
 * one device that asks rather than for the account, where a browser's
 * session must never stand in: the Mac's held read claims every command its
 * account's agents queued for itself (`agents/mac-commands-app.ts`).
 */
export function resolveHostedBearerUserId(request: Request): Effect.Effect<Option.Option<string>> {
  return hostedUserId(request, hostedUserInfo);
}
