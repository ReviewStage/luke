import { isRecord, text, type UnparsedWireValue } from "../core.js";

/** The subject a signed-in OAuth userinfo answer names. */
export interface OAuthUserInfo {
  sub: string;
}

/**
 * The auth service's own userinfo endpoint, called in process. It is the same
 * validation the desktop's identity request goes through over HTTP: expiry,
 * revocation, and scope are all the OAuth provider's answer, never a second
 * implementation here.
 */
export type UserInfoEndpoint = (input: { headers: Headers }) => Promise<OAuthUserInfo | undefined>;

/** Parses the auth service's raw userinfo answer at the hosted API boundary. */
export function oauthUserInfoFromAuthAnswer(value: UnparsedWireValue): OAuthUserInfo | undefined {
  if (!isRecord(value)) return undefined;
  const sub = text(value.sub);
  return sub ? { sub } : undefined;
}

/**
 * Resolves the signed-in user behind a request's bearer token, or nothing.
 * Nothing distinguishes a missing header from an expired or revoked token on
 * purpose: every failure is one 401, and the desktop's existing refresh
 * machinery is what answers it.
 */
export function hostedUserId(
  request: Request,
  userInfo: UserInfoEndpoint,
): Promise<string | undefined> {
  return userIdForAuthorization(request.headers.get("authorization"), userInfo);
}

/**
 * The same resolution for an `Authorization` value that arrived somewhere
 * other than on its own request: the voice service forwards the header the
 * desktop opened its socket with, and it is read as if it had been sent here.
 */
export async function userIdForAuthorization(
  value: string | null | undefined,
  userInfo: UserInfoEndpoint,
): Promise<string | undefined> {
  const authorization = value?.trim();
  if (!authorization) return undefined;
  try {
    const identity = await userInfo({ headers: new Headers({ authorization }) });
    return identity?.sub || undefined;
  } catch {
    return undefined;
  }
}
