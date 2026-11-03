/**
 * workspace-tools.ts -- which of our own tools an agent is offered, and whether its `run_on_mac` would run now, as its MCP popover reads them.
 *
 * The list is the one the agent's runtime hands it, by the same rules:
 * eve's tools for an agent on eve (`coder-host/tool-set.ts`'s
 * `offeredCoderTools`), and for one on Claude Code or Codex the tools of
 * our MCP server, whose harness keeps its own shell and files
 * (`workspace-mcp/tools.ts`'s `offeredWorkspaceMcpTool`), each narrowed by its
 * repository, its kind, where it runs, whether anyone but its starter has
 * put words into it, and its starter's Memory. Nothing is
 * kept beside those rules, so the popover cannot name a tool the agent is
 * not handed. `run_on_mac` is answered off for the reasons a call would be
 * refused now (`mac-command.ts`): no Mac of the starter's listening, then
 * words someone other than the starter put into the conversation, with
 * what kind of sender put the first of them there and when, where the
 * transcript shows that line.
 */

import type { Agent } from "@repo/database/models/agent-store";
import { firstForeignLine } from "@repo/database/models/mac-command-store";
import type { TaskStoreEffect } from "@repo/database/models/task-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { RUN_ON_MAC_OFF, type RunOnMacStanding } from "@repo/features/workspace-tools-wire";
import { Effect, Option } from "effect";
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
  /** Whether anyone but the agent's starter has put words into it (`heardFromAnotherAccount`). */
  readonly heardFromAnotherAccount: boolean;
}

/** Our tools the agent is offered, by name, in the order its runtime offers them. */
export function offeredWorkspaceTools(input: WorkspaceToolsOfferedTo): readonly string[] {
  if (!input.native) return offeredCoderTools(input.agent, input);
  const offered = offeredWorkspaceMcpTool(input.agent, input);
  return [...WORKSPACE_MCP_TOOLS.keys()].filter(offered);
}

/** Whether the agent's `run_on_mac` would run now: off where no Mac of its starter's listens, then where another account put words in. */
export function runOnMacStanding(target: ConversationTarget): TaskStoreEffect<RunOnMacStanding> {
  return Effect.gen(function* () {
    if (!(yield* macListening(target.userId))) {
      return { on: false, reason: RUN_ON_MAC_OFF.MAC_AWAY } as const;
    }
    const foreign = yield* firstForeignLine(target);
    if (Option.isNone(foreign)) return { on: true } as const;
    const { sender, createdAt, shown } = foreign.value;
    // Note that who and when are said only of a line the transcript shows, because a reader must learn nothing the agent's transcript does not already show them.
    if (!shown) return { on: false, reason: RUN_ON_MAC_OFF.OUTSIDE_WORDS } as const;
    return {
      on: false,
      reason: RUN_ON_MAC_OFF.OUTSIDE_WORDS,
      ...(sender === null ? {} : { from: sender }),
      at: createdAt.getTime(),
    } as const;
  });
}
