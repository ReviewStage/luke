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

/**
 * demo-seed.ts -- `pnpm --filter @repo/web demo:seed`: the demo's acme world written into the freshly migrated Postgres on loopback that `DATABASE_URL` names.
 *
 * `run.sh --demo` calls it once per run, after `db:migrate` and `auth:seed`
 * against the same database. It reads:
 *
 * - `DATABASE_URL`, which must name a Postgres on this machine's loopback
 *   (`127.0.0.1`, `localhost`, or `::1`); anything else is refused before a
 *   connection is opened.
 * - `APP_DEMO_CLAUDE_TOKEN`, a `claude setup-token`, or else
 *   `APP_DEMO_ANTHROPIC_API_KEY`, optional: saved as Dean's, for his agents.
 * - `PROVIDER_KEY_ENCRYPTION_KEYS`, needed only with a credential: the ring
 *   it is sealed under, which the local server must hold too.
 * - `APP_DEMO_HOST_STATE` and `APP_DEMO_SERVICE_ORIGIN`, optional and
 *   given together: the state folder of the host the run starts on this Mac
 *   (`luke-host run` under `APP_HOST_STATE_ROOT`), and the local server's
 *   origin it calls. The host is enrolled as Dean's, every task runs its
 *   agents on it, and its record is written into that folder once the seed
 *   has landed, holding a device secret minted here, which the database
 *   keeps only as its hash.
 *
 * It prints what it wrote and never a credential. A database that holds
 * any account already is refused, so it runs once per fresh database.
 */

const DEMO_ENVIRONMENT = {
  DATABASE_URL: "DATABASE_URL",
  CLAUDE_TOKEN: "APP_DEMO_CLAUDE_TOKEN",
  ANTHROPIC_API_KEY: "APP_DEMO_ANTHROPIC_API_KEY",
  KEY_RING: "PROVIDER_KEY_ENCRYPTION_KEYS",
  HOST_STATE: "APP_DEMO_HOST_STATE",
  SERVICE_ORIGIN: "APP_DEMO_SERVICE_ORIGIN",
} as const;

/** The credential the run hands in, the setup token before the API key, sealed under the ring it names; none where it hands none. */
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

/** Where the run's host keeps its state and the origin it calls, where the run starts one; the secret its record holds, minted now. */
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
  // Better Auth writes through a pool of its own, as the deployment's does, ended once the seed is.
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
    `Seeded the acme world: ${seeded.taskIds.length} tasks, ${seeded.channelIds.length} channels, ${seeded.memberIds.length + 1} members`,
    { deanId: seeded.deanId, workspaceId: seeded.workspaceId },
  );
  if (Option.isSome(credential)) {
    yield* Effect.logInfo(`Saved Dean's ${credential.value.kind} for his agents`);
  }
  if (Option.isSome(host)) {
    const { stateRoot, serviceOrigin, minted } = host.value;
    yield* writeHostDevice(stateRoot, {
      deviceId: DEMO_HOST.id,
      deviceSecret: minted.secret,
      serviceOrigin,
    }).pipe(Effect.provide(NodeServices.layer));
    yield* Effect.logInfo(`Enrolled Dean's host on this Mac, its record in ${stateRoot}`);
  }
});

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  NodeRuntime.runMain(Effect.scoped(seedConfiguredDatabase));
}
