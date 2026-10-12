import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentListAnswer,
  type CodingAgentPullRequestAnswerView,
} from "@sidecar/hosted/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentPullRequest,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@sidecar/hosted/coding-agent-wire";
import { modelLabel } from "@sidecar/hosted/model-label";
import type { CatalogModel } from "@sidecar/hosted/models-wire";
import { scheduleOnce } from "@sidecar/runtime/effect";
import { Context, Duration, Effect, Queue, Schedule, type Scope } from "effect";

/**
 * agent-notices.ts -- tells the developer when a coding agent's turn ends: the ledger of where each agent stands, the poll that keeps it current while no tab does, and the notification posted when one ends.
 *
 * The panel reads an agent's status only while its tab is on screen, so
 * main keeps a ledger of its own, fed by every coding-agent answer that
 * passes through the acts (a list, a Start, a Stop, a transcript page) and
 * by one read of its own: while any agent in the ledger is starting or
 * running, its plan's agents are listed again every `WATCH_INTERVAL`, the
 * panel's own list read on a clock rather than a second kind of read, so an
 * agent on a plan the developer has left is still watched. The ledger
 * keys an agent's run by the turn its status is read from (`turnId`): a
 * status that moves from still writing to ended under one turn is that
 * turn's end, announced once, and as the agent's unseen dot, until its tab
 * is shown or the window comes forward on it. It is announced nowhere while
 * the window is focused on that agent's tab; in the window's own toast while
 * the window is focused on anything else, since a notification would come
 * from beside the window the developer is already looking at; and as a
 * notification while the window is behind, unless the developer turned
 * notifications off, which leaves the dot and the toast. A message
 * to an agent that had ended reads it running under the ended turn's id
 * until eve opens the next turn, which is the old run read again and not
 * a new one: the ledger keeps the end it announced, and on the message's
 * own answer keeps the plan watched until the new turn's id arrives, whose
 * own end is the next notice. A list that landed late, describing a turn
 * the agent has left behind, says nothing newer. A Stop is the developer's
 * own and announces nothing. The ledger
 * is this launch's and this account's, so an agent that ended before Luke
 * watched it, or while Luke was not running, is not announced, a reload of
 * the window announces nothing twice, and an account that signs out takes
 * its agents with it. Only another account is a change of hands: the
 * account's own session renewing, which it does mid-run, says the same
 * account again and keeps the ledger, or an agent running across the
 * renewal would be first seen again already ended and never announced.
 *
 * The notification says the plan's name, the agent's title or else its
 * model's name, and how the turn ended, and nothing of the transcript; the
 * toast says the same but the plan's name. A turn that completed is announced
 * as the pull request it opened where one is found: each end is queued
 * from the ledger's own synchronous path and a fiber on the notices' scope
 * takes it, reads what the agent published once, and posts; an end whose
 * read found nothing, or could not be made, says finished as before. The
 * agent's unseen dot is set as the end is seen, ahead of the read.
 *
 * The sidebar's plan rows say which plans have an agent at work and which
 * a pull request, from the plan list, which is read on no clock. So the
 * ledger asks for the list again whenever it sees an agent start or end,
 * and whenever a read of what an agent published, the panel's or the
 * notice's own, finds a pull request other than the one it last saw for
 * that agent, since that read is what the service keeps for the list.
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

/** Where a notification's click takes the developer: the plan, on the agent's tab. */
export interface AgentPlace {
  planId: string;
  agentId: string;
}

/** A turn's end as the window's own toast says it: the words, whether the turn failed, and where its View goes. */
export interface AgentEndToast {
  place: AgentPlace;
  words: string;
  failed: boolean;
}

/**
 * The two doors an announcement leaves this process through: the OS's
 * notification, and the panel's toast. A service rather than a dependency
 * handed in, because it is this process's door to Electron, so a test stands
 * a Layer of its own on it.
 */
export interface AgentNoticeDoorsSurface {
  post(notice: AgentNotice): void;
  toast(end: AgentEndToast): void;
}

export class AgentNoticeDoors extends Context.Service<AgentNoticeDoors, AgentNoticeDoorsSurface>()(
  "@luke/desktop/AgentNoticeDoors",
) {}

