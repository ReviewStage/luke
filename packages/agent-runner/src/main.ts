/**
 * main.ts -- the runner's process: stdin and the environment in, one launch run, and the process's exit code out.
 *
 * Bundled with the SDK into one file (`pnpm --filter @luke/agent-runner
 * build`), which Luke uploads to the agent's sandbox and starts there as the
 * agent user (P08). Exit 0 is a launch that ended as Luke asked or as the
 * turn did; anything else is one Luke shows as interrupted.
 */

import { createInterface } from "node:readline";
import { NodeRuntime } from "@effect/platform-node";
import { Effect, Exit, Layer, Stream } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { claudeCodeLive } from "./claude-code.js";
import { RUNNER_END } from "./protocol.js";
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

const main = runAgent({ lines: stdinLines, env: process.env }).pipe(
  Effect.scoped,
  Effect.map((end) => (end === RUNNER_END.FAILED ? EXIT.FAILED : EXIT.ENDED)),
  Effect.catch((error) =>
    Effect.logError(`agent-runner: ${error._tag}: ${error.detail}`).pipe(Effect.as(EXIT.FAILED)),
  ),
  Effect.provide(Layer.mergeAll(claudeCodeLive, FetchHttpClient.layer)),
);

// Note that we exit explicitly, even on success, where `runMain` would leave
// the process to drain, because stdin, which Luke may hold open, would keep
// it alive after the launch has ended.
NodeRuntime.runMain(main, {
  teardown: (exit) => process.exit(Exit.isSuccess(exit) ? Number(exit.value) : EXIT.FAILED),
});
