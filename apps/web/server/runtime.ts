import { sentryLayer } from "@luke/service/observability/sentry";
import { type WebServices, type WebServicesError, webServices } from "@luke/service/runtime";
import { type Effect, Layer, ManagedRuntime } from "effect";

/**
 * Module scope is the memoization: Vercel keeps a warm instance's module
 * registry between invocations, so the first invocation of a cold start builds
 * the layer and every later one on that instance reuses the same services.
 * Nothing builds a second runtime — a second one would be a second copy of
 * every service a `Context.Service` was supposed to identify.
 */
let standing: ManagedRuntime.ManagedRuntime<WebServices, WebServicesError> | undefined;

/**
 * The one runtime a web function runs an effect on, with Sentry started
 * before the services it watches, as Sentry's Effect guide provides it to
 * the HTTP layer.
 */
function webRuntime(): ManagedRuntime.ManagedRuntime<WebServices, WebServicesError> {
  standing ??= ManagedRuntime.make(Layer.provideMerge(webServices, sentryLayer()));
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
