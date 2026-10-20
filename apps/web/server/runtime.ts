import { type CoderHost, coderHost } from "@luke/service/agents/coder-host/host";
import { productionCoderHostSeams } from "@luke/service/agents/coder-host/production";
import { hostedEnvironment } from "@luke/service/environment";
import { sentryLayer } from "@luke/service/observability/sentry";
import { type WebServices, type WebServicesError, webServices } from "@luke/service/runtime";
import { Effect, Layer, ManagedRuntime } from "effect";

/**
 * Module scope is the memoization: Vercel keeps a warm instance's module
 * registry between invocations, so the first invocation of a cold start builds
 * the layer and every later one on that instance reuses the same services.
 * Nothing builds a second runtime — a second one would be a second copy of
 * every service a `Context.Service` was supposed to identify.
 */
let standing: ManagedRuntime.ManagedRuntime<WebServices, WebServicesError> | undefined;

/** The coder host a web function serves an agent's tools through, composed on first use and kept for the instance. */
let standingCoderHost: CoderHost | undefined;

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
 * The coding agent's host over the deployment's seams, for a function that
 * runs the agent's tools outside eve: Luke's MCP server, which a native
 * harness's runner calls. It is composed here, on this runtime's runner, as
 * the coding agent's eve root composes its own (`apps/dev/host.ts`): the
 * seams take a runner for their promise-shaped doors, and the environment
 * read is a `Config` over `process.env`, which suspends on nothing.
 */
export function webCoderHost(): CoderHost {
  standingCoderHost ??= coderHost(
    Effect.runSync(Effect.provide(productionCoderHostSeams(runWeb), hostedEnvironment)),
  );
  return standingCoderHost;
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
