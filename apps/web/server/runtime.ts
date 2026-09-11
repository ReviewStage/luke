import { FetchHttpClient } from "@effect/platform";
import type { Effect, Layer } from "effect";
import { ManagedRuntime } from "effect";

/**
 * The services every web function's effects run against. A function reaches
 * this layer only through the runtime below, so a service added here is built
 * once per instance rather than once per invocation.
 *
 * `@effect/platform-node` has no entry: a Vercel function's platform is the
 * Web `fetch` its runtime already carries, and a Node-reaching companion
 * behind this door would have to be traced into every bundle.
 */
const webServices = FetchHttpClient.layer;

/** What an effect run at this edge may require. */
export type WebServices = Layer.Layer.Success<typeof webServices>;

/**
 * Module scope is the memoization: Vercel keeps a warm instance's module
 * registry between invocations, so the first invocation of a cold start builds
 * the layer and every later one on that instance reuses the same services.
 * Nothing builds a second runtime — a second one would be a second copy of
 * every service a `Context.Tag` was supposed to identify.
 */
let standing: ManagedRuntime.ManagedRuntime<WebServices, never> | undefined;

/** The one runtime a web function runs an effect on. */
export function webRuntime(): ManagedRuntime.ManagedRuntime<WebServices, never> {
  standing ??= ManagedRuntime.make(webServices);
  return standing;
}

/** The one place `apps/web` runs an effect, which is what makes this the edge. */
export function runWeb<A, E>(effect: Effect.Effect<A, E, WebServices>): Promise<A> {
  return webRuntime().runPromise(effect);
}

/**
 * Releases what the layer acquired and leaves the next call to build it again.
 *
 * A Vercel Node function is given no documented shutdown hook — an instance is
 * frozen between invocations and discarded without notice — so nothing in
 * production calls this, and the layer holds nothing whose release a process's
 * end would not do. It exists so a test can end the runtime it started.
 */
export function disposeWebRuntime(): Promise<void> {
  const ending = standing;
  standing = undefined;
  return ending === undefined ? Promise.resolve() : ending.dispose();
}
