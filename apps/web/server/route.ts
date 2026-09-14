import type { Layer } from "effect";
import type { HttpRouter } from "effect/unstable/http";

/**
 * What a route file default-exports: one fetch handler, which is the whole of
 * what the platform asks of a function. Named here so every wrapper that
 * builds one says the same thing.
 */
export interface Route {
  fetch: (request: Request) => Promise<Response>;
}

/**
 * The method every route in this repository registers under: a path's own
 * handler decides which methods it answers, so a request to the right path on
 * the wrong method still answers the handler's 405 rather than falling
 * through to the group's own not-found.
 */
export const ANY_METHOD = "*";

/**
 * The path a group's own not-found route registers under, which the router
 * reaches only after every path the group declares has failed to match.
 */
export const ANY_PATH = "*";

/**
 * What a group of routes is: a layer that registers each of its routes with
 * the one `HttpRouter` service `routeFromHttpRouter` builds. A route's own
 * requirements are carried as request markers rather than as the layer's
 * inputs, since they are provided per request rather than when the router is
 * built; `R` names them as the services they are. A group answers every
 * request, so no error marker appears here: a route that can fail is one that
 * recovers into its own refusal before it is registered.
 *
 * It is stated here rather than beside the adaptor that reads it because a
 * group naming it must not thereby import the edge's own runtime, whose
 * database driver would then be traced into every function's bundle.
 */
export type WebRoutes<R> = Layer.Layer<
  never,
  never,
  HttpRouter.HttpRouter | HttpRouter.Request.From<"Requires", R>
>;
