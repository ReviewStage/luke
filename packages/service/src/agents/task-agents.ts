import {
  awaitingLinesOfReached,
  type CodingAgentLatestTurn,
  type CodingAgentStoreEffect,
  latestTurnsOfReached,
  listPublishedCodingAgents,
  listTasklessCodingAgents,
  type PublishedCodingAgent,
} from "@luke/database/models/coding-agent-store";
import { readAccountNames } from "@luke/database/models/workspace-store";
import {
  CODING_AGENT_STATUS,
  type CodingAgentStatus,
  PULL_REQUEST_STATE,
  type TasklessAgent,
} from "@luke/features/coding-agent-wire";
import {
  TASK_AGENTS_BOUNDS,
  type TaskAgentLine,
  type TaskAgentsSummary,
  type TaskPullRequestLine,
  type TaskSummary,
} from "@luke/features/task-wire";
import { Clock, Effect } from "effect";
import {
  codingAgentActivityAt,
  codingAgentPage,
  codingAgentRunStartedAt,
  codingAgentStatusOf,
  summaryAccounts,
} from "./coder-host/status.js";

/**
 * task-agents.ts -- what each listed task's coding agents are doing and what they published, in brief, for the sidebar's row and its hover card, and the agents with no plan the list carries beside the plans.
 *
 * Four statements answer the whole list however many tasks it holds: the
 * agents of every task named with the pull request each last published,
 * their newest turns, which of them hold a line awaiting its turn, and the
 * names of the members who started them. An agent's status and its starter
 * are read exactly as its tab's are (`coder-host/status.ts`), and a pull
 * request is the one its row keeps as GitHub last answered, so
 * nothing here asks GitHub. A task with no agent carries nothing, so the
 * list stays as small as it was for every task nobody has started an agent
 * on.
 */

/** The statuses under which an agent is at work. */
const WORKING_STATUSES: ReadonlySet<CodingAgentStatus> = new Set([
  CODING_AGENT_STATUS.STARTING,
  CODING_AGENT_STATUS.RUNNING,
]);

/** One agent read for the list: its line, when it was started, which orders the lines, when it last did something settled, and whether it was archived, which leaves it out of all but the activity. */
interface ReadAgent {
  readonly line: TaskAgentLine;
  readonly createdAt: number;
  readonly activityAt: number;
  readonly archived: boolean;
  readonly published: PublishedCodingAgent["published"];
}

/** One agent as its row names it, its status read at `now`: since its run began while it works, since its newest turn ended once it has; its starter named by `names`, and left unnamed once their account is gone. */
function agentLine(
  held: PublishedCodingAgent,
  turn: CodingAgentLatestTurn | undefined,
  awaitingLineAt: Date | undefined,
  now: number,
  names: ReadonlyMap<string, string>,
): ReadAgent {
  const { agent } = held;
  const starter = names.get(agent.userId);
  const standing = { createdAt: agent.createdAt, now, awaitingLineAt };
  const status = codingAgentStatusOf(turn, standing);
  const at = WORKING_STATUSES.has(status)
    ? codingAgentRunStartedAt(turn, standing)
    : turn?.settledAt?.getTime();
  return {
    line: {
      id: agent.id,
      title: agent.title,
      model: agent.model,
      effort: agent.effort,
      status,
      ...(at === undefined ? undefined : { at }),
      ...(starter === undefined
        ? undefined
        : { startedBy: { userId: agent.userId, name: starter } }),
      ...(agent.automationId === null ? undefined : { automationId: agent.automationId }),
    },
    createdAt: agent.createdAt.getTime(),
    activityAt: codingAgentActivityAt(turn, agent),
    archived: agent.archivedAt !== null,
    published: held.published,
  };
}

/** The order the pull requests a row names stand in: those still to act on first, then merged, then closed. */
const PULL_REQUEST_RANK = {
  [PULL_REQUEST_STATE.OPEN]: 0,
  [PULL_REQUEST_STATE.DRAFT]: 0,
  [PULL_REQUEST_STATE.MERGED]: 1,
  [PULL_REQUEST_STATE.CLOSED]: 2,
} as const satisfies Record<TaskPullRequestLine["state"], number>;

/**
 * One task's agents in brief: those at work named first, then the rest,
 * newest started first within each; the pull requests each named once by
 * their page, since two agents on one branch share theirs and a task whose
 * repository changed may hold two of one number, those still open first, then
 * merged, then closed, newest agent's first within each, so the few a row
 * names always hold the one its mark is drawn for; and the latest settled
 * activity of every agent, named or not and archived or not, which the
 * plan's last update is read beside. A plan whose every agent is archived
 * carries its activity alone, with no agent and no pull request counted.
 */
