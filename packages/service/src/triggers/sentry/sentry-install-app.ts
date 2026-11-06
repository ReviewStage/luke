import type { DatabaseServices } from "@repo/database/core/query";
import {
  INSTALLATION_LINK,
  linkIntegrationInstallation,
  spendIntegrationInstallIntent,
} from "@repo/database/models/integration-installation-store";
import { workspaceOf } from "@repo/database/models/workspace-store";
import { HOSTED_SERVICE_PATH } from "@repo/features";
import {
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_PROVIDER,
  type IntegrationLandingStatus,
  integrationLandingPath,
} from "@repo/features/integration-wire";
import { TRIGGER_PROVIDER } from "@repo/features/trigger-catalog";
import { managesWorkspace } from "@repo/features/workspace-role";
import { Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import {
  type HostedRefusal,
  hostedNotFoundRoute,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../../route.js";
import { SentryApp, type SentryAppSettings } from "./sentry-app-config.js";

export const SENTRY_ORIGIN = "https://sentry.io";

const INSTALLED_QUERY = {
  CODE: "code",
  INSTALLATION_ID: "installationId",
  STATE: "state",
} as const;

const INSTALLATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const GRANT_CODE = /^[A-Za-z0-9_-]{1,128}$/u;

const SEE_OTHER = 303;

const SENTRY = INTEGRATION_PROVIDER.SENTRY;

const AuthorizationAnswer = Schema.Struct({ token: Schema.String });

const VerifiedAnswer = Schema.Struct({
  organization: Schema.optionalKey(Schema.Struct({ slug: Schema.optionalKey(Schema.String) })),
});

const SENTRY_PROOF_FAILURE = {
  REFUSED: "refused",
  UNANSWERED: "unanswered",
} as const;

type SentryProofFailure = (typeof SENTRY_PROOF_FAILURE)[keyof typeof SENTRY_PROOF_FAILURE];

const LANDED_ON_PROOF_FAILURE = {
  [SENTRY_PROOF_FAILURE.REFUSED]: INTEGRATION_LANDING_STATUS.NOT_COMPLETED,
  [SENTRY_PROOF_FAILURE.UNANSWERED]: INTEGRATION_LANDING_STATUS.UNAVAILABLE,
} as const satisfies Readonly<Record<SentryProofFailure, IntegrationLandingStatus>>;

const requestQuery = Effect.map(
  HttpServerRequest.HttpServerRequest,
  (request) => new URL(request.url, "https://localhost").searchParams,
);

function sentryCall<A>(
  request: HttpClientRequest.HttpClientRequest,
  schema: Schema.Codec<A, unknown>,
): Effect.Effect<A, SentryProofFailure, HttpClient.HttpClient> {
  return Effect.flatMap(HttpClient.HttpClient, (client) =>
    client.execute(request).pipe(
      Effect.mapError(() => SENTRY_PROOF_FAILURE.UNANSWERED),
      Effect.flatMap((response) => {
        if (response.status >= HOSTED_HTTP_STATUS.INTERNAL_ERROR) {
          return Effect.fail(SENTRY_PROOF_FAILURE.UNANSWERED);
        }
        if (response.status < 200 || response.status >= 300) {
          return Effect.fail(SENTRY_PROOF_FAILURE.REFUSED);
        }
        return HttpClientResponse.schemaBodyJson(schema)(response).pipe(
          Effect.mapError(() => SENTRY_PROOF_FAILURE.REFUSED),
        );
      }),
      Effect.scoped,
    ),
  );
}

const proveInstallation = Effect.fn("web/sentryProveInstallation")(function* (
  settings: SentryAppSettings,
  installationId: string,
  code: string,
): Effect.fn.Return<Option.Option<string>, SentryProofFailure, HttpClient.HttpClient> {
  const installation = `${SENTRY_ORIGIN}/api/0/sentry-app-installations/${installationId}/`;
  const authorized = yield* sentryCall(
    HttpClientRequest.post(`${installation}authorizations/`).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bodyJsonUnsafe({
        grant_type: "authorization_code",
        code,
        client_id: settings.clientId,
        client_secret: Redacted.value(settings.clientSecret),
      }),
    ),
    AuthorizationAnswer,
  );
  const verified = yield* sentryCall(
    HttpClientRequest.put(installation).pipe(
      HttpClientRequest.bearerToken(authorized.token),
      HttpClientRequest.acceptJson,
      HttpClientRequest.bodyJsonUnsafe({ status: "installed" }),
    ),
    VerifiedAnswer,
  );
  return Option.fromNullishOr(verified.organization?.slug);
});

const installedLanding = Effect.fn("web/sentryInstalledLanding")(function* (
  query: URLSearchParams,
): Effect.fn.Return<
  IntegrationLandingStatus,
  HostedRefusal,
  DatabaseServices | SentryApp | HttpClient.HttpClient
> {
  const state = query.get(INSTALLED_QUERY.STATE);
  if (state === null) return INTEGRATION_LANDING_STATUS.EXPIRED;
  const intent = yield* hostedStoreOrUnavailable(
    spendIntegrationInstallIntent(TRIGGER_PROVIDER.SENTRY, state),
  );
  if (Option.isNone(intent)) return INTEGRATION_LANDING_STATUS.EXPIRED;
  const { userId, organizationId } = intent.value;
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, organizationId));
  if (Option.isNone(workspace) || !managesWorkspace(workspace.value)) {
    return INTEGRATION_LANDING_STATUS.EXPIRED;
  }
  const code = query.get(INSTALLED_QUERY.CODE);
  const installationId = query.get(INSTALLED_QUERY.INSTALLATION_ID);
  if (
    code === null ||
    !GRANT_CODE.test(code) ||
    installationId === null ||
    !INSTALLATION_ID.test(installationId)
  ) {
    return INTEGRATION_LANDING_STATUS.NOT_COMPLETED;
  }
  const app = yield* SentryApp;
  const settings = yield* Effect.result(app.settings);
  if (Result.isFailure(settings)) return INTEGRATION_LANDING_STATUS.UNAVAILABLE;
  const proven = yield* Effect.result(proveInstallation(settings.success, installationId, code));
  if (Result.isFailure(proven)) {
    yield* Effect.logWarning("Sentry did not prove an installation", proven.failure);
    return LANDED_ON_PROOF_FAILURE[proven.failure];
  }
  const linked = yield* hostedStoreOrUnavailable(
    linkIntegrationInstallation({
      provider: TRIGGER_PROVIDER.SENTRY,
      externalId: installationId,
      organizationId,
      userId,
      ...Option.match(proven.success, {
        onNone: () => ({}),
        onSome: (accountLabel) => ({ accountLabel }),
      }),
    }),
  );
  return linked === INSTALLATION_LINK.LINKED
    ? INTEGRATION_LANDING_STATUS.CONNECTED
    : INTEGRATION_LANDING_STATUS.ALREADY_CONNECTED;
});

const installedEndpoint = Effect.gen(function* () {
  const query = yield* requestQuery;
  const status = yield* installedLanding(query).pipe(
    Effect.catch(() => Effect.succeed(INTEGRATION_LANDING_STATUS.UNAVAILABLE)),
  );
  return HttpServerResponse.redirect(integrationLandingPath(SENTRY, status), {
    status: SEE_OTHER,
  });
});

export function sentryInstallApp(): WebRoutes<
  DatabaseServices | SentryApp | HttpClient.HttpClient
> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, HOSTED_SERVICE_PATH.SENTRY_INSTALLED, installedEndpoint),
    hostedNotFoundRoute,
  );
}
