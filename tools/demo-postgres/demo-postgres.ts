/**
 * demo-postgres.ts -- the demo's throwaway database: Postgres 18 made empty in a new temp folder on a free loopback port, migrated and seeded, and held until a signal stops it and deletes the folder.
 *
 *   node tools/demo-postgres/demo-postgres.ts --url-file <path>
 *
 * Once the database is migrated (`pnpm --filter @luke/web db:migrate`) and
 * seeded (`auth:seed`), its URL is written to `<path>`, readable by its
 * owner alone, in one rename, so the file holds the whole URL from the
 * moment it exists. The port and the temp folder are printed, and nothing
 * else, the password least of all. It then runs until SIGINT or SIGTERM,
 * when it deletes the URL file, stops Postgres, deletes the folder, and
 * exits 0. A step that fails stops it the same way before the file is
 * written, prints what that step printed, and exits 1.
 *
 * A caller in bash runs it in the background and waits for the file:
 *
 *   node tools/demo-postgres/demo-postgres.ts --url-file "$folder/database-url" &
 *   postgres_pid=$!
 *   trap 'kill "$postgres_pid" 2>/dev/null; wait "$postgres_pid"' EXIT
 *   until [[ -s $folder/database-url ]]; do
 *       kill -0 "$postgres_pid" 2>/dev/null || exit 1
 *       sleep 0.2
 *   done
 *   database_url=$(<"$folder/database-url")
 *
 * The one URL serves as both `DATABASE_URL` and `DATABASE_URL_UNPOOLED`,
 * since no pooler stands in front of it. Each run starts from a new, empty
 * database; nothing is kept between runs.
 */

import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Console, Effect, Exit, FileSystem, Redacted } from "effect";
import { completed, ephemeralCluster, StepFailed } from "./cluster.ts";

/** Where `pnpm` runs the web app's scripts from: the repository's root. */
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The web app's scripts that make an empty database the one a deployment has. */
const WEB_SCRIPTS = ["db:migrate", "auth:seed"] as const;

/** The exit codes a caller reads: stopped as asked, or a step failed. */
const EXIT_CODE = { STOPPED: 0, FAILED: 1 } as const;

/** The file the URL is written to, from the one flag the command takes. */
const urlFile = Effect.try({
  try: () => {
    const { values } = parseArgs({ options: { "url-file": { type: "string" } } });
    const file = values["url-file"];
    if (file === undefined || file.length === 0) throw new Error("--url-file <path> is required");
    return file;
  },
  catch: (cause) => new StepFailed({ step: "reading the arguments", printed: String(cause) }),
});

/** Runs one of the web app's scripts against the database at `url`. */
function webScript(script: (typeof WEB_SCRIPTS)[number], url: Redacted.Redacted<string>) {
  return completed(
    `pnpm --filter @luke/web ${script}`,
    "pnpm",
    ["--dir", REPOSITORY_ROOT, "--filter", "@luke/web", script],
    { DATABASE_URL: Redacted.value(url), DATABASE_URL_UNPOOLED: Redacted.value(url) },
  );
}

/**
 * The URL written to `file` for as long as the scope lives. Note that it is
 * written beside the file and renamed over it, so a caller waiting for the
 * file never reads half of it.
 */
function urlWritten(file: string, url: Redacted.Redacted<string>) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const partial = `${file}.partial`;
    const written = Effect.andThen(
      fileSystem.writeFileString(partial, `${Redacted.value(url)}\n`, { mode: 0o600 }),
      fileSystem.rename(partial, file),
    );
    yield* Effect.acquireRelease(written, () =>
      Effect.ignore(fileSystem.remove(file, { force: true })),
    );
  });
}

/** The whole run: the cluster, its scripts, the URL, then a wait on a signal. */
const demoPostgres = Effect.gen(function* () {
  const file = yield* urlFile;
  const cluster = yield* ephemeralCluster;
  for (const script of WEB_SCRIPTS) yield* webScript(script, cluster.url);
  yield* urlWritten(file, cluster.url);
  yield* Console.log(`Postgres 18 on port ${cluster.port}, in ${cluster.folder}`);
  return yield* Effect.never;
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

// Note that a stop by signal is how every run ends, so it exits 0: a caller
// that waits on the process under `set -e` would otherwise abort its own cleanup.
NodeRuntime.runMain(demoPostgres, {
  teardown: (exit, onExit) =>
    onExit(
      Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
        ? EXIT_CODE.FAILED
        : EXIT_CODE.STOPPED,
    ),
});
