/**
 * run-archive.ts -- "Archive finished runs": an automation run's agents put away once each finished well, as soon as what held the run back lets go.
 *
 * An automation that archives its successful runs has the agents of each
 * run, the run's own agent and the helpers it started with no task alike,
 * archived once each finished well, read as its tab reads it, holds nothing
 * open in the inbox, and has no pull request open or in draft, since an
 * archived agent hears nothing of a review on it. A run is archived as one,
 * once all its agents are done with, and settled once: an agent archived
 * here, one that failed or was stopped, and one the developer already put
 * away are marked so and never read again, so one brought back stays.
 *
 * Nothing polls for it. A run is reconsidered (`reconsiderRunArchive`) at
 * each moment that may let it go: a turn of any of its agents settling
 * (`../agents/coder-host/settled-turns.ts`), a pull request of one read
 * merged or closed (`../agents/coder-host/published.ts`, which the GitHub
 * webhook and the token poll both write through), and an inbox item of one
 * answered, acknowledged, or closed by a member
 * (`../inbox/inbox-procedures.ts`). A run still held at each of them waits
 * on the next.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  archiveUnmovedAgent,
  awaitingLinesOfReached,
  latestTurnsOfReached,
  readAgentOfConversation,
} from "@repo/database/models/agent-store";
import {
  type ArchivableRunAgent,
  runArchivableAgentsOf,
  settleRunArchive,
} from "@repo/database/models/automation-store";
import type { SettledAgentTurn } from "@repo/database/models/writer";
import { AGENT_STATUS, type AgentStatus } from "@repo/features/agent-wire";
import { causeKind } from "@repo/runtime/effect";
import { Clock, Effect, Option } from "effect";
import { agentStatusOf } from "../agents/coder-host/status.js";
import { discardedOrLogged } from "../agents/device-discard.js";

/** The statuses an agent ends on that its automation never archives: it failed, or it was stopped. */
const ENDED_UNWELL: ReadonlySet<AgentStatus> = new Set([
  AGENT_STATUS.FAILED,
  AGENT_STATUS.CANCELED,
]);

/** An agent "Archive finished runs" may put away, as its reader saw it: whose it is, its id, its conversation and how far its lines had run, when it was made, and when it was put away where it already was. */
type FinishedAgentRead = Pick<
  ArchivableRunAgent,
  "userId" | "agentId" | "conversationId" | "createdAt" | "archivedAt" | "conversationSeq"
>;

/** What came of one: the agent as read, where it stands, whether it was archived now, and whether nothing failed letting it go on its device. */
interface FinishedAgentArchive<A extends FinishedAgentRead> {
  readonly agent: A;
  readonly status: AgentStatus;
  readonly archived: boolean;
  readonly discarded: boolean;
}

/** Where each agent stands at `now`, read as its tab reads it, by agent id. */
function finishedStatuses(agents: readonly FinishedAgentRead[], now: number) {
  return Effect.gen(function* () {
    const conversations = agents.map((agent) => agent.conversationId);
    const turns = yield* latestTurnsOfReached(conversations);
    const awaiting = yield* awaitingLinesOfReached(conversations);
    return new Map(
      agents.map((agent) => [
        agent.agentId,
        agentStatusOf(turns.get(agent.conversationId), {
          createdAt: agent.createdAt,
          now,
          awaitingLineAt: awaiting.get(agent.conversationId),
        }),
      ]),
    );
  });
}

/** The agents archived as their statuses were read, each answered in order, as `archiveFinishedAgents` says. */
function archiveAsRead<A extends FinishedAgentRead>(
  agents: readonly A[],
  statuses: ReadonlyMap<string, AgentStatus>,
) {
  return Effect.forEach(agents, (agent) =>
    Effect.gen(function* () {
      const status = statuses.get(agent.agentId) ?? AGENT_STATUS.RUNNING;
      const finishedWell = agent.archivedAt === null && status === AGENT_STATUS.COMPLETED;
      // Note that the archive takes only while the agent's lines stand where they were read, so
      // one woken since, or whose starter left, stands and is read again later.
      const archived =
        finishedWell &&
        (yield* archiveUnmovedAgent(agent.userId, agent.agentId, agent.conversationSeq));
      // A local agent archived is let go of on its device, as an archive by hand lets it go.
      const discarded =
        archived || agent.archivedAt !== null
          ? yield* discardedOrLogged({ id: agent.agentId, userId: agent.userId })
          : true;
      return { agent, status, archived, discarded } satisfies FinishedAgentArchive<A>;
    }),
  );
}

