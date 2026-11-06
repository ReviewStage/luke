import { isAPIError } from "better-auth/api";
import type { Cause } from "effect";
import { Effect, Option } from "effect";
import {
  isRecord,
  text,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "../core.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import type { RelayCredential } from "../http/relay-upgrade.js";
import { auth } from "./auth.js";
import { BearerCallers } from "./bearer-callers.js";
import { resolveBrowserSessionUserId } from "./browser-session.js";
import { CREDENTIAL_HEADER, sessionCredential } from "./session-credential.js";

const RELAY_PAGE_BASE = "http://localhost/";

const JOSE_CODE = { PREFIX: "ERR_J", KEY_SET_TIMEOUT: "ERR_JWKS_TIMEOUT" } as const;

export interface OAuthUserInfo {
  sub: string;
}

export type UserInfoEndpoint = (input: {
  headers: Headers;
}) => Effect.Effect<OAuthUserInfo | undefined, Cause.UnknownError>;

export type SessionEndpoint = (input: {
  headers: Headers;
}) => Effect.Effect<Option.Option<string>, Cause.UnknownError>;

export function oauthUserInfoFromAuthAnswer(value: UnparsedWireValue): OAuthUserInfo | undefined {
  if (!isRecord(value)) return undefined;
  const sub = text(value.sub);
  return sub ? { sub } : undefined;
}

function refusedToken(failure: Cause.UnknownError): boolean {
  const thrown = failure.cause;
  if (isAPIError(thrown)) {
    return (
      thrown.statusCode < HOSTED_HTTP_STATUS.INTERNAL_ERROR &&
      thrown.statusCode !== HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS
    );
  }
  if (!(thrown instanceof Error) || !("code" in thrown) || typeof thrown.code !== "string") {
    return false;
  }
  return thrown.code.startsWith(JOSE_CODE.PREFIX) && thrown.code !== JOSE_CODE.KEY_SET_TIMEOUT;
}

export function hostedUserId(
  request: Request,
  userInfo: UserInfoEndpoint,
): Effect.Effect<Option.Option<string>, Cause.UnknownError> {
  return userIdForAuthorization(request.headers.get(CREDENTIAL_HEADER.AUTHORIZATION), userInfo);
}

export function userIdForAuthorization(
  value: string | null | undefined,
  userInfo: UserInfoEndpoint,
): Effect.Effect<Option.Option<string>, Cause.UnknownError> {
  const authorization = value?.trim();
  if (!authorization) return Effect.succeedNone;
  return userInfo({ headers: new Headers({ authorization }) }).pipe(
    Effect.map((identity) => Option.fromUndefinedOr(identity?.sub || undefined)),
    Effect.catchIf(refusedToken, () => Effect.succeedNone),
  );
}

export function requestUserId(
  request: Request,
  userInfo: UserInfoEndpoint,
  session: SessionEndpoint,
): Effect.Effect<Option.Option<string>, Cause.UnknownError> {
  if (request.headers.has(CREDENTIAL_HEADER.AUTHORIZATION)) return hostedUserId(request, userInfo);
  const cookie = sessionCredential(request.headers);
  if (cookie === undefined) return Effect.succeedNone;
  return session({ headers: cookie });
}

export function relayUserId(
  credential: RelayCredential,
  userInfo: UserInfoEndpoint,
  session: SessionEndpoint,
): Effect.Effect<Option.Option<string>, Cause.UnknownError> {
  if ("bearer" in credential) return userIdForAuthorization(credential.bearer, userInfo);
  const page = new Request(RELAY_PAGE_BASE, { headers: credential.page });
  return requestUserId(page, userInfo, session);
}

const askedUserInfo: UserInfoEndpoint = (input) =>
  Effect.tryPromise(async () => {
    const answer = (await auth.api.oauth2UserInfo(input)) as WireBoundaryInput;
    return oauthUserInfoFromAuthAnswer(unparsedWire(answer));
  });

export const hostedUserInfo: UserInfoEndpoint = (input) =>
  Effect.flatMap(Effect.serviceOption(BearerCallers), (kept) =>
    Option.isSome(kept) ? kept.value.through(askedUserInfo)(input) : askedUserInfo(input),
  );

export function resolveHostedUserId(
  request: Request,
): Effect.Effect<Option.Option<string>, Cause.UnknownError> {
  return requestUserId(request, hostedUserInfo, resolveBrowserSessionUserId);
}

export function resolveHostedBearerUserId(
  request: Request,
): Effect.Effect<Option.Option<string>, Cause.UnknownError> {
  return hostedUserId(request, hostedUserInfo);
}

export function resolveRelayUserId(
  credential: RelayCredential,
): Effect.Effect<Option.Option<string>, Cause.UnknownError> {
  return relayUserId(credential, hostedUserInfo, resolveBrowserSessionUserId);
}
