import type { UpdateSnapshot } from "#shared/contracts";
import { UpdatesTag } from "./layers/updates";
import type { DesktopRuntime } from "./runtime";

export interface UpdateServiceHandle {
  snapshot(): UpdateSnapshot;
  check(): Promise<UpdateSnapshot>;
  install(): void;
  start(): void;
  stop(): void;
}

export function updateServiceFromRuntime(runtime: DesktopRuntime): UpdateServiceHandle {
  const updates = runtime.runSync(UpdatesTag);
  return {
    snapshot: () => updates.snapshot(),
    check: () => runtime.runPromise(updates.check()),
    install: () => {
      void runtime.runPromise(updates.install());
    },
    start: () => {
      void runtime.runPromise(updates.start());
    },
    stop: () => {
      void runtime.runPromise(updates.stop());
    },
  };
}
