import {
  isRecord,
  isWireString,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/core";
import type { AccountProvider } from "./shared/contracts";

export interface AccountTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AccountIdentity {
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
export function accountPictureUrl(value: UnparsedWireValue): string | undefined {
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
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class AccountClientError extends Error {
  readonly status?: number;
  readonly oauthError?: string;

  constructor(message: string, options: { status?: number; oauthError?: string } = {}) {
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

export class AccountClient {
  readonly #baseUrl: string;
  readonly #clientId: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  constructor(options: AccountClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#clientId = options.clientId;
    this.#fetch = options.fetch ?? fetch;
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
    const response = await this.#fetch(`${this.#baseUrl}/oauth2/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.#clientId,
        token: refreshToken,
        token_type_hint: "refresh_token",
      }),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) await responseRecord(response);
  }

  async userInfo(accessToken: string, provider: AccountProvider): Promise<AccountIdentity> {
    const response = await this.#fetch(`${this.#baseUrl}/oauth2/userinfo`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    const body = await responseRecord(response);
    if (!isWireString(body.email)) {
      throw new AccountClientError("Account service returned an invalid identity");
    }
    const pictureUrl = accountPictureUrl(body.picture);
    return {
      email: body.email,
      ...(isWireString(body.name) && body.name ? { name: body.name } : undefined),
      ...(pictureUrl ? { pictureUrl } : undefined),
      provider,
    };
  }

  async #token(fields: Record<string, string>): Promise<WireRecord> {
    const response = await this.#fetch(`${this.#baseUrl}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    return responseRecord(response);
  }
}
