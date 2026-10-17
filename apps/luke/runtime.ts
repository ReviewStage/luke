/**
 * runtime.ts -- the one runtime this eve root's effects run on.
 *
 * eve drives the root's authored files through promise-shaped hooks of its
 * own, so each file that answers one is an edge, and every one of them runs
 * on the runtime built here over the deployment's services
 * (`@luke/service/runtime`) rather than reaching into the website's.
 */

import { sentryReportingLayer } from "@luke/service/observability/sentry";
import { type WebServices, type WebServicesError, webServices } from "@luke/service/runtime";
import { Effect, Layer, ManagedRuntime } from "effect";

/**
 * Module scope is the memoization, on the same terms as the web functions'
 * runtime: a warm instance of Luke's brain's service keeps its module registry, so
 * the first hook of a cold start builds the layer and every later one reuses it.
 */
let standing: ManagedRuntime.ManagedRuntime<WebServices, WebServicesError> | undefined;

/**
 * The one place this eve root runs an effect, which is what makes this the
 * edge. Sentry was started by eve's instrumentation (`instrumentation/sentry.ts`)
 * before this file loaded, so the runtime takes its reporting and not a
 * second start. A defect is reported on the way out, since eve, the
 * promise's caller, is not Effect and would not.
 */
export function runAgent<A, E>(effect: Effect.Effect<A, E, WebServices>): Promise<A> {
  standing ??= ManagedRuntime.make(Layer.merge(webServices, sentryReportingLayer));
  return standing.runPromise(Effect.withErrorReporting(effect, { defectsOnly: true }));
}
