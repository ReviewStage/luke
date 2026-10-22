/**
 * integrations-app.ts -- Vercel Connect's return to the browser from an integration's sign-in, and what the integrations share.
 *
 * `GET /api/account/integrations/connected` is where Connect returns the
 * browser from any provider: the sign-in's state names the account and the
 * provider, Connect is asked for a token afresh, and the browser is sent
 * on to the landing page with the provider and one word. A browser back
 * without a grant ends the sign-in, so the provider no longer stands
 * pending, unless Connect's result names a cancel or a refusal: that one
 * is left for the statuses read, which says why as it ends it. Connect
 * sends nothing back on the address, no error and no reason.
 *
 * Everything else about the account's integrations is a hosted procedure
 * (`integrations-procedures.ts`), which reads the seams, the sign-in window,
 * and Connect's word on a sign-in from here. The sign-in's state is never
 * logged, and nothing Connect answers is answered on: the browser is only
 * ever sent on to the landing page with a provider and one word.
 */

import { randomBytes } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import {
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_NAME,
  INTEGRATION_SIGN_IN_FAILURE,
  type IntegrationLandingStatus,
  type IntegrationProvider,
  type IntegrationSignInFailure,
  integrationLandingPath,
} from "@luke/features/integration-wire";
import { Effect, Layer, type Redacted, Result } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import {
  type HostedRefusal,
  hostedNotFoundRoute,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import {
  accountIntegrationConnect,
  CONNECT_SIGN_IN_RESULT,
  type ConnectorService,
  INTEGRATION_CONNECT_FAILURE,
  type IntegrationConnect,
} from "./integration-connect.js";
import type {
  IntegrationAccountKey,
  IntegrationConnectionRow,
  IntegrationStoreEffect,
} from "./integration-store.js";

/** How long a sign-in may stay under way before its state no longer settles it: Connect's own requests last about as long. */
const INTEGRATION_SIGN_IN_WINDOW_MS = 15 * 60 * 1000;

/** The query Connect returns the browser with, which is the one Luke put on the callback. */
export const INTEGRATION_CALLBACK_QUERY = { STATE: "state" } as const;

/** A sign-in's state as one is minted: 32 random bytes, url-safe. */
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const STATE_BYTES = 32;

const SUBJECT_BYTES = 24;

/** A browser is sent on with 303, so whatever Connect sends becomes the GET the page is. */
const SEE_OTHER = 303;

export interface IntegrationsAppSeams {
  resolveUserId: UserIdResolver;
  readConnections: (userId: string) => IntegrationStoreEffect<readonly IntegrationConnectionRow[]>;
  readSignIn: (state: string) => IntegrationStoreEffect<IntegrationConnectionRow | undefined>;
  /** Records a sign-in under way; answers whether it took, which it does not where another sign-in minted the same name meanwhile. */
  beginSignIn: (
    userId: string,
    account: IntegrationAccountKey,
    state: string,
    verifier: Redacted.Redacted,
  ) => IntegrationStoreEffect<boolean>;
  /** Sets one account connected, taking its name at the provider as its label where it carries none. */
  completeSignIn: (
    userId: string,
    connectionName: string,
    state: string,
    accountName?: string,
  ) => IntegrationStoreEffect<boolean>;
  /** Ends the sign-in begun under `state` without a grant: the browser came back without one. */
  endSignIn: (
    userId: string,
    connectionName: string,
    state: string,
  ) => IntegrationStoreEffect<void>;
  deleteAccount: (
    account: Pick<IntegrationConnectionRow, "userId" | "connectionName" | "id">,
  ) => IntegrationStoreEffect<boolean>;
  /** Labels an account that carries no label yet, once, with what its grant named or an empty label for nothing; only the account under that grant's subject. */
  fillLabel: (account: IntegrationConnectionRow, label: string) => IntegrationStoreEffect<void>;
  /** Names one account; answers whether the account held it. */
  renameConnection: (
    userId: string,
    connectionName: string,
    label: string,
  ) => IntegrationStoreEffect<boolean>;
  /** A fresh subject for another account's grant at Connect; random in production, fixed in a test. */
  mintSubject: () => string;
  /** A fresh sign-in state; random in production, fixed in a test. */
  mintState: () => string;
  /** Now, in milliseconds since the epoch. */
  now: () => number;
}

/** A sign-in state as production mints it. */
export function mintIntegrationState(): string {
  return randomBytes(STATE_BYTES).toString("base64url");
}

/** A subject for another account's grant as production mints it: 24 random bytes, url-safe, prefixed so it reads as Luke's own. */
export function mintIntegrationSubject(): string {
  return `luke_acct_${randomBytes(SUBJECT_BYTES).toString("base64url")}`;
}

/** Whether a sign-in begun at this instant may still settle. */
export function signInStands(seams: IntegrationsAppSeams, issuedAt: Date | undefined): boolean {
  return (
    issuedAt !== undefined && seams.now() - issuedAt.getTime() <= INTEGRATION_SIGN_IN_WINDOW_MS
  );
}

/** Why a sign-in ended without a grant, as the statuses read answers it: the provider aside. */
export type SignInFailure = Omit<IntegrationSignInFailure, "provider">;

/**
 * Asks Connect how the sign-in it answered this row's handle for stands,
 * and answers why it ended where Connect says it was cancelled or
 * refused; nothing while it is under way, succeeded, or Connect could not
 * be asked, which the next read asks again.
 */
export const connectSignInFailure = /* @__PURE__ */ Effect.fnUntraced(function* (
  connector: ConnectorService,
  row: IntegrationConnectionRow,
): Effect.fn.Return<SignInFailure | undefined> {
  if (row.verifier === undefined) return undefined;
  const result = yield* Effect.result(connector.signInResult(row.verifier));
  if (Result.isFailure(result)) {
    yield* Effect.logWarning(
      `Vercel Connect could not say how a ${INTEGRATION_NAME[row.provider]} sign-in stands`,
      result.failure.message,
    );
    return undefined;
  }
  const ended = result.success;
  if (ended.kind === CONNECT_SIGN_IN_RESULT.CANCELED) {
    return { reason: INTEGRATION_SIGN_IN_FAILURE.CANCELED };
  }
  if (ended.kind !== CONNECT_SIGN_IN_RESULT.FAILED) return undefined;
  return {
    reason: INTEGRATION_SIGN_IN_FAILURE.ERROR,
    ...(ended.message !== undefined ? { message: ended.message } : undefined),
  };
});

/** Where the browser lands, with the provider where the sign-in named one. */
interface Landing {
  readonly provider: IntegrationProvider | undefined;
  readonly status: IntegrationLandingStatus;
}

function landing({ provider, status }: Landing): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.redirect(integrationLandingPath(provider, status), {
    status: SEE_OTHER,
  });
}

