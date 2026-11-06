import { randomBytes } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import { HOSTED_SERVICE_PATH } from "@repo/features";
import {
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_NAME,
  type IntegrationLandingStatus,
  type IntegrationProvider,
  integrationLandingPath,
} from "@repo/features/integration-wire";
import { Effect, Layer, Result } from "effect";
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
  INTEGRATION_CONNECT_FAILURE,
  type IntegrationConnect,
} from "./integration-connect.js";
import type {
  IntegrationAccountKey,
  IntegrationConnectionRow,
  IntegrationStoreEffect,
} from "./integration-store.js";

const INTEGRATION_SIGN_IN_WINDOW_MS = 15 * 60 * 1000;

export const INTEGRATION_CALLBACK_QUERY = { STATE: "state" } as const;

const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const STATE_BYTES = 32;

const SUBJECT_BYTES = 24;

const SEE_OTHER = 303;

export interface IntegrationsAppSeams {
  resolveUserId: UserIdResolver;
  readConnections: (userId: string) => IntegrationStoreEffect<readonly IntegrationConnectionRow[]>;
  readSignIn: (state: string) => IntegrationStoreEffect<IntegrationConnectionRow | undefined>;
  beginSignIn: (
    userId: string,
    account: IntegrationAccountKey,
    state: string,
  ) => IntegrationStoreEffect<string | undefined>;
  completeSignIn: (
    userId: string,
    connectionName: string,
    state: string,
    accountName?: string,
  ) => IntegrationStoreEffect<boolean>;
  endSignIn: (
    userId: string,
    connectionName: string,
    state: string,
  ) => IntegrationStoreEffect<string | undefined>;
  deleteAccount: (
    account: Pick<IntegrationConnectionRow, "userId" | "connectionName" | "id">,
  ) => IntegrationStoreEffect<string | undefined>;
  fillLabel: (account: IntegrationConnectionRow, label: string) => IntegrationStoreEffect<void>;
  renameConnection: (
    userId: string,
    connectionName: string,
    label: string,
  ) => IntegrationStoreEffect<string | undefined>;
  mintSubject: () => string;
  mintState: () => string;
  now: () => number;
}

export function mintIntegrationState(): string {
  return randomBytes(STATE_BYTES).toString("base64url");
}

export function mintIntegrationSubject(): string {
  return `app_acct_${randomBytes(SUBJECT_BYTES).toString("base64url")}`;
}

export function signInIssuedSince(now: number): number {
  return now - INTEGRATION_SIGN_IN_WINDOW_MS;
}

export function signInStands(seams: IntegrationsAppSeams, issuedAt: Date | undefined): boolean {
  return (
    issuedAt !== undefined && seams.now() - issuedAt.getTime() <= INTEGRATION_SIGN_IN_WINDOW_MS
  );
}

interface Landing {
  readonly provider: IntegrationProvider | undefined;
  readonly status: IntegrationLandingStatus;
}

function landing({ provider, status }: Landing): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.redirect(integrationLandingPath(provider, status), {
    status: SEE_OTHER,
  });
}

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
  if (!connector.configured) return landed(INTEGRATION_LANDING_STATUS.UNAVAILABLE);
  const issued = yield* Effect.result(connector.token(row.connectSubject, { fresh: true }));
  if (Result.isFailure(issued)) {
    if (issued.failure.reason === INTEGRATION_CONNECT_FAILURE.NOT_AUTHORIZED) {
      yield* hostedStoreOrUnavailable(seams.endSignIn(row.userId, row.connectionName, state));
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
    yield* recordServerEvent(
      SERVER_EVENT.INTEGRATION_CONNECTION_CREATE,
      { userId: row.userId },
      {
        provider: row.provider,
      },
    );
  }
  return landed(
    completed ? INTEGRATION_LANDING_STATUS.CONNECTED : INTEGRATION_LANDING_STATUS.NOT_COMPLETED,
  );
});

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
