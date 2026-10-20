/**
 * native-agents.ts -- the native harnesses a web function launches and writes to, provided beside the deployment's services.
 *
 * A coding agent whose conversation runs on a native harness (Claude Code)
 * is answered by a runner Luke launches in its sandbox
 * (`packages/service/src/agents/coder-host/runtime-sessions.ts`). The
 * functions whose routes reach an agent's session provide the harnesses
 * here: the default function's oRPC router and its GitHub and automation
 * webhooks, the scheduled sweep, and Luke's MCP server. Importing this
 * module is what reaches `runner-bundle.ts`, so the web build ships the
 * runner's bundle in each of those functions' `.func`
 * (`scripts/bundle-functions.ts`), where the bundle is read beside the
 * function's own entry. Every other function provides none, and a native
 * conversation reached from one is refused by name rather than run on eve.
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { agentSandboxImageFromEnvironment } from "@luke/service/agents/agent-sandbox-image";
import { nativeAgentSessionsLayer } from "@luke/service/agents/coder-host/native-agent-sessions";
import { runnerBundleFromDirectory } from "@luke/service/agents/coder-host/runner-bundle";
import type { NativeAgentSessions } from "@luke/service/agents/coder-host/runtime-sessions";
import type { WebServices } from "@luke/service/runtime";
import { type Context, Effect, Layer } from "effect";
import { runWeb } from "./runtime.js";

/** The harnesses over the web runtime, the bundle read beside this function's entry. */
const nativeAgents = nativeAgentSessionsLayer({ run: runWeb }).pipe(
  Layer.provide(
    Layer.merge(
      runnerBundleFromDirectory(dirname(fileURLToPath(import.meta.url))),
      agentSandboxImageFromEnvironment,
    ),
  ),
);

/** The deployment's services with the native harnesses beside them, read from the one web runtime. */
export function withNativeAgents(): Promise<Context.Context<WebServices | NativeAgentSessions>> {
  return runWeb(
    Effect.context<WebServices | NativeAgentSessions>().pipe(Effect.provide(nativeAgents)),
  );
}
