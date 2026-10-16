/**
 * runtime.ts -- the services the deployment's effects run against, as a layer.
 *
 * This module builds nothing and runs nothing: each edge that runs an effect
 * against the deployment's services (`apps/web/server/runtime.ts` for the web
 * functions, each eve root's own `runtime.ts` for its agent) builds its one
 * `ManagedRuntime` over this layer.
 */

import { ConfigProvider, Effect, Layer, Logger } from "effect";
import { FetchHttpClient } from "effect/http";
import { webSqlClient } from "./db/sql-client.js";
import { hostedEnvironment } from "./environment.js";
import { githubAppFromEnvironment } from "./github/github-app.js";
import {
  integrationConnectFromEnvironment,
  workspaceLinearConnectFromEnvironment,
} from "./integrations/integration-connect.js";
import { errorReportsLayer, errorReportsLogger } from "./observability/error-reports.js";
import { modelCatalogLayer } from "./providers/model-catalog.js";

/**
 * The deployment's own environment, read as these services are built rather
 * than once for the process. The default `ConfigProvider` is a
 * `Context.Reference` whose default value is computed once and then kept on
 * the reference itself, so the record `ConfigProvider.fromEnv()` copies out of
 * `process.env` would be the record every later instance still read. An
 * instance builds its services from the environment it was started with, and
 * a test that sets one and disposes the runtime gets the environment it set.
 */
const webConfigProvider = ConfigProvider.layer(Effect.sync(() => ConfigProvider.fromEnv()));

/**
 * Where an `Effect.log*` on this runtime goes: one JSON object per line on the
 * console, which Vercel's log drain parses into a structured entry, with the
 * level, the annotations, the enclosing spans, and the cause a log line was
 * handed rendered as fields rather than folded into the message. v4 states the
 * whole active set of loggers rather than swapping one out of it, so the
 * tracer's logger is named beside the JSON one: it is what puts a line on the
 * span it was written under, the one trace surface the service keeps. The
 * third files every line at Error or above with Sentry, where the deployment
 * names a DSN (`observability/error-reports.ts`).
 */
const webLogger = Logger.layer([Logger.consoleJson, Logger.tracerLogger, errorReportsLogger]);

/** The error reports the logger files through, which the sweep's check-ins share. */
const webErrorReports = errorReportsLayer();

/**
 * The services every web function's and every agent's effects run against. A
 * function reaches this layer only through its edge's runtime, so a service
 * added here is built once per instance rather than once per invocation.
 *
 * What the deployment's environment says about the hosted tier is read here
 * too, once per instance rather than at each invocation: `HostedEnvironment`
 * is the one place `OPENAI_API_KEY`, the brain model override, and the
 * analytics processor's own deletion key and project are read, and
 * `GitHubApp` the one place the Luke GitHub App's id, slug, client, and
 * private key are.
 *
 * `IntegrationConnect` is the one place each integration's connector UID and
 * allowlist are read, for the account routes that connect and disconnect an account and
 * the agents that read its tokens alike; `WorkspaceLinearConnect` is the one
 * place the workspace Linear connector's UID is.
 *
 * `ModelCatalog` is here for the same reason: its read of AI Gateway's
 * public catalog is cached on the service, so one instance reads the catalog
 * once an hour for every route that offers or checks a model.
 *
 * `@effect/platform-node` has no entry: a Vercel function's platform is the
 * Web `fetch` its runtime already carries, and a Node-reaching companion
 * behind this door would have to be traced into every bundle. `@effect/sql-pg`
 * does have one: a web function's database is the platform Vercel gives it, and
 * `repository-checks.sh` keeps that specifier out of `api/`, where the stubs
 * that re-export a bundle stand, rather than out of the bundle itself.
 */
export const webServices = Layer.mergeAll(
  FetchHttpClient.layer,
  webSqlClient,
  hostedEnvironment,
  githubAppFromEnvironment,
  integrationConnectFromEnvironment,
  workspaceLinearConnectFromEnvironment,
  Layer.provideMerge(webLogger, webErrorReports),
  modelCatalogLayer.pipe(Layer.provide(Layer.merge(FetchHttpClient.layer, hostedEnvironment))),
).pipe(Layer.provide(webConfigProvider));

/** What an effect run on a runtime over these services may require. */
export type WebServices = Layer.Success<typeof webServices>;

/**
 * How building those services can fail, which is a missing `DATABASE_URL`: the
 * layer names the database every deployed function reaches, so an invocation
 * on an instance configured without one is refused at the edge rather than at
 * whichever query ran first.
 */
export type WebServicesError = Layer.Error<typeof webServices>;
