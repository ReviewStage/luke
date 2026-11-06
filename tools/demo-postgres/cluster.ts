import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { type AddressInfo, createServer } from "node:net";
import { PgClient } from "@effect/sql-pg";
import { Data, Effect, FileSystem, Path, Redacted, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";
import { SqlClient } from "effect/sql";

const CLUSTER = {
  HOST: "127.0.0.1",
  USER: "vespin",
  DATABASE: "vespin",
  MAINTENANCE_DATABASE: "postgres",
  TEMP_PREFIX: "vespin-demo-postgres-",
  WAIT_SECONDS: "60",
} as const;

const CLUSTER_FILE = {
  DATA: "data",
  LOG: "postgres.log",
  PASSWORD: "password",
} as const;

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

const PostgresBinaries = Schema.Struct({ initdb: Schema.String, pg_ctl: Schema.String });
type PostgresBinaries = typeof PostgresBinaries.Type;

interface Cluster {
  readonly folder: string;
  readonly port: number;
  readonly url: Redacted.Redacted<string>;
}

export class StepFailed extends Data.TaggedError("StepFailed")<{
  readonly step: string;
  readonly printed: string;
}> {
  override get message(): string {
    return `${this.step} failed${this.printed.length > 0 ? `:\n${this.printed}` : ""}`;
  }
}

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

const freeLoopbackPort = Effect.tryPromise({
  try: async () => {
    const server = createServer().listen(0, CLUSTER.HOST);
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    server.close();
    await once(server, "close");
    return port;
  },
  catch: (cause) => new StepFailed({ step: "finding a free port", printed: String(cause) }),
});

function initialized(bin: PostgresBinaries, folder: string, password: Redacted.Redacted<string>) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const passwordFile = path.join(folder, CLUSTER_FILE.PASSWORD);
    yield* fileSystem.writeFileString(passwordFile, `${Redacted.value(password)}\n`, {
      mode: 0o600,
    });
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
