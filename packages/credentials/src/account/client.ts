import { HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import {
  isRecord,
  isWireString,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { webResponseFromClientResponse } from "@sidecar/wire/effect";
import { Duration, Effect, Fiber, type Layer } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type { AccountProvider } from "./snapshot.js";

export interface AccountTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AccountIdentity {
  /**
   * The account's own opaque id, exactly as the service's `sub` claim gives
   * it. It is the same id the hosted endpoints resolve a bearer token to, so
   * anything the desktop files under it lands on the person the desktop's own
   * counted events already belong to — and is erased with them when the
   * account is deleted. Nothing about the user can be read out of it.
   *
   * Optional, and its absence is never a refusal. Every hosted endpoint
   * resolves this same claim from the bearer token itself, so an identity
   * without one is signed in exactly as before and only the things that need
   * to name a person locally stand down. Refusing the sign-in instead would
   * trade an account for a feature.
   */
  id?: string;
  email: string;
  name?: string;
  pictureUrl?: string;
  provider: AccountProvider;
}

/**
 * The only hosts an avatar may be loaded from, matching the renderer's image
 * policy exactly: Google serves profile photos from `googleusercontent.com`
 * and GitHub from `avatars.githubusercontent.com`. A picture anywhere else is
 * dropped rather than handed to a renderer whose CSP would refuse it — and the
 * set is fixed by this build, like every address the renderer is given.
 */
function accountPictureUrl(value: UnparsedWireValue): string | undefined {
  if (!isWireString(value) || !value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  const host = url.hostname;
  const googleHosted = host === "googleusercontent.com" || host.endsWith(".googleusercontent.com");
  return googleHosted || host === "avatars.githubusercontent.com" ? url.toString() : undefined;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface AccountClientOptions {
  baseUrl: string;
  clientId: string;
  /** The `HttpClient` a test hands over in place of the ambient fetch client. */
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
  timeoutMs?: number;
}

export class AccountClientError extends Error {
  readonly status?: number | undefined;
  readonly oauthError?: string | undefined;

  constructor(
    message: string,
    options: { status?: number | undefined; oauthError?: string | undefined } = {},
  ) {
    super(message);
    this.name = "AccountClientError";
    this.status = options.status;
    this.oauthError = options.oauthError;
  }
}

function record(value: UnparsedWireValue): WireRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function responseRecord(response: Response): Effect.Effect<WireRecord, AccountClientError> {
  return Effect.gen(function* () {
    const body = record(yield* Effect.promise(() => response.json().catch(() => undefined)));
    if (!response.ok) {
      return yield* Effect.fail(
        new AccountClientError(
          text(body?.error_description) ?? `Account service returned ${response.status}`,
          {
            status: response.status,
            ...(text(body?.error) ? { oauthError: text(body?.error) } : undefined),
          },
        ),
      );
    }
    if (!body) {
      return yield* Effect.fail(
        new AccountClientError("Account service returned an invalid response"),
      );
    }
    return body;
  });
}

function tokensFrom(body: WireRecord): Effect.Effect<AccountTokens, AccountClientError> {
  if (!isWireString(body.access_token) || !isWireString(body.refresh_token)) {
    return Effect.fail(new AccountClientError("Account service did not return both tokens"));
  }
  return Effect.succeed({ accessToken: body.access_token, refreshToken: body.refresh_token });
}

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";

/**
 * One request over the client handed in, under its own deadline, which is
 * provided here so a caller yields the request without carrying an
 * `HttpClient` of its own. A client that could not carry it, or a body that
 * outlived the deadline, fails with the error it always carried — the
 * platform's own transport error for the first, a timeout named the way
 * `AbortSignal.timeout` always named it for the second — so every caller here
 * reads the same error it always did, on the failure channel rather than as a
 * throw. A defect joins it there, exactly as the promise this replaces
 * rejected with one. An interruption does not: a caller that cut this fiber
 * is not a request that failed, and every reader of a failure here — the
 * sign-out's report, the withdrawn sign-in — tells the two apart.
 */
function timedRequest(
  client: Layer.Layer<HttpClient.HttpClient>,
  request: HttpClientRequest.HttpClientRequest,
  timeoutMs: number,
): Effect.Effect<Response, Error> {
  return HttpClient.execute(request).pipe(
    Effect.flatMap(webResponseFromClientResponse),
    Effect.timeoutOrElse({
      duration: Duration.millis(timeoutMs),
      orElse: () => Effect.fail(new DOMException("The request timed out", "TimeoutError")),
    }),
    Effect.provide(client),
    Effect.catch((error) => Effect.fail(asError(error))),
    Effect.catchDefect((defect) => Effect.fail(asError(defect))),
  );
}

/** What a failure or a defect carries, as the `Error` every caller here reads. */
function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

export class AccountClient {
  readonly #baseUrl: string;
  readonly #clientId: string;
  readonly #client: Layer.Layer<HttpClient.HttpClient>;
  readonly #timeoutMs: number;

  constructor(options: AccountClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#clientId = options.clientId;
    this.#client = options.httpClient ?? FetchHttpClient.layer;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
  }

  authorizeUrl(input: { redirectUri: string; state: string; codeChallenge: string }): string {
    const url = new URL(`${this.#baseUrl}/oauth2/authorize`);
    url.search = new URLSearchParams({
      client_id: this.#clientId,
      response_type: "code",
      redirect_uri: input.redirectUri,
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
      scope: "openid profile email offline_access",
      prompt: "login",
    }).toString();
    return url.toString();
  }

  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Effect.Effect<AccountTokens, Error> {
    return Effect.flatMap(
      this.#token({
        grant_type: "authorization_code",
        code: input.code,
        code_verifier: input.codeVerifier,
        client_id: this.#clientId,
        redirect_uri: input.redirectUri,
      }),
      tokensFrom,
    );
  }

  refresh(refreshToken: string): Effect.Effect<AccountTokens, Error> {
    return Effect.flatMap(
      this.#token({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.#clientId,
      }),
      (body) => tokensFrom({ ...body, refresh_token: body.refresh_token ?? refreshToken }),
    );
  }

  /** Revokes the long-lived credential; local sign-out never depends on this succeeding. */
  revoke(refreshToken: string): Effect.Effect<void, Error> {
    return Effect.gen({ self: this }, function* () {
      const response = yield* timedRequest(
        this.#client,
        HttpClientRequest.post(`${this.#baseUrl}/oauth2/revoke`, {
          body: HttpBody.raw(
            new URLSearchParams({
              client_id: this.#clientId,
              token: refreshToken,
              token_type_hint: "refresh_token",
            }).toString(),
            { contentType: FORM_CONTENT_TYPE },
          ),
        }),
        this.#timeoutMs,
      );
      if (!response.ok) yield* responseRecord(response);
    });
  }

  userInfo(accessToken: string, provider: AccountProvider): Effect.Effect<AccountIdentity, Error> {
    return Effect.gen({ self: this }, function* () {
      const response = yield* timedRequest(
        this.#client,
        HttpClientRequest.get(`${this.#baseUrl}/oauth2/userinfo`, {
          headers: { authorization: `Bearer ${accessToken}` },
        }),
        this.#timeoutMs,
      );
      const body = yield* responseRecord(response);
      if (!isWireString(body.email)) {
        return yield* Effect.fail(
          new AccountClientError("Account service returned an invalid identity"),
        );
      }
      const pictureUrl = accountPictureUrl(body.picture);
      return {
        ...(isWireString(body.sub) && body.sub ? { id: body.sub } : undefined),
        email: body.email,
        ...(isWireString(body.name) && body.name ? { name: body.name } : undefined),
        ...(pictureUrl ? { pictureUrl } : undefined),
        provider,
      };
    });
  }

  #token(fields: Record<string, string>): Effect.Effect<WireRecord, Error> {
    return Effect.flatMap(
      timedRequest(
        this.#client,
        HttpClientRequest.post(`${this.#baseUrl}/oauth2/token`, {
          body: HttpBody.raw(new URLSearchParams(fields).toString(), {
            contentType: FORM_CONTENT_TYPE,
          }),
        }),
        this.#timeoutMs,
      ),
      responseRecord,
    );
  }
}

