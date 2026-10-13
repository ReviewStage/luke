/**
 * linear-connect.ts -- Vercel Connect, as Luke asks it about one account's Linear grant.
 *
 * Vercel Connect holds every account's Linear grant, encrypted, and refreshes
 * it; Luke names the account by its own user id as the grant's subject and
 * never stores a token. Three things are ever asked: a browser sign-in for
 * the account to begin, the account's token now, and the grant revoked. Each
 * answers either what was asked or one of three fixed words, never Connect's
 * own message: an error's message is Connect's or the provider's words, which
 * nothing here can vouch for holding no credential, so what a failure keeps
 * is its word and, where it carries them, Connect's machine code and status.
 *
 * Asking Connect for another user's token needs the deployment's own Vercel
 * OIDC token, which the SDK reads from the request or the environment
 * itself; the one thing this deployment configures is the connector's UID,
 * `LINEAR_CONNECTOR_UID`. A deployment without it answers every ask as not
 * configured, and every agent still runs, only without Linear.
 */

import {
  ConnectError,
  ConnectorInstallationRequiredError,
  getTokenResponse,
  NoValidTokenError,
  revokeToken,
  startAuthorization,
  UserAuthorizationRequiredError,
} from "@vercel/connect";
import { Config, Context, Data, Effect, Layer, Option, Redacted } from "effect";
import { text } from "../core.js";

/** The variable the connector's UID is read from, as `vercel connect create mcp.linear.app` printed it. */
const LINEAR_CONNECT_ENVIRONMENT = { CONNECTOR: "LINEAR_CONNECTOR_UID" } as const;

/** Why Connect answered nothing usable. */
export const LINEAR_CONNECT_FAILURE = {
  /** The deployment names no connector, or Connect says the connector is not installed for it. */
  NOT_CONFIGURED: "not-configured",
  /** Connect holds no grant it can turn into a token for the account: never signed in, declined, or revoked at Linear. */
  NOT_AUTHORIZED: "not-authorized",
  /** Connect could not be asked, or refused for a reason of its own. */
  UNAVAILABLE: "unavailable",
} as const;

export type LinearConnectFailureReason =
  (typeof LINEAR_CONNECT_FAILURE)[keyof typeof LINEAR_CONNECT_FAILURE];

/** Connect's machine code as a failure may keep it: a lower-case slug, and nothing shaped like a sentence or a token. */
const CONNECT_CODE_PATTERN = /^[a-z][a-z0-9_.-]{0,62}$/;

export class LinearConnectFailure extends Data.TaggedError("LinearConnectFailure")<{
  readonly reason: LinearConnectFailureReason;
  /** Connect's own code, where it sent one of the fixed shape above. */
  readonly code?: string;
  readonly status?: number;
}> {
  override get message(): string {
    const words: string[] = [`Vercel Connect answered ${this.reason}`];
    if (this.code !== undefined) words.push(this.code);
    if (this.status !== undefined) words.push(String(this.status));
    return words.join(" ");
  }
}

/** One account's token as Connect issued it; the token itself travels sealed until the one place that hands it to eve. */
interface LinearToken {
  readonly token: Redacted.Redacted;
  /** When it stops being good, in milliseconds since the epoch. */
  readonly expiresAt: number;
}

export interface LinearConnectService {
  /** Whether the deployment names a connector at all; a deployment without one never asks Connect anything. */
  readonly configured: boolean;
  /** Begins a browser sign-in for the account, which Connect returns to `callbackUrl`; answers the address the browser opens. */
  readonly authorize: (
    userId: string,
    callbackUrl: string,
  ) => Effect.Effect<string, LinearConnectFailure>;
  /** The account's token now; `fresh` asks Connect itself rather than the SDK's in-process cache. */
  readonly token: (
    userId: string,
    options: { readonly fresh: boolean },
  ) => Effect.Effect<LinearToken, LinearConnectFailure>;
  /** Revokes the account's grant at Connect, which revokes it at Linear where Linear allows it. */
  readonly revoke: (userId: string) => Effect.Effect<void, LinearConnectFailure>;
}

export class LinearConnect extends Context.Service<LinearConnect, LinearConnectService>()(
  "LinearConnect",
) {}

/** The subject every ask names: Luke's own user id, so a grant is the account's whatever principal a session runs under. */
function subjectOf(userId: string) {
  return { subject: { type: "user", id: userId } } as const;
}

