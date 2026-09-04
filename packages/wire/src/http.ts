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

/** A base URL as a path is joined to it: one slash between, never two. */
export function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
