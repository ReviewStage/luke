import { isRecord } from "@sidecar/core";

/**
 * The auth service's own userinfo endpoint, called in process. It is the same
 * validation the desktop's identity request goes through over HTTP: expiry,
 * revocation, and scope are all the OAuth provider's answer, never a second
 * implementation here.
 */
export type UserInfoEndpoint = (input: { headers: Headers }) => Promise<unknown>;

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
    const subject = isRecord(identity) && typeof identity.sub === "string" ? identity.sub : "";
    return subject || undefined;
  } catch {
    return undefined;
  }
}
