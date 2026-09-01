import { type Effect, ManagedRuntime } from "effect";
import { type DesktopLiveInput, type DesktopServices, desktopLive } from "./layers/app";

export type DesktopRuntime = ManagedRuntime.ManagedRuntime<DesktopServices, never>;

let desktopRuntime: DesktopRuntime | undefined;

export function createDesktopRuntime(input: DesktopLiveInput): DesktopRuntime {
  if (desktopRuntime) {
    throw new Error("Desktop runtime already exists");
  }
  desktopRuntime = ManagedRuntime.make(desktopLive(input));
  return desktopRuntime;
}

export function getDesktopRuntime(): DesktopRuntime {
  if (!desktopRuntime) {
    throw new Error("Desktop runtime has not been created");
  }
  return desktopRuntime;
}

export function hasDesktopRuntime(): boolean {
  return desktopRuntime !== undefined;
}

export async function disposeDesktopRuntime(): Promise<void> {
  const runtime = desktopRuntime;
  if (!runtime) return;
  desktopRuntime = undefined;
  await runtime.dispose();
}

export function runDesktopStartup<A, E>(
  runtime: DesktopRuntime,
  program: Effect.Effect<A, E, DesktopServices>,
): Promise<A> {
  return runtime.runPromise(program);
}

export function runDesktopShutdown<A, E>(
  runtime: DesktopRuntime,
  program: Effect.Effect<A, E, DesktopServices>,
): Promise<A> {
  return runtime.runPromise(program);
}

export type { DesktopLiveInput, DesktopServices };
