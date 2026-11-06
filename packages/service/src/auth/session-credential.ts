export const CREDENTIAL_HEADER = { AUTHORIZATION: "authorization", COOKIE: "cookie" } as const;

export function sessionCredential(headers: Headers): Headers | undefined {
  const authorization = headers.get(CREDENTIAL_HEADER.AUTHORIZATION);
  if (authorization !== null) {
    return authorization.trim() === "" ? undefined : new Headers({ authorization });
  }
  const cookie = headers.get(CREDENTIAL_HEADER.COOKIE)?.trim();
  return cookie ? new Headers({ cookie }) : undefined;
}
