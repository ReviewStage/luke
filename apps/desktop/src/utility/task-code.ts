import { serveTaskCode } from "@repo/host/task-code-worker";
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
