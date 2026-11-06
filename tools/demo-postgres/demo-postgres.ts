import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Console, Effect, Exit, FileSystem, Redacted } from "effect";
import { completed, ephemeralCluster, StepFailed } from "./cluster.ts";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const WEB_SCRIPTS = ["db:migrate", "auth:seed"] as const;

const EXIT_CODE = { STOPPED: 0, FAILED: 1 } as const;

const urlFile = Effect.try({
  try: () => {
    const { values } = parseArgs({ options: { "url-file": { type: "string" } } });
    const file = values["url-file"];
    if (file === undefined || file.length === 0) throw new Error("--url-file <path> is required");
    return file;
  },
  catch: (cause) => new StepFailed({ step: "reading the arguments", printed: String(cause) }),
});

function webScript(script: (typeof WEB_SCRIPTS)[number], url: Redacted.Redacted<string>) {
  return completed(
    `pnpm --filter @repo/web ${script}`,
    "pnpm",
    ["--dir", REPOSITORY_ROOT, "--filter", "@repo/web", script],
    { DATABASE_URL: Redacted.value(url), DATABASE_URL_UNPOOLED: Redacted.value(url) },
  );
}

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

const demoPostgres = Effect.gen(function* () {
  const file = yield* urlFile;
  const cluster = yield* ephemeralCluster;
  for (const script of WEB_SCRIPTS) yield* webScript(script, cluster.url);
  yield* urlWritten(file, cluster.url);
  yield* Console.log(`Postgres 18 on port ${cluster.port}, in ${cluster.folder}`);
  return yield* Effect.never;
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

NodeRuntime.runMain(demoPostgres, {
  teardown: (exit, onExit) =>
    onExit(
      Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
        ? EXIT_CODE.FAILED
        : EXIT_CODE.STOPPED,
    ),
});
