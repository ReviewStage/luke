import {
  isRecord,
  isWireString,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/core";
import { AccountClientFailure, type CloudFailure } from "@sidecar/core/effect-errors";
import { Effect } from "effect";
import { Http } from "./services/http";
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

export interface AccountClientOptions {
  baseUrl: string;
  clientId: string;
  timeoutMs?: number;
}

function record(value: UnparsedWireValue): WireRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function responseRecord(
  body: unknown,
  response: Response,
): Effect.Effect<WireRecord, AccountClientFailure> {
  if (!response.ok) {
    const parsed = record(body as UnparsedWireValue);
    return Effect.fail(
      new AccountClientFailure({
        status: response.status,
        ...(text(parsed?.error) ? { oauthError: text(parsed?.error) } : undefined),
      }),
    );
  }
  const parsed = record(body as UnparsedWireValue);
  if (!parsed) return Effect.fail(new AccountClientFailure({}));
  return Effect.succeed(parsed);
}

function tokensFrom(body: WireRecord): Effect.Effect<AccountTokens, AccountClientFailure> {
  if (!isWireString(body.access_token) || !isWireString(body.refresh_token)) {
    return Effect.fail(new AccountClientFailure({}));
  }
  return Effect.succeed({ accessToken: body.access_token, refreshToken: body.refresh_token });
}

export class AccountClient {
  readonly #baseUrl: string;
  readonly #clientId: string;
  readonly #timeoutMs: number;

  constructor(options: AccountClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#clientId = options.clientId;
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
  }): Effect.Effect<AccountTokens, AccountClientFailure | CloudFailure, Http> {
    return Effect.gen(this, function* () {
      const body = yield* this.#token({
        grant_type: "authorization_code",
        code: input.code,
        code_verifier: input.codeVerifier,
        client_id: this.#clientId,
        redirect_uri: input.redirectUri,
      });
      return yield* tokensFrom(body);
    });
  }

  refresh(
    refreshToken: string,
  ): Effect.Effect<AccountTokens, AccountClientFailure | CloudFailure, Http> {
    return Effect.gen(this, function* () {
      const body = yield* this.#token({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.#clientId,
      });
      return yield* tokensFrom({ ...body, refresh_token: body.refresh_token ?? refreshToken });
    });
  }

  /** Revokes the long-lived credential; local sign-out never depends on this succeeding. */
  revoke(refreshToken: string): Effect.Effect<void, AccountClientFailure | CloudFailure, Http> {
    return Effect.gen(this, function* () {
      const http = yield* Http;
      const response = yield* http.request(`${this.#baseUrl}/oauth2/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.#clientId,
          token: refreshToken,
          token_type_hint: "refresh_token",
        }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!response.ok) yield* responseRecord(yield* http.readJson(response), response);
    });
  }

  userInfo(
    accessToken: string,
    provider: AccountProvider,
  ): Effect.Effect<AccountIdentity, AccountClientFailure | CloudFailure, Http> {
    return Effect.gen(this, function* () {
      const http = yield* Http;
      const response = yield* http.request(`${this.#baseUrl}/oauth2/userinfo`, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      const body = yield* responseRecord(yield* http.readJson(response), response);
      if (!isWireString(body.email)) {
        return yield* Effect.fail(new AccountClientFailure({}));
      }
      const pictureUrl = accountPictureUrl(body.picture);
      return {
        email: body.email,
        ...(isWireString(body.name) && body.name ? { name: body.name } : undefined),
        ...(pictureUrl ? { pictureUrl } : undefined),
        provider,
      };
    });
  }

  #token(
    fields: Record<string, string>,
  ): Effect.Effect<WireRecord, AccountClientFailure | CloudFailure, Http> {
    return Effect.gen(this, function* () {
      const http = yield* Http;
      const response = yield* http.request(`${this.#baseUrl}/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      return yield* responseRecord(yield* http.readJson(response), response);
    });
  }
}
