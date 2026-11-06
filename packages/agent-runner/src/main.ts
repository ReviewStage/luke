import { createInterface } from "node:readline";
import {
  NodeChildProcessSpawner,
  NodeFileSystem,
  NodePath,
  NodeRuntime,
} from "@effect/platform-node";
import { Effect, Exit, Layer, Stream } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { claudeCodeLive } from "./claude-code.js";
import { codexToken } from "./codex-token.js";
import { hostProcessTable, MAC_PS } from "./host-processes.js";
import { runsOnHost } from "./launch.js";
import { processTable } from "./processes.js";
import { CODEX_TOKEN_COMMAND, RUNNER_END } from "./protocol.js";
import { runAgent } from "./runner.js";

const EXIT = { ENDED: 0, FAILED: 1 } as const;

const stdin: AsyncIterable<string> = {
  [Symbol.asyncIterator]: () =>
    createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY })[
      Symbol.asyncIterator
    ](),
};
const stdinLines = Stream.fromAsyncIterable(stdin, () => undefined).pipe(
  Stream.catch(() => Stream.empty),
);

const [, script, mode, tokenUrl] = process.argv;

const launch = runAgent({
  lines: stdinLines,
  env: process.env,
  self: script === undefined ? undefined : { executable: process.execPath, script },
}).pipe(
  Effect.scoped,
  Effect.map((end) => (end === RUNNER_END.FAILED ? EXIT.FAILED : EXIT.ENDED)),
  Effect.catch((error) =>
    Effect.logError(`agent-runner: ${error._tag}: ${error.detail}`).pipe(Effect.as(EXIT.FAILED)),
  ),
  Effect.provide(
    Layer.mergeAll(
      claudeCodeLive,
      FetchHttpClient.layer,
      runsOnHost(process.env)
        ? hostProcessTable(process.pid, { proc: "/proc", ps: MAC_PS })
        : processTable("/proc", process.pid),
      NodeChildProcessSpawner.layer.pipe(
        Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
      ),
    ),
  ),
);

const token = Effect.gen(function* () {
  if (tokenUrl === undefined) return yield* Effect.fail("no token URL was given");
  const accessToken = yield* codexToken(tokenUrl, process.env).pipe(
    Effect.mapError((failure) => failure.detail),
  );
  yield* Effect.sync(() => process.stdout.write(`${accessToken}\n`));
  return EXIT.ENDED;
}).pipe(
  Effect.catch((detail) =>
    Effect.sync(() => process.stderr.write(`agent-runner: ${detail}\n`)).pipe(
      Effect.as(EXIT.FAILED),
    ),
  ),
  Effect.provide(FetchHttpClient.layer),
);

const main = mode === CODEX_TOKEN_COMMAND ? token : launch;

NodeRuntime.runMain(main, {
  teardown: (exit) => process.exit(Exit.isSuccess(exit) ? Number(exit.value) : EXIT.FAILED),
});
