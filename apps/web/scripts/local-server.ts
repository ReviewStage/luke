import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHttpServer, NodeHttpServerRequest, NodeRuntime } from "@effect/platform-node";
import { AUTH_DEPLOYMENT_ENVIRONMENT } from "@repo/service/auth/auth-deployment";
import { localServerRefusal } from "@repo/service/local/local-server-guard";
import {
  CRON_ENVIRONMENT,
  MAINTENANCE_SWEEP,
  MAINTENANCE_SWEEP_PATH,
} from "@repo/service/maintenance/maintenance-bounds";
import type { Route } from "@repo/service/route";
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

const WEB = join(import.meta.dirname, "..");

const LOOPBACK = "127.0.0.1";

const DEFAULT_PORT = 5173;

const PORT_FLAG = "--port";

const ENV = {
  PORT: "PORT",
  AUTH_URL: AUTH_DEPLOYMENT_ENVIRONMENT.PRODUCTION_URL,
  CRON_SECRET: CRON_ENVIRONMENT.CRON_SECRET,
} as const;

const STATUS = { NOT_FOUND: 404, SERVER_ERROR: 500 } as const;

const RAW_QUERY = "?raw";

const SHUTDOWN_GRACE = Duration.seconds(1);

const VITE: InlineConfig = { root: WEB, server: { middlewareMode: true, ws: false } };

class LocalServerRefused extends Schema.TaggedError<LocalServerRefused>()("LocalServerRefused", {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

function flagsProvider(argv: readonly string[]): ConfigProvider.ConfigProvider {
  const flag = argv.indexOf(PORT_FLAG);
  const port = flag === -1 ? undefined : argv[flag + 1];
  return ConfigProvider.fromEnvRecord(port === undefined ? {} : { [ENV.PORT]: port });
}

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

async function localRoutes(): Promise<ReadonlyMap<string, Route>> {
  const [{ auth }, { DEMO_DEAN }, { LOCAL_SIGN_IN_PATH, localSignIn }] = await Promise.all([
    import("@repo/service/auth/auth"),
    import("@repo/service/demo/demo-seed"),
    import("../server/local-sign-in.js"),
  ]);
  return new Map([[LOCAL_SIGN_IN_PATH, localSignIn(auth, DEMO_DEAN.id)]]);
}

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

interface LocalSite {
  readonly local: ReadonlyMap<string, Route>;
  readonly deployment: LocalDeployment;
  readonly pageOf: (pathname: string) => string;
  readonly vite: ViteDevServer;
}

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
