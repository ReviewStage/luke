import {
  CODING_AGENT_STATUS,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@sidecar/hosted";
import { TURN_STATUS } from "../../core.js";
import type { CodingAgent, CodingAgentLatestTurn } from "../coding-agent-store.js";

/**
 * status.ts -- where a coding agent stands, read from its newest turn.
 *
 * An agent's status is its conversation's newest turn row and nothing else:
 * `starting` before the first turn is queued, `running` while eve runs it,
 * and how it ended after. A turn still running that carries a Stop stamp
 * reads as cancelled already, since the Stop is on its way to eve and
 * nothing the turn still does changes where it ends.
 */

/** The status a turn row's own status word reads as. */
const STATUS_OF_TURN = {
  [TURN_STATUS.QUEUED]: CODING_AGENT_STATUS.RUNNING,
  [TURN_STATUS.RUNNING]: CODING_AGENT_STATUS.RUNNING,
  [TURN_STATUS.SETTLED]: CODING_AGENT_STATUS.COMPLETED,
  [TURN_STATUS.CANCELLED]: CODING_AGENT_STATUS.CANCELLED,
  [TURN_STATUS.FAILED]: CODING_AGENT_STATUS.FAILED,
} as const satisfies Record<string, CodingAgentStatus>;

const STATUS_WORDS: ReadonlySet<string> = new Set(Object.keys(STATUS_OF_TURN));

function isTurnStatusWord(status: string): status is keyof typeof STATUS_OF_TURN {
  return STATUS_WORDS.has(status);
}

/** Where an agent stands, from its newest turn; starting with none. */
export function codingAgentStatusOf(turn: CodingAgentLatestTurn | undefined): CodingAgentStatus {
  if (turn === undefined) return CODING_AGENT_STATUS.STARTING;
  // A row outside the vocabulary is a write this build does not know, read as the one status that claims nothing.
  if (!isTurnStatusWord(turn.status)) return CODING_AGENT_STATUS.FAILED;
  const status = STATUS_OF_TURN[turn.status];
  return status === CODING_AGENT_STATUS.RUNNING && turn.cancelRequestedAt !== null
    ? CODING_AGENT_STATUS.CANCELLED
    : status;
}

/** One agent as the tabs draw it. */
export function codingAgentSummary(
  agent: CodingAgent,
  turn: CodingAgentLatestTurn | undefined,
): CodingAgentSummary {
  return {
    id: agent.id,
    planId: agent.planId,
    model: agent.model,
    effort: agent.effort,
    createdAt: agent.createdAt.getTime(),
    status: codingAgentStatusOf(turn),
  };
}