/** The signed-in identity with the tokens it was issued, as the store keeps it. */
export interface StoredAccount extends AccountIdentity {
  accessToken: string;
  refreshToken: string;
}

export const ACCOUNT_FAILURE_ACTION = {
  KEEP_ACCOUNT: "keep-account",
  SIGN_OUT: "sign-out",
} as const;

export type AccountFailureAction =
  (typeof ACCOUNT_FAILURE_ACTION)[keyof typeof ACCOUNT_FAILURE_ACTION];

/** Only the OAuth server's definitive revocation answer removes a stored account. */
export function accountFailureAction(error: Error): AccountFailureAction {
  return error instanceof AccountClientError && error.oauthError === "invalid_grant"
    ? ACCOUNT_FAILURE_ACTION.SIGN_OUT
    : ACCOUNT_FAILURE_ACTION.KEEP_ACCOUNT;
}

/** Whether the pinned auth provider has definitively rejected an access token. */
export function accessTokenNeedsRefresh(error: Error): boolean {
  return (
    error instanceof AccountClientError &&
    (error.status === 401 || error.oauthError === "invalid_scope")
  );
}

/** Fixture and capture modes remain deterministic and never need an account. */
export function accountGateOpen(
  runMode: { readonly requiresAccount: boolean },
  signedIn: boolean,
): boolean {
  return !runMode.requiresAccount || signedIn;
}

