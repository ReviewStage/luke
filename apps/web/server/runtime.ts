import { FetchHttpClient } from "@effect/platform";
import type { Effect } from "effect";
import { Layer, ManagedRuntime } from "effect";
import { webSqlClient } from "./db/sql-client.js";

/**
 * The services every web function's effects run against. A function reaches
 * this layer only through the runtime below, so a service added here is built
 * once per instance rather than once per invocation.
 *
 * `@effect/platform-node` has no entry: a Vercel function's platform is the
 * Web `fetch` its runtime already carries, and a Node-reaching companion
 * behind this door would have to be traced into every bundle. `@effect/sql-pg`
 * does have one: a web function's database is the platform Vercel gives it, and
 * `repository-checks.sh` keeps that specifier out of `api/`, where the stubs
 * that re-export a bundle stand, rather than out of the bundle itself.
 */
const webServices = Layer.mergeAll(FetchHttpClient.layer, webSqlClient);

/** What an effect run at this edge may require. */
export type WebServices = Layer.Layer.Success<typeof webServices>;

/**
 * How building those services can fail, which is a missing `DATABASE_URL`: the
 * runtime names the database every deployed function reaches, so an invocation
 * on an instance configured without one is refused at the edge rather than at
 * whichever query ran first.
 */
type WebServicesError = Layer.Layer.Error<typeof webServices>;

/**
 * Module scope is the memoization: Vercel keeps a warm instance's module
 * registry between invocations, so the first invocation of a cold start builds
 * the layer and every later one on that instance reuses the same services.
 * Nothing builds a second runtime — a second one would be a second copy of
 * every service a `Context.Tag` was supposed to identify.
 */
let standing: ManagedRuntime.ManagedRuntime<WebServices, WebServicesError> | undefined;

/** The one runtime a web function runs an effect on. */
export function webRuntime(): ManagedRuntime.ManagedRuntime<WebServices, WebServicesError> {
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
