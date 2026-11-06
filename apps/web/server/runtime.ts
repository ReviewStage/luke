import type { NativeAgentSessions } from "@repo/service/agents/coder-host/runtime-sessions";
import { agentMachinesLayer } from "@repo/service/agents/machine/agent-machines";
import { deploymentOidcToken } from "@repo/service/agents/vercel-sandbox-api";
import { agentSandboxDoors } from "@repo/service/agents/workspace-mcp/sandbox-door";
import { AfterResponse } from "@repo/service/http/after-response";
import { sentryLayer } from "@repo/service/observability/sentry";
import { type WebServices, type WebServicesError, webServices } from "@repo/service/runtime";
import { waitUntil } from "@vercel/functions";
import { type Context, Effect, Layer, ManagedRuntime } from "effect";

let standing: ManagedRuntime.ManagedRuntime<WebServices, WebServicesError> | undefined;

const afterResponseLayer = Layer.succeed(AfterResponse, {
  keep: (work) => Effect.sync(() => waitUntil(runWeb(work))),
});

function webRuntime(): ManagedRuntime.ManagedRuntime<WebServices, WebServicesError> {
  standing ??= ManagedRuntime.make(
    Layer.provideMerge(webServices, Layer.merge(sentryLayer(), afterResponseLayer)),
  );
  return standing;
}

export function runWeb<A, E>(effect: Effect.Effect<A, E, WebServices>): Promise<A> {
  return webRuntime().runPromise(effect);
}

export function webServicesWith(
  beside?: Layer.Layer<NativeAgentSessions, never, WebServices>,
): Promise<Context.Context<WebServices>> {
  return beside === undefined
    ? runWeb(Effect.context<WebServices>())
    : runWeb(Effect.provide(Effect.context<WebServices | NativeAgentSessions>(), beside));
}

export const webAgentSandboxDoor = agentSandboxDoors(
  runWeb,
  agentMachinesLayer({ readToken: deploymentOidcToken, run: runWeb }),
);

export function disposeWebRuntime(): Promise<void> {
  const ending = standing;
  standing = undefined;
  return ending === undefined ? Promise.resolve() : ending.dispose();
}