export interface AgentNoticesDependencies {
  /** The plan's agents with their status, as the host answers them: the watch's one read. */
  listAgents: (planId: string) => Effect.Effect<CodingAgentListAnswer>;
  /** What the agent published, read once as a completed turn ends for the pull request the notice names. */
  readPullRequest: (agentId: string) => Effect.Effect<CodingAgentPullRequestAnswerView>;
  /** The plan's name as main holds it, or nothing for a plan it holds no name for. */
  planName: (planId: string) => string | undefined;
  /** Brings Luke forward on the plan with the agent's tab open: the click's whole effect. */
  open: (place: AgentPlace) => void;
  /** Where the unseen agents are written, for the tabs to draw. */
  onUnseenChanged: (unseen: readonly string[]) => void;
  /** The panel window coming forward or going behind, for as long as the subscription stands. */
  onPanelFocusChanged: (listener: (focused: boolean) => void) => () => void;
  /** Whether a notification is posted for an end the window is behind for: the developer's setting. */
  notifying: () => boolean;
  /** Who is signed in now, by the account's own key, or nobody. */
  signedInAs: () => string | undefined;
  /** The account as each change of it says, for as long as the subscription stands: the ledger is no one else's. */
  onAccountChanged: (listener: (signedInAs: string | undefined) => void) => () => void;
  /** An agent started or ended, or a read found it published something new: the plan list is read again, so its rows say so. */
  onPlanAgentsMoved: () => void;
  watchInterval?: Duration.Duration;
  report: (line: string) => void;
}

export interface AgentNotices {
  /** Agents as an answer carried them: a plan's list, or the one a Start or a Stop answered. */
  observeAgents(agents: readonly CodingAgentSummary[]): void;
  /** One agent's status as a transcript page carried it; an agent no answer has named yet is left for the list. */
  observeStatus(agentId: string, status: CodingAgentStatus): void;
  /** One agent's title as a transcript page carried it, which the list that named the agent may have read before the title landed; said whatever the agent's standing. */
  observeTitle(agentId: string, title: string | null): void;
  /** The agent as the answer to a message carried it: running, and with a line awaiting the turn it opens, which keeps its plan watched for that turn. */
  observeMessaged(agent: CodingAgentSummary): void;
  /** The catalog as the panel last read it, for the model's name. */
  observeModels(models: readonly CatalogModel[]): void;
  /** What one agent published, as a read of it answered: the pull request, or none. */
  observePublished(agentId: string, pullRequest: CodingAgentPullRequest | null): void;
  /** A plan the host no longer holds: its agents are forgotten. */
  observePlanGone(planId: string): void;
  /** The panel said which agent's tab it shows, or none. */
  shown(agentId: string | null): void;
}

/** What the ledger keeps of one agent: enough to watch it, to name it, and to tell one turn's end from the next's. */
interface HeldAgent {
  planId: string;
  model: string;
  /** The agent's title, said in the model's place where it has one. */
  title: string | null;
  status: CodingAgentStatus;
  /** The turn the status is read from; none before the first. */
  turnId: string | null;
  /** Whether a message of the developer's awaits a turn not yet opened, which keeps the plan watched past the end already announced. */
  awaiting: boolean;
  /** The turns the agent has left behind, which a list that landed late may still describe. */
  pastTurns: ReadonlySet<string>;
}

/** One turn's end as the ledger saw it, waiting to be announced, and whether the window was focused as it ended. */
interface TurnEnd {
  agentId: string;
  agent: HeldAgent;
  focused: boolean;
}

function stillWriting(status: CodingAgentStatus): boolean {
  return WRITING_STATUSES.has(status);
}

/** Whether two reads of what an agent published say the same of it in a plan's row: the same pull request, standing the same, of the same size. */
function samePublished(
  a: CodingAgentPullRequest | null,
  b: CodingAgentPullRequest | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.number === b.number &&
    a.title === b.title &&
    a.state === b.state &&
    a.checks === b.checks &&
    a.additions === b.additions &&
    a.deletions === b.deletions
  );
}

/**
 * What the notification says, built in one place: the plan's name over
 * the agent's title, or its model's name until it has one, and the word for
 * how the turn ended, or the pull request it opened once a reader of the
 * agent's pull request hands one in. Nothing for a status that is not a
 * turn's end, or for a Stop.
 */
