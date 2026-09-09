// The one consent trip every provider Luke asks consent of runs: the loopback,
// the PKCE, and the landing page are all its, so no two of Luke's sign-ins can
// drift into different servers, weaker verifiers, or differently dressed tabs.
import {
  LOOPBACK_CONNECTION_SOURCE,
  type LoopbackConsent,
  type LoopbackConsentOutcome,
  loopbackConsent,
  unofferedConsent,
} from "@sidecar/credentials";
import { isWireString, type UnparsedWireValue, unparsedWire, wireRecord } from "@sidecar/wire";

/**
 * The sign-in behind the Google Calendar row: Google's OAuth flow for an
 * installed app, run the way the platform documents it for one, on the shared
 * loopback consent trip. Every address involved is fixed by this build; what
 * the flow produces is a grant scoped to availability and the calendar list
 * alone, and storing it is the caller's act, not this one's.
 *
 * The flow exists only when a run holds the whole registration: the client id
 * standing in source below, and the client secret packaging injects — or the
 * environment variables that stand in for either during development. A bare
 * checkout with neither offers the integration not at all.
 */

export interface GoogleCalendarSignInConfig {
  clientId: string;
  /**
   * Google issues desktop OAuth clients a "secret" it documents as not
   * confidential — every installed copy carries it — and the token endpoint
   * expects it for that client type, so a config without one is not offered.
   */
  clientSecret: string;
}

const SIGN_IN_ENVIRONMENT = {
  CLIENT_ID: "GOOGLE_CALENDAR_OAUTH_CLIENT_ID",
  CLIENT_SECRET: "GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET",
} as const;

/**
 * The Google Calendar OAuth client this project registered with Google — the
 * "Luke" desktop client in the project's own Google Cloud console. A client
 * id is published in every authorization URL, so it stands in source; the
 * environment variable above overrides it for development against another
 * registration.
 */
const REGISTERED_GOOGLE_CALENDAR_CLIENT_ID =
  "346664327893-mg16fmbgb2qtt41fe4kn860kbv6bsaaf.apps.googleusercontent.com";

/**
 * The registration's secret half. Google documents a desktop client's secret
 * as not confidential — every installed copy carries it, and PKCE over the
 * loopback is what actually protects the flow — but repository scanners
 * cannot tell it from a web client's real one, so it never sits in source:
 * `build.mjs` defines this identifier from the packaging environment, and a
 * build packaged without it offers the sign-in only where the environment
 * variables supply one.
 */
declare const PACKAGED_GOOGLE_CALENDAR_CLIENT_SECRET: string | undefined;

function readPackagedGoogleCalendarClientSecret(): string {
  try {
    // SAFETY: esbuild replaces this free identifier on packaged builds.
    const packaged = PACKAGED_GOOGLE_CALENDAR_CLIENT_SECRET;
    return isWireString(packaged) ? packaged : "";
  } catch {
    return "";
  }
}

const packagedClientSecret = readPackagedGoogleCalendarClientSecret();

/** The sign-in this run can offer, or nothing — which hides the button. */
export function googleCalendarSignInConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GoogleCalendarSignInConfig | undefined {
  const clientId =
    environment[SIGN_IN_ENVIRONMENT.CLIENT_ID]?.trim() || REGISTERED_GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret =
    environment[SIGN_IN_ENVIRONMENT.CLIENT_SECRET]?.trim() || packagedClientSecret;
  // Google's token endpoint expects a desktop client's secret; a flow that
  // would fail mid-exchange is not offered at all.
  if (!clientId || !clientSecret) return undefined;
  return { clientId, clientSecret };
}

/** Google's documented endpoints for an installed app, fixed by this build. */
export const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * The two scopes the sign-in asks for, and no more: availability, which the
 * free/busy read answers with intervals alone — a title or an attendee cannot
 * travel under it, by Google's own contract — and the calendar list, which is
 * how the account is named and how the user chooses which calendars count.
 */
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
].join(" ");

const CALLBACK_PATH = "/oauth/callback";

const TOKEN_REQUEST_TIMEOUT_MS = 10_000;

