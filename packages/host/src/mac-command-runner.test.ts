import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { MAC_COMMAND_BOUNDS } from "@sidecar/hosted/mac-command-wire";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { MAC_COMMAND_RUN, runMacCommand } from "./mac-command-runner.js";
import { scriptedSpawner } from "./testing/scripted-spawner.js";

/**
 * One command an agent asked of this Mac, run on a scripted spawner and the
 * test's clock: what the shell is handed, what the result carries, and how
 * a command that outlives its timeout is ended.
 */

const SHELL = { path: "/bin/zsh", home: "/Users/developer" };

const command = (text: string, timeoutSeconds = 60) => ({
  id: "6b0c9a52-3f1e-4d7a-9c2b-8e5f1a0d4c37",
  command: text,
  timeoutSeconds,
});

it.effect(
  "runs the command whole in the login shell from the home folder, with nothing on stdin",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ stdout: "main\n", stderr: "warn\n", exitCode: 3 }));

      const result = yield* Effect.provide(
        runMacCommand(command("git branch --show-current && echo $HOME"), SHELL),
        spawner.layer,
      );

      assert.deepEqual(result, {
        exitCode: 3,
        stdout: "main\n",
        stderr: "warn\n",
        truncated: false,
        timedOut: false,
      });
      const [spawned] = spawner.spawned;
      assert.equal(spawned?.program, "/bin/zsh");
      assert.deepEqual(spawned?.args, ["-l", "-c", "git branch --show-current && echo $HOME"]);
      assert.equal(spawned?.cwd, "/Users/developer");
      assert.equal(spawned?.stdin, "ignore");
      assert.equal(spawned?.extendEnv, true, "the command sees the app's own environment");
      assert.equal(spawned?.env?.GIT_TERMINAL_PROMPT, "0");
      assert.equal(spawned?.ended, "exited");
    }),
);

it.effect(
  "a command that outlives its timeout is ended with its group, and what it printed is kept",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ stdout: "serving on :3000\n" }));
      const running = yield* Effect.forkChild(
        Effect.provide(runMacCommand(command("npm run dev", 5), SHELL), spawner.layer),
      );

      yield* TestClock.adjust("5 seconds");
      const result = yield* Fiber.join(running);

      assert.deepEqual(result, {
        exitCode: null,
        stdout: "serving on :3000\n",
        stderr: "",
        truncated: false,
        timedOut: true,
      });
      assert.deepEqual(spawner.spawned[0]?.ended, {
        killSignal: "SIGTERM",
        forceKillAfterMillis: Duration.toMillis(MAC_COMMAND_RUN.KILL_GRACE),
      });
    }),
);

it.effect("each stream keeps its first characters up to the bound and says it was cut", () =>
  Effect.gen(function* () {
    const long = "x".repeat(MAC_COMMAND_BOUNDS.MAX_OUTPUT_CHARS + 5_000);
    const spawner = scriptedSpawner(() => ({ stdout: long, exitCode: 0 }));

    const result = yield* Effect.provide(
      runMacCommand(command("yes x | head"), SHELL),
      spawner.layer,
    );

    assert.equal(result.stdout, long.slice(0, MAC_COMMAND_BOUNDS.MAX_OUTPUT_CHARS));
    assert.equal(result.truncated, true);
    assert.equal(result.exitCode, 0);
  }),
);

it.effect("a command whose shell cannot be started answers why on its stderr", () =>
  Effect.gen(function* () {
    const spawner = scriptedSpawner(() => undefined);

    const result = yield* Effect.provide(runMacCommand(command("ls"), SHELL), spawner.layer);

    assert.equal(result.exitCode, null);
    assert.equal(result.timedOut, false);
    assert.match(result.stderr, /^Luke could not start the command: /);
  }),
);
