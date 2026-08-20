/**
 * The HTTP boundary: the statuses this build branches on, and the fetch a
 * caller is given so a test can answer for the network. Here rather than with
 * the adapters that read them, so the fake that speaks this vocabulary is
 * reachable without depending on every provider.
 */
export const HTTP_STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
} as const;

export type CloudFetch = (url: string, init: RequestInit) => Promise<Response>;
