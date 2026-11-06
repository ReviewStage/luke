import path from "node:path";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { type ColorCode, taskCodeProcessColoring } from "@repo/host/task-code-remote";
import type { Effect, Scope } from "effect";
import { utilityProcess } from "electron";

const ENTRY = "task-code.js";

const SERVICE_NAME = `${PRODUCT_NAME} Code Coloring`;

export function colorCodeInUtilityProcess(
  resourceDirectory: string,
): Effect.Effect<ColorCode, never, Scope.Scope> {
  return taskCodeProcessColoring((listeners) => {
    const child = utilityProcess.fork(path.join(resourceDirectory, ENTRY), [], {
      serviceName: SERVICE_NAME,
    });
    child.on("message", (message: unknown) => listeners.onMessage(message));
    child.on("exit", () => listeners.onExit());
    return {
      send: (message) => child.postMessage(message),
      kill: () => {
        child.kill();
      },
    };
  });
}
