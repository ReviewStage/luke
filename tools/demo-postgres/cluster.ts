/**
 * cluster.ts -- a Postgres 18 cluster of its own: made empty in a new temp folder, listening on a free loopback port, and stopped and deleted with its scope.
 *
 * The binaries are `embedded-postgres`'s, one npm package per platform, so
 * no Postgres need be installed. Its JavaScript wrapper is left out: it
 * stops its clusters from a SIGINT and SIGTERM hook it installs as it loads,
 * which would race this scope's own stop and the folder's deletion, and it
 * writes the password to a file in the shared temp folder. `initdb` and
 * `pg_ctl` are run here instead, the password file kept inside the
 * cluster's own folder, which only its owner can read.
 */

import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { type AddressInfo, createServer } from "node:net";
import { PgClient } from "@effect/sql-pg";
import { Data, Effect, FileSystem, Path, Redacted, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";
import { SqlClient } from "effect/sql";

/** Who the cluster answers, and on what. */
const CLUSTER = {
  HOST: "127.0.0.1",
  USER: "vespin",
  DATABASE: "vespin",
  /** The database `initdb` makes, which the cluster's own is created from. */
  MAINTENANCE_DATABASE: "postgres",
  TEMP_PREFIX: "vespin-demo-postgres-",
  /** How long `pg_ctl` waits on a start or a stop. */
  WAIT_SECONDS: "60",
} as const;

/** What the cluster's folder holds, by name. */
const CLUSTER_FILE = {
  DATA: "data",
  LOG: "postgres.log",
  PASSWORD: "password",
} as const;

/**
 * The binaries' package for each platform and architecture `embedded-postgres`
 * publishes and the repository runs on; pnpm installs the machine's own alone
 * (`pnpm-workspace.yaml`'s `onlyBuiltDependencies` says why it must build).
 */
const BINARY_PACKAGES: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
  [
    "darwin",
    new Map([
      ["arm64", "@embedded-postgres/darwin-arm64"],
      ["x64", "@embedded-postgres/darwin-x64"],
    ]),
  ],
  [
    "linux",
    new Map([
      ["arm64", "@embedded-postgres/linux-arm64"],
      ["x64", "@embedded-postgres/linux-x64"],
    ]),
  ],
]);

/** The paths a binaries package exports, of the two programs run here. */
const PostgresBinaries = Schema.Struct({ initdb: Schema.String, pg_ctl: Schema.String });
type PostgresBinaries = typeof PostgresBinaries.Type;

/** A cluster as its caller reaches it. */
interface Cluster {
  /** The folder the cluster lives in, deleted when it stops. */
  readonly folder: string;
  readonly port: number;
  /** The connection string of its database, password and all. */
  readonly url: Redacted.Redacted<string>;
}

/** A step of the start that failed, with what it printed. */
export class StepFailed extends Data.TaggedError("StepFailed")<{
  readonly step: string;
  readonly printed: string;
}> {
  override get message(): string {
    return `${this.step} failed${this.printed.length > 0 ? `:\n${this.printed}` : ""}`;
  }
}

/* ----- Steps ----- */

/** The binaries for this machine, or a failure naming the platform where none are published. */
const binaries = Effect.gen(function* () {
  const name = BINARY_PACKAGES.get(process.platform)?.get(process.arch);
  if (name === undefined) {
    return yield* new StepFailed({
      step: `finding Postgres for ${process.platform}-${process.arch}`,
      printed: "",
    });
  }
  const exported = yield* Effect.tryPromise({
    try: () => import(name),
    catch: (cause) => new StepFailed({ step: `loading ${name}`, printed: String(cause) }),
  });
  return yield* Schema.decodeUnknownEffect(PostgresBinaries)(exported).pipe(
    Effect.mapError((error) => new StepFailed({ step: `reading ${name}`, printed: error.message })),
  );
});

/**
 * Runs one program to its end, in this process's environment with `env` over
 * it, and fails with what it printed where it exits other than 0. Note that
 * its output is kept rather than shown, so a start that goes well prints
 * nothing of it.
 */
export function completed(
  step: string,
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(command, [...args], {
        env,
        extendEnv: true,
        stdin: "ignore",
      });
      const [printed, code] = yield* Effect.all(
        [Stream.mkString(Stream.decodeText(handle.all)), handle.exitCode],
        { concurrency: "unbounded" },
      );
      if (Number(code) !== 0) return yield* new StepFailed({ step, printed: printed.trim() });
    }),
  ).pipe(
    Effect.catchTag("PlatformError", (error) =>
      Effect.fail(new StepFailed({ step, printed: error.message })),
    ),
  );
}

/**
 * A port nothing on the loopback address listens on now. Note that it is
 * only free until Postgres takes it, a moment later; a port taken in that
 * moment fails the start, which says so.
 */
