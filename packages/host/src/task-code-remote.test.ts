import assert from "node:assert/strict";
import { type ChildProcess, fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { highlightSnippet } from "./task-code.js";
import {
  plainCodeLines,
  type TaskCodeProcess,
  type TaskCodeProcessListeners,
  taskCodeProcessColoring,
} from "./task-code-remote.js";

/** The coloring process's side, run in a real Node child as the desktop runs it in a utility process. */
const CHILD = fileURLToPath(new URL("./testing/task-code-child.mjs", import.meta.url));

/** A child is started with tsx's loader and builds the highlighter, which takes a second or two. */
const CHILD_TIMEOUT_MS = 30_000;

const BLOCKS = [
  { language: "ts", code: "const answer: number = 42;\n\nexport default answer;" },
  { language: "python", code: 'def greet(name):\n    return f"hi {name}"' },
  { language: "cobol", code: "DISPLAY 'HELLO'." },
] as const;

/** A Node child running the coloring process's side, and `afterSend` run on it after each block it is sent. */
function forkChild(
  listeners: TaskCodeProcessListeners,
  afterSend: (child: ChildProcess) => void = () => undefined,
  forked: (child: ChildProcess) => void = () => undefined,
): TaskCodeProcess {
  const child = fork(CHILD, { execArgv: ["--import", "tsx"], stdio: "inherit" });
  forked(child);
  child.on("message", (message) => listeners.onMessage(message));
  child.on("exit", () => listeners.onExit());
  return {
    send: (message) => {
      child.send(message as object);
      afterSend(child);
    },
    kill: () => {
      child.kill();
    },
  };
}

it.effect(
  "a block colored through the process answers the lines this process colors it as",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const color = yield* taskCodeProcessColoring((listeners) => forkChild(listeners));
        // Note that each side colors every block once first: Shiki stops a line's coloring past its
        // time limit, and a grammar's first use compiles it, which a loaded runner can push past that.
        for (const { language, code } of BLOCKS) {
          yield* color(language, code);
          yield* highlightSnippet(language, code);
        }

        for (const { language, code } of BLOCKS) {
          assert.deepEqual(yield* color(language, code), yield* highlightSnippet(language, code));
        }
      }),
    ),
  CHILD_TIMEOUT_MS,
);

it.effect(
  "a process that dies holding a block answers it plain, and the next block is colored by a new process",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let spawned = 0;
        const color = yield* taskCodeProcessColoring((listeners) => {
          spawned += 1;
          // The first process is killed the moment it is handed its block, as a crash would end it.
          return spawned === 1
            ? forkChild(listeners, (child) => child.kill("SIGKILL"))
            : forkChild(listeners);
        });
        const [block] = BLOCKS;

        assert.deepEqual(yield* color(block.language, block.code), plainCodeLines(block.code));
        const colored = yield* color(block.language, block.code);

        assert.deepEqual(
          colored.map((line) => line.map((run) => run.text).join("")),
          block.code.split("\n"),
        );
        assert.ok(
          colored.some((line) => line.some((run) => run.color !== undefined)),
          "the new process colors the block",
        );
      }),
    ),
  CHILD_TIMEOUT_MS,
);

it.effect(
  "a process that dies while idle is replaced before the next block, which is colored rather than drawn plain",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const children: ChildProcess[] = [];
        const color = yield* taskCodeProcessColoring((listeners) =>
          forkChild(listeners, undefined, (child) => children.push(child)),
        );
        const [block] = BLOCKS;
        yield* color(block.language, block.code);

        // The first process crashes after answering, with no block in its hands.
        const [first] = children;
        assert.ok(first !== undefined);
        const exited = once(first, "exit");
        first.kill("SIGKILL");
        yield* Effect.promise(() => exited);
        const colored = yield* color(block.language, block.code);

        assert.ok(
          colored.some((line) => line.some((run) => run.color !== undefined)),
          "the block after an idle crash is colored",
        );
      }),
    ),
  CHILD_TIMEOUT_MS,
);
