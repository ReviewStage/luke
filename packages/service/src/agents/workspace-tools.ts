/**
 * workspace-tools.ts -- whether an agent's `run_on_mac` would run now, as its MCP popover reads it.
 *
 * `run_on_mac` is answered off where a call would be refused now
 * (`mac-command.ts`): no Mac of its task's assignee's listening.
 */

import { macOwnerOf } from "@repo/database/models/mac-command-store";
import type { TaskStoreEffect } from "@repo/database/models/task-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { RUN_ON_MAC_OFF, type RunOnMacStanding } from "@repo/features/workspace-tools-wire";
import { Effect } from "effect";
import { macListening } from "./mac-command.js";

/** Whether the agent's `run_on_mac` would run now: off where no Mac of its task's assignee's listens. */
export function runOnMacStanding(target: ConversationTarget): TaskStoreEffect<RunOnMacStanding> {
  return Effect.gen(function* () {
    if (!(yield* macListening(yield* macOwnerOf(target)))) {
      return { on: false, reason: RUN_ON_MAC_OFF.MAC_AWAY } as const;
    }
    return { on: true } as const;
  });
}
