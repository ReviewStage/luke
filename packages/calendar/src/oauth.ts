import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
// The same landing page the Luke account sign-in leaves the browser on, so
// the two flows' tabs cannot dress differently.
// The same RFC 7636 arithmetic the Luke account sign-in uses: one PKCE, two
// flows, so neither can drift into a weaker verifier than the other.
import {
  accountLoopbackPage,
  codeChallenge,
  createCodeVerifier,
  LOOPBACK_PAGE_TONE,
} from "@sidecar/credentials";
import { isWireString, type UnparsedWireValue, unparsedWire, wireRecord } from "@sidecar/wire";

/**
 * The sign-in behind the Google Calendar row: Google's OAuth flow for an
 * installed app, run the way the platform documents it for one — an
 * authorization page opened in the user's own browser, a code handed back on
 * a loopback redirect that never leaves this machine, and a PKCE-verified
 * exchange at Google's token endpoint. Every address involved is fixed by
 * this build; what the flow produces is a grant scoped to availability and
 * the calendar list alone, and storing it is the caller's act, not this one's.
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

/** Long enough to find the right account; not an open door all afternoon. */
const SIGN_IN_TIMEOUT_MS = 180_000;

const TOKEN_REQUEST_TIMEOUT_MS = 10_000;

/**
 * What the browser tab shows once the flow is over: the same self-contained
 * landing the Luke account sign-in leaves the browser on, worded for the
 * calendar. One page builder for both flows is what keeps the two tabs
 * introducing themselves identically; every string here is fixed by the
 * build, and nothing the redirect carried is ever interpolated.
 */
function signInPage(granted: boolean): string {
  return granted
    ? accountLoopbackPage({
        tone: LOOPBACK_PAGE_TONE.SETTLED,
        badge: "Connected",
        title: "Connected to Google Calendar",
        body: "You can close this tab and return to Luke.",
      })
    : accountLoopbackPage({
        tone: LOOPBACK_PAGE_TONE.ATTENTION,
        badge: "Not connected",
        title: "Sign-in didn’t complete",
        body: "You can close this tab and try again from Luke.",
      });
}

export type GoogleCalendarSignInOutcome =
  | { refreshToken: string; accessToken: string }
  | { reason: string };

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
function tokensFrom(
  payload: UnparsedWireValue,
): { refreshToken: string; accessToken: string } | undefined {
  const record = wireRecord(unparsedWire(payload));
  if (!record) return undefined;
  const refreshToken = record.refresh_token;
  const accessToken = record.access_token;
  if (!isWireString(refreshToken) || !refreshToken) return undefined;
  if (!isWireString(accessToken) || !accessToken) return undefined;
  return { refreshToken, accessToken };
}

/**
 * Runs one sign-in from button press to refresh token. One at a time: a
 * second press while the browser tab is open is answered with why, rather
 * than a second tab racing the first for the loopback port.
 */
export class GoogleCalendarSignIn {
  readonly #options: GoogleCalendarSignInOptions;
  #running = false;
  /** Ends the flow now waiting, when there is one — the cancel button's way in. */
  #abandon: (() => void) | undefined;
  /** Reopens the waiting flow's own consent page — the lost-tab way back in. */
  #reopen: (() => void) | undefined;

  constructor(options: GoogleCalendarSignInOptions) {
    this.#options = options;
  }

  async signIn(): Promise<GoogleCalendarSignInOutcome> {
    const config = googleCalendarSignInConfig(this.#options.environment);
    if (!config) return { reason: "Sign-in is not configured in this build." };
    if (this.#running) return { reason: "A sign-in is already waiting in your browser." };
    this.#running = true;
    try {
      return await this.#run(config);
    } finally {
      this.#running = false;
      this.#abandon = undefined;
      this.#reopen = undefined;
    }
  }

  /**
   * Ends the flow now waiting, if any. The browser tab is left where it is —
   * closing another app's window is not Luke's to do — but the loopback stops
   * listening, so a grant given after this lands nowhere.
   */
  cancel(): void {
    this.#abandon?.();
  }

  /**
   * Opens the waiting flow's consent page again — the very URL, state and
   * challenge included, the flow is already listening for — for a tab lost
   * behind other windows or closed by mistake. With no flow waiting there is
   * no page to reopen, and nothing happens.
   */
  reopen(): void {
    this.#reopen?.();
  }

  async #run(config: GoogleCalendarSignInConfig): Promise<GoogleCalendarSignInOutcome> {
    const verifier = createCodeVerifier();
    const challenge = codeChallenge(verifier);
    const state = randomUUID();

    let finish: (outcome: GoogleCalendarSignInOutcome) => void = () => undefined;
    const outcome = new Promise<GoogleCalendarSignInOutcome>((resolve) => {
      finish = resolve;
    });
    // Assigned once the loopback has a port, before the browser is opened —
    // no request can arrive ahead of it.
    let redirectUri = "";

    const server = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      // Anything that is not this flow's own redirect — another path, a
      // stray request, a state this run never issued — is refused without
      // ending the wait: the real redirect may still be on its way.
      if (url.pathname !== CALLBACK_PATH || url.searchParams.get("state") !== state) {
        response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
        return;
      }
      const refused = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (refused || !code) {
        response
          .writeHead(200, { "content-type": "text/html; charset=utf-8" })
          .end(signInPage(false));
        finish({ reason: "Google did not grant access." });
        return;
      }
      void this.#exchange(config, code, verifier, redirectUri).then((exchanged) => {
        const granted = "refreshToken" in exchanged;
        response
          .writeHead(200, { "content-type": "text/html; charset=utf-8" })
          .end(signInPage(granted));
        finish(exchanged);
      });
    });

    // The loopback answers this machine alone: Google's redirect lands in the
    // user's own browser, which hands the code straight back across localhost.
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    // SAFETY: A TCP server successfully listening on port 0 has an AddressInfo address.
    const port = (server.address() as AddressInfo).port;
    redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;

    const authorization = new URL(GOOGLE_AUTHORIZATION_URL);
    authorization.searchParams.set("client_id", config.clientId);
    authorization.searchParams.set("redirect_uri", redirectUri);
    authorization.searchParams.set("response_type", "code");
    authorization.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES);
    authorization.searchParams.set("code_challenge", challenge);
    authorization.searchParams.set("code_challenge_method", "S256");
    // Offline access is what a refresh token is, and the consent prompt is
    // what guarantees Google issues one rather than assuming an earlier grant.
    authorization.searchParams.set("access_type", "offline");
    authorization.searchParams.set("prompt", "consent");
    authorization.searchParams.set("state", state);

    const timeout = setTimeout(() => {
      finish({ reason: "Sign-in timed out. Try again from the Google Calendar row." });
    }, this.#options.timeoutMs ?? SIGN_IN_TIMEOUT_MS);
    timeout.unref();
    this.#abandon = () => finish({ reason: "Sign-in was cancelled." });
    this.#reopen = () => this.#options.openExternal(authorization.toString());

    try {
      this.#options.openExternal(authorization.toString());
      return await outcome;
    } finally {
      clearTimeout(timeout);
      server.close();
      // The server holds the process open only while the flow is live; a
      // browser tab left forever must not be what keeps Luke running.
      server.unref();
    }
  }

  async #exchange(
    config: GoogleCalendarSignInConfig,
    code: string,
    verifier: string,
    redirectUri: string,
  ): Promise<GoogleCalendarSignInOutcome> {
    const body = new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    });
    try {
      const fetchImplementation = this.#options.fetchImplementation ?? fetch;
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
}