export function noticeText(input: {
  planName: string | undefined;
  model: string;
  title: string | null;
  status: CodingAgentStatus;
  models: readonly CatalogModel[] | undefined;
  pullRequest?: number;
}): Pick<AgentNotice, "title" | "body"> | undefined {
  const { status } = input;
  if (status !== CODING_AGENT_STATUS.COMPLETED && status !== CODING_AGENT_STATUS.FAILED) {
    return undefined;
  }
  const name = input.title ?? modelLabel(input.model, input.models);
  const ended =
    input.pullRequest !== undefined && status === CODING_AGENT_STATUS.COMPLETED
      ? `opened #${input.pullRequest}`
      : ENDED_WORD[status];
  return { title: input.planName ?? UNNAMED_PLAN_TITLE, body: `${name} ${ended}` };
}

/**
 * The notices, built on the ambient scope: the watch forks into it and the
 * focus subscription is given back when it closes, so both end with the
 * launch rather than with a handle a caller had to remember.
 */
export const createAgentNotices = /* @__PURE__ */ Effect.fn("desktop/createAgentNotices")(
  function* (
    dependencies: AgentNoticesDependencies,
  ): Effect.fn.Return<AgentNotices, never, Scope.Scope | AgentNoticeDoors> {
    const { listAgents, readPullRequest, planName, open, onUnseenChanged, report } = dependencies;
    const doors = yield* AgentNoticeDoors;
    const ledger = new Map<string, HeldAgent>();
    /** What each agent was last read to have published, by agent. */
    const published = new Map<string, CodingAgentPullRequest | null>();
    const unseen = new Set<string>();
    const ends = yield* Queue.unbounded<TurnEnd>();
    let models: readonly CatalogModel[] | undefined;
    let shownAgent: string | null = null;
    let focused = false;
    /** Whose agents the ledger holds: read as it takes its first, and moved only by another account. */
    let holder: string | undefined;

    function publishUnseen(): void {
      onUnseenChanged([...unseen]);
    }

    /** A turn ended: dot its tab and queue the announcement, unless the developer is looking at it. */
    function ended(agentId: string, agent: HeldAgent): void {
      if (
        agent.status !== CODING_AGENT_STATUS.COMPLETED &&
        agent.status !== CODING_AGENT_STATUS.FAILED
      ) {
        return;
      }
      if (focused && shownAgent === agentId) return;
      unseen.add(agentId);
      publishUnseen();
      Queue.offerUnsafe(ends, { agentId, agent, focused });
    }

    /** A read of what the agent published answered: the list is read again where it found other than the last read did, or a pull request where none was read before. */
    function observePublished(agentId: string, pullRequest: CodingAgentPullRequest | null): void {
      const was = published.get(agentId) ?? null;
      published.set(agentId, pullRequest);
      if (!samePublished(was, pullRequest)) dependencies.onPlanAgentsMoved();
    }

    /** The pull request a completed turn opened, where the read finds one; nothing for any other end, or a read that did not answer. */
    const pullRequestOf = (end: TurnEnd): Effect.Effect<number | undefined> =>
      end.agent.status !== CODING_AGENT_STATUS.COMPLETED
        ? Effect.succeed(undefined)
        : readPullRequest(end.agentId).pipe(
            Effect.map((answer) => {
              if (!("pullRequest" in answer)) return undefined;
              observePublished(end.agentId, answer.pullRequest);
              return answer.pullRequest?.number;
            }),
            Effect.catchDefect((defect) =>
              Effect.sync(() => {
                report(
                  `the agent's pull request could not be read for its notice: ${defect instanceof Error ? defect.message : String(defect)}`,
                );
                return undefined;
              }),
            ),
          );

    /**
     * One end announced: what the agent published read, then the toast shown
     * where the window was focused as the turn ended and still is, or else
     * the notification posted. Note that focus is read on both sides of the
     * read, because a toast to a window gone behind while it was out would
     * play to nobody, and a window come forward meanwhile had already been
     * told nothing of the end it missed.
     */
    const announce = Effect.gen(function* () {
      const end = yield* Queue.take(ends);
      const pullRequest = yield* pullRequestOf(end);
      const text = noticeText({
        planName: planName(end.agent.planId),
        model: end.agent.model,
        title: end.agent.title,
        status: end.agent.status,
        models,
        ...(pullRequest === undefined ? undefined : { pullRequest }),
      });
      if (text === undefined) return;
      const place = { planId: end.agent.planId, agentId: end.agentId };
      if (end.focused && focused) {
        doors.toast({
          place,
          words: text.body,
          failed: end.agent.status === CODING_AGENT_STATUS.FAILED,
        });
        return;
      }
      if (dependencies.notifying()) doors.post({ ...text, onClick: () => open(place) });
    });
    // Each announce suspends on the queue itself, so the loop need not yield between ends: the ends queued together are posted together.
    yield* Effect.forkScoped(Effect.forever(announce, { disableYield: true }));

    /** One agent as an answer carried it, against where the ledger last had it. */
    function observe(agentId: string, next: HeldAgent): void {
      const was = ledger.get(agentId);
      // An agent first seen ended ended before Luke watched it; one first seen at work may have just started.
      if (was === undefined) {
        if (ledger.size === 0) holder = dependencies.signedInAs();
        ledger.set(agentId, next);
        if (stillWriting(next.status)) dependencies.onPlanAgentsMoved();
        return;
      }
      // The reads overlap, so a list can land after a newer read moved the
      // ledger on: one describing a turn the agent has left behind, or no
      // turn yet, says nothing newer and is let go whole.
      if (next.turnId === null ? was.turnId !== null : was.pastTurns.has(next.turnId)) return;
      if (was.turnId === next.turnId) {
        // A turn that ended stays ended, so an end is never a second turn's,
        // and running again under the ended turn's id is a late read or a
        // message awaiting the next turn, which its own answer says.
        if (!stillWriting(was.status)) return;
        ledger.set(agentId, { ...next, pastTurns: was.pastTurns });
        if (stillWriting(next.status)) return;
        ended(agentId, next);
        dependencies.onPlanAgentsMoved();
        return;
      }
      // A new turn: the one before it is left behind, and its own end is the next notice.
      const pastTurns = new Set(was.pastTurns);
      if (was.turnId !== null) pastTurns.add(was.turnId);
      ledger.set(agentId, { ...next, pastTurns });
      if (!stillWriting(next.status)) ended(agentId, next);
      dependencies.onPlanAgentsMoved();
    }

    /** Lets go of every agent `keep` refuses, their dots with them, as a plan deleted or an account left has no tab to clear one. */
    function forget(keep: (agent: HeldAgent) => boolean): void {
      let dotted = false;
      for (const [agentId, agent] of ledger) {
        if (keep(agent)) continue;
        ledger.delete(agentId);
        published.delete(agentId);
        if (unseen.delete(agentId)) dotted = true;
      }
      if (dotted) publishUnseen();
    }

    function seen(agentId: string | null): void {
      if (agentId === null || !unseen.delete(agentId)) return;
      publishUnseen();
    }

    /** The plans with an agent still writing, or one awaiting the turn a message opens, each listed again on the watch's clock. */
    function watchedPlans(): readonly string[] {
      const plans = new Set<string>();
      for (const agent of ledger.values()) {
        if (stillWriting(agent.status) || agent.awaiting) plans.add(agent.planId);
      }
      return [...plans];
    }

    function heldOf(agent: CodingAgentSummary): HeldAgent {
      return {
        planId: agent.planId,
        model: agent.model,
        title: agent.title,
        status: agent.status,
        turnId: agent.turnId,
        awaiting: false,
        pastTurns: new Set(),
      };
    }

    const notices: AgentNotices = {
      observeAgents: (agents) => {
        for (const agent of agents) observe(agent.id, heldOf(agent));
      },
      observeMessaged: (agent) => {
        observe(agent.id, heldOf(agent));
        // The line awaits the turn it opens: the plan is watched until that turn names itself.
        const held = ledger.get(agent.id);
        if (held !== undefined && !stillWriting(held.status)) {
          ledger.set(agent.id, { ...held, awaiting: true });
        }
      },
      observeStatus: (agentId, status) => {
        const held = ledger.get(agentId);
        if (held !== undefined) observe(agentId, { ...held, status });
      },
      observeTitle: (agentId, title) => {
        const held = ledger.get(agentId);
        if (held !== undefined && held.title !== title) ledger.set(agentId, { ...held, title });
      },
      observeModels: (next) => {
        models = next;
      },
      observePublished,
      observePlanGone: (planId) => forget((agent) => agent.planId !== planId),
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
    // Another account leaves the ledger no one's: nothing of the account
    // that left is announced to whoever signs in next, and an answer still on
    // its way lands as a first sighting, which announces nothing.
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        dependencies.onAccountChanged((signedInAs) => {
          if (ledger.size === 0 || signedInAs === holder) return;
          forget(() => false);
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    return notices;
  },
);
