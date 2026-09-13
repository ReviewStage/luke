import { runtimeExit } from "@sidecar/brain";
import type { ExecutionRuntime } from "@sidecar/runtime/vocabulary";
import { Effect, type Exit } from "effect";

/** Declared rather than imported: this fixture is read as syntax, never resolved. */
declare const NodeRuntime: { readonly runMain: (effect: Effect.Effect<void>) => void };

export function greeting(name: string): Promise<string> {
  return Effect.runPromise(Effect.sync(() => `hello ${name}`));
}

export function main(): void {
  NodeRuntime.runMain(Effect.sync(() => undefined));
}

export function greetingExit(
  execution: ExecutionRuntime,
  name: string,
): Promise<Exit.Exit<string>> {
  return runtimeExit(execution)(Effect.sync(() => `hello ${name}`));
}
