import { fixedBearer, HOSTED_API_ERROR } from "@luke/features";
import { pinnedPictureUrl } from "@luke/features/account-picture";
import { askHosted, type HostedFailure, hostedClient } from "@luke/features/hosted-link";
import { onOwnFiber } from "@luke/runtime/effect";
import {
  HTTP_STATUS,
  isRecord,
  isWireString,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@luke/wire";
import { webResponseFromClientResponse } from "@luke/wire/effect";
import { Data, Duration, Effect, type Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
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
 * The account's picture, kept only where it is drawn from a host the
 * renderer's image policy allows (`@luke/features/account-picture`, the one
 * rule the service's workspace read follows too).
 */
function accountPictureUrl(value: UnparsedWireValue): string | undefined {
  return isWireString(value) ? pinnedPictureUrl(value) : undefined;
}

interface AccountClientOptions {
  baseUrl: string;
  clientId: string;
  /** The `HttpClient` a test hands over in place of the ambient fetch client. */
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
  timeoutMs?: number;
}

/**
 * The account service's own answer to a request that reached it: a status and
 * the OAuth code the body named, when it named one, or a body that would not
 * read. Everything that decides on a failure below — the renewal, the
 * sign-out — reads these two fields and nothing else.
 */
class AccountClientError extends Data.TaggedError("AccountClientError")<{
  readonly message: string;
  readonly status?: number | undefined;
  readonly oauthError?: string | undefined;
}> {}

/**
 * A request that reached no status at all: a client that could not carry it,
 * or the deadline. The name is the error's kind, the way `AbortSignal.timeout`
 * always named its own, so a reader tells a timeout from a closed socket.
 */
class AccountTransportError extends Data.TaggedError("AccountTransportError")<{
  readonly message: string;
  readonly errorName: string | undefined;
}> {}

/** Every way a call on the account service fails. */
export type AccountClientFailure = AccountClientError | AccountTransportError;

function record(value: UnparsedWireValue): WireRecord | undefined {
  return isRecord(value) ? value : undefined;
}

const responseRecord = /* @__PURE__ */ Effect.fnUntraced(function* (
  response: Response,
): Effect.fn.Return<WireRecord, AccountClientError> {
  const body = record(yield* Effect.promise(() => response.json().catch(() => undefined)));
  if (!response.ok) {
    return yield* Effect.fail(
      new AccountClientError({
        message: text(body?.error_description) ?? `Account service returned ${response.status}`,
        status: response.status,
        ...(text(body?.error) ? { oauthError: text(body?.error) } : undefined),
      }),
    );
  }
  if (!body) {
    return yield* Effect.fail(
      new AccountClientError({ message: "Account service returned an invalid response" }),
    );
  }
  return body;
});

function tokensFrom(body: WireRecord): Effect.Effect<AccountTokens, AccountClientError> {
  if (!isWireString(body.access_token) || !isWireString(body.refresh_token)) {
    return Effect.fail(
      new AccountClientError({ message: "Account service did not return both tokens" }),
    );
  }
  return Effect.succeed({
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
  });
}

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";

const JSON_CONTENT_TYPE = "application/json";

/**
 * The response header Better Auth's bearer plugin hands a session out in,
 * signed under the service's secret: the one form of the token the service
 * takes back as a bearer (https://www.better-auth.com/docs/plugins/bearer).
 */
const SESSION_TOKEN_HEADER = "set-auth-token";

/** The Mac's own Better Auth session, and whose it is. */
export interface AccountSession {
  /** The signed session token, sent back as `Authorization: Bearer`. */
  sessionToken: string;
  /** The account the session is for, as the service's `sub` names it. */
  userId: string;
  /** That account's address, for a stored account that names no id. */
  email: string;
}

/** The session the exchange answered, read off the bearer plugin's header and the plugin's own body. */
function sessionFrom(
  response: Response,
  body: WireRecord,
): Effect.Effect<AccountSession, AccountClientError> {
  const sessionToken = response.headers.get(SESSION_TOKEN_HEADER);
  const user = record(body.user);
  if (!sessionToken || !isWireString(user?.id) || !user.id || !isWireString(user.email)) {
    return Effect.fail(
      new AccountClientError({ message: "Account service did not return a session" }),
    );
  }
  return Effect.succeed({ sessionToken, userId: user.id, email: user.email });
}

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
): Effect.Effect<Response, AccountTransportError> {
  return HttpClient.execute(request).pipe(
    Effect.flatMap(webResponseFromClientResponse),
    Effect.timeoutOrElse({
      duration: Duration.millis(timeoutMs),
      orElse: () => Effect.fail(new DOMException("The request timed out", "TimeoutError")),
    }),
    Effect.provide(client),
    Effect.catch((error) => Effect.fail(transportError(error))),
    Effect.catchDefect((defect) => Effect.fail(transportError(defect))),
  );
}

/** What a failure or a defect carried, named by its kind and worded as it was. */
function transportError(cause: unknown): AccountTransportError {
  return new AccountTransportError({
    message: cause instanceof Error ? cause.message : String(cause),
    errorName: cause instanceof Error ? cause.name : undefined,
  });
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
  }): Effect.Effect<AccountTokens, AccountClientFailure> {
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

  refresh(refreshToken: string): Effect.Effect<AccountTokens, AccountClientFailure> {
    return Effect.flatMap(
      this.#token({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.#clientId,
      }),
      (body) =>
        tokensFrom({
          ...body,
          refresh_token: body.refresh_token ?? refreshToken,
        }),
    );
  }

  /** Revokes the long-lived credential; local sign-out never depends on this succeeding. */
  revoke(refreshToken: string): Effect.Effect<void, AccountClientFailure> {
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

  /**
   * Exchanges the Electron plugin's single-use code for a session of this
   * Mac's own, as the plugin's `/electron/token` takes it: the code, the
   * state it was asked for under, and the PKCE verifier whose challenge the
   * hand-off page carried
   * (https://www.better-auth.com/docs/integrations/electron#manual-token-exchange).
   */
  exchangeSessionCode(input: {
    code: string;
    state: string;
    codeVerifier: string;
  }): Effect.Effect<AccountSession, AccountClientFailure> {
    return Effect.gen({ self: this }, function* () {
      const response = yield* timedRequest(
        this.#client,
        HttpClientRequest.post(`${this.#baseUrl}/electron/token`, {
          body: HttpBody.raw(
            JSON.stringify({
              token: input.code,
              state: input.state,
              code_verifier: input.codeVerifier,
            }),
            { contentType: JSON_CONTENT_TYPE },
          ),
        }),
        this.#timeoutMs,
      );
      return yield* sessionFrom(response, yield* responseRecord(response));
    });
  }

  /** Ends the Mac's session on the service; local sign-out never depends on this succeeding. */
  endSession(sessionToken: string): Effect.Effect<void, AccountClientFailure> {
    return Effect.gen({ self: this }, function* () {
      const response = yield* timedRequest(
        this.#client,
        HttpClientRequest.post(`${this.#baseUrl}/sign-out`, {
          headers: { authorization: `Bearer ${sessionToken}` },
          body: HttpBody.raw("{}", { contentType: JSON_CONTENT_TYPE }),
        }),
        this.#timeoutMs,
      );
      if (!response.ok) yield* responseRecord(response);
    });
  }

  userInfo(
    accessToken: string,
    provider: AccountProvider,
  ): Effect.Effect<AccountIdentity, AccountClientFailure> {
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
          new AccountClientError({ message: "Account service returned an invalid identity" }),
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

  #token(fields: Record<string, string>): Effect.Effect<WireRecord, AccountClientFailure> {
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
  /**
   * The Mac's own Better Auth session, signed, for the endpoints that take a
   * session rather than an OAuth token. Absent for an account signed in
   * before the Mac held one, or whose hand-off did not complete.
   */
  sessionToken?: string;
}

export const ACCOUNT_FAILURE_ACTION = {
  KEEP_ACCOUNT: "keep-account",
  SIGN_OUT: "sign-out",
} as const;

type AccountFailureAction = (typeof ACCOUNT_FAILURE_ACTION)[keyof typeof ACCOUNT_FAILURE_ACTION];

/** Only the OAuth server's definitive revocation answer removes a stored account. */
export function accountFailureAction(error: AccountClientFailure): AccountFailureAction {
  return error._tag === "AccountClientError" && error.oauthError === "invalid_grant"
    ? ACCOUNT_FAILURE_ACTION.SIGN_OUT
    : ACCOUNT_FAILURE_ACTION.KEEP_ACCOUNT;
}

/** Whether the pinned auth provider has definitively rejected an access token. */
export function accessTokenNeedsRefresh(error: AccountClientFailure): boolean {
  return (
    error._tag === "AccountClientError" &&
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

interface AccountDeletionOptions {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  /** The signed-in account's current access token. */
  accessToken: string;
  /** The `HttpClient` a test hands over in place of the ambient fetch client. */
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
  timeoutMs?: number;
}

/**
 * A deletion that did not land, as the caller reads it: a refusal the
 * service answered, an expired access token among them as the 401 it is, or
 * a request that reached no answer this build could read.
 */
function deletionFailure(failed: HostedFailure): AccountClientFailure {
  if (failed._tag === "HostedRefused") {
    return new AccountClientError({
      message: `Account service refused the deletion: ${failed.refusal}`,
      ...(failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN
        ? { status: HTTP_STATUS.UNAUTHORIZED }
        : undefined),
    });
  }
  if (failed.fault === undefined) {
    return new AccountClientError({ message: "Account service returned an invalid response" });
  }
  return new AccountTransportError({
    message: `Account service did not answer the deletion: ${failed.fault}`,
    errorName: failed.errorName,
  });
}

/**
 * Asks the hosted service to erase the signed-in account. The bearer token is
 * the whole request — the service resolves who to delete from it, so nothing
 * here can name a different account. The token is the one handed in and is
 * never renewed here: a refusal fails with an `AccountClientError`, an
 * expired access token carrying its 401, which is what lets the caller tell
 * an expired access token (refresh and retry) from a service that actually
 * said no.
 */
export const deleteHostedAccount = /* @__PURE__ */ Effect.fn("credentials/deleteHostedAccount")(
  function* (options: AccountDeletionOptions): Effect.fn.Return<void, AccountClientFailure> {
    const hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: fixedBearer(options.accessToken),
      requestTimeoutMs: options.timeoutMs ?? DELETE_TIMEOUT_MS,
    });
    yield* askHosted(hosted.account.delete, undefined).pipe(
      Effect.provide(options.httpClient ?? FetchHttpClient.layer),
      Effect.mapError(deletionFailure),
    );
  },
);

/**
 * One call made on a fiber of its own and waited for where it was asked for.
 * The revocation below runs as a failed attempt unwinds, where
 * `Effect.onError`'s cleanup is uninterruptible — and an uninterruptible
 * region is one nothing inside it may interrupt either, including the
 * deadline {@link timedRequest} races against its own request, which would
 * then never win and never end a hung revocation. The call is forked as a
 * daemon, and a fork is interruptible whatever the status of the fiber that
 * made it, so its deadline ends it exactly as it did when the request ran on a
 * fiber of its own, and the unwinding still waits for what it asked for.
 */
/**
 * Ensures credentials rejected before sign-in completes do not outlive the
 * failed attempt. The revocation runs on the way out of any end the use did
 * not reach — a failure, a defect, or an interruption — because a refresh
 * token nobody holds is the same live credential however the attempt ended.
 */
export function withIssuedAccountTokens<A, E>(options: {
  issue: Effect.Effect<AccountTokens, AccountClientFailure>;
  use: (tokens: AccountTokens) => Effect.Effect<A, E>;
  revoke: (refreshToken: string) => Effect.Effect<void, AccountClientFailure>;
  onRevokeFailure?: (error: AccountClientFailure) => void;
}): Effect.Effect<A, E | AccountClientFailure> {
  return Effect.gen(function* () {
    const tokens = yield* options.issue;
    return yield* Effect.onError(options.use(tokens), () =>
      Effect.catch(onOwnFiber(options.revoke(tokens.refreshToken)), (error) =>
        Effect.sync(() => options.onRevokeFailure?.(error)),
      ),
    );
  });
}
