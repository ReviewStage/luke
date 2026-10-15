/**
 * runtime.ts -- the one runtime an agent's effects run on, shared by the workspace's members.
 *
 * eve drives a member's authored files through promise-shaped hooks of its
 * own, so each file that answers one is an edge, and every one of them runs
 * on the runtime built here over the deployment's services
 * (`@luke/service/runtime`) rather than reaching into the website's. Each
 * member is built and deployed as its own service, so each service holds its
 * own copy of this module and its own runtime.
 */

import { type WebServices, type WebServicesError, webServices } from "@luke/service/runtime";
import { type Effect, ManagedRuntime } from "effect";

/**
 * Module scope is the memoization, on the same terms as the web functions'
 * runtime: a warm instance of an agent's service keeps its module registry, so
 * the first hook of a cold start builds the layer and every later one reuses it.
 */
let standing: ManagedRuntime.ManagedRuntime<WebServices, WebServicesError> | undefined;

/** The one place an agent runs an effect, which is what makes this the edge. */
export function runAgent<A, E>(effect: Effect.Effect<A, E, WebServices>): Promise<A> {
  standing ??= ManagedRuntime.make(webServices);
  return standing.runPromise(effect);
}
