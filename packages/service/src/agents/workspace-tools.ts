/**
 * workspace-tools.ts -- which of our own tools an agent is offered, and whether its `run_on_mac` would run now, as its MCP popover reads them.
 *
 * The list is the catalog's (`tool-catalog/catalog.ts`'s `offeredTools`),
 * by where the agent stands against its gates, the one list our MCP server
 * answers `tools/list` with. Nothing is kept beside it, so the popover
 * cannot name a tool the agent is not handed. `run_on_mac` is answered off
 * where a call would be refused now (`mac-command.ts`): no Mac of its
 * task's assignee's listening.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type { Agent } from "@repo/database/models/agent-store";
import { macOwnerOf } from "@repo/database/models/mac-command-store";
import type { TaskStoreEffect } from "@repo/database/models/task-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { RUN_ON_MAC_OFF, type RunOnMacStanding } from "@repo/features/workspace-tools-wire";
import { Effect, Option } from "effect";
import { macListening } from "./mac-command.js";
import { offeredTools } from "./tool-catalog/catalog.js";
import { standingOfAgent } from "./tool-catalog/gates.js";

/** Our tools the agent is offered, by name, in the order the catalog offers them. */
export function offeredWorkspaceTools(
  agent: Agent,
): Effect.Effect<readonly string[], never, DatabaseServices> {
  return Effect.map(standingOfAgent(Option.some(agent)), (standing) =>
    offeredTools(standing).map((tool) => tool.name),
  );
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
