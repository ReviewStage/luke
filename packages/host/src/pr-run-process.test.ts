import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { runPullRequestCommand } from "./pr-run-process.js";

/**
 * A repository's run command over a real shell: it runs from the
 * checkout's root, what it prints reaches the writer, how it ended on its
 * own is its status, and a stop ends it and everything it started.
 */

const machine = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

const SHELL = { path: "/bin/sh" } as const;

/** Whether a process of that id still runs. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

it.effect(
  "the command runs from the checkout's root, its output written, its status answered",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const folder = yield* temporaryDirectoryScoped("luke-pr-process-");
        const written: Uint8Array[] = [];
        const write = (bytes: Uint8Array) => Effect.sync(() => void written.push(bytes));

        const succeeded = yield* runPullRequestCommand(
          SHELL,
          folder,
          'pwd; echo "$LUKE_PR_CHECKOUT" >&2',
          write,
        );
        const failed = yield* runPullRequestCommand(SHELL, folder, "exit 3", write);

        assert.equal(succeeded, 0);
        assert.equal(failed, 3);
        const printed = Buffer.concat(written).toString("utf8");
        assert.equal(printed.split(folder).length - 1, 2, printed);
      }),
    ).pipe(Effect.provide(machine)),
);

it.effect("a stop ends the command and the process it started", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const folder = yield* temporaryDirectoryScoped("luke-pr-process-");
      const started = yield* Deferred.make<void>();
      const write = () => Deferred.succeed(started, undefined).pipe(Effect.asVoid);
      const fiber = yield* Effect.forkChild(
        runPullRequestCommand(
          SHELL,
          folder,
          "sleep 60 & echo $! > child.pid; echo $$ > parent.pid; echo started; wait",
          write,
        ),
      );
      yield* Deferred.await(started);
      const parent = Number(readFileSync(path.join(folder, "parent.pid"), "utf8"));
      const child = Number(readFileSync(path.join(folder, "child.pid"), "utf8"));
      assert.ok(alive(parent) && alive(child));

      yield* Fiber.interrupt(fiber);

      assert.equal(alive(parent), false);
      assert.equal(alive(child), false);
    }),
  ).pipe(Effect.provide(machine)),
);
