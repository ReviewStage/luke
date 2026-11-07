/**
 * workspace-tools.ts -- whose Mac an agent's `run_on_mac` runs on, and whether it would run there now, as its composer reads it.
 *
 * The Mac is `macOwnerOf`'s: its task's assignee's, or else its starter's.
 * `run_on_mac` is answered off where a call would be refused now
 * (`mac-command.ts`): no Mac of that member's listening. An agent the
 * catalog offers no `run_on_mac` (`tool-catalog/catalog.ts`), one on a
 * device, is answered nothing.
 */

import type { Agent } from "@repo/database/models/agent-store";
import { macOwnerOf } from "@repo/database/models/mac-command-store";
import { readAccountNames } from "@repo/database/models/workspace-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { RUN_ON_MAC_OFF, type RunOnMacStanding } from "@repo/features/workspace-tools-wire";
import { Effect, Option } from "effect";
import { macListening } from "./mac-command.js";
import { offers } from "./tool-catalog/catalog.js";
import { standingOfAgent } from "./tool-catalog/gates.js";

/** Whose Mac the agent's `run_on_mac` runs on and whether it would run there now; nothing where the agent is offered none. */
export function runOnMacStanding(agent: Agent, target: ConversationTarget) {
  return Effect.gen(function* () {
    if (!offers(yield* standingOfAgent(Option.some(agent)), AGENT_TOOL.RUN_ON_MAC)) {
      return undefined;
    }
    const userId = yield* macOwnerOf(target);
    const owner = { userId, name: (yield* readAccountNames([userId])).get(userId) ?? "" };
    const standing: RunOnMacStanding = (yield* macListening(userId))
      ? { on: true, owner }
      : { on: false, reason: RUN_ON_MAC_OFF.MAC_AWAY, owner };
    return standing;
  });
}
