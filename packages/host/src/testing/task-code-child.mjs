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
