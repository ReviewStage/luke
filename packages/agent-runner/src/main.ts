/**
 * main.ts -- the runner's process: stdin and the environment in, one launch run, and the process's exit code out; or, started as Codex's token command, the plan's access token out.
 *
 * Bundled with the SDK into one file (`pnpm --filter @luke/agent-runner
 * build`), which Luke uploads to the agent's sandbox and starts there as the
 * agent user (P08). Exit 0 is a launch that ended as Luke asked or as the
 * turn did; anything else is one Luke shows as interrupted.
 *
 * Started as `node <bundle> codex-token <tokenUrl>` by app-server
 * (`codex-token.ts`), it prints the token Luke answers on stdout and exits
 * 0, or says why not on stderr and exits 1.
 */

import { existsSync } from "node:fs";
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
import { askCodexToken } from "./codex-token.js";
import { processTable } from "./processes.js";
import { CODEX_TOKEN_COMMAND, RUNNER_END } from "./protocol.js";
import { MAC_PS, psProcessTable } from "./ps-processes.js";
import { runAgent } from "./runner.js";

const EXIT = { ENDED: 0, FAILED: 1 } as const;

// Note that the interface is made only as the stream starts, and iterated at
// once, because readline drops every line it reads before its iterator exists.
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

// Note that a Mac's development run starts the bundle under Electron's own binary with
// ELECTRON_RUN_AS_NODE, which only that start needs: a command of the agent's that
// launched an Electron app would otherwise run it as Node.
delete process.env.ELECTRON_RUN_AS_NODE;

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
      // The machine's own processes, read beside the runner's, for a wait's release (runner.ts):
      // the sandbox's `/proc`, or `ps` on a Mac, which has none.
      existsSync("/proc/self/status")
        ? processTable("/proc", process.pid)
        : psProcessTable(MAC_PS, process.pid),
      // Codex's app-server, spawned as the runner's own child (codex.ts).
      NodeChildProcessSpawner.layer.pipe(
        Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
      ),
    ),
  ),
);

// Note that the token goes to stdout alone, for app-server, and a failure says only its words.
const token = Effect.gen(function* () {
  if (tokenUrl === undefined) return yield* Effect.fail("no token URL was given");
  const accessToken = yield* askCodexToken(tokenUrl, process.env).pipe(
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

// Note that we exit explicitly, even on success, where `runMain` would leave
// the process to drain, because stdin, which Luke may hold open, would keep
// it alive after the launch has ended.
NodeRuntime.runMain(main, {
  teardown: (exit) => process.exit(Exit.isSuccess(exit) ? Number(exit.value) : EXIT.FAILED),
});
