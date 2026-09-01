import { createObservationLoop, createObservationSupervisor } from "./observation-service.js";

export interface ObservationLoopOptions {
  gate: () => boolean;
  intervalMs: number;
  run: (generation: number) => Promise<void>;
  afterRun?: () => void;
}

export class ObservationLoop {
  readonly #handle: ReturnType<typeof createObservationLoop>;

  constructor(options: ObservationLoopOptions) {
    this.#handle = createObservationLoop(options);
  }

  get generation(): number {
    return this.#handle.generation;
  }

  isCurrent(generation: number): boolean {
    return this.#handle.isCurrent(generation);
  }

  start(): void {
    this.#handle.start();
  }

  stop(): void {
    this.#handle.stop();
  }

  refresh(): Promise<void> {
    return this.#handle.refresh();
  }
}

export class ObservationSupervisor {
  readonly #supervisor: ReturnType<typeof createObservationSupervisor>;

  constructor(loops: readonly ObservationLoop[]) {
    this.#supervisor = createObservationSupervisor(loops);
  }

  /**
   * Deliberately unlatched. Every loop starts behind a gate of its own that
   * may still be closed — a launch before the account arrives arms nothing —
   * so the call that matters is usually the second one, and a supervisor that
   * remembered it was already enabled would leave the loops stopped for the
   * rest of the run. The loops carry the idempotence instead: an armed loop
   * ignores `start`, and a stopped one ignores `stop`.
   */
  setEnabled(enabled: boolean): void {
    this.#supervisor.setEnabled(enabled);
  }
}

export {
  createObservationLoop,
  createObservationSupervisor,
  makeObservationLoopRuntime,
  type ObservationLoopConfig,
  type ObservationLoopHandle,
  type ObservationLoopRuntime,
} from "./observation-service.js";