/**
 * The agents archived under "Archive finished runs"' rule, each answered in
 * order: one standing unarchived that finished well, read as its tab reads
 * it, is archived only while its lines stand where they were read and it
 * holds no pull request or inbox item open (`archiveUnmovedAgent`), and a
 * local one archived, now or before, is let go of on its device. Note that
 * the rule is shared, because an agent started from Slack is archived by it
 * too once a turn of its settles (`../slack/slack-agent-starts.ts`).
 */
export function archiveFinishedAgents<A extends FinishedAgentRead>(
  agents: readonly A[],
  now: number,
) {
  return Effect.flatMap(finishedStatuses(agents, now), (statuses) =>
    archiveAsRead(agents, statuses),
  );
}

/** Whether the agent is done with, for its run: put away already, or ended well or not. */
const doneWith = (agent: ArchivableRunAgent, status: AgentStatus) =>
  agent.archivedAt !== null || status === AGENT_STATUS.COMPLETED || ENDED_UNWELL.has(status);

/**
 * The run read archived where it finished well. Note that a run is archived
 * as one, because its agents are kept together: only once every agent it
 * has was read and is done with, so a helper still at work, or held back by
 * its inbox item or pull request, keeps the whole run standing for the next
 * moment that may let it go, and the run is settled only once each of its
 * agents is, so none is left unread.
 */
const archiveRunAsRead = Effect.fnUntraced(function* (
  run: readonly ArchivableRunAgent[],
  now: number,
) {
  const [first] = run;
  if (first === undefined || run.length !== first.runAgents) return;
  const statuses = yield* finishedStatuses(run, now);
  if (!run.every((agent) => doneWith(agent, statuses.get(agent.agentId) ?? AGENT_STATUS.RUNNING)))
    return;
  const outcomes = yield* archiveAsRead(run, statuses);
  // A run stays unsettled until every agent's discard is queued, so the next moment asks again.
  const settled = outcomes.every(
    ({ agent, status, archived, discarded }) =>
      discarded && (archived || agent.archivedAt !== null || ENDED_UNWELL.has(status)),
  );
  if (settled) yield* settleRunArchive(first.runId);
});

/** The run the agent belongs to archived where it finished well and holds nothing open, as `reconsiderRunArchive` says, failing as its reads fail. */
const archivedRunOf = Effect.fnUntraced(function* (agentId: string) {
  const run = yield* runArchivableAgentsOf(agentId);
  if (run.length === 0) return;
  yield* archiveRunAsRead(run, yield* Clock.currentTimeMillis);
});

/** The work logged by its kind alone where it fails, since no caller waits on it. */
const logged = <E>(work: Effect.Effect<void, E, DatabaseServices>) =>
  work.pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("a finished automation run was not archived", {
        failure: causeKind(cause),
      }),
    ),
  );

/**
 * The run the agent belongs to archived where its automation archives its
 * successful runs and every agent of it finished well and holds nothing
 * open; nothing for an agent of no such run, or a run already settled. A
 * failure is logged by its kind alone.
 */
export function reconsiderRunArchive(
  agentId: string,
): Effect.Effect<void, never, DatabaseServices> {
  return logged(archivedRunOf(agentId));
}

/** The run of the agent whose turn settled reconsidered, as `reconsiderRunArchive` says, so a run is put away as its last turn ends. */
export function reconsiderRunArchiveAfterTurn(
  turn: SettledAgentTurn,
): Effect.Effect<void, never, DatabaseServices> {
  return logged(
    Effect.flatMap(readAgentOfConversation(turn.userId, turn.conversationId), (agent) =>
      Option.isSome(agent) && agent.value.automationRunId !== null
        ? archivedRunOf(agent.value.id)
        : Effect.void,
    ),
  );
}
