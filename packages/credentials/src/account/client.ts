import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import * as HttpBody from "@effect/platform/HttpBody";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import { HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import {
  isRecord,
  isWireString,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { webResponseFromClientResponse } from "@sidecar/wire/effect";
import { Cause, Duration, Effect, Exit, type Layer } from "effect";
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

async function responseRecord(response: Response): Promise<WireRecord> {
  const body = record(await response.json().catch(() => undefined));
  if (!response.ok) {
    throw new AccountClientError(
      text(body?.error_description) ?? `Account service returned ${response.status}`,
      {
        status: response.status,
        ...(text(body?.error) ? { oauthError: text(body?.error) } : undefined),
      },
    );
  }
  if (!body) throw new AccountClientError("Account service returned an invalid response");
  return body;
}

function tokensFrom(body: WireRecord): AccountTokens {
  if (!isWireString(body.access_token) || !isWireString(body.refresh_token)) {
    throw new AccountClientError("Account service did not return both tokens");
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";

/**
 * One request over the ambient `HttpClient`, under its own deadline. A
 * client that could not carry it, or a body that outlived the deadline, ends
 * the request as the failure `Cause.squash` unwraps back to the caller — the
 * platform's own transport error for the first, a timeout named the way
 * `AbortSignal.timeout` always named it for the second — so every caller here
 * keeps reading a thrown error exactly as it always did.
 *
 * @deprecated This is the promise-facing seam on the `Effect.runPromise`
 * allowlist in `docs/adr/0001-effect.md`: `AccountClient` and
 * `deleteHostedAccount` still answer a Promise, so the request built over the
 * ambient `HttpClient` is run to a promise here rather than left to a
 * caller's own fiber. Deleted once both take a fiber of their own instead.
 */
function timedRequest(
  client: Layer.Layer<HttpClient.HttpClient>,
  request: HttpClientRequest.HttpClientRequest,
  timeoutMs: number,
): Promise<Response> {
  const answer = HttpClient.execute(request).pipe(
    Effect.flatMap(webResponseFromClientResponse),
    Effect.timeoutFail({
      duration: Duration.millis(timeoutMs),
      onTimeout: () => new DOMException("The request timed out", "TimeoutError"),
    }),
  );
  return Effect.runPromiseExit(Effect.provide(answer, client)).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
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

  async exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<AccountTokens> {
    return tokensFrom(
      await this.#token({
        grant_type: "authorization_code",
        code: input.code,
        code_verifier: input.codeVerifier,
        client_id: this.#clientId,
        redirect_uri: input.redirectUri,
      }),
    );
  }

  async refresh(refreshToken: string): Promise<AccountTokens> {
    const body = await this.#token({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.#clientId,
    });
    const refreshed = tokensFrom({ ...body, refresh_token: body.refresh_token ?? refreshToken });
    return refreshed;
  }

  /** Revokes the long-lived credential; local sign-out never depends on this succeeding. */
  async revoke(refreshToken: string): Promise<void> {
    const response = await timedRequest(
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
    if (!response.ok) await responseRecord(response);
  }

  async userInfo(accessToken: string, provider: AccountProvider): Promise<AccountIdentity> {
    const response = await timedRequest(
      this.#client,
      HttpClientRequest.get(`${this.#baseUrl}/oauth2/userinfo`, {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      this.#timeoutMs,
    );
    const body = await responseRecord(response);
    if (!isWireString(body.email)) {
      throw new AccountClientError("Account service returned an invalid identity");
    }
    const pictureUrl = accountPictureUrl(body.picture);
    return {
      ...(isWireString(body.sub) && body.sub ? { id: body.sub } : undefined),
      email: body.email,
      ...(isWireString(body.name) && body.name ? { name: body.name } : undefined),
      ...(pictureUrl ? { pictureUrl } : undefined),
      provider,
    };
  }

  async #token(fields: Record<string, string>): Promise<WireRecord> {
    const response = await timedRequest(
      this.#client,
      HttpClientRequest.post(`${this.#baseUrl}/oauth2/token`, {
        body: HttpBody.raw(new URLSearchParams(fields).toString(), {
          contentType: FORM_CONTENT_TYPE,
        }),
      }),
      this.#timeoutMs,
    );
    return responseRecord(response);
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
 * here can name a different account. A refusal throws an `AccountClientError`
 * carrying the status, which is what lets the caller tell an expired access
 * token (refresh and retry) from a service that actually said no.
 */
export async function deleteHostedAccount(options: AccountDeletionOptions): Promise<void> {
  const response = await timedRequest(
    options.httpClient ?? FetchHttpClient.layer,
    HttpClientRequest.post(
      `${options.serviceBaseUrl.replace(/\/$/, "")}${HOSTED_SERVICE_PATH.ACCOUNT_DELETE}`,
      { headers: { authorization: `Bearer ${options.accessToken}` } },
    ),
    options.timeoutMs ?? DELETE_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new AccountClientError(`Account service returned ${response.status}`, {
      status: response.status,
    });
  }
}

/** Ensures credentials rejected before sign-in completes do not outlive the failed attempt. */
export async function withIssuedAccountTokens<T>(options: {
  issue: () => Promise<AccountTokens>;
  use: (tokens: AccountTokens) => Promise<T>;
  revoke: (refreshToken: string) => Promise<void>;
  onRevokeFailure?: (error: Error) => void;
}): Promise<T> {
  const tokens = await options.issue();
  try {
    return await options.use(tokens);
  } catch (error) {
    await options.revoke(tokens.refreshToken).catch((revokeError) => {
      options.onRevokeFailure?.(revokeError);
    });
    throw error;
  }
}
