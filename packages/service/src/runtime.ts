import { ConfigProvider, Effect, Layer, Logger } from "effect";
import { FetchHttpClient } from "effect/http";
import { invitationMailFromEnvironment } from "./accounts/invitation-mail.js";
import { welcomeMailFromEnvironment } from "./accounts/welcome-mail.js";
import { settledTurnListener } from "./agents/coder-host/settled-turns.js";
import { bearerCallersLayer } from "./auth/bearer-callers.js";
import { webSqlClient } from "./db/sql-client.js";
import { hostedEnvironment } from "./environment.js";
import { productAnalyticsFromEnvironment } from "./events/server-events.js";
import { githubAppFromEnvironment } from "./github/github-app.js";
import { githubRateGate } from "./github/github-rate-gate.js";
import { pullRequestLinksLayer } from "./github/pull-request-links.js";
import { integrationConnectFromEnvironment } from "./integrations/integration-connect.js";
import { sentryLogger } from "./observability/sentry.js";
import { pageLinksFromEnvironment } from "./pages/page-links.js";
import { modelCatalogLayer } from "./providers/model-catalog.js";
import { slackBotFromEnvironment } from "./slack/slack-bot.js";
import { syncFromEnvironment } from "./sync/hub.js";
import { sentryAppFromEnvironment } from "./triggers/sentry/sentry-app-config.js";

const webConfigProvider = ConfigProvider.layer(Effect.sync(() => ConfigProvider.fromEnv()));

const webLogger = Logger.layer([Logger.consoleJson, Logger.tracerLogger, sentryLogger]);

const gatedGitHubClient = githubRateGate.pipe(
  Layer.provide(Layer.merge(FetchHttpClient.layer, webSqlClient)),
);

const githubApp = githubAppFromEnvironment.pipe(Layer.provide(hostedEnvironment));

const slackBot = slackBotFromEnvironment.pipe(
  Layer.provide(Layer.merge(FetchHttpClient.layer, integrationConnectFromEnvironment)),
);

export const webServices = Layer.mergeAll(
  gatedGitHubClient,
  webSqlClient,
  hostedEnvironment,
  githubApp,
  settledTurnListener.pipe(
    Layer.provide(Layer.mergeAll(gatedGitHubClient, githubApp, hostedEnvironment, slackBot)),
  ),
  sentryAppFromEnvironment,
  integrationConnectFromEnvironment,
  slackBot,
  webLogger,
  syncFromEnvironment,
  bearerCallersLayer,
  pageLinksFromEnvironment,
  modelCatalogLayer.pipe(Layer.provide(Layer.merge(FetchHttpClient.layer, hostedEnvironment))),
  pullRequestLinksLayer,
  productAnalyticsFromEnvironment.pipe(
    Layer.provide(Layer.mergeAll(FetchHttpClient.layer, hostedEnvironment, webSqlClient)),
  ),
  invitationMailFromEnvironment.pipe(Layer.provide(FetchHttpClient.layer)),
  welcomeMailFromEnvironment.pipe(Layer.provide(FetchHttpClient.layer)),
).pipe(Layer.provide(webConfigProvider));

export type WebServices = Layer.Success<typeof webServices>;

export type WebServicesError = Layer.Error<typeof webServices>;
