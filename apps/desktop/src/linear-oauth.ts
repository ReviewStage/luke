import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  isRecord,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/core";
import { type Context, Deferred, Duration, Effect, Exit } from "effect";
// The same landing page the Luke account sign-in leaves the browser on, so no
// two of Luke's consent trips dress their tabs differently.
import { accountLoopbackPage, LOOPBACK_PAGE_TONE } from "./account-loopback-page";
import { codeChallenge, createCodeVerifier } from "./account-pkce";
import { Http, type LoopbackFailure } from "./services/http";

/**
 * The sign-in behind the Linear row: Linear's own OAuth flow for a public
 * client, run the way it documents one — an authorization page opened in the
 * user's browser, a code handed back on a loopback redirect that never leaves
 * this machine, and a PKCE-verified exchange at Linear's token endpoint. No
 * client secret is involved at all: Linear makes it optional under PKCE, and
 * a secret every installed copy carries protects nothing that the verifier
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
 // SAFETY: The preceding check establishes the asserted contract.
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

/** Long enough to find the right workspace; not an open door all afternoon. */
const SIGN_IN_TIMEOUT_MS = 180_000;

const TOKEN_REQUEST_TIMEOUT_MS = 10_000;

/**
 // SAFETY: The preceding check establishes the asserted contract.
 * What the browser tab shows once the flow is over, drawn as the same card
 * every other loopback landing draws. Every string is fixed by the build, and
 * nothing the redirect carried is ever interpolated.
 */
function signInPage(granted: boolean): string {
  return granted
    ? accountLoopbackPage({
        tone: LOOPBACK_PAGE_TONE.SETTLED,
        badge: "Connected",
        title: "Connected to Linear",
        body: "You can close this tab and return to Luke.",
      })
    : accountLoopbackPage({
        tone: LOOPBACK_PAGE_TONE.ATTENTION,
        badge: "Not connected",
        title: "Sign-in didn’t complete",
        body: "You can close this tab and try again from Luke.",
      });
}

/**
 * One connected Linear workspace's credentials. The refresh token is absent
 * where Linear issued none — it grants long-lived access tokens to some
 * registrations — and a grant without one is simply reconnected when its
 * access token finally expires.
 */
export interface LinearGrant {
  accessToken: string;
  refreshToken?: string;
  // SAFETY: The preceding check establishes the asserted contract.
  /** When the access token stops being honoured, as epoch milliseconds. */
  expiresAt: number;
}

export type LinearSignInOutcome = LinearGrant | { reason: string };

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
  // SAFETY: The preceding check establishes the asserted contract.
  const record = payload as WireRecord;
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
 * Runs one sign-in from button press to grant. One at a time: a second press
 * while the browser tab is open is answered with why, rather than a second tab
 * racing the first for the loopback port.
 */
export class LinearSignIn {
  readonly #options: LinearSignInOptions;
  #running = false;
  /** Ends the flow now waiting, when there is one — the cancel button's way in. */
  #abandon: (() => void) | undefined;
  /** Reopens the waiting flow's own consent page — the lost-tab way back in. */
  #reopen: (() => void) | undefined;

  constructor(options: LinearSignInOptions) {
    this.#options = options;
  }

