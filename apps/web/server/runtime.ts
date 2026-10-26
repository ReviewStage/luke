import type { NativeAgentSessions } from "@luke/service/agents/coder-host/runtime-sessions";
import { agentSandboxDoors } from "@luke/service/agents/luke-mcp/sandbox-door";
import { agentMachinesLayer } from "@luke/service/agents/machine/agent-machines";
import { deploymentOidcToken } from "@luke/service/agents/vercel-sandbox-api";
import { AfterResponse } from "@luke/service/http/after-response";
import { sentryLayer } from "@luke/service/observability/sentry";
import { type WebServices, type WebServicesError, webServices } from "@luke/service/runtime";
import { waitUntil } from "@vercel/functions";
import { type Context, Effect, Layer, ManagedRuntime } from "effect";

/**
 * Module scope is the memoization: Vercel keeps a warm instance's module
 * registry between invocations, so the first invocation of a cold start builds
 * the layer and every later one on that instance reuses the same services.
 * Nothing builds a second runtime — a second one would be a second copy of
 * every service a `Context.Service` was supposed to identify.
 */
let standing: ManagedRuntime.ManagedRuntime<WebServices, WebServicesError> | undefined;

/**
 * Work a request hands on past its answer (`after-response.ts`), run as a
 * root of its own on this runtime, so the request's end interrupts none of
 * it, and handed to Vercel's `waitUntil`, so the instance is not frozen
 * before it ends. The work never fails, and carries the request's services.
 */
const afterResponseLayer = Layer.succeed(AfterResponse, {
  keep: (work) => Effect.sync(() => waitUntil(runWeb(work))),
});

/**
 * The one runtime a web function runs an effect on, with Sentry started
 * before the services it watches, as Sentry's Effect guide provides it to
 * the HTTP layer, and the after-response work beside them.
 */
function webRuntime(): ManagedRuntime.ManagedRuntime<WebServices, WebServicesError> {
  standing ??= ManagedRuntime.make(
    Layer.provideMerge(webServices, Layer.merge(sentryLayer(), afterResponseLayer)),
  );
  return standing;
}

/** The one place `apps/web` runs an effect, which is what makes this the edge. */
export function runWeb<A, E>(effect: Effect.Effect<A, E, WebServices>): Promise<A> {
  return webRuntime().runPromise(effect);
}

/**
 * The deployment's services as a route reads them once per instance, with
 * the native harnesses beside them where its function provides them
 * (`native-agents.ts`), built over this one runtime.
 */
export function webServicesWith(
  beside?: Layer.Layer<NativeAgentSessions, never, WebServices>,
): Promise<Context.Context<WebServices>> {
  return beside === undefined
    ? runWeb(Effect.context<WebServices>())
    : runWeb(Effect.provide(Effect.context<WebServices | NativeAgentSessions>(), beside));
}

/**
 * The doors to a native agent's machine, for Luke's MCP server's tools that
 * read a file the agent names or run `show_code` in its checkout: their calls run on this runtime, a
 * sandbox's under the function's own OIDC token, as every other call of
 * Luke's to Vercel Sandbox is made, and a local agent's as requests its Mac answers.
 */
export const webAgentSandboxDoor = agentSandboxDoors(
  runWeb,
  agentMachinesLayer({ readToken: deploymentOidcToken, run: runWeb }),
);

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