/** Connect's failure as the word it amounts to, keeping only its code and status. */
function failureOf(cause: unknown): LinearConnectFailure {
  if (!(cause instanceof ConnectError)) {
    return new LinearConnectFailure({ reason: LINEAR_CONNECT_FAILURE.UNAVAILABLE });
  }
  const reason =
    cause instanceof UserAuthorizationRequiredError || cause instanceof NoValidTokenError
      ? LINEAR_CONNECT_FAILURE.NOT_AUTHORIZED
      : cause instanceof ConnectorInstallationRequiredError
        ? LINEAR_CONNECT_FAILURE.NOT_CONFIGURED
        : LINEAR_CONNECT_FAILURE.UNAVAILABLE;
  const code =
    cause.code !== undefined && CONNECT_CODE_PATTERN.test(cause.code) ? cause.code : undefined;
  return new LinearConnectFailure({
    reason,
    ...(code !== undefined ? { code } : undefined),
    ...(cause.status !== undefined ? { status: cause.status } : undefined),
  });
}

/** Whether a sign-in address is one a browser may be sent to: https, and nothing else. */
function isBrowserAddress(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

const NOT_CONFIGURED = new LinearConnectFailure({ reason: LINEAR_CONNECT_FAILURE.NOT_CONFIGURED });

/** The service over a deployment that names no connector: nothing is ever asked. */
const unconfigured: LinearConnectService = {
  configured: false,
  authorize: () => Effect.fail(NOT_CONFIGURED),
  token: () => Effect.fail(NOT_CONFIGURED),
  revoke: () => Effect.fail(NOT_CONFIGURED),
};

/** The three calls of Vercel Connect's SDK the service makes, which a test hands a fake Connect for. */
export interface ConnectSdk {
  readonly startAuthorization: typeof startAuthorization;
  readonly getTokenResponse: typeof getTokenResponse;
  readonly revokeToken: typeof revokeToken;
}

const VERCEL_CONNECT_SDK: ConnectSdk = { startAuthorization, getTokenResponse, revokeToken };

/** The service over one connector, asking Vercel Connect itself, or the SDK a test hands it. */
export function vercelLinearConnect(
  connector: string,
  sdk: ConnectSdk = VERCEL_CONNECT_SDK,
): LinearConnectService {
  return {
    configured: true,
    authorize: (userId, callbackUrl) =>
      Effect.tryPromise({
        try: () => sdk.startAuthorization(connector, subjectOf(userId), { callbackUrl }),
        catch: failureOf,
      }).pipe(
        Effect.flatMap(({ url }) =>
          isBrowserAddress(url)
            ? Effect.succeed(url)
            : Effect.fail(new LinearConnectFailure({ reason: LINEAR_CONNECT_FAILURE.UNAVAILABLE })),
        ),
      ),
    token: (userId, { fresh }) =>
      Effect.tryPromise({
        try: () => sdk.getTokenResponse(connector, subjectOf(userId), { forceRefresh: fresh }),
        catch: failureOf,
      }).pipe(
        Effect.map((response) => ({
          token: Redacted.make(response.token),
          expiresAt: response.expiresAt,
        })),
      ),
    revoke: (userId) =>
      Effect.tryPromise({
        try: () => sdk.revokeToken(connector, subjectOf(userId)),
        catch: failureOf,
      }),
  };
}

/**
 * Asks Connect to revoke the account's grant, where the deployment names a
 * connector at all: a Disconnect asks it, and so does deleting the account.
 * A revoke that fails is logged by its word, code, and status, never
 * Connect's sentence, and answered as done, because whoever asked has
 * already deleted the account's row, so no agent reads a token again
 * whatever Connect answered.
 */
export const revokeLinearGrant = /* @__PURE__ */ Effect.fn("web/revokeLinearGrant")(function* (
  userId: string,
): Effect.fn.Return<void, never, LinearConnect> {
  const connect = yield* LinearConnect;
  if (!connect.configured) return;
  yield* connect
    .revoke(userId)
    .pipe(
      Effect.catch((failure) =>
        Effect.logWarning("Vercel Connect could not revoke a Linear grant", failure.message),
      ),
    );
});

/** The service as this deployment's environment configures it: the connector it names, or none. */
export const linearConnectFromEnvironment: Layer.Layer<LinearConnect, Config.ConfigError> =
  Layer.effect(
    LinearConnect,
    Effect.map(Config.option(Config.String(LINEAR_CONNECT_ENVIRONMENT.CONNECTOR)), (read) => {
      const connector = text(Option.getOrUndefined(read));
      return connector === undefined ? unconfigured : vercelLinearConnect(connector);
    }),
  );