  signIn(): Effect.Effect<LinearSignInOutcome, LoopbackFailure, Http> {
    const config = linearSignInConfig(this.#options.environment);
    if (!config) return Effect.succeed({ reason: "Sign-in is not configured in this build." });
    if (this.#running) {
      return Effect.succeed({ reason: "A sign-in is already waiting in your browser." });
    }
    this.#running = true;
    return this.#run(config).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#running = false;
          this.#abandon = undefined;
          this.#reopen = undefined;
        }),
      ),
    );
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

  #run(config: LinearSignInConfig): Effect.Effect<LinearSignInOutcome, LoopbackFailure, Http> {
    return Effect.gen(this, function* () {
      const http = yield* Http;
      const verifier = createCodeVerifier();
      const challenge = codeChallenge(verifier);
      const state = randomUUID();
      const outcomeDeferred = yield* Deferred.make<LinearSignInOutcome>();
      let redirectUri = "";
      let callbackClaimed = false;

      const bound = yield* this.#bindLoopback(http, (request, response) =>
        this.#handleCallback(request, response, {
          config,
          verifier,
          state,
          http,
          getRedirectUri: () => redirectUri,
          getCallbackClaimed: () => callbackClaimed,
          setCallbackClaimed: () => {
            callbackClaimed = true;
          },
          finish: (outcome) => Deferred.succeed(outcomeDeferred, outcome),
        }),
      );
      if (bound === undefined) {
        return { reason: "Luke could not open a sign-in callback on this machine." };
      }
      const { server, port } = bound;
      redirectUri = `http://${LOOPBACK_HOST}:${port}${CALLBACK_PATH}`;

      const authorization = new URL(LINEAR_AUTHORIZATION_URL);
      authorization.searchParams.set("client_id", config.clientId);
      authorization.searchParams.set("redirect_uri", redirectUri);
      authorization.searchParams.set("response_type", "code");
      authorization.searchParams.set("scope", LINEAR_SCOPES);
      authorization.searchParams.set("code_challenge", challenge);
      authorization.searchParams.set("code_challenge_method", "S256");
      authorization.searchParams.set("actor", "user");
      authorization.searchParams.set("prompt", "consent");
      authorization.searchParams.set("state", state);

      const timeoutMs = this.#options.timeoutMs ?? SIGN_IN_TIMEOUT_MS;
      this.#abandon = () => {
        Deferred.unsafeDone(outcomeDeferred, Exit.succeed({ reason: "Sign-in was cancelled." }));
      };
      this.#reopen = () => this.#options.openExternal(authorization.toString());

      try {
        this.#options.openExternal(authorization.toString());
        return yield* Deferred.await(outcomeDeferred).pipe(
          Effect.timeout(Duration.millis(timeoutMs)),
          Effect.catchAll(() =>
            Effect.succeed({
              reason: "Sign-in timed out. Try again from the Linear row.",
            } as LinearSignInOutcome),
          ),
        );
      } finally {
        yield* http.closeServer(server);
        yield* http.closeAllConnections(server);
        yield* Effect.sync(() => {
          server.unref();
        });
      }
    });
  }

  #bindLoopback(
    http: Context.Tag.Service<Http>,
    onRequest: (
      request: IncomingMessage,
      response: ServerResponse,
    ) => Effect.Effect<void, LoopbackFailure>,
  ): Effect.Effect<
    { server: import("node:http").Server; port: number } | undefined,
    LoopbackFailure
  > {
    return Effect.gen(function* () {
      for (const port of LOOPBACK_PORTS) {
        const attempt = yield* http
          .listenLoopback({ host: LOOPBACK_HOST, port, onRequest })
          .pipe(Effect.either);
        if (attempt._tag === "Right") return attempt.right;
      }
      return undefined;
    });
  }

  #handleCallback(
    request: IncomingMessage,
    response: ServerResponse,
    options: {
      config: LinearSignInConfig;
      verifier: string;
      state: string;
      http: Context.Tag.Service<Http>;
      getRedirectUri: () => string;
      getCallbackClaimed: () => boolean;
      setCallbackClaimed: () => void;
      finish: (outcome: LinearSignInOutcome) => Effect.Effect<void>;
    },
  ): Effect.Effect<void, LoopbackFailure> {
    return Effect.gen(this, function* () {
      const url = new URL(request.url ?? "/", `http://${LOOPBACK_HOST}`);
      if (url.pathname !== CALLBACK_PATH || url.searchParams.get("state") !== options.state) {
        response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
        return;
      }
      if (options.getCallbackClaimed()) {
        response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
        return;
      }
      options.setCallbackClaimed();
      this.#abandon = undefined;
      const refused = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (refused || !code) {
        response
          .writeHead(200, { "content-type": "text/html; charset=utf-8" })
          .end(signInPage(false));
        yield* options.finish({ reason: "Linear did not grant access." });
        return;
      }
      const exchanged = yield* this.#exchange(
        options.config,
        code,
        options.verifier,
        options.getRedirectUri(),
      ).pipe(Effect.provideService(Http, options.http));
      response
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(signInPage(!("reason" in exchanged)));
      yield* options.finish(exchanged);
    });
  }

  #exchange(
    config: LinearSignInConfig,
    code: string,
    verifier: string,
    redirectUri: string,
  ): Effect.Effect<LinearSignInOutcome, never, Http> {
    const body = new URLSearchParams({
      code,
      client_id: config.clientId,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    });
    return Effect.gen(this, function* () {
      const http = yield* Http;
      const response = yield* http
        .request(LINEAR_TOKEN_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
        })
        .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      if (!response?.ok) return { reason: "Linear refused the sign-in exchange." };
      const payload = yield* http
        .readJson(response)
        .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      const grant = grantFrom(payload as UnparsedWireValue, (this.#options.now ?? Date.now)());
      if (!grant) return { reason: "Linear answered the sign-in without a token." };
      return grant;
    });
  }
}

/**
 * Tells Linear the grant is finished with, so disconnecting ends the access
 * at Linear rather than only forgetting it here. Best effort by design: the
 * user asked to disconnect, and a network that cannot carry the revocation is
 * not a reason to keep the grant on this machine — the caller deletes it
 * either way, and Linear's own settings remain the certain way to withdraw.
 */
export function revokeLinearGrant(
  token: string,
  tokenType: "access_token" | "refresh_token",
): Effect.Effect<boolean, never, Http> {
  return Effect.gen(function* () {
    const http = yield* Http;
    const response = yield* http
      .request(LINEAR_REVOKE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token, token_type_hint: tokenType }).toString(),
        signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
      })
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    return response?.ok ?? false;
  });
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
  REFUSED: "refused",
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
export function refreshLinearGrant(
  refreshToken: string,
  options: {
    environment?: NodeJS.ProcessEnv;
    now?: () => number;
  } = {},
): Effect.Effect<LinearRefreshOutcome, never, Http> {
  const config = linearSignInConfig(options.environment);
  if (!config) return Effect.succeed({ status: LINEAR_REFRESH_STATUS.UNREACHABLE });
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: config.clientId,
    grant_type: "refresh_token",
  });
  return Effect.gen(function* () {
    const http = yield* Http;
    const response = yield* http
      .request(LINEAR_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
      })
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    if (!response) return { status: LINEAR_REFRESH_STATUS.UNREACHABLE };
    if (!response.ok) {
      const payload = yield* http
        .readJson(response)
        .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      if (
        isRecord(payload as UnparsedWireValue) &&
        (payload as WireRecord).error === "invalid_grant"
      ) {
        return { status: LINEAR_REFRESH_STATUS.REFUSED };
      }
      return { status: LINEAR_REFRESH_STATUS.UNREACHABLE };
    }
    const payload = yield* http
      .readJson(response)
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    const grant = grantFrom(payload as UnparsedWireValue, (options.now ?? Date.now)());
    if (!grant?.refreshToken) return { status: LINEAR_REFRESH_STATUS.UNREACHABLE };
    return { status: LINEAR_REFRESH_STATUS.RENEWED, grant };
  });
}
