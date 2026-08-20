import { isRecord, text, type UnparsedWireValue } from "../core";

/** The subject a signed-in OAuth userinfo answer names. */
export interface OAuthUserInfo {
  sub: string;
}

/** Fields the auth userinfo endpoint may return before subject extraction. */
export interface AuthUserInfoFields {
  sub?: string | number | boolean | null;
}

/** Answers the auth service's userinfo endpoint may return before parsing. */
export type AuthUserInfoAnswer = AuthUserInfoFields | string | number | boolean | null | undefined;

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
export async function hostedUserId(
  request: Request,
  userInfo: UserInfoEndpoint,
): Promise<string | undefined> {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization) return undefined;
  try {
    const identity = await userInfo({ headers: new Headers({ authorization }) });
    return identity?.sub || undefined;
  } catch {
    return undefined;
  }
}
