/**
 * runtime.ts -- the one runtime this eve root's effects run on.
 *
 * eve drives the root's authored files through promise-shaped hooks of its
 * own, so each file that answers one is an edge, and every one of them runs
 * on the runtime built here over the deployment's services
 * (`@luke/service/runtime`) rather than reaching into the website's.
 */

import { type WebServices, type WebServicesError, webServices } from "@luke/service/runtime";
import { type Effect, ManagedRuntime } from "effect";

/**
 * Module scope is the memoization, on the same terms as the web functions'
 * runtime: a warm instance of the coding agent's service keeps its module registry, so
 * the first hook of a cold start builds the layer and every later one reuses it.
 */
let standing: ManagedRuntime.ManagedRuntime<WebServices, WebServicesError> | undefined;

/** The one place this eve root runs an effect, which is what makes this the edge. */
export function runAgent<A, E>(effect: Effect.Effect<A, E, WebServices>): Promise<A> {
  standing ??= ManagedRuntime.make(webServices);
  return standing.runPromise(effect);
}
