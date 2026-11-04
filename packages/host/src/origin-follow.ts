import { type AgentOriginLiveAnswer, agentOriginOfLive } from "@repo/features/agent-origin-live";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import type { AgentOrigin } from "@repo/features/agent-wire";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import { Effect, Option, type Scope } from "effect";
import { type AppAgentOrigins, NO_AGENT_ORIGINS } from "./app-state.js";
import { type HeldAnswers, type HeldSlice, heldSlice } from "./live-collection.js";
import { pushLive } from "./live-push.js";

/**
 * origin-follow.ts -- the run of an automation that started each agent whose page the windows hold, followed over the service's held poll and told whole on its app-state slice.
 *
 * An agent's page draws the agent itself from the task list, which names
 * the automation that started it but carries no run, since a list of many
 * carries no prompt. The page holds the run by the agent's id, and the host
 * follows it while any window holds it and a while after (`heldSlice`), so
 * opening the page again reads nothing. Nothing moves the run once the
 * agent is made, so its follow answers once and is held quiet after.
 */

/** A read the service did not answer, as the client and the gate tell it. */
interface OriginUnanswered {
  readonly failure: string;
}

export interface OriginFollowDependencies {
  /** The read of `agentId`'s origin sealed for `userId`, its rows inline at the poll address where it polls, held past `after` where it names one. */
  readonly seal: (
    agentId: string,
    poll: boolean,
    userId: string,
    after?: string,
  ) => Effect.Effect<AgentOriginLiveAnswer | OriginUnanswered>;
  /** The account signed in, which every seal names; none while nobody is. */
  readonly accountId: () => string | undefined;
  /** Whether the account gate stands open, so a follow may read. */
  readonly gate: () => boolean;
  readonly tell: (held: AppAgentOrigins) => void;
}

/** A refusal that names nothing the account reaches, after which the read is followed no longer. */
function goneAfter(failure: string): boolean {
  return failure === AGENT_CALL_FAILURE.NOT_FOUND || failure === LIVE_SIGNED_OUT.failure;
}

/** Follows `agentId`'s origin live until let go, each change told through `answers`: null for an agent no run started, and unanswered where a row is off its own shape. */
function followOrigin(
  dependencies: OriginFollowDependencies,
  agentId: string,
  answers: HeldAnswers<AgentOrigin | null>,
): Effect.Effect<void> {
  // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
  const userId = dependencies.accountId();
  return pushLive({
    seal: (poll, after) =>
      dependencies.gate() && userId !== undefined
        ? Effect.map(dependencies.seal(agentId, poll, userId, after), (sealed) =>
            "failure" in sealed
              ? { failure: sealed.failure, gone: goneAfter(sealed.failure) }
              : sealed,
          )
        : Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true }),
    decode: (parts) => Option.some(parts.origin),
    publish: (rows) => {
      const origin = rows === undefined ? undefined : agentOriginOfLive(rows);
      if (origin === undefined) return answers.unanswered();
      answers.answered(origin);
    },
  });
}

/**
 * The held lifetime over every agent's origin the windows hold
 * (`heldSlice`), told whole on its slice: each agent's read as its follow
 * last told it, kept where a later read does not answer, and failed where it
 * never answered; one the service refused for good, an agent the account
 * does not reach, is told failed and followed no longer until every window
 * lets it go and one holds it anew.
 */
export function heldAgentOrigins(
  dependencies: OriginFollowDependencies,
): Effect.Effect<HeldSlice<string>, never, Scope.Scope> {
  return heldSlice<typeof LIVE_READ.AGENT_ORIGINS, string>({
    empty: NO_AGENT_ORIGINS,
    path: (agentId) => [agentId],
    gate: dependencies.gate,
    follow: (agentId, answers) => followOrigin(dependencies, agentId, answers),
    tell: dependencies.tell,
  });
}
