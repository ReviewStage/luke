import { Effect } from "effect";
import { UpdatesTag } from "./layers/updates";
import { disposeDesktopRuntime, getDesktopRuntime, hasDesktopRuntime } from "./runtime";

export interface ShutdownHooks {
  readonly beforeQuit: () => void | Promise<void>;
  readonly willQuit: () => void | Promise<void>;
}

let shutdownRequested = false;

export function shutdownInProgress(): boolean {
  return shutdownRequested;
}

export function resetShutdownStateForTests(): void {
  shutdownRequested = false;
}

export async function requestDesktopShutdown(hooks: ShutdownHooks): Promise<void> {
  if (shutdownRequested) return;
  shutdownRequested = true;

  await hooks.beforeQuit();

  if (hasDesktopRuntime()) {
    const runtime = getDesktopRuntime();
    await runtime
      .runPromise(
        Effect.gen(function* () {
          const updates = yield* UpdatesTag;
          yield* updates.stop();
        }),
      )
      .catch(() => undefined);
    await disposeDesktopRuntime();
  }

  await hooks.willQuit();
}
