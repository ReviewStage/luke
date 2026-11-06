import type { DatabaseServices } from "@repo/database/core/query";
import { accountExperimentOn } from "@repo/database/models/account-store";
import { AGENT_KIND, type AgentKind } from "@repo/features/agent-wire";
import { EXPERIMENT } from "@repo/settings";
import { Effect } from "effect";
import { logStoreFailure } from "../http/store-failure.js";

export function descriptionsOnFor(
  userId: string,
  kind: AgentKind = AGENT_KIND.CODER,
): Effect.Effect<boolean, never, DatabaseServices> {
  return Effect.gen(function* () {
    if (kind === AGENT_KIND.PILOT && (yield* accountExperimentOn(userId, EXPERIMENT.PILOT))) {
      return true;
    }
    return yield* accountExperimentOn(userId, EXPERIMENT.DESCRIPTIONS);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(() => false),
  );
}