/** How the sign-in the browser returned from settled. */
const callbackLanding = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: IntegrationsAppSeams,
  state: string | null,
): Effect.fn.Return<Landing, HostedRefusal, DatabaseServices | IntegrationConnect> {
  const expired = { provider: undefined, status: INTEGRATION_LANDING_STATUS.EXPIRED } as const;
  if (state === null || !STATE_PATTERN.test(state)) return expired;
  const row = yield* hostedStoreOrUnavailable(seams.readSignIn(state));
  if (row === undefined) return expired;
  const landed = (status: IntegrationLandingStatus): Landing => ({
    provider: row.provider,
    status,
  });
  if (!signInStands(seams, row.stateIssuedAt)) return landed(INTEGRATION_LANDING_STATUS.EXPIRED);
  const connector = (yield* hostedStoreOrUnavailable(accountIntegrationConnect(row.userId)))[
    row.provider
  ];
  // A provider no longer offered to the account completes nothing for it.
  if (!connector.configured) return landed(INTEGRATION_LANDING_STATUS.UNAVAILABLE);
  const issued = yield* Effect.result(connector.token(row.connectSubject, { fresh: true }));
  if (Result.isFailure(issued)) {
    // Back without a grant: the sign-in is over, so the window waiting on it hears so at its next read.
    if (issued.failure.reason === INTEGRATION_CONNECT_FAILURE.NOT_AUTHORIZED) {
      // Note that one Connect says was cancelled or refused is left standing, because the statuses read says why as it ends it.
      if ((yield* connectSignInFailure(connector, row)) === undefined) {
        yield* hostedStoreOrUnavailable(seams.endSignIn(row.userId, row.connectionName, state));
      }
      return landed(INTEGRATION_LANDING_STATUS.NOT_COMPLETED);
    }
    yield* Effect.logWarning(
      `Vercel Connect could not settle a ${INTEGRATION_NAME[row.provider]} sign-in`,
      issued.failure.message,
    );
    return landed(INTEGRATION_LANDING_STATUS.UNAVAILABLE);
  }
  const completed = yield* hostedStoreOrUnavailable(
    seams.completeSignIn(row.userId, row.connectionName, state, issued.success.accountName),
  );
  if (completed) {
    yield* recordServerEvent(SERVER_EVENT.INTEGRATION_CONNECTION_CREATE, row.userId, {
      provider: row.provider,
    });
  }
  // A Disconnect pressed while the browser was away, or a sign-in begun again, wins: this one completes nothing.
  return landed(
    completed ? INTEGRATION_LANDING_STATUS.CONNECTED : INTEGRATION_LANDING_STATUS.NOT_COMPLETED,
  );
});

/** GET: Connect's return. Whatever it brought, the browser lands on the page with a word. */
const connectedEndpoint = /* @__PURE__ */ Effect.fn("web/integrationConnectedEndpoint")(function* (
  seams: IntegrationsAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest | DatabaseServices | IntegrationConnect
> {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const query = new URL(request.url, "https://localhost").searchParams;
  const landed = yield* callbackLanding(seams, query.get(INTEGRATION_CALLBACK_QUERY.STATE)).pipe(
    Effect.catch(() =>
      Effect.succeed({ provider: undefined, status: INTEGRATION_LANDING_STATUS.UNAVAILABLE }),
    ),
  );
  return landing(landed);
});

/** The group: Connect's return, the browser's, and the hosted vocabulary's own refusal for any other path. */
export function integrationsApp(
  seams: IntegrationsAppSeams,
): WebRoutes<DatabaseServices | IntegrationConnect> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS_CONNECTED,
      connectedEndpoint(seams),
    ),
    hostedNotFoundRoute,
  );
}
