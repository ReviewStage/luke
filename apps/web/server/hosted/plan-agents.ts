import {
  awaitingLinesOfReached,
  type CodingAgentLatestTurn,
  type CodingAgentStoreEffect,
  latestTurnsOfReached,
  listPublishedCodingAgents,
  type PublishedCodingAgent,
} from "@sidecar/database/models/coding-agent-store";
import {
  CODING_AGENT_STATUS,
  type CodingAgentStatus,
  PULL_REQUEST_STATE,
} from "@sidecar/features/coding-agent-wire";
import {
  PLAN_AGENTS_BOUNDS,
  type PlanAgentLine,
  type PlanAgentsSummary,
  type PlanPullRequestLine,
  type PlanSummary,
} from "@sidecar/features/plan-wire";
import { Clock, Effect } from "effect";
import { codingAgentRunStartedAt, codingAgentStatusOf } from "./coder-host/status.js";

/**
 * plan-agents.ts -- what each listed plan's coding agents are doing and what they published, in brief, for the sidebar's row and its hover card.
 *
 * Three statements answer the whole list however many plans it holds: the
 * agents of every plan named with the pull request each last published,
 * their newest turns, and which of them hold a line awaiting its turn. An
 * agent's status is read exactly as its tab's is (`coder-host/status.ts`),
 * and a pull request is the one its row keeps as GitHub last answered, so
 * nothing here asks GitHub. A plan with no agent carries nothing, so the
 * list stays as small as it was for every plan nobody has started an agent
 * on.
 */

/** The statuses under which an agent is at work. */
const WORKING_STATUSES: ReadonlySet<CodingAgentStatus> = new Set([
  CODING_AGENT_STATUS.STARTING,
  CODING_AGENT_STATUS.RUNNING,
]);

/** One agent read for the list: its line, and when it was started, which orders the lines. */
interface ReadAgent {
  readonly line: PlanAgentLine;
  readonly createdAt: number;
  readonly published: PublishedCodingAgent["published"];
}

/** One agent as its row names it, its status read at `now`: since its run began while it works, since its newest turn ended once it has. */
function agentLine(
  held: PublishedCodingAgent,
  turn: CodingAgentLatestTurn | undefined,
  lineAwaits: boolean,
  now: number,
): ReadAgent {
  const { agent } = held;
  const status = codingAgentStatusOf(turn, { createdAt: agent.createdAt, now, lineAwaits });
  const at = WORKING_STATUSES.has(status)
    ? codingAgentRunStartedAt(turn, { createdAt: agent.createdAt, lineAwaits })
    : turn?.settledAt?.getTime();
  return {
    line: {
      id: agent.id,
      title: agent.title,
      model: agent.model,
      effort: agent.effort,
      status,
      ...(at === undefined ? undefined : { at }),
    },
    createdAt: agent.createdAt.getTime(),
    published: held.published,
  };
}

/** The order the pull requests a row names stand in: those still to act on first, then merged, then closed. */
const PULL_REQUEST_RANK = {
  [PULL_REQUEST_STATE.OPEN]: 0,
  [PULL_REQUEST_STATE.DRAFT]: 0,
  [PULL_REQUEST_STATE.MERGED]: 1,
  [PULL_REQUEST_STATE.CLOSED]: 2,
} as const satisfies Record<PlanPullRequestLine["state"], number>;

/**
 * One plan's agents in brief: those at work named first, then the rest,
 * newest started first within each; the pull requests each named once by
 * their page, since two agents on one branch share theirs and a plan whose
 * repository changed may hold two of one number, those still open first, then
 * merged, then closed, newest agent's first within each, so the few a row
 * names always hold the one its mark is drawn for.
 */
function summaryOf(agents: readonly ReadAgent[]): PlanAgentsSummary {
  const newest = [...agents].sort((a, b) => b.createdAt - a.createdAt);
  const working = newest.filter((agent) => WORKING_STATUSES.has(agent.line.status));
  const resting = newest.filter((agent) => !WORKING_STATUSES.has(agent.line.status));
  const pullRequests = new Map<string, PlanPullRequestLine>();
  for (const { published } of newest) {
    if (published === null || pullRequests.has(published.url)) continue;
    const { number, title, state, checks, additions, deletions, url } = published;
    pullRequests.set(url, { number, title, state, checks, additions, deletions, url });
  }
  return {
    total: agents.length,
    working: working.length,
    agents: [...working, ...resting]
      .slice(0, PLAN_AGENTS_BOUNDS.MAX_AGENTS)
      .map((agent) => agent.line),
    pullRequestTotal: pullRequests.size,
    pullRequests: [...pullRequests.values()]
      .sort((a, b) => PULL_REQUEST_RANK[a.state] - PULL_REQUEST_RANK[b.state])
      .slice(0, PLAN_AGENTS_BOUNDS.MAX_PULL_REQUESTS),
  };
}

/** The account's listed plans, each carrying its agents in brief, whichever member started each, where it has any; the plans' order and every other field as listed. */
export function withPlanAgents(
  userId: string,
  plans: readonly PlanSummary[],
): CodingAgentStoreEffect<readonly PlanSummary[]> {
  return Effect.gen(function* () {
    const held = yield* listPublishedCodingAgents(
      userId,
      plans.map((plan) => plan.id),
    );
    const conversationIds = held.map(({ agent }) => agent.conversationId);
    // The agents were read through the plans' gate, and each conversation is its starter's, a teammate's as often as the account's.
    const turns = yield* latestTurnsOfReached(conversationIds);
    const awaiting = yield* awaitingLinesOfReached(conversationIds);
    const now = yield* Clock.currentTimeMillis;
    const byPlan = new Map<string, ReadAgent[]>();
    for (const agent of held) {
      const { conversationId, planId } = agent.agent;
      const line = agentLine(agent, turns.get(conversationId), awaiting.has(conversationId), now);
      byPlan.set(planId, [...(byPlan.get(planId) ?? []), line]);
    }
    return plans.map((plan) => {
      const agents = byPlan.get(plan.id);
      return agents === undefined ? plan : { ...plan, agents: summaryOf(agents) };
    });
  });
}
