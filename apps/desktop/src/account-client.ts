import { ACCOUNT_PROVIDER, type AccountProvider } from "./shared/contracts";

export interface AccountTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AccountIdentity {
  email: string;
  name?: string;
  provider: AccountProvider;
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

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function responseRecord(response: Response): Promise<Record<string, unknown>> {
  const body = record(await response.json().catch(() => undefined));
  if (!response.ok) {
    throw new AccountClientError(
      typeof body?.error_description === "string"
        ? body.error_description
        : `Account service returned ${response.status}`,
      {
        status: response.status,
        ...(typeof body?.error === "string" ? { oauthError: body.error } : {}),
      },
    );
  }
  if (!body) throw new AccountClientError("Account service returned an invalid response");
  return body;
}

function tokensFrom(body: Record<string, unknown>): AccountTokens {
  if (typeof body.access_token !== "string" || typeof body.refresh_token !== "string") {
    throw new AccountClientError("Account service did not return both tokens");
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

function isAccountProvider(value: unknown): value is AccountProvider {
  return value === ACCOUNT_PROVIDER.GOOGLE || value === ACCOUNT_PROVIDER.GITHUB;
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

  async userInfo(accessToken: string): Promise<AccountIdentity> {
    const response = await this.#fetch(`${this.#baseUrl}/oauth2/userinfo`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    const body = await responseRecord(response);
    if (typeof body.email !== "string" || !isAccountProvider(body.provider)) {
      throw new AccountClientError("Account service returned an invalid identity");
    }
    return {
      email: body.email,
      ...(typeof body.name === "string" && body.name ? { name: body.name } : {}),
      provider: body.provider,
    };
  }

  async #token(fields: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await this.#fetch(`${this.#baseUrl}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    return responseRecord(response);
  }
}
