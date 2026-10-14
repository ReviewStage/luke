/**
 * desktop-session-wire.ts -- the hand-off page that gives the Mac a Better Auth session of its own, and the query it reads and writes.
 *
 * The Mac signs in as an OAuth client and holds an access token for Luke's
 * own routes, but Better Auth's organization endpoints take a session. So
 * once the browser is signed in, the Mac sends it to this page with a PKCE
 * challenge and a state of its own; the page asks Better Auth's Electron
 * plugin to transfer the signed-in user
 * (https://www.better-auth.com/docs/integrations/electron#handling-authorization-in-the-browser),
 * and hands the authorization code it answers back to the Mac's loopback,
 * where the Mac exchanges it at `/electron/token` with its verifier.
 *
 * The plugin's own browser client redirects through a custom URL scheme;
 * the Mac already listens on a loopback port for its OAuth sign-in, so the
 * page returns there instead, and only there: a return address that is not
 * `http://127.0.0.1:<port>` is no return address. The code is single-use,
 * short-lived, and worthless without the verifier the Mac never sent.
 */

/** The Electron plugin's client id for the Mac, apart from its OAuth client id. */
export const DESKTOP_SESSION_CLIENT_ID = "luke-desktop-session";

/** The hand-off page, and the query the plugin's transfer reads from it. */
const DESKTOP_SESSION_PAGE = {
  PATH: "/desktop-session.html",
  /** Where the page sends the code: the Mac's loopback. */
  RETURN_PARAM: "return_to",
} as const;

/** The query names the Electron plugin reads on a transfer, fixed by the plugin. */
const TRANSFER_PARAM = {
  CLIENT_ID: "client_id",
  STATE: "state",
  CODE_CHALLENGE: "code_challenge",
} as const;

/**
 * The query names the page writes back to the loopback: the plugin's code
 * and the Mac's state, under the names an authorization redirect uses
 * (RFC 6749 section 4.1.2), so the loopback reads them as it reads one.
 */
const RETURN_PARAM = {
  CODE: "code",
  STATE: "state",
} as const;

/** The only host a return address may name. */
const LOOPBACK_HOST = "127.0.0.1";

/** What the Mac puts on the hand-off page's address. */
export interface DesktopSessionRequest {
  readonly state: string;
  readonly codeChallenge: string;
  readonly returnTo: string;
}

/** The query the plugin's transfer endpoint takes, as the page sends it on. */
interface DesktopSessionTransfer {
  readonly client_id: string;
  readonly state: string;
  readonly code_challenge: string;
}

/** What the page reads: the transfer to ask for, and the loopback to return to. */
export interface DesktopSessionPageQuery {
  readonly transfer: DesktopSessionTransfer;
  readonly returnTo: URL;
}

/** The loopback the page may return to, or nothing when the address names anywhere else. */
function loopbackReturn(raw: string | null): URL | undefined {
  if (!raw || !URL.canParse(raw)) return undefined;
  const url = new URL(raw);
  const loopback =
    url.protocol === "http:" &&
    url.hostname === LOOPBACK_HOST &&
    url.port !== "" &&
    url.username === "" &&
    url.password === "";
  return loopback ? url : undefined;
}

/** The hand-off page's address on the service at `origin`. */
export function desktopSessionPageUrl(origin: string, request: DesktopSessionRequest): string {
  const url = new URL(DESKTOP_SESSION_PAGE.PATH, origin);
  url.searchParams.set(TRANSFER_PARAM.CLIENT_ID, DESKTOP_SESSION_CLIENT_ID);
  url.searchParams.set(TRANSFER_PARAM.STATE, request.state);
  url.searchParams.set(TRANSFER_PARAM.CODE_CHALLENGE, request.codeChallenge);
  url.searchParams.set(DESKTOP_SESSION_PAGE.RETURN_PARAM, request.returnTo);
  return url.href;
}

/** The hand-off page's query, or nothing when a part is missing or the return address is not a loopback. */
export function desktopSessionPageQuery(search: string): DesktopSessionPageQuery | undefined {
  const params = new URLSearchParams(search);
  const state = params.get(TRANSFER_PARAM.STATE);
  const codeChallenge = params.get(TRANSFER_PARAM.CODE_CHALLENGE);
  const returnTo = loopbackReturn(params.get(DESKTOP_SESSION_PAGE.RETURN_PARAM));
  if (!state || !codeChallenge || returnTo === undefined) return undefined;
  return {
    transfer: {
      client_id: DESKTOP_SESSION_CLIENT_ID,
      state,
      code_challenge: codeChallenge,
    },
    returnTo,
  };
}

/** The loopback address carrying the plugin's code and the Mac's own state back. */
export function desktopSessionReturnUrl(returnTo: URL, code: string, state: string): string {
  const url = new URL(returnTo.href);
  url.searchParams.set(RETURN_PARAM.CODE, code);
  url.searchParams.set(RETURN_PARAM.STATE, state);
  return url.href;
}
