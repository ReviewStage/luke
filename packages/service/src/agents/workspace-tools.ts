import type { Agent } from "@repo/database/models/agent-store";
import { macOwnerOf } from "@repo/database/models/mac-command-store";
import type { TaskStoreEffect } from "@repo/database/models/task-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { RUN_ON_MAC_OFF, type RunOnMacStanding } from "@repo/features/workspace-tools-wire";
import { Effect } from "effect";
import { offeredCoderTools } from "./coder-host/tool-set.js";
import { macListening } from "./mac-command.js";
import { offeredWorkspaceMcpTool, WORKSPACE_MCP_TOOLS } from "./workspace-mcp/tools.js";

export interface WorkspaceToolsOfferedTo {
  readonly agent: Pick<Agent, "repository" | "machine">;
  readonly native: boolean;
  readonly memoryOn: boolean;
  readonly descriptionsOn: boolean;
}

export function offeredWorkspaceTools(input: WorkspaceToolsOfferedTo): readonly string[] {
  if (!input.native) return offeredCoderTools(input.agent, input);
  const offered = offeredWorkspaceMcpTool(input.agent, input);
  return [...WORKSPACE_MCP_TOOLS.keys()].filter(offered);
}

export function runOnMacStanding(target: ConversationTarget): TaskStoreEffect<RunOnMacStanding> {
  return Effect.gen(function* () {
    if (!(yield* macListening(yield* macOwnerOf(target)))) {
      return { on: false, reason: RUN_ON_MAC_OFF.MAC_AWAY } as const;
    }
    return { on: true } as const;
  });
}
