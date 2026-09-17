import type { Cause } from "effect";
import { Effect, Option } from "effect";
import { isRecord, text, type UnparsedWireValue } from "../core.js";

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
  return userIdForAuthorization(request.headers.get("authorization"), userInfo);
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