function summaryOf(read: readonly ReadAgent[]): TaskAgentsSummary {
  const agents = read.filter((agent) => !agent.archived);
  const newest = [...agents].sort((a, b) => b.createdAt - a.createdAt);
  const working = newest.filter((agent) => WORKING_STATUSES.has(agent.line.status));
  const resting = newest.filter((agent) => !WORKING_STATUSES.has(agent.line.status));
  const pullRequests = new Map<string, TaskPullRequestLine>();
  for (const { published, line } of newest) {
    if (published === null || pullRequests.has(published.url)) continue;
    const { number, title, state, checks, additions, deletions, url } = published;
    pullRequests.set(url, {
      number,
      title,
      state,
      checks,
      additions,
      deletions,
      url,
      agentId: line.id,
    });
  }
  return {
    total: agents.length,
    working: working.length,
    ...(read.length === 0
      ? undefined
      : { activityAt: Math.max(...read.map((agent) => agent.activityAt)) }),
    agents: [...working, ...resting]
      .slice(0, TASK_AGENTS_BOUNDS.MAX_AGENTS)
      .map((agent) => agent.line),
    pullRequestTotal: pullRequests.size,
    pullRequests: [...pullRequests.values()]
      .sort((a, b) => PULL_REQUEST_RANK[a.state] - PULL_REQUEST_RANK[b.state])
      .slice(0, TASK_AGENTS_BOUNDS.MAX_PULL_REQUESTS),
  };
}

/** The account's listed tasks, each carrying its agents in brief, whichever member started each, where it has any; the tasks' order and every other field as listed. */
export function withTaskAgents(
  userId: string,
  tasks: readonly TaskSummary[],
): CodingAgentStoreEffect<readonly TaskSummary[]> {
  return Effect.gen(function* () {
    // Note that the archived agents are read too, because the work one did
    // is still the task's activity, though the row names it no more.
    const held = yield* listPublishedCodingAgents(
      userId,
      tasks.map((task) => task.id),
      { includeArchived: true },
    );
    const conversationIds = held.map(({ agent }) => agent.conversationId);
    // The agents were read through the tasks' gate, and each conversation is its starter's, a teammate's as often as the account's.
    const turns = yield* latestTurnsOfReached(conversationIds);
    const awaiting = yield* awaitingLinesOfReached(conversationIds);
    const names = yield* readAccountNames(held.map(({ agent }) => agent.userId));
    const now = yield* Clock.currentTimeMillis;
    const byTask = new Map<string, ReadAgent[]>();
    for (const agent of held) {
      const { conversationId, taskId } = agent.agent;
      // An agent with no task is no task's to summarise.
      if (taskId === null) continue;
      const line = agentLine(
        agent,
        turns.get(conversationId),
        awaiting.get(conversationId),
        now,
        names,
      );
      byTask.set(taskId, [...(byTask.get(taskId) ?? []), line]);
    }
    return tasks.map((task) => {
      const agents = byTask.get(task.id);
      return agents === undefined ? task : { ...task, agents: summaryOf(agents) };
    });
  });
}

/**
 * The agents with no plan in the account's workspaces, whichever member
 * started each, newest started first, each read as its own page reads it,
 * with its automation's name, when it last moved, and when the account
 * pinned it where it did, the archived ones only where `includeArchived`
 * asks: the sidebar's rows beside the plans.
 */
export function listTasklessAgents(
  userId: string,
  options: { readonly includeArchived: boolean },
): CodingAgentStoreEffect<readonly TasklessAgent[]> {
  return Effect.gen(function* () {
    const agents = yield* listTasklessCodingAgents(userId, options);
    const conversationIds = agents.map((agent) => agent.conversationId);
    // The agents were read through their workspaces' gate, and each conversation is its starter's.
    const turns = yield* latestTurnsOfReached(conversationIds);
    const awaiting = yield* awaitingLinesOfReached(conversationIds);
    // The member each was archived by or for is named too, as the agent's own page names them.
    const names = yield* readAccountNames(agents.flatMap(summaryAccounts));
    const now = yield* Clock.currentTimeMillis;
    return agents.map((agent) => {
      const turn = turns.get(agent.conversationId);
      const awaitingLineAt = awaiting.get(agent.conversationId);
      const { origin: _origin, ...page } = codingAgentPage(
        agent,
        { turn, awaitingLineAt },
        now,
        names,
      );
      return {
        ...page,
        activityAt: codingAgentActivityAt(turn, { createdAt: agent.createdAt }),
        ...(agent.pinnedAt === null ? undefined : { pinnedAt: agent.pinnedAt.getTime() }),
        ...(agent.pinPosition === null ? undefined : { pinPosition: agent.pinPosition }),
      };
    });
  });
}
