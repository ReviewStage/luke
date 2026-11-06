/**
 * descriptions-on.ts -- whether an agent's starter has Plans on, which decides what of a task's plan and its comments the agent is offered, handed, and told.
 *
 * Read once where an agent's tools, instructions, and context are built, and
 * again at each plan tool's door, as Memory is (`memory-tools.ts`'s
 * `memoryOnFor`). It stands in a module of its own, beside nothing else, so
 * the start, the turn's context, and the doors all reach it without reaching
 * each other.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { accountExperimentOn } from "@repo/database/models/account-store";
import { AGENT_KIND, type AgentKind } from "@repo/features/agent-wire";
import { EXPERIMENT } from "@repo/settings";
import { Effect } from "effect";
import { logStoreFailure } from "../http/store-failure.js";

/**
 * Whether the member has Plans on (`EXPERIMENT.DESCRIPTIONS`), for an agent they
 * started of the kind given or for their own calls: what decides whether an
 * agent is offered `edit_description` and `look_at_picture`, handed its task's plan
 * and the plan's comments, and told of either. A pilot plans through
 * `read_task` and `edit_description`, so one counts Plans as on for as long as its
 * starter has Pilot on. Where it cannot be read, it is off, logged for the
 * operator.
 */
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
