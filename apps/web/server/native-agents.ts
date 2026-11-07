/**
 * native-agents.ts -- the native harnesses a web function launches and writes to, provided beside the deployment's services.
 *
 * A coding agent whose conversation runs on a native harness (Claude Code)
 * is answered by a runner the service launches in its sandbox
 * (`packages/service/src/agents/coder-host/runtime-sessions.ts`). The
 * functions whose routes reach an agent's session provide the harnesses
 * here: the default function's oRPC router and its GitHub and automation
 * webhooks, the scheduled sweep, our MCP server, the member MCP server, and
 * the runner's events route. Importing this module is what reaches `agent-image.ts`, so the web
 * build ships the agents' image reference in each of those functions' `.func`
 * (`scripts/bundle-functions.ts`), where it is read beside the
 * function's own entry. Every other function provides none, and a native
 * conversation reached from one is refused by name.
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { agentImageFromDirectory } from "@repo/service/agents/coder-host/agent-image";
import { nativeAgentSessionsLayer } from "@repo/service/agents/coder-host/native-agent-sessions";
import { Layer } from "effect";
import { runWeb } from "./runtime.js";

/** The agents' image's reference, read beside this function's entry, which the harnesses and every other opener of a sandbox in the function are handed. */
export const agentImage = agentImageFromDirectory(dirname(fileURLToPath(import.meta.url)));

/** The harnesses over the web runtime and the agents' image. */
export const nativeAgents = nativeAgentSessionsLayer({ run: runWeb }).pipe(
  Layer.provide(agentImage),
);
