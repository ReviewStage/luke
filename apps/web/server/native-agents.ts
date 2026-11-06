import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { agentImageFromDirectory } from "@repo/service/agents/coder-host/agent-image";
import { nativeAgentSessionsLayer } from "@repo/service/agents/coder-host/native-agent-sessions";
import { Layer } from "effect";
import { runWeb } from "./runtime.js";

export const nativeAgents = nativeAgentSessionsLayer({ run: runWeb }).pipe(
  Layer.provide(agentImageFromDirectory(dirname(fileURLToPath(import.meta.url)))),
);
