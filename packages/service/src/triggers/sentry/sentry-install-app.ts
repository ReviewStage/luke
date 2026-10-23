/**
 * sentry-install-app.ts -- the Redirect URL Sentry returns the browser to after Luke's Sentry integration is installed.
 *
 * `GET /api/triggers/sentry/installed` is a browser navigation that carries
 * no bearer. The install it settles is begun, and the workspace's
 * installations read and disconnected, by the hosted procedures
 * (`sentry-install-procedures.ts`), whose install address carries an install
 * intent's state; Sentry's external-install page hands that `state` back on
 * this address untouched, beside the code and the installation's id.
 *
 * The intent is spent first, so a state replayed, unknown, or expired
 * links nothing; the account must still be an owner or admin of its
 * workspace. Nothing on the address is trusted on its own, since anyone can
 * put any installation id there: the code is exchanged for a token at
 * Sentry with the integration's client id and secret, which Sentry grants
 * only for that installation's own code, and the installation is then
 * verified with that token (the integration's "Verify Installation"), which
 * answers the organization it is on. Only then is it linked, and one
 * standing for another workspace is refused. The token is used for those
 * two calls and kept nowhere, and neither it nor the code is logged. The
 * browser lands on the integrations landing page with Sentry and one word.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  INSTALLATION_LINK,
  linkIntegrationInstallation,
  spendIntegrationInstallIntent,
} from "@luke/database/models/integration-installation-store";
import { workspaceOf } from "@luke/database/models/workspace-store";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import {
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_PROVIDER,
  type IntegrationLandingStatus,
  integrationLandingPath,
} from "@luke/features/integration-wire";
import { TRIGGER_PROVIDER } from "@luke/features/trigger-catalog";
import { managesWorkspace } from "@luke/features/workspace-role";
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

/** Sentry's own origin, where the install page and the integration platform's API stand. */
export const SENTRY_ORIGIN = "https://sentry.io";

/** The query Sentry puts on the Redirect URL. */
const INSTALLED_QUERY = {
  CODE: "code",
  INSTALLATION_ID: "installationId",
  STATE: "state",
} as const;

/** Sentry's installation ids are UUIDs. */
const INSTALLATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** A grant code as Sentry spells one: a short run of hex, bounded so nothing long is sent on. */
const GRANT_CODE = /^[A-Za-z0-9_-]{1,128}$/u;

/** A browser is sent on with 303, so the landing is the GET the page is. */
const SEE_OTHER = 303;

const SENTRY = INTEGRATION_PROVIDER.SENTRY;

/** Sentry's answer to a code exchanged: the token, which is used at once and kept nowhere. */
const AuthorizationAnswer = Schema.Struct({ token: Schema.String });

/** Sentry's answer to an installation verified: the organization it is on. */
const VerifiedAnswer = Schema.Struct({
  organization: Schema.optionalKey(Schema.Struct({ slug: Schema.optionalKey(Schema.String) })),
});

/** Why Sentry did not prove an installation: it refused (a code not its, used, or expired), or did not answer. */
const SENTRY_PROOF_FAILURE = {
  REFUSED: "refused",
  UNANSWERED: "unanswered",
} as const;

type SentryProofFailure = (typeof SENTRY_PROOF_FAILURE)[keyof typeof SENTRY_PROOF_FAILURE];

/** The landing each proof failure lands on. */
const LANDED_ON_PROOF_FAILURE = {
  [SENTRY_PROOF_FAILURE.REFUSED]: INTEGRATION_LANDING_STATUS.NOT_COMPLETED,
  [SENTRY_PROOF_FAILURE.UNANSWERED]: INTEGRATION_LANDING_STATUS.UNAVAILABLE,
} as const satisfies Readonly<Record<SentryProofFailure, IntegrationLandingStatus>>;

/** The request's query. */
const requestQuery = Effect.map(
  HttpServerRequest.HttpServerRequest,
  (request) => new URL(request.url, "https://localhost").searchParams,
);

/** One call to Sentry's integration platform, its body read as the schema says; a refusal or a shape not read is refused, no answer is unanswered. */
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

/**
 * The installation proven with Sentry: its code exchanged for a token under
 * the integration's own client, then the installation verified with that
 * token. Answers the slug of the organization it is on where Sentry said it.
 */
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

/** How an install the browser returned from settled. */
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
    // Note that only the failure's kind is logged, never the code or a token.
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

/** GET: the Redirect URL. Whatever Sentry sent, the browser lands on the page with a word. */
const installedEndpoint = Effect.gen(function* () {
  const query = yield* requestQuery;
  const status = yield* installedLanding(query).pipe(
    Effect.catch(() => Effect.succeed(INTEGRATION_LANDING_STATUS.UNAVAILABLE)),
  );
  return HttpServerResponse.redirect(integrationLandingPath(SENTRY, status), {
    status: SEE_OTHER,
  });
});

/** The route: the Redirect URL, and the hosted vocabulary's own refusal for any other path. */
export function sentryInstallApp(): WebRoutes<
  DatabaseServices | SentryApp | HttpClient.HttpClient
> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, HOSTED_SERVICE_PATH.SENTRY_INSTALLED, installedEndpoint),
    hostedNotFoundRoute,
  );
}