const freeLoopbackPort = Effect.tryPromise({
  try: async () => {
    const server = createServer().listen(0, CLUSTER.HOST);
    await once(server, "listening");
    // SAFETY: a server listening on a TCP address answers an AddressInfo, never a pipe name.
    const { port } = server.address() as AddressInfo;
    server.close();
    await once(server, "close");
    return port;
  },
  catch: (cause) => new StepFailed({ step: "finding a free port", printed: String(cause) }),
});

/** The data directory made under `folder`, its one role signing in by `password`. */
function initialized(bin: PostgresBinaries, folder: string, password: Redacted.Redacted<string>) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const passwordFile = path.join(folder, CLUSTER_FILE.PASSWORD);
    yield* fileSystem.writeFileString(passwordFile, `${Redacted.value(password)}\n`, {
      mode: 0o600,
    });
    // Note that nothing is synced to disk, because the cluster is deleted when it stops.
    yield* completed("initdb", bin.initdb, [
      `--pgdata=${path.join(folder, CLUSTER_FILE.DATA)}`,
      `--username=${CLUSTER.USER}`,
      `--pwfile=${passwordFile}`,
      "--auth=scram-sha-256",
      "--encoding=UTF8",
      "--locale=C",
      "--no-sync",
      "--no-instructions",
      `--set=listen_addresses=${CLUSTER.HOST}`,
      "--set=unix_socket_directories=",
      "--set=fsync=off",
    ]);
  });
}

/**
 * The cluster's server started on `port` and stopped with the scope. The
 * start waits until it takes connections; the stop waits until it is gone,
 * so the folder can be deleted after it. `pg_ctl` starts the server in a
 * session of its own, so a ^C at the terminal reaches this process alone,
 * whose scope then stops it.
 */
function running(bin: PostgresBinaries, folder: string, port: number) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const data = path.join(folder, CLUSTER_FILE.DATA);
    const log = path.join(folder, CLUSTER_FILE.LOG);
    const start = completed("starting Postgres", bin.pg_ctl, [
      "start",
      `--pgdata=${data}`,
      `--log=${log}`,
      `--options=-p ${port}`,
      `--timeout=${CLUSTER.WAIT_SECONDS}`,
      "--wait",
      "--silent",
    ]).pipe(
      // Note that what went wrong is in the server's log where the server got far enough to
      // write one, and otherwise in what `pg_ctl` printed, so both are kept.
      Effect.catchTag("StepFailed", (failed) =>
        Effect.gen(function* () {
          const logged = yield* Effect.orElseSucceed(fileSystem.readFileString(log), () => "");
          const printed = [failed.printed, logged.trim()].filter((text) => text.length > 0);
          return yield* new StepFailed({ step: failed.step, printed: printed.join("\n") });
        }),
      ),
    );
    const stop = completed("stopping Postgres", bin.pg_ctl, [
      "stop",
      `--pgdata=${data}`,
      "--mode=fast",
      `--timeout=${CLUSTER.WAIT_SECONDS}`,
      "--wait",
      "--silent",
    ]);
    yield* Effect.acquireRelease(start, () => Effect.orDie(stop));
  });
}

/** The cluster's own database, created over the maintenance one as its role. */
function databaseCreated(port: number, password: Redacted.Redacted<string>) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE DATABASE ${sql(CLUSTER.DATABASE)}`;
  }).pipe(
    Effect.provide(
      PgClient.layer({
        url: connectionString(port, password, CLUSTER.MAINTENANCE_DATABASE),
      }),
    ),
    Effect.mapError(
      (error) => new StepFailed({ step: "creating the database", printed: error.message }),
    ),
  );
}

/** Where `database` is reached on the cluster's port, as its role. */
function connectionString(
  port: number,
  password: Redacted.Redacted<string>,
  database: string,
): Redacted.Redacted<string> {
  const url = new URL(`postgresql://${CLUSTER.HOST}:${port}`);
  url.username = CLUSTER.USER;
  url.password = Redacted.value(password);
  url.pathname = `/${database}`;
  return Redacted.make(url.href);
}

/* ----- Public API ----- */

/**
 * A new cluster, empty but for its one database, which lives as long as the
 * scope: closing it stops the server and then deletes the folder, the
 * database's files with it. The password is new each time and leaves this
 * process only in the folder's password file and the URL.
 */
export const ephemeralCluster = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const bin = yield* binaries;
  const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: CLUSTER.TEMP_PREFIX });
  const password = Redacted.make(randomBytes(24).toString("hex"));
  yield* initialized(bin, folder, password);
  const port = yield* freeLoopbackPort;
  yield* running(bin, folder, port);
  yield* databaseCreated(port, password);
  return {
    folder,
    port,
    url: connectionString(port, password, CLUSTER.DATABASE),
  } satisfies Cluster;
});
