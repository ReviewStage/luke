export const DESKTOP_SESSION_CLIENT_ID = "desktop-session";

const DESKTOP_SESSION_PAGE = {
  PATH: "/desktop-session",
  RETURN_PARAM: "return_to",
} as const;

const TRANSFER_PARAM = {
  CLIENT_ID: "client_id",
  STATE: "state",
  CODE_CHALLENGE: "code_challenge",
} as const;

const RETURN_PARAM = {
  CODE: "code",
  STATE: "state",
} as const;

const LOOPBACK_HOST = "127.0.0.1";

export interface DesktopSessionRequest {
  readonly state: string;
  readonly codeChallenge: string;
  readonly returnTo: string;
}

interface DesktopSessionTransfer {
  readonly client_id: string;
  readonly state: string;
  readonly code_challenge: string;
}

export interface DesktopSessionPageQuery {
  readonly transfer: DesktopSessionTransfer;
  readonly returnTo: URL;
}

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

export function desktopSessionPageUrl(origin: string, request: DesktopSessionRequest): string {
  const url = new URL(DESKTOP_SESSION_PAGE.PATH, origin);
  url.searchParams.set(TRANSFER_PARAM.CLIENT_ID, DESKTOP_SESSION_CLIENT_ID);
  url.searchParams.set(TRANSFER_PARAM.STATE, request.state);
  url.searchParams.set(TRANSFER_PARAM.CODE_CHALLENGE, request.codeChallenge);
  url.searchParams.set(DESKTOP_SESSION_PAGE.RETURN_PARAM, request.returnTo);
  return url.href;
}

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

export function desktopSessionReturnUrl(returnTo: URL, code: string, state: string): string {
  const url = new URL(returnTo.href);
  url.searchParams.set(RETURN_PARAM.CODE, code);
  url.searchParams.set(RETURN_PARAM.STATE, state);
  return url.href;
}
