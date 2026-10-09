import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentListAnswer,
} from "@sidecar/hosted/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@sidecar/hosted/coding-agent-wire";
import type { CatalogModel } from "@sidecar/hosted/models-wire";
import { scheduleOnce } from "@sidecar/runtime/effect";
import { Duration, Effect, Schedule, type Scope } from "effect";
import { modelLabel } from "#shared/model-label";

/**
 * agent-notices.ts -- tells the developer when a coding agent's turn ends: the ledger of where each agent stands, the poll that keeps it current while no tab does, and the notification posted when one ends.
 *
 * The panel reads an agent's status only while its tab is on screen, so
 * main keeps a ledger of its own, fed by every coding-agent answer that
 * passes through the acts (a list, a Start, a Stop, a transcript page) and
 * by one read of its own: while any agent in the ledger is starting or
 * running, its plan's agents are listed again every `WATCH_INTERVAL`, the
 * panel's own list read on a clock rather than a second kind of read, so an
 * agent on a plan the developer has left is still watched. An agent whose
 * status moves from still writing to ended is a turn end, announced once:
 * as a notification, unless the window is focused and that agent's tab is
 * the one shown; and as the agent's unseen dot, until its tab is shown or
 * the window comes forward on it. A Stop is the developer's own and
 * announces nothing. The ledger is this launch's, so an agent that ended
 * before Luke watched it, or while Luke was not running, is not announced,
 * and a reload of the window announces nothing twice.
 *
 * The notification says the plan's name, the model's name, and how the turn
 * ended, and nothing of the transcript.
 */

/** How often a plan with an agent still writing has its agents listed again. */
const WATCH_INTERVAL = Duration.seconds(30);

/** What the notification is titled for a plan main holds no name for. */
const UNNAMED_PLAN_TITLE = "Luke";

/** The statuses under which an agent may still write, which is when its plan is watched. */
const WRITING_STATUSES: ReadonlySet<CodingAgentStatus> = new Set([
  CODING_AGENT_STATUS.STARTING,
  CODING_AGENT_STATUS.RUNNING,
]);

/** How the notification words each way a turn ends; a Stop is the developer's own and is not announced. */
const ENDED_WORD = {
  [CODING_AGENT_STATUS.COMPLETED]: "finished",
  [CODING_AGENT_STATUS.FAILED]: "failed",
} as const;

/** The notification as the OS posts it: what it says, and what its click does. */
export interface AgentNotice {
  title: string;
  body: string;
  onClick: () => void;
}

/** The one door a notification leaves through: Electron's `Notification`, or a test's record of it. */
export interface AgentNoticePoster {
  post(notice: AgentNotice): void;
}

/** Where a notification's click takes the developer: the plan, on the agent's tab. */
export interface AgentPlace {
  planId: string;
  agentId: string;
}

export interface AgentNoticesDependencies {
  /** The plan's agents with their status, as the host answers them: the watch's one read. */
  listAgents: (planId: string) => Effect.Effect<CodingAgentListAnswer>;
  /** The plan's name as main holds it, or nothing for a plan it holds no name for. */
  planName: (planId: string) => string | undefined;
  poster: AgentNoticePoster;
  /** Brings Luke forward on the plan with the agent's tab open: the click's whole effect. */
  open: (place: AgentPlace) => void;
  /** Where the unseen agents are written, for the tabs to draw. */
  onUnseenChanged: (unseen: readonly string[]) => void;
  /** The panel window coming forward or going behind, for as long as the subscription stands. */
  onPanelFocusChanged: (listener: (focused: boolean) => void) => () => void;
  watchInterval?: Duration.Duration;
  report: (line: string) => void;
}

export interface AgentNotices {
  /** Agents as an answer carried them: a plan's list, or the one a Start or a Stop answered. */
  observeAgents(agents: readonly CodingAgentSummary[]): void;
  /** One agent's status as a transcript page carried it; an agent no answer has named yet is left for the list. */
  observeStatus(agentId: string, status: CodingAgentStatus): void;
  /** The catalog as the panel last read it, for the model's name. */
  observeModels(models: readonly CatalogModel[]): void;
  /** A plan the host no longer holds: its agents are forgotten. */
  observePlanGone(planId: string): void;
  /** The panel said which agent's tab it shows, or none. */
  shown(agentId: string | null): void;
}

/** What the ledger keeps of one agent: enough to watch it and to name it. */
interface HeldAgent {
  planId: string;
  model: string;
  status: CodingAgentStatus;
}

function stillWriting(status: CodingAgentStatus): boolean {
  return WRITING_STATUSES.has(status);
}

/**
 * What the notification says, built in one place: the plan's name over
 * the model's name and the word for how the turn ended, or the pull request
 * it opened once a reader of the agent's pull request hands one in. Nothing
 * for a status that is not a turn's end, or for a Stop.
 */
