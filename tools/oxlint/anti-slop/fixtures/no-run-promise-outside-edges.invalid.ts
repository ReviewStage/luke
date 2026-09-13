import { detachOn, runtimeExit } from "@sidecar/brain";
import type { ExecutionRuntime } from "@sidecar/runtime/vocabulary";
import { Context, Effect, type Exit } from "effect";
import { runWeb, webRuntime } from "../../../../apps/web/server/runtime.js";

/** Declared rather than imported: this fixture is read as syntax, never resolved. */
declare const NodeRuntime: { readonly runMain: (effect: Effect.Effect<void>) => void };

export function greeting(name: string): Promise<string> {
  return Effect.runPromise(Effect.sync(() => `hello ${name}`));
}

export function main(): void {
  NodeRuntime.runMain(Effect.sync(() => undefined));
}

/** The services a caller carries are where a v3 `Runtime` went; running on them is still running. */
export function greetingWithServices(name: string): Promise<string> {
  return Effect.runPromiseWith(Context.empty())(Effect.sync(() => `hello ${name}`));
}

export function greetingExit(
  execution: ExecutionRuntime,
  name: string,
): Promise<Exit.Exit<string>> {
  return runtimeExit(execution)(Effect.sync(() => `hello ${name}`));
}

/** The brain's fork door, called where the work lives rather than at the edge. */
export function detached(execution: ExecutionRuntime, name: string): void {
  detachOn(execution)(Effect.sync(() => `hello ${name}`));
}

/** The web edge's own runner, called where the work lives rather than at the edge. */
export function seeded(): Promise<void> {
  return runWeb(Effect.sync(() => undefined));
}

/** The same run one member deeper: the runtime the edge hands out still runs one. */
export function seededOnRuntime(): Promise<void> {
  return webRuntime().runPromise(Effect.sync(() => undefined));
}
