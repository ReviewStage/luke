import assert from "node:assert/strict";
import { type ChildProcess, fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { highlightSnippet } from "./task-code.js";
import {
  plainCodeLines,
  type TaskCodeProcess,
  type TaskCodeProcessListeners,
  taskCodeProcessColouring,
} from "./task-code-remote.js";

/** The colouring process's side, run in a real Node child as the desktop runs it in a utility process. */
const CHILD = fileURLToPath(new URL("./testing/task-code-child.mjs", import.meta.url));

/** A child is started with tsx's loader and builds the highlighter, which takes a second or two. */
const CHILD_TIMEOUT_MS = 30_000;

const BLOCKS = [
  { language: "ts", code: "const answer: number = 42;\n\nexport default answer;" },
  { language: "python", code: 'def greet(name):\n    return f"hi {name}"' },
  { language: "cobol", code: "DISPLAY 'HELLO'." },
] as const;

/** A Node child running the colouring process's side, and `afterSend` run on it after each block it is sent. */
function forkChild(
  listeners: TaskCodeProcessListeners,
  afterSend: (child: ChildProcess) => void = () => undefined,
): TaskCodeProcess {
  const child = fork(CHILD, { execArgv: ["--import", "tsx"], stdio: "inherit" });
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
  "a block coloured through the process answers the lines this process colours it as",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const colour = yield* taskCodeProcessColouring((listeners) => forkChild(listeners));
        // Note that each side colours every block once first: Shiki stops a line's colouring past its
        // time limit, and a grammar's first use compiles it, which a loaded runner can push past that.
        for (const { language, code } of BLOCKS) {
          yield* colour(language, code);
          yield* highlightSnippet(language, code);
        }

        for (const { language, code } of BLOCKS) {
          assert.deepEqual(yield* colour(language, code), yield* highlightSnippet(language, code));
        }
      }),
    ),
  CHILD_TIMEOUT_MS,
);

it.effect(
  "a process that dies holding a block answers it plain, and the next block is coloured by a new process",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let spawned = 0;
        const colour = yield* taskCodeProcessColouring((listeners) => {
          spawned += 1;
          // The first process is killed the moment it is handed its block, as a crash would end it.
          return spawned === 1
            ? forkChild(listeners, (child) => child.kill("SIGKILL"))
            : forkChild(listeners);
        });
        const [block] = BLOCKS;

        assert.deepEqual(yield* colour(block.language, block.code), plainCodeLines(block.code));
        const coloured = yield* colour(block.language, block.code);

        assert.deepEqual(
          coloured.map((line) => line.map((run) => run.text).join("")),
          block.code.split("\n"),
        );
        assert.ok(
          coloured.some((line) => line.some((run) => run.color !== undefined)),
          "the new process colours the block",
        );
      }),
    ),
  CHILD_TIMEOUT_MS,
);
