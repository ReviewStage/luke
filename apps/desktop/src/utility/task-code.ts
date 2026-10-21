/**
 * task-code.ts -- the code colouring process main spawns with Electron's `utilityProcess`, answering over its parent port.
 *
 * Its own bundle (`dist/task-code.js`, `scripts/build.mjs`), the one that
 * carries Shiki and its grammars, so main's bundle carries none of them and
 * main's event loop never runs a tokenizer. What is coloured and how is
 * `@luke/host`'s (`task-code-worker.ts`); this is only the process's edge:
 * it runs that over the port main asks it on, for as long as main keeps it.
 */
import { serveTaskCode } from "@luke/host/task-code-worker";
import { Effect } from "effect";

const { parentPort } = process;

Effect.runFork(
  serveTaskCode({
    onMessage: (listener) => {
      parentPort.on("message", (event) => listener(event.data));
    },
    postMessage: (message) => parentPort.postMessage(message),
  }),
);
