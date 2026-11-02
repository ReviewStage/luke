/**
 * local-server.ts -- the hosted routes served from this machine as Vercel serves them, over a local database, with the site's pages beside them.
 *
 *   DATABASE_URL=postgres://…@127.0.0.1:5432/luke DATABASE_URL_UNPOOLED=… \
 *   BETTER_AUTH_SECRET=… CRON_SECRET=… \
 *     pnpm --filter @luke/web local-server --port 5173
 *
 * It refuses to start beside any `VERCEL*` variable or over a database off
 * this machine's loopback (`server/local-server-guard.ts`), and it imports
 * no route until it has, because the auth service reads the environment as
 * it loads (`@luke/service/auth/auth`). Where `BETTER_AUTH_URL` names no
 * address, the server names its own there first, so Better Auth's base URL
 * and the cookie origin guard both call it by the address it listens at.
 *
 * Every path a rewrite of the committed table takes is the deployment's,
 * answered by the function the rewrite lands it on
 * (`server/local-deployment.ts`); every other path is the site's, which Vite
 * serves in middleware mode as `pnpm dev` would. It listens on 127.0.0.1
 * alone, on `--port`, `PORT`, or Vite's own port, and calls the scheduled
 * sweep on the cron's cadence under `CRON_SECRET`, as Vercel's cron does.
 *
 * `@vercel/functions` does nothing here. `waitUntil` hands its promise to
 * the request context Vercel puts on `globalThis`, which this process has
 * none of, so the work runs on as any promise in a live process would;
 * every caller hands one that settles. `attachDatabasePool` arms its idle
 * wait only where `VERCEL_URL` and `VERCEL_REGION` are set, which the guard
 * refuses.
 */

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHttpServer, NodeHttpServerRequest, NodeRuntime } from "@effect/platform-node";
import { AUTH_DEPLOYMENT_ENVIRONMENT } from "@luke/service/auth/auth-deployment";
import {
  CRON_ENVIRONMENT,
  MAINTENANCE_SWEEP,
  MAINTENANCE_SWEEP_PATH,
} from "@luke/service/maintenance/maintenance-bounds";
import type { Route } from "@luke/service/route";
import {
  Config,
  ConfigProvider,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Schedule,
  Schema,
} from "effect";
import { HttpEffect, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import { createServer as createViteServer, type InlineConfig, type ViteDevServer } from "vite";
import type { LocalDeployment } from "../server/local-deployment.js";
import { localServerRefusal } from "../server/local-server-guard.js";

const WEB = join(import.meta.dirname, "..");

/** The one address the server listens at: this machine's loopback, never a network's. */
const LOOPBACK = "127.0.0.1";

/** Vite's own port, where neither the flag nor the variable names one. */
const DEFAULT_PORT = 5173;

const PORT_FLAG = "--port";

const ENV = {
  PORT: "PORT",
  AUTH_URL: AUTH_DEPLOYMENT_ENVIRONMENT.PRODUCTION_URL,
  CRON_SECRET: CRON_ENVIRONMENT.CRON_SECRET,
} as const;

const STATUS = { NOT_FOUND: 404, SERVER_ERROR: 500 } as const;

/** The query a module is imported under to be its file's text, as Vite spells it. */
const RAW_QUERY = "?raw";

/** How long a stop waits on the connections still open, a page's held reads among them, before it closes them. */
const SHUTDOWN_GRACE = Duration.seconds(1);

/**
 * The site as `pnpm dev` serves it, in middleware mode under this server.
 * Note that Vite's HMR socket is left off, because the Effect server answers
 * every upgrade on this server itself and a socket of Vite's own would be a
 * second port: an edit shows on the page's next load.
 */
const VITE: InlineConfig = { root: WEB, server: { middlewareMode: true, ws: false } };

class LocalServerRefused extends Schema.TaggedError<LocalServerRefused>()("LocalServerRefused", {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

/** The command line's flags as the variables they stand in for, read ahead of the environment's own. */
function flagsProvider(argv: readonly string[]): ConfigProvider.ConfigProvider {
  const flag = argv.indexOf(PORT_FLAG);
  const port = flag === -1 ? undefined : argv[flag + 1];
  return ConfigProvider.fromEnvRecord(port === undefined ? {} : { [ENV.PORT]: port });
}

/**
 * Answers a file a route imports `?raw` with its text, as the function's
 * bundle inlines it (`server/function-bundles.ts`) and Vite answers it to a
 * test, since Node knows no such import: the host's install script.
 */
function answerRawImports(): void {
  registerHooks({
    load(url, context, nextLoad) {
      if (!url.endsWith(RAW_QUERY)) return nextLoad(url, context);
      const text = readFileSync(fileURLToPath(url), "utf8");
      return {
        format: "module",
        shortCircuit: true,
        source: `export default ${JSON.stringify(text)};`,
      };
    },
  });
}

/**
 * The routes this server answers ahead of the deployment's and the pages,
 * by the path each answers: where a local-only route mounts, the demo's
 * sign-in among them, which answers `/sign-in.html` in the page's place.
 * None ever stands under `server/routes/`, so no function a deploy carries
 * reaches one. Read once the environment is settled, as the deployment's
 * routes are, since what they import may read it as it loads.
 */
function localRoutes(): Promise<ReadonlyMap<string, Route>> {
  return Promise.resolve(new Map());
}

/**
 * A page's request, handed to Vite as the Node request and response it came
 * as, addressed to the page it is served from; Vite writes the answer, so the
 * empty response returned is never written. The browser keeps the address it
 * asked for, which the app reads its link from.
 */
function page(
  vite: ViteDevServer,
  request: HttpServerRequest.HttpServerRequest,
  served: URL,
): Effect.Effect<HttpServerResponse.HttpServerResponse> {
  return Effect.callback((resume) => {
    const incoming = NodeHttpServerRequest.toIncomingMessage(request);
    const outgoing = NodeHttpServerRequest.toServerResponse(request);
    incoming.url = `${served.pathname}${served.search}`;
    outgoing.once("close", () => resume(Effect.succeed(HttpServerResponse.empty())));
    vite.middlewares(incoming, outgoing, (error?: unknown) => {
      outgoing.statusCode = error === undefined ? STATUS.NOT_FOUND : STATUS.SERVER_ERROR;
      outgoing.end();
    });
  });
}

/** What a request is answered by: a local-only route, the deployment's routes, or the page a path of the site is served from. */
interface LocalSite {
  readonly local: ReadonlyMap<string, Route>;
  readonly deployment: LocalDeployment;
  readonly pageOf: (pathname: string) => string;
  readonly vite: ViteDevServer;
}

/** Every request as this server answers it: a local-only route's, the deployment's, or a page's, in that order. */
function answer(origin: string, site: LocalSite) {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const asked = new URL(request.url, origin);
    const own = site.local.get(asked.pathname);
    if (own !== undefined) return yield* HttpEffect.fromWebHandler(own.fetch);
    if (site.deployment.answers(asked.pathname)) {
      return yield* HttpEffect.fromWebHandler(site.deployment.fetch);
    }
    const served = new URL(asked);
    served.pathname = site.pageOf(asked.pathname);
    return yield* page(site.vite, request, served);
  });
}

/** The scheduled sweep as Vercel's cron calls it, under the cron secret, on the cadence the root `vercel.json` gives it, answered in process. */
function sweepOnSchedule(deployment: LocalDeployment, origin: string, secret: Redacted.Redacted) {
  const sweep = Effect.tryPromise(async () => {
    const answered = await deployment.fetch(
      new Request(new URL(MAINTENANCE_SWEEP_PATH, origin), {
        headers: { authorization: `Bearer ${Redacted.value(secret)}` },
      }),
    );
    await answered.body?.cancel();
    return answered.status;
  }).pipe(
    Effect.flatMap((status) =>
      status < 300 ? Effect.void : Effect.logWarning(`The scheduled sweep answered ${status}`),
    ),
    Effect.catch((error) => Effect.logWarning("The scheduled sweep failed", error)),
  );
  return Effect.repeat(sweep, Schedule.cron(MAINTENANCE_SWEEP.CRONTAB)).pipe(Effect.orDie);
}

const program = Effect.gen(function* () {
  const refusal = localServerRefusal(process.env);
  if (refusal !== undefined) return yield* new LocalServerRefused({ reason: refusal });
  const port = yield* Config.Port(ENV.PORT).pipe(Config.withDefault(DEFAULT_PORT));
  const cronSecret = yield* Config.option(Config.Redacted(ENV.CRON_SECRET));
  const origin = `http://${LOOPBACK}:${port}`;
  // Note that the address is settled before any route is imported, because the auth service reads it as it loads.
  yield* Effect.sync(() => {
    if (!process.env[ENV.AUTH_URL]?.trim()) process.env[ENV.AUTH_URL] = origin;
  });
  yield* Effect.sync(answerRawImports);
  const { localDeployment, localPages } = yield* Effect.promise(
    () => import("../server/local-deployment.js"),
  );
  const deployment = yield* Effect.promise(() => localDeployment(WEB));
  const pageOf = yield* Effect.promise(() => localPages(WEB));
  const local = yield* Effect.promise(localRoutes);
  const vite = yield* Effect.acquireRelease(
    Effect.promise(() => createViteServer(VITE)),
    (server) => Effect.promise(() => server.close()),
  );
  if (Option.isSome(cronSecret)) {
    yield* Effect.forkScoped(sweepOnSchedule(deployment, origin, cronSecret.value));
  } else {
    yield* Effect.logWarning(`${ENV.CRON_SECRET} is not set, so the scheduled sweep does not run`);
  }
  const listening = NodeHttpServer.layer(createServer, {
    port,
    host: LOOPBACK,
    gracefulShutdownTimeout: SHUTDOWN_GRACE,
  });
  return yield* Layer.launch(
    HttpServer.serve(answer(origin, { local, deployment, pageOf, vite })).pipe(
      HttpServer.withLogAddress,
      Layer.provide(listening),
    ),
  );
}).pipe(
  Effect.scoped,
  Effect.provide(
    ConfigProvider.layer(
      ConfigProvider.orElse(flagsProvider(process.argv.slice(2)), ConfigProvider.fromEnv()),
    ),
  ),
);

NodeRuntime.runMain(program);