/** The grant one finished sign-in produces. Storing it is the caller's act. */
export interface GoogleCalendarGrant {
  refreshToken: string;
  accessToken: string;
}

export type GoogleCalendarSignInOutcome = LoopbackConsentOutcome<GoogleCalendarGrant>;

export interface GoogleCalendarSignInOptions {
  /**
   * Opens the authorization page in the user's own browser. Injected so the
   * one caller hands in the shell and tests hand in a recorder — this module
   * never reaches for Electron itself.
   */
  openExternal: (url: string) => void;
  environment?: NodeJS.ProcessEnv;
  /** Injectable so tests exercise the exchange without a network. */
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
}

/** Reads the tokens Google answered the exchange with, trusting no shape. */
function tokensFrom(payload: UnparsedWireValue): GoogleCalendarGrant | undefined {
  const record = wireRecord(unparsedWire(payload));
  if (!record) return undefined;
  const refreshToken = record.refresh_token;
  const accessToken = record.access_token;
  if (!isWireString(refreshToken) || !refreshToken) return undefined;
  if (!isWireString(accessToken) || !accessToken) return undefined;
  return { refreshToken, accessToken };
}

/**
 * Trades the code for a grant at Google's token endpoint. Google's desktop
 * client type expects the secret it documents as non-confidential, which is
 * why a run holding no secret is offered no sign-in at all.
 */
export async function exchangeGoogleCode(
  config: GoogleCalendarSignInConfig,
  input: { code: string; redirectUri: string; codeVerifier: string },
  fetchImplementation: typeof fetch = fetch,
): Promise<GoogleCalendarSignInOutcome> {
  const body = new URLSearchParams({
    code: input.code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
    code_verifier: input.codeVerifier,
  });
  try {
    const response = await fetchImplementation(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { reason: "Google refused the sign-in exchange." };
    const tokens = tokensFrom(await response.json());
    if (!tokens) return { reason: "Google answered the sign-in without a token." };
    return tokens;
  } catch {
    return { reason: "The sign-in exchange with Google did not complete." };
  }
}

/**
 * Runs one sign-in from button press to refresh token. A run that does not
 * hold the whole registration offers a flow that says so rather than one whose
 * exchange would fail after the user had already consented.
 */
export function googleCalendarSignIn(
  options: GoogleCalendarSignInOptions,
): LoopbackConsent<GoogleCalendarGrant> {
  const config = googleCalendarSignInConfig(options.environment);
  if (!config) return unofferedConsent();
  return loopbackConsent<GoogleCalendarGrant>({
    callbackPath: CALLBACK_PATH,
    source: LOOPBACK_CONNECTION_SOURCE.GOOGLE_CALENDAR,
    pages: {
      granted: {
        badge: "Connected",
        title: "Connected to Google Calendar",
        body: "You can close this tab and return to Luke.",
      },
      notGranted: {
        badge: "Not connected",
        title: "Sign-in didn’t complete",
        body: "You can close this tab and try again from Luke.",
      },
    },
    reasons: {
      refused: "Google did not grant access.",
      timedOut: "Sign-in timed out. Try again from the Google Calendar row.",
    },
    authorizationUrl: ({ state, redirectUri, codeChallenge }) => {
      const authorization = new URL(GOOGLE_AUTHORIZATION_URL);
      authorization.searchParams.set("client_id", config.clientId);
      authorization.searchParams.set("redirect_uri", redirectUri);
      authorization.searchParams.set("response_type", "code");
      authorization.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES);
      authorization.searchParams.set("code_challenge", codeChallenge);
      authorization.searchParams.set("code_challenge_method", "S256");
      // Offline access is what a refresh token is, and the consent prompt is
      // what guarantees Google issues one rather than assuming an earlier grant.
      authorization.searchParams.set("access_type", "offline");
      authorization.searchParams.set("prompt", "consent");
      authorization.searchParams.set("state", state);
      return authorization.toString();
    },
    exchange: (input) => exchangeGoogleCode(config, input, options.fetchImplementation ?? fetch),
    openExternal: options.openExternal,
    timeoutMs: options.timeoutMs,
  });
}
