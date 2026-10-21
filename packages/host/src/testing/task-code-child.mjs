// task-code-child.mjs -- the colouring process's side run in a plain Node child, over its IPC channel, as the desktop runs it over a utility process's parent port.
//
// A test forks this with tsx's loader (`task-code-remote.test.ts`), so the
// colouring crosses a real process boundary as it does on the desktop. It is
// plain JavaScript because it is a process's edge: it runs the one Effect
// that serves for the child's life.
import { Effect } from "effect";
import { serveTaskCode } from "../task-code-worker.js";

Effect.runFork(
  serveTaskCode({
    onMessage: (listener) => {
      process.on("message", listener);
    },
    postMessage: (message) => {
      process.send?.(message);
    },
  }),
);