const DELETE_TIMEOUT_MS = 15_000;

export interface AccountDeletionOptions {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  /** The signed-in account's current access token. */
  accessToken: string;
  /** The `HttpClient` a test hands over in place of the ambient fetch client. */
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
  timeoutMs?: number;
}

/**
 * Asks the hosted service to erase the signed-in account. The bearer token is
 * the whole request — the service resolves who to delete from it, so nothing
 * here can name a different account. A refusal fails with an
 * `AccountClientError` carrying the status, which is what lets the caller tell
 * an expired access token (refresh and retry) from a service that actually
 * said no.
 */
export function deleteHostedAccount(options: AccountDeletionOptions): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    const response = yield* timedRequest(
      options.httpClient ?? FetchHttpClient.layer,
      HttpClientRequest.post(
        `${options.serviceBaseUrl.replace(/\/$/, "")}${HOSTED_SERVICE_PATH.ACCOUNT_DELETE}`,
        { headers: { authorization: `Bearer ${options.accessToken}` } },
      ),
      options.timeoutMs ?? DELETE_TIMEOUT_MS,
    );
    if (!response.ok) {
      return yield* Effect.fail(
        new AccountClientError(`Account service returned ${response.status}`, {
          status: response.status,
        }),
      );
    }
  });
}

/**
 * One call made on a fiber of its own and waited for where it was asked for.
 * The revocation below runs as a failed attempt unwinds, where
 * `Effect.onError`'s cleanup is uninterruptible — and an uninterruptible
 * region is one nothing inside it may interrupt either, including the
 * deadline {@link timedRequest} races against its own request, which would
 * then never win and never end a hung revocation. The call is forked as a
 * daemon and made interruptible again, so its deadline ends it exactly as it
 * did when the request ran on a fiber of its own, and the unwinding still
 * waits for what it asked for.
 */
function onOwnFiber<A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> {
  return Effect.flatMap(Effect.forkDetach(Effect.interruptible(effect)), Fiber.join);
}

/**
 * Ensures credentials rejected before sign-in completes do not outlive the
 * failed attempt. The revocation runs on the way out of any end the use did
 * not reach — a failure, a defect, or an interruption — because a refresh
 * token nobody holds is the same live credential however the attempt ended.
 */
export function withIssuedAccountTokens<A>(options: {
  issue: Effect.Effect<AccountTokens, Error>;
  use: (tokens: AccountTokens) => Effect.Effect<A, Error>;
  revoke: (refreshToken: string) => Effect.Effect<void, Error>;
  onRevokeFailure?: (error: Error) => void;
}): Effect.Effect<A, Error> {
  return Effect.gen(function* () {
    const tokens = yield* options.issue;
    return yield* Effect.onError(options.use(tokens), () =>
      Effect.catch(onOwnFiber(options.revoke(tokens.refreshToken)), (error) =>
        Effect.sync(() => options.onRevokeFailure?.(error)),
      ),
    );
  });
}
