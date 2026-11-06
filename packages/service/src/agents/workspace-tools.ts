/**
 * workspace-tools.ts -- which of our own tools an agent is offered, and whether its `run_on_mac` would run now, as its MCP popover reads them.
 *
 * The list is the one the agent's runtime hands it, by the same rules:
 * eve's tools for an agent on eve (`coder-host/tool-set.ts`'s
 * `offeredCoderTools`), and for one on Claude Code or Codex the tools of
 * our MCP server, whose harness keeps its own shell and files
 * (`workspace-mcp/tools.ts`'s `offeredWorkspaceMcpTool`), each narrowed by its
 * repository, its kind, where it runs, and its starter's Memory and Descriptions. Nothing is
 * kept beside those rules, so the popover cannot name a tool the agent is
 * not handed. `run_on_mac` is answered off where a call would be refused
 * now (`mac-command.ts`): no Mac of its task's assignee's listening.
 */

import type { Agent } from "@repo/database/models/agent-store";
import { macOwnerOf } from "@repo/database/models/mac-command-store";
import type { TaskStoreEffect } from "@repo/database/models/task-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { RUN_ON_MAC_OFF, type RunOnMacStanding } from "@repo/features/workspace-tools-wire";
import { Effect } from "effect";
import { offeredCoderTools } from "./coder-host/tool-set.js";
import { macListening } from "./mac-command.js";
import { offeredWorkspaceMcpTool, WORKSPACE_MCP_TOOLS } from "./workspace-mcp/tools.js";

/** What of an agent decides which of our tools it is offered: what narrows them, and whether it runs on a provider's own harness. */
export interface WorkspaceToolsOfferedTo {
  readonly agent: Pick<Agent, "repository" | "machine">;
  /** Whether the agent runs on Claude Code or Codex rather than eve. */
  readonly native: boolean;
  /** Whether the agent's starter has Memory on. */
  readonly memoryOn: boolean;
  /** Whether the agent's workspace has Task descriptions on (`experimentOnIn`). */
  readonly descriptionsOn: boolean;
}

/** Our tools the agent is offered, by name, in the order its runtime offers them. */
export function offeredWorkspaceTools(input: WorkspaceToolsOfferedTo): readonly string[] {
  if (!input.native) return offeredCoderTools(input.agent, input);
  const offered = offeredWorkspaceMcpTool(input.agent, input);
  return [...WORKSPACE_MCP_TOOLS.keys()].filter(offered);
}

/** Whether the agent's `run_on_mac` would run now: off where no Mac of its task's assignee's listens. */
export function runOnMacStanding(target: ConversationTarget): TaskStoreEffect<RunOnMacStanding> {
  return Effect.gen(function* () {
    if (!(yield* macListening(yield* macOwnerOf(target)))) {
      return { on: false, reason: RUN_ON_MAC_OFF.MAC_AWAY } as const;
    }
    return { on: true } as const;
  });
}
