import { pathToFileURL } from "node:url";
import { NodeRuntime } from "@effect/platform-node";
import { sqlClientOverUrl } from "@luke/database/core/sql-client";
import { PROVIDER_KEY_KIND } from "@luke/features/provider-key-wire";
import { demoDatabaseUrl } from "@luke/service/demo/demo-database";
import { type DemoCredential, demoAuth, seedDemoWorld } from "@luke/service/demo/demo-seed";
import { drizzle } from "drizzle-orm/node-postgres";
import { Config, Effect, Option, Redacted, Result } from "effect";
import { Pool } from "pg";

/**
 * demo-seed.ts -- `pnpm --filter @luke/web demo:seed`: the demo's acme world written into the freshly migrated Postgres on loopback that `DATABASE_URL` names.
 *
 * `run.sh --demo` calls it once per run, after `db:migrate` and `auth:seed`
 * against the same database. It reads:
 *
 * - `DATABASE_URL`, which must name a Postgres on this machine's loopback
 *   (`127.0.0.1`, `localhost`, or `::1`); anything else is refused before a
 *   connection is opened.
 * - `LUKE_DEMO_CLAUDE_TOKEN`, a `claude setup-token`, or else
 *   `LUKE_DEMO_ANTHROPIC_API_KEY`, optional: saved as Dean's, for his agents.
 * - `PROVIDER_KEY_ENCRYPTION_KEYS`, needed only with a credential: the ring
 *   it is sealed under, which the local server must hold too.
 *
 * It prints what it wrote and never a credential. A database that holds
 * any account already is refused, so it runs once per fresh database.
 */

const DEMO_ENVIRONMENT = {
  DATABASE_URL: "DATABASE_URL",
  CLAUDE_TOKEN: "LUKE_DEMO_CLAUDE_TOKEN",
  ANTHROPIC_API_KEY: "LUKE_DEMO_ANTHROPIC_API_KEY",
  KEY_RING: "PROVIDER_KEY_ENCRYPTION_KEYS",
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
  // Better Auth writes through a pool of its own, as the deployment's does, ended once the seed is.
  const pool = yield* Effect.acquireRelease(
    Effect.sync(() => new Pool({ connectionString: url.success })),
    (opened) => Effect.promise(() => opened.end()),
  );
  const seeded = yield* seedDemoWorld(demoAuth(drizzle({ client: pool })), credential).pipe(
    Effect.provide(sqlClientOverUrl(url.success)),
  );
  yield* Effect.logInfo(
    `Seeded the acme world: ${seeded.taskIds.length} tasks, ${seeded.channelIds.length} channels, ${seeded.memberIds.length + 1} members`,
    { deanId: seeded.deanId, workspaceId: seeded.workspaceId },
  );
  if (Option.isSome(credential)) {
    yield* Effect.logInfo(`Saved Dean's ${credential.value.kind} for his agents`);
  }
});

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  NodeRuntime.runMain(Effect.scoped(seedConfiguredDatabase));
}
