/**
 * session-credential.ts -- the one credential a Better Auth session is read from: a request's `Authorization` wherever it carries one, and its cookie only where it carries none.
 *
 * Every route that takes a session (the workspace writes and invitations,
 * GitHub's claim and disconnect, and the admin dashboard) reads it on the
 * rule `bearer.ts`'s `requestUserId` holds every account route to: an
 * `Authorization` at all names the caller alone, so one that does not
 * verify names nobody. Note that the cookie is never handed on beside an
 * `Authorization`, because Better Auth's bearer plugin leaves the cookie
 * standing under any bearer it did not sign, so a junk header would pass for
 * the caller's own while the cookie's session answered for it. This module
 * imports nothing, so a caller middleware reads it without loading the auth
 * service.
 */

/** The request headers a caller's credential is read from: a bearer's, and a browser's session cookie's. */
export const CREDENTIAL_HEADER = { AUTHORIZATION: "authorization", COOKIE: "cookie" } as const;

/**
 * The headers to read a session from and carry it on in: the
 * `Authorization` alone where the request carries one, its cookie alone
 * where it carries none, and nothing where it carries neither or only a
 * blank one, so that the auth service is asked nothing.
 */
export function sessionCredential(headers: Headers): Headers | undefined {
  const authorization = headers.get(CREDENTIAL_HEADER.AUTHORIZATION);
  if (authorization !== null) {
    return authorization.trim() === "" ? undefined : new Headers({ authorization });
  }
  const cookie = headers.get(CREDENTIAL_HEADER.COOKIE)?.trim();
  return cookie ? new Headers({ cookie }) : undefined;
}
