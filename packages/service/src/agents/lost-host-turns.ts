/**
 * lost-host-turns.ts -- the turns a removed host's agents had running, settled lost, since no runner there can end them.
 *
 * A host is removed by Settings' Remove, or folded into the account's new
 * host on the same Mac (`@repo/database/models/host-store`). Either way its
 * secret is refused from now on, so no runner there can end the turns its
 * agents had running, and without this they would read as running until
 * their lease runs out (`@repo/database/models/turn-lease`).
 */

import { settleRunnerLostTurns } from "@repo/database/models/abandoned-turns";
import { storeWriter } from "@repo/database/models/writer";
import { Clock, Effect } from "effect";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";

/** Why a removed host's agents' turns read as failed. */
const HOST_REMOVED_DETAIL = "the host this agent ran on was removed";

/** The turns one agent had running on a host as it was removed, by its conversation. */
export interface LostHostTurns {
  readonly conversationId: string;
  readonly runningTurnIds: readonly string[];
}

/**
 * Settles the turns given as lost, as a runner gone without its end is
 * settled (`settleRunnerLostTurns`), and only those, because a turn the
 * agent begins after its host was removed is its new host's. A failure is
 * logged and nothing more, because the host is already removed and a retry
 * would find no host to remove; whatever was left lapses with its lease.
 */
export const settleLostHostTurns = (lost: readonly LostHostTurns[]) =>
  Effect.gen(function* () {
    const running = lost.filter((agent) => agent.runningTurnIds.length > 0);
    if (running.length === 0) return;
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const now = yield* Clock.currentTimeMillis;
    for (const { conversationId, runningTurnIds } of running) {
      yield* settleRunnerLostTurns(
        writer,
        conversationId,
        now,
        HOST_REMOVED_DETAIL,
        new Set(runningTurnIds),
      );
    }
  }).pipe(
    Effect.catch((failure) =>
      Effect.logWarning("a removed host's agents' turns were not settled", failure),
    ),
  );