export function noticeText(input: {
  planName: string | undefined;
  model: string;
  status: CodingAgentStatus;
  models: readonly CatalogModel[] | undefined;
  pullRequest?: number;
}): Pick<AgentNotice, "title" | "body"> | undefined {
  const { status } = input;
  if (status !== CODING_AGENT_STATUS.COMPLETED && status !== CODING_AGENT_STATUS.FAILED) {
    return undefined;
  }
  const model = modelLabel(input.model, input.models);
  const ended =
    input.pullRequest !== undefined && status === CODING_AGENT_STATUS.COMPLETED
      ? `opened #${input.pullRequest}`
      : ENDED_WORD[status];
  return { title: input.planName ?? UNNAMED_PLAN_TITLE, body: `${model} ${ended}` };
}

/**
 * The notices, built on the ambient scope: the watch forks into it and the
 * focus subscription is given back when it closes, so both end with the
 * launch rather than with a handle a caller had to remember.
 */
export const createAgentNotices = /* @__PURE__ */ Effect.fn("desktop/createAgentNotices")(
  function* (
    dependencies: AgentNoticesDependencies,
  ): Effect.fn.Return<AgentNotices, never, Scope.Scope> {
    const { listAgents, planName, poster, open, onUnseenChanged, report } = dependencies;
    const ledger = new Map<string, HeldAgent>();
    const unseen = new Set<string>();
    let models: readonly CatalogModel[] | undefined;
    let shownAgent: string | null = null;
    let focused = false;

    function publishUnseen(): void {
      onUnseenChanged([...unseen]);
    }

    /** A turn ended: announce it, unless the developer is looking at it. */
    function ended(agentId: string, agent: HeldAgent): void {
      const text = noticeText({
        planName: planName(agent.planId),
        model: agent.model,
        status: agent.status,
        models,
      });
      if (text === undefined) return;
      if (focused && shownAgent === agentId) return;
      unseen.add(agentId);
      publishUnseen();
      poster.post({ ...text, onClick: () => open({ planId: agent.planId, agentId }) });
    }

    /** One agent as an answer carried it, against where the ledger last had it. */
    function observe(agentId: string, next: HeldAgent): void {
      const was = ledger.get(agentId);
      ledger.set(agentId, next);
      // Only a move from still writing to ended is a turn's end: an agent
      // first seen ended ended before Luke watched it.
      if (was === undefined || !stillWriting(was.status) || stillWriting(next.status)) return;
      ended(agentId, next);
    }

    function seen(agentId: string | null): void {
      if (agentId === null || !unseen.delete(agentId)) return;
      publishUnseen();
    }

    /** The plans with an agent still writing, each listed again on the watch's clock. */
    function watchedPlans(): readonly string[] {
      const plans = new Set<string>();
      for (const agent of ledger.values()) if (stillWriting(agent.status)) plans.add(agent.planId);
      return [...plans];
    }

    const notices: AgentNotices = {
      observeAgents: (agents) => {
        for (const agent of agents) {
          observe(agent.id, { planId: agent.planId, model: agent.model, status: agent.status });
        }
      },
      observeStatus: (agentId, status) => {
        const held = ledger.get(agentId);
        if (held !== undefined) observe(agentId, { ...held, status });
      },
      observeModels: (next) => {
        models = next;
      },
      observePlanGone: (planId) => {
        for (const [agentId, agent] of ledger) if (agent.planId === planId) ledger.delete(agentId);
      },
      shown: (agentId) => {
        shownAgent = agentId;
        seen(agentId);
      },
    };

    /** One tick of the watch: each watched plan listed again, read as the panel's own list is. */
    const tick = Effect.suspend(() =>
      Effect.forEach(
        watchedPlans(),
        (planId) =>
          Effect.map(listAgents(planId), (answer) => {
            if ("agents" in answer) notices.observeAgents(answer.agents);
            else if (answer.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND) {
              notices.observePlanGone(planId);
            }
          }),
        { discard: true },
      ),
    );
    // A tick that died is reported rather than left to end the watch: a
    // repeat that failed once would never list again for the rest of the run.
    const watch = Effect.catchDefect(tick, (defect) =>
      Effect.sync(() => {
        report(
          `the coding-agent watch failed: ${defect instanceof Error ? defect.message : String(defect)}`,
        );
      }),
    );
    // The watch never fires at the fork itself: nothing is in the ledger at
    // launch, so the first tick is one interval on, and each after it.
    const interval = dependencies.watchInterval ?? WATCH_INTERVAL;
    yield* scheduleOnce(
      Duration.toMillis(interval),
      Effect.repeat(watch, Schedule.spaced(interval)),
    );
    // Coming forward on the shown agent's tab is seeing it.
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        dependencies.onPanelFocusChanged((next) => {
          focused = next;
          if (focused) seen(shownAgent);
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    return notices;
  },
);
