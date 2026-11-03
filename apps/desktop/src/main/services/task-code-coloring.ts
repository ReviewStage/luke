/**
 * task-code-coloring.ts -- a transcript's fenced blocks colored in a `utilityProcess` of main's own, rather than on main's event loop.
 *
 * What is asked and when, the queue, and the restart are `@repo/host`'s
 * (`task-code-remote.ts`); this is only how the desktop starts the process:
 * the coloring bundle built beside main (`dist/task-code.js`), forked the
 * first time a block is asked for, talked to over its parent port, and killed
 * with the scope the launch builds it in.
 */
import path from "node:path";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { type ColorCode, taskCodeProcessColoring } from "@repo/host/task-code-remote";
import type { Effect, Scope } from "effect";
import { utilityProcess } from "electron";

/** The coloring process's bundle, beside main's own in the build's directory. */
const ENTRY = "task-code.js";

/** What Activity Monitor names the process. */
const SERVICE_NAME = `${PRODUCT_NAME} Code Coloring`;

/** The coloring the act port asks for, through a process forked from `resourceDirectory`'s bundle. */
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
