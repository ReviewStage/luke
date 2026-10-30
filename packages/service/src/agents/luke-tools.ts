/**
 * luke-tools.ts -- which of Luke's own tools an agent is offered, and whether its `run_on_mac` would run now, as its MCP popover reads them.
 *
 * The list is the one the agent's runtime hands it, by the same rules:
 * eve's tools for an agent on eve (`coder-host/tool-set.ts`'s
 * `offeredCoderTools`), and for one on Claude Code or Codex the tools of
 * Luke's MCP server, whose harness keeps its own shell and files
 * (`luke-mcp/tools.ts`'s `offeredLukeMcpTool`), each narrowed by its
 * repository, its kind, whether a pilot started it, where it runs, and its
 * starter's Memory. Nothing is
 * kept beside those rules, so the popover cannot name a tool the agent is
 * not handed. `run_on_mac` is answered off for the reasons a call would be
 * refused now (`mac-command.ts`): no Mac of the starter's listening, then
 * words someone other than the starter put into the conversation, with
 * what kind of sender put the first of them there and when, where the
 * transcript shows that line.
 */

import type { Agent } from "@luke/database/models/agent-store";
import { firstForeignLine } from "@luke/database/models/mac-command-store";
import type { TaskStoreEffect } from "@luke/database/models/task-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import { RUN_ON_MAC_OFF, type RunOnMacStanding } from "@luke/features/luke-tools-wire";
import { Effect, Option } from "effect";
import { offeredCoderTools } from "./coder-host/tool-set.js";
import { LUKE_MCP_TOOLS, offeredLukeMcpTool } from "./luke-mcp/tools.js";
import { macListening } from "./mac-command.js";

/** What of an agent decides its Luke tools: what narrows them, and whether it runs on a provider's own harness. */
export interface LukeToolsOfferedTo {
  readonly agent: Pick<Agent, "repository" | "kind" | "machine">;
  /** Whether the agent runs on Claude Code or Codex rather than eve. */
  readonly native: boolean;
  /** Whether the agent's starter has Memory on. */
  readonly memoryOn: boolean;
  /** Whether a pilot started the agent (`agentUnderPilot`). */
  readonly underPilot: boolean;
}

/** The agent's Luke tools, by name, in the order its runtime offers them. */
export function offeredLukeTools(input: LukeToolsOfferedTo): readonly string[] {
  if (!input.native) return offeredCoderTools(input.agent, input);
  const offered = offeredLukeMcpTool(input.agent, input);
  return [...LUKE_MCP_TOOLS.keys()].filter(offered);
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
