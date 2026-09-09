import {
  ACT_RESULT_STATUS,
  isRecord,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
} from "@sidecar/wire";
// The one consent trip every provider Luke asks consent of runs: the loopback,
// the PKCE, and the landing page are all its, so no two of Luke's sign-ins can
// drift into different servers, weaker verifiers, or differently dressed tabs.
import {
  type LoopbackConsent,
  type LoopbackConsentOutcome,
  loopbackConsent,
  unofferedConsent,
} from "../loopback-consent.js";
import { LOOPBACK_CONNECTION_SOURCE } from "../loopback-page.js";

/**
 * The sign-in behind the Linear row: Linear's own OAuth flow for a public
 * client, run the way it documents one, on the shared loopback consent trip.
 * No client secret is involved at all: Linear makes it optional under PKCE,
 * and a secret every installed copy carries protects nothing that the verifier
 * does not already protect.
 *
 * The flow exists only in a run holding the registration — the client id
 * standing in source below, or the environment variable that stands in for it
 * during development. A build with neither offers the integration not at all,
 * which is why `linearSignInConfig` returning nothing hides the row rather
 * than drawing one whose button cannot work.
 */

export interface LinearSignInConfig {
  clientId: string;
}

const SIGN_IN_ENVIRONMENT = {
  CLIENT_ID: "LINEAR_OAUTH_CLIENT_ID",
} as const;

/**
 * The Linear OAuth application this project registered — created under
 * Settings · API · OAuth applications in the workspace that owns Luke. A
 * client id is published in every authorization URL, so it stands in source
 * the way the calendar's does; the environment variable above overrides it
 * for development against another registration.
 *
 * Every redirect URL in `LINEAR_REDIRECT_URIS` must be registered on it, or
 * Linear refuses the callback rather than the exchange, and the browser stops
 * at Linear's own error page.
 */
const REGISTERED_LINEAR_CLIENT_ID = "781b6356943d0c71c4dc618b782e0ab0";

/** The sign-in this run can offer, or nothing — which hides the row. */
export function linearSignInConfig(
  environment: NodeJS.ProcessEnv = process.env,
): LinearSignInConfig | undefined {
  const clientId =
    environment[SIGN_IN_ENVIRONMENT.CLIENT_ID]?.trim() || REGISTERED_LINEAR_CLIENT_ID;
  if (!clientId) return undefined;
  return { clientId };
}

/** Linear's documented OAuth endpoints, fixed by this build. */
export const LINEAR_AUTHORIZATION_URL = "https://linear.app/oauth/authorize";
export const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
export const LINEAR_REVOKE_URL = "https://api.linear.app/oauth/revoke";

/**
 * The scopes the consent page asks for. `read` is the roster; `write` is the
 * two acts a developer can ask for on a row — moving an issue to another of
 * its team's states, and commenting. Linear publishes narrower scopes only
 * for creating issues and comments, and moving an issue is neither, so
 * `write` is the narrowest grant that carries both acts rather than a wide
 * one chosen for convenience. What bounds the acts is not the scope but the
 * validation above it: an act is issued only for an issue and a state the
 * latest read actually listed, and only in a turn the developer opened.
 *
 * Linear separates scopes with commas, where most providers use spaces.
 */
export const LINEAR_SCOPES = ["read", "write"].join(",");

/**
 * Where Linear is asked to send the code back. Unlike Google, Linear does not
 * document loopback redirects as exempt from exact matching, so the port
 * cannot be the ephemeral one the other flows take: every address here is
 * registered on the OAuth application, and the flow takes the first that will
 * bind. Three, so a port held by another app — or by a second copy of Luke —
 * is an inconvenience rather than a dead row. Linear's own desktop app probes
 * 44450, 18450 and 33234, so those are left alone.
 */
const LOOPBACK_PORTS = [47821, 47822, 47823] as const;
const LOOPBACK_HOST = "127.0.0.1";
const CALLBACK_PATH = "/linear/callback";

/** Every redirect URL this build can use, which is what the app must register. */
export const LINEAR_REDIRECT_URIS: readonly string[] = LOOPBACK_PORTS.map(
  (port) => `http://${LOOPBACK_HOST}:${port}${CALLBACK_PATH}`,
);

const TOKEN_REQUEST_TIMEOUT_MS = 10_000;

