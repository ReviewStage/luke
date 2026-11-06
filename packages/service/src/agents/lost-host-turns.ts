import { settleRunnerLostTurns } from "@repo/database/models/abandoned-turns";
import { storeWriter } from "@repo/database/models/writer";
import { Clock, Effect } from "effect";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";

const HOST_REMOVED_DETAIL = "the host this agent ran on was removed";

export interface LostHostTurns {
  readonly conversationId: string;
  readonly runningTurnIds: readonly string[];
}

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
