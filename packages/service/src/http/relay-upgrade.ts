/**
 * relay-upgrade.ts -- who a relay's WebSocket upgrade says it is, read before any socket stands: the desktop's bearer, sent with no `Origin`, or a page's session cookie, taken only from one of the deployment's own origins.
 *
 * Two relays stand on these terms, an agent's terminal (`terminal/service.ts`)
 * and a cloud Browser tab's live view (`browser-live/service.ts`). The
 * desktop connects from its main process, which names no `Origin`, under the
 * account's bearer. A browser names the page's origin on every upgrade, and
 * no page can set or drop it; it also carries the deployment's cookies on an
 * upgrade any page opens, and a WebSocket's handshake, unlike a fetch, asks
 * no CORS question first. So an upgrade naming an origin is taken only from
 * the deployment's own pages (`authDeployment`'s `ownOrigins`, the list
 * `origin-guard.ts` holds a cookie's writes to, never Better Auth's
 * `trustedOrigins`), and its account is then read from its cookie alone, as
 * every hosted route reads a browser's: another site's page that opens a
 * socket here, carrying the member's cookie, is refused before the cookie is
 * read. A page can set no `Authorization` on a WebSocket, so one beside a
 * page's origin is never read, and a cookie with no origin is no desktop's
 * credential. What the account may then reach is each relay's own rule.
 */

import type { IncomingHttpHeaders } from "node:http";
import type { Duplex } from "node:stream";
import { HTTP_STATUS } from "@luke/wire";
import { CREDENTIAL_HEADER } from "../auth/session-credential.js";

/** The statuses an upgrade is refused with, before any socket stands. */
export const RELAY_UPGRADE_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: HTTP_STATUS.UNAUTHORIZED,
  /** The handshake named an origin that is not one of the deployment's own: another site's page. */
  FORBIDDEN: HTTP_STATUS.FORBIDDEN,
  NOT_FOUND: HTTP_STATUS.NOT_FOUND,
  SERVICE_UNAVAILABLE: 503,
} as const;

const BEARER_SCHEME = "Bearer ";

/** Who an upgrade says it is: the desktop's bearer, or a page's session cookie, as the headers its session is read from. */
export type RelayCredential = { readonly bearer: string } | { readonly page: Headers };

/** The headers a page's session is read from: its cookie alone, which is all a browser's socket can carry; none where it carries none. */
function pageHeaders(headers: IncomingHttpHeaders): Headers | undefined {
  const cookie = headers.cookie?.trim();
  return cookie ? new Headers({ [CREDENTIAL_HEADER.COOKIE]: cookie }) : undefined;
}

/** The desktop's bearer, where the upgrade carries one with something in it. */
function bearerOf(headers: IncomingHttpHeaders): string | undefined {
  const authorization = headers.authorization;
  if (authorization === undefined || !authorization.startsWith(BEARER_SCHEME)) return undefined;
  return authorization.slice(BEARER_SCHEME.length).trim() === "" ? undefined : authorization;
}

/**
 * The credential an upgrade carries, read from its headers alone against
 * the deployment's own origins, or the status it is refused with: a page of
 * another origin is forbidden whatever it carries, and a page with no
 * cookie, or a caller with no origin and no bearer, is unauthorized.
 */
export function relayCredential(
  headers: IncomingHttpHeaders,
  ownOrigins: ReadonlySet<string>,
): RelayCredential | { readonly status: number } {
  if (headers.origin !== undefined) {
    if (!ownOrigins.has(headers.origin)) return { status: RELAY_UPGRADE_STATUS.FORBIDDEN };
    const page = pageHeaders(headers);
    return page === undefined ? { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED } : { page };
  }
  const bearer = bearerOf(headers);
  return bearer === undefined ? { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED } : { bearer };
}

/** Refuses one upgrade before any socket stands, with the status given. */
export function refuseUpgrade(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} Refused\r\nConnection: close\r\n\r\n`);
}
