import { pathToFileURL } from "node:url";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { sqlClientOverUrl } from "@repo/database/core/sql-client";
import { PROVIDER_KEY_KIND } from "@repo/features/provider-key-wire";
import { writeHostDevice } from "@repo/host/daemon";
import { demoDatabaseUrl } from "@repo/service/demo/demo-database";
import {
  DEMO_HOST,
  type DemoCredential,
  demoAuth,
  demoHostSecret,
  seedDemoWorld,
} from "@repo/service/demo/demo-seed";
import { drizzle } from "drizzle-orm/node-postgres";
import { Config, Effect, Option, Redacted, Result } from "effect";
import { Pool } from "pg";

const DEMO_ENVIRONMENT = {
  DATABASE_URL: "DATABASE_URL",
  CLAUDE_TOKEN: "APP_DEMO_CLAUDE_TOKEN",
  ANTHROPIC_API_KEY: "APP_DEMO_ANTHROPIC_API_KEY",
  KEY_RING: "PROVIDER_KEY_ENCRYPTION_KEYS",
  HOST_STATE: "APP_DEMO_HOST_STATE",
  SERVICE_ORIGIN: "APP_DEMO_SERVICE_ORIGIN",
} as const;

const demoCredential = Effect.gen(function* () {
  const token = yield* Config.option(Config.Redacted(DEMO_ENVIRONMENT.CLAUDE_TOKEN));
  const apiKey = yield* Config.option(Config.Redacted(DEMO_ENVIRONMENT.ANTHROPIC_API_KEY));
  const handed = Option.orElse(
    Option.map(token, (key) => ({ kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN, key })),
    () => Option.map(apiKey, (key) => ({ kind: PROVIDER_KEY_KIND.API_KEY, key })),
  );
  if (Option.isNone(handed)) return Option.none<DemoCredential>();
  const ring = yield* Config.Redacted(DEMO_ENVIRONMENT.KEY_RING);
  return Option.some<DemoCredential>({ ...handed.value, ring });
});

const demoHost = Effect.gen(function* () {
  const stateRoot = yield* Config.option(Config.String(DEMO_ENVIRONMENT.HOST_STATE));
  const serviceOrigin = yield* Config.option(Config.String(DEMO_ENVIRONMENT.SERVICE_ORIGIN));
  if (Option.isNone(stateRoot) && Option.isNone(serviceOrigin)) return Option.none();
  if (Option.isNone(stateRoot) || Option.isNone(serviceOrigin)) {
    return yield* Effect.fail(
      new Error(
        `${DEMO_ENVIRONMENT.HOST_STATE} and ${DEMO_ENVIRONMENT.SERVICE_ORIGIN} are given together or not at all`,
      ),
    );
  }
  return Option.some({
    stateRoot: stateRoot.value,
    serviceOrigin: serviceOrigin.value,
    minted: demoHostSecret(),
  });
});

const seedConfiguredDatabase = Effect.gen(function* () {
  const named = Redacted.value(yield* Config.Redacted(DEMO_ENVIRONMENT.DATABASE_URL));
  const url = demoDatabaseUrl(named);
  if (Result.isFailure(url)) {
    return yield* Effect.fail(
      new Error(
        `${DEMO_ENVIRONMENT.DATABASE_URL} is refused (${url.failure}): the demo seed writes to a Postgres on loopback alone`,
      ),
    );
  }
  const credential = yield* demoCredential;
  const host = yield* demoHost;
  const pool = yield* Effect.acquireRelease(
    Effect.sync(() => new Pool({ connectionString: url.success })),
    (opened) => Effect.promise(() => opened.end()),
  );
  const seeded = yield* seedDemoWorld(
    demoAuth(drizzle({ client: pool })),
    credential,
    Option.map(host, ({ minted }) => ({ secretHash: minted.hash })),
  ).pipe(Effect.provide(sqlClientOverUrl(url.success)));
  yield* Effect.logInfo(
    `Seeded the acme world: ${seeded.taskIds.length} tasks, ${seeded.memberIds.length + 1} members`,
    { memberId: seeded.deanId, workspaceId: seeded.workspaceId },
  );
  if (Option.isSome(credential)) {
    yield* Effect.logInfo(`Saved the ${credential.value.kind} the demo's agents run on`);
  }
  if (Option.isSome(host)) {
    const { stateRoot, serviceOrigin, minted } = host.value;
    yield* writeHostDevice(stateRoot, {
      deviceId: DEMO_HOST.id,
      deviceSecret: minted.secret,
      serviceOrigin,
    }).pipe(Effect.provide(NodeServices.layer));
    yield* Effect.logInfo(`Enrolled the demo's host on this Mac, its record in ${stateRoot}`);
  }
});

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  NodeRuntime.runMain(Effect.scoped(seedConfiguredDatabase));
}
