import { fixedBearer, HOSTED_API_ERROR } from "@repo/features";
import { pinnedPictureUrl } from "@repo/features/account-picture";
import { askHosted, type HostedFailure, hostedClient } from "@repo/features/hosted-link";
import { onOwnFiber } from "@repo/runtime/effect";
import {
  HTTP_STATUS,
  isRecord,
  isWireString,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@repo/wire";
import { webResponseFromClientResponse } from "@repo/wire/effect";
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
  id?: string;
  email: string;
  name?: string;
  pictureUrl?: string;
  provider: AccountProvider;
}

function accountPictureUrl(value: UnparsedWireValue): string | undefined {
  return isWireString(value) ? pinnedPictureUrl(value) : undefined;
}

interface AccountClientOptions {
  baseUrl: string;
  clientId: string;
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
  timeoutMs?: number;
}

class AccountClientError extends Data.TaggedError("AccountClientError")<{
  readonly message: string;
  readonly status?: number | undefined;
  readonly oauthError?: string | undefined;
}> {}

class AccountTransportError extends Data.TaggedError("AccountTransportError")<{
  readonly message: string;
  readonly errorName: string | undefined;
}> {}

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

const SESSION_TOKEN_HEADER = "set-auth-token";

export interface AccountSession {
  sessionToken: string;
  userId: string;
  email: string;
}

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

export interface StoredAccount extends AccountIdentity {
  accessToken: string;
  refreshToken: string;
  sessionToken?: string;
}

export const ACCOUNT_FAILURE_ACTION = {
  KEEP_ACCOUNT: "keep-account",
  SIGN_OUT: "sign-out",
} as const;

type AccountFailureAction = (typeof ACCOUNT_FAILURE_ACTION)[keyof typeof ACCOUNT_FAILURE_ACTION];

export function accountFailureAction(error: AccountClientFailure): AccountFailureAction {
  return error._tag === "AccountClientError" && error.oauthError === "invalid_grant"
    ? ACCOUNT_FAILURE_ACTION.SIGN_OUT
    : ACCOUNT_FAILURE_ACTION.KEEP_ACCOUNT;
}

export function accessTokenNeedsRefresh(error: AccountClientFailure): boolean {
  return (
    error._tag === "AccountClientError" &&
    (error.status === 401 || error.oauthError === "invalid_scope")
  );
}

export function accountGateOpen(
  runMode: { readonly requiresAccount: boolean },
  signedIn: boolean,
): boolean {
  return !runMode.requiresAccount || signedIn;
}

const DELETE_TIMEOUT_MS = 15_000;

interface AccountDeletionOptions {
  serviceBaseUrl: string;
  accessToken: string;
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
  timeoutMs?: number;
}

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
