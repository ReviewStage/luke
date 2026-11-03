/**
 * local-demo.ts -- whether the service runs as the local demo: the flag the local server sets, honoured only where the local server's own guard passes over the same environment.
 *
 * The local server sets `APP_LOCAL_DEMO` for the routes it mounts
 * (`apps/web/scripts/local-server.ts`), and the demo is the one place what it
 * turns on may stand: a Start on a task that names no repository, where its
 * agents run on a host (`agents/coder-host/start.ts`), and the account's
 * access saying so, so a window lets that Start be pressed
 * (`accounts/account-procedures.ts`). Note that the flag alone turns nothing
 * on, because a variable that leaked into a deployment's environment would
 * carry it there: the service reads the local server's guard again over the
 * environment the flag was read from (`localServerRefusalRead`), and any
 * `VERCEL*` variable, or a database off this machine's loopback, holds the
 * demo off whatever the flag says. A runtime that provides no reading is off.
 */

import { Config, Context, Effect, Layer } from "effect";
import { localServerRefusalRead } from "./local-server-guard.js";

/** The variable the local server turns the demo on with, the one name it goes by. */
export const LOCAL_DEMO_ENVIRONMENT = { FLAG: "APP_LOCAL_DEMO" } as const;

/** What the local server sets the flag to. */
export const LOCAL_DEMO_ON = "1";

export interface LocalDemoShape {
  /** Whether this service runs as the local demo. */
  readonly on: boolean;
}

const OFF: LocalDemoShape = { on: false };

/** The demo as one runtime has it: on only where `localDemoFromEnvironment` read it so, off otherwise. */
export const LocalDemo = Context.Reference<LocalDemoShape>("@repo/service/LocalDemo", {
  defaultValue: () => OFF,
});

/**
 * The demo as the active `ConfigProvider`'s environment says it, read as the
 * runtime's services are built: on where the flag is set true and the local
 * server's guard passes over the same environment; off where the flag is
 * unset, false, or unreadable, and wherever the guard refuses, which is
 * logged by name so a demo that will not turn on says why.
 */
export const localDemoFromEnvironment = Layer.effect(
  LocalDemo,
  Effect.gen(function* () {
    const flagged = yield* Config.Boolean(LOCAL_DEMO_ENVIRONMENT.FLAG).pipe(
      Config.withDefault(false),
      Effect.orElseSucceed(() => false),
    );
    if (!flagged) return OFF;
    const refusal = yield* localServerRefusalRead;
    if (refusal === undefined) return { on: true };
    yield* Effect.logWarning(`${LOCAL_DEMO_ENVIRONMENT.FLAG} is set but held off: ${refusal}`);
    return OFF;
  }),
);