/**
 * One connected Linear workspace's credentials. The refresh token is absent
 * where Linear issued none — it grants long-lived access tokens to some
 * registrations — and a grant without one is simply reconnected when its
 * access token finally expires.
 */
export interface LinearGrant {
  accessToken: string;
  refreshToken?: string;
  /** When the access token stops being honoured, as epoch milliseconds. */
  expiresAt: number;
}

export type LinearSignInOutcome = LoopbackConsentOutcome<LinearGrant>;

export interface LinearSignInOptions {
  /**
   * Opens the authorization page in the user's own browser. Injected so the
   * one caller hands in the shell and tests hand in a recorder — this module
   * never reaches for Electron itself.
   */
  openExternal: (url: string) => void;
  environment?: NodeJS.ProcessEnv;
  /** Injectable so tests exercise the exchange without a network. */
  fetchImplementation?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

/**
 * Reads the grant Linear answered an exchange or a refresh with, trusting no
 * shape. An access token is the whole requirement: without one there is
 * nothing to read Linear with, and the caller says so rather than storing a
 * grant that cannot work.
 */
export function grantFrom(payload: UnparsedWireValue, now: number): LinearGrant | undefined {
  if (!isRecord(payload)) return undefined;
  const record = payload;
  const accessToken = record.access_token;
  if (!isWireString(accessToken) || !accessToken) return undefined;
  const refreshToken = record.refresh_token;
  // Linear states the lifetime in seconds. A response without one is treated
  // as already expired rather than as eternal, so a refresh proves the grant
  // before a pass rides it.
  const expiresIn = isWireNumber(record.expires_in) ? record.expires_in : 0;
  return {
    accessToken,
    ...(isWireString(refreshToken) && refreshToken ? { refreshToken } : undefined),
    expiresAt: now + expiresIn * 1_000,
  };
}

/**
 * Trades the code for a grant at Linear's token endpoint. No client secret
 * travels: PKCE is what protects a public client.
 */
export async function exchangeLinearCode(
  config: LinearSignInConfig,
  input: { code: string; redirectUri: string; codeVerifier: string },
  options: { fetchImplementation?: typeof fetch; now?: () => number } = {},
): Promise<LinearSignInOutcome> {
  const body = new URLSearchParams({
    code: input.code,
    client_id: config.clientId,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
    code_verifier: input.codeVerifier,
  });
  try {
    const fetchImplementation = options.fetchImplementation ?? fetch;
    const response = await fetchImplementation(LINEAR_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { reason: "Linear refused the sign-in exchange." };
    const grant = grantFrom(await response.json(), (options.now ?? Date.now)());
    if (!grant) return { reason: "Linear answered the sign-in without a token." };
    return grant;
  } catch {
    return { reason: "The sign-in exchange with Linear did not complete." };
  }
}

/**
 * Runs one sign-in from button press to grant. A build whose registration was
 * stripped offers a flow that says so rather than one whose consent page could
 * not be built.
 */
export function linearSignIn(options: LinearSignInOptions): LoopbackConsent<LinearGrant> {
  const config = linearSignInConfig(options.environment);
  if (!config) return unofferedConsent();
  return loopbackConsent<LinearGrant>({
    ports: LOOPBACK_PORTS,
    callbackPath: CALLBACK_PATH,
    source: LOOPBACK_CONNECTION_SOURCE.LINEAR,
    pages: {
      granted: {
        badge: "Connected",
        title: "Connected to Linear",
        body: "You can close this tab and return to Luke.",
      },
      notGranted: {
        badge: "Not connected",
        title: "Sign-in didn’t complete",
        body: "You can close this tab and try again from Luke.",
      },
    },
    reasons: {
      refused: "Linear did not grant access.",
      timedOut: "Sign-in timed out. Try again from the Linear row.",
    },
    authorizationUrl: ({ state, redirectUri, codeChallenge }) => {
      const authorization = new URL(LINEAR_AUTHORIZATION_URL);
      authorization.searchParams.set("client_id", config.clientId);
      authorization.searchParams.set("redirect_uri", redirectUri);
      authorization.searchParams.set("response_type", "code");
      authorization.searchParams.set("scope", LINEAR_SCOPES);
      authorization.searchParams.set("code_challenge", codeChallenge);
      authorization.searchParams.set("code_challenge_method", "S256");
      // Everything Luke does on a board, he does as the developer who asked:
      // an issue moves under their name and a comment carries it. `user` is
      // Linear's default, and saying so keeps a changed default from quietly
      // turning Luke into an actor of his own.
      authorization.searchParams.set("actor", "user");
      // Consent every time, so reconnecting after withdrawing the grant in
      // Linear actually asks again rather than silently reissuing.
      authorization.searchParams.set("prompt", "consent");
      authorization.searchParams.set("state", state);
      return authorization.toString();
    },
    exchange: (input) =>
      exchangeLinearCode(config, input, {
        fetchImplementation: options.fetchImplementation,
        now: options.now,
      }),
    openExternal: options.openExternal,
    timeoutMs: options.timeoutMs,
  });
}

/**
 * Tells Linear the grant is finished with, so disconnecting ends the access
 * at Linear rather than only forgetting it here. Best effort by design: the
 * user asked to disconnect, and a network that cannot carry the revocation is
 * not a reason to keep the grant on this machine — the caller deletes it
 * either way, and Linear's own settings remain the certain way to withdraw.
 */
export async function revokeLinearGrant(
  token: string,
  tokenType: "access_token" | "refresh_token",
  fetchImplementation: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImplementation(LINEAR_REVOKE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token, token_type_hint: tokenType }).toString(),
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * What a refresh settled, which is two different answers a caller must not
 * confuse. `REFUSED` is Linear itself saying no — the grant was withdrawn,
 * expired, or spent — and the only cure is connecting again, so the stored
 * grant is finished with. `UNREACHABLE` is nothing having come back at all,
 * where the grant is untouched and the next pass is the whole remedy.
 * Deleting a grant over a dropped connection would disconnect a developer
 * for closing their laptop lid.
 */
export const LINEAR_REFRESH_STATUS = {
  RENEWED: "renewed",
  REFUSED: ACT_RESULT_STATUS.REJECTED,
  UNREACHABLE: "unreachable",
} as const;

export type LinearRefreshStatus =
  (typeof LINEAR_REFRESH_STATUS)[keyof typeof LINEAR_REFRESH_STATUS];

export type LinearRefreshOutcome =
  | { status: typeof LINEAR_REFRESH_STATUS.RENEWED; grant: LinearGrant }
  | { status: typeof LINEAR_REFRESH_STATUS.REFUSED }
  | { status: typeof LINEAR_REFRESH_STATUS.UNREACHABLE };

/**
 * Trades a refresh token for a fresh grant. Linear consumes the refresh token
 * it is given and answers with another, so what comes back must be stored
 * before it is used — a grant refreshed and then lost is a grant the user has
 * to make again.
 */
export async function refreshLinearGrant(
  refreshToken: string,
  options: {
    environment?: NodeJS.ProcessEnv;
    fetchImplementation?: typeof fetch;
    now?: () => number;
  } = {},
): Promise<LinearRefreshOutcome> {
  const config = linearSignInConfig(options.environment);
  // A build that lost its registration cannot refresh anything, and has not
  // been told the grant is bad either.
  if (!config) return { status: LINEAR_REFRESH_STATUS.UNREACHABLE };
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: config.clientId,
    grant_type: "refresh_token",
  });
  const fetchImplementation = options.fetchImplementation ?? fetch;
  let response: Response;
  try {
    response = await fetchImplementation(LINEAR_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { status: LINEAR_REFRESH_STATUS.UNREACHABLE };
  }
  if (!response.ok) {
    try {
      const payload = await response.json();
      if (isRecord(payload) && payload.error === "invalid_grant") {
        return { status: LINEAR_REFRESH_STATUS.REFUSED };
      }
    } catch {
      // An unreadable refusal proves nothing about the grant.
    }
    return { status: LINEAR_REFRESH_STATUS.UNREACHABLE };
  }
  let grant: LinearGrant | undefined;
  try {
    grant = grantFrom(await response.json(), (options.now ?? Date.now)());
  } catch {
    return { status: LINEAR_REFRESH_STATUS.UNREACHABLE };
  }
  if (!grant?.refreshToken) return { status: LINEAR_REFRESH_STATUS.UNREACHABLE };
  return { status: LINEAR_REFRESH_STATUS.RENEWED, grant };
}
