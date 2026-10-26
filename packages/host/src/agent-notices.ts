import type {
  AccountInboxAnswer,
  AccountInboxAutomation,
  AccountInboxEntry,
  AccountInboxTask,
  AccountTasklessEntry,
} from "@luke/features/account-inbox-wire";
import type { CodingAgentAccountInboxAnswerView } from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentStatus,
  type CodingAgentSummary,
  type TasklessAgent,
} from "@luke/features/coding-agent-wire";
import { Context, Effect, type Scope, Stream } from "effect";
import type { AppInboxSlice, AppInboxWaitingItem } from "./app-state.js";

/**
 * agent-notices.ts -- keeps where each coding agent stands and what waits across the account, for the window's marks and counts: the ledger of each agent's turn, fed by the plan list followed live, the follow of what waits, and the Dock's badge.
 *
 * Nothing here announces anything. An agent's turn ending, an Inbox item
 * posted, or an automation's run failing to start is said by the window's
 * own marks and counts, focused or behind, and by no toast and no
 * notification, since news the developer did not ask for interrupts more
 * than it tells: the agent's unseen dot, the Inbox's counts and the Dock's
 * badge, and the Automations failed mark. The
 * one notification Luke posts is a command waiting on this Mac
 * (`client/client-notices.ts`), through the same doors.
 *
 * The panel reads an agent's status only while its tab is on screen, so
 * main keeps a ledger of its own, fed by every coding-agent answer that
 * passes through the acts (a list, a Start, a Stop, a transcript page) and
 * by the plan list, followed live over Neon Realtime, which carries every
 * agent on a plan and every one with no plan as each moves, so an agent on
 * a plan the developer has left is still heard and nothing is read on a
 * clock. An agent an automation started with no plan is held from the plan
 * list, which carries the account's own beside the plans, and from any
 * answer naming it. The ledger keys an agent's run by the turn its status is
 * read from (`turnId`): a status that moves from still writing to ended under
 * one turn is that turn's end, marked once as the agent's unseen dot, until
 * its tab is shown or the window comes forward on it, and not at all while
 * the window is focused on that agent's tab, where the developer sees the
 * end for themselves. A message to an agent that had ended reads it running
 * under the ended turn's id until eve opens the next turn, which is the old
 * run read again and not a new one: the ledger keeps the end it marked until
 * the new turn's id arrives, whose own end is the next dot. A list that
 * landed late, describing a turn the agent has left behind, says nothing
 * newer. A Stop is the developer's own and leaves no dot, and so does a quiet
 * turn, a member's operator's heartbeat whose reply is its quiet reply alone,
 * as the plan list says (`quietTurn`): one the agent's page saw end first has
 * its dot taken back once the list says it was quiet. The ledger is this
 * launch's and this account's, so an agent that ended before Luke watched
 * it, or while Luke was not running, is not dotted, a reload of the window
 * dots nothing twice, and an account that signs out takes its agents with
 * it. Only another account is a change of hands: the account's own session
 * renewing, which it does mid-run, says the same account again and keeps the
 * ledger, or an agent running across the renewal would be first seen again
 * already ended and never dotted.
 *
 * The notices hold one more read of their own: what waits on the developer
 * across the account's tasks, every open inbox item, followed over Neon
 * Realtime for as long as an account is signed in, so an item an agent posts
 * is heard whichever task is open, or none, and whichever Mac started the
 * agent. Of those, only the items of agents the account started wait on
 * it, since an agent runs on its starter's keys and asks its starter: each
 * answer is written whole as each task's open items of those, which the
 * sidebar counts, and the Dock's badge is their number. While Channels is
 * on the badge counts only the open asks among them, which is every channel's
 * count of what waits on the developer summed, since a notice asks nobody
 * to act; every task holding any
 * member's item is listed for the Inbox. The same read carries the newest
 * run of each of the account's own automations that failed to start lately,
 * which is written for the window's Automations to mark until that
 * automation is opened, and counts on no badge, since nothing answers it.
 * Another account, or nobody, ends the follow of the last, and lets go of
 * its items, its counts, and its badge before anything of the next is read.
 */

/** The statuses under which an agent may still write, which is when its task is watched. */
const WRITING_STATUSES: ReadonlySet<CodingAgentStatus> = new Set([
  CODING_AGENT_STATUS.STARTING,
  CODING_AGENT_STATUS.RUNNING,
]);

/** How many pushes of the followed list in a row may leave out an agent only a Start answered before the ledger lets it go. */
const UNNAMED_PUSHES_KEPT = 2;

/** What kind of event a notice tells of. */
export const NOTICE_KIND = {
  /** A command an agent asked to run on this Mac waits on the developer (`client/client-notices.ts`). */
  MAC_COMMAND_ASK: "mac-command-ask",
} as const;

/** The event a notice tells of, by the identifiers that name it. */
type NoticeSubject = { readonly kind: typeof NOTICE_KIND.MAC_COMMAND_ASK; readonly askId: string };

/** The notification as the OS posts it: the event it tells of, what it says, and what its click does. */
export interface AgentNotice {
  subject: NoticeSubject;
  title: string;
  body: string;
  onClick: () => void;
}

/**
 * The doors a notice leaves this process through: the OS's notification,
 * which only a command waiting on this Mac posts (`client/client-notices.ts`),
 * and the Dock's badge. A service rather than a dependency handed in, because
 * it is this process's door to Electron, so a test stands a Layer of its
 * own on it.
 */
export interface AgentNoticeDoorsSurface {
  post(notice: AgentNotice): void;
  /** How many inbox items wait across the account, which the Dock's badge counts; none clears it. */
  badge(count: number): void;
}

export class AgentNoticeDoors extends Context.Service<AgentNoticeDoors, AgentNoticeDoorsSurface>()(
  "@luke/desktop/AgentNoticeDoors",
) {}

/**
 * The doors as the notices call them: one that throws is reported and its
 * count dropped. Note that the throw never reaches the caller, because the
 * badge is set from the inbox's answers, and a throw there would end the
 * follow for the rest of the run.
 */
function guardedDoors(
  doors: AgentNoticeDoorsSurface,
  report: (message: string) => void,
): AgentNoticeDoorsSurface {
  const guarded =
    <Said>(door: string, say: (said: Said) => void) =>
    (said: Said): void => {
      try {
        say(said);
      } catch (defect) {
        report(
          `the notice's ${door} door failed: ${defect instanceof Error ? defect.message : String(defect)}`,
        );
      }
    };
  return {
    ...doors,
    badge: guarded("badge", (count: number) => doors.badge(count)),
  };
}

export interface AgentNoticesDependencies {
  /** Where the unseen agents are written, for the tabs to draw. */
  onUnseenChanged: (unseen: readonly string[]) => void;
  /** The panel window coming forward or going behind, for as long as the subscription stands. */
  onPanelFocusChanged: (listener: (focused: boolean) => void) => () => void;
  /** Who is signed in now, by the account's own key, or nobody. */
  signedInAs: () => string | undefined;
  /** The signed-in account's id, which an agent's starter is named by; none for an identity stored without one, which is told of every agent. */
  accountId: () => string | undefined;
  /** The account as each change of it says, for as long as the subscription stands: the ledger is no one else's. */
  onAccountChanged: (listener: (signedInAs: string | undefined) => void) => () => void;
  /** What waits across the account, followed for as long as the stream is run: each answer the host tells as it moves. */
  followAccountInbox: () => Stream.Stream<CodingAgentAccountInboxAnswerView>;
  /** Who is signed in, by the account's own key, from where the launch stands and at each change: whose items the inbox read reads. */
  accounts: Stream.Stream<string | undefined>;
  /** Where each task's waiting items, and every task holding an item, are written, for the window's Inbox. */
  onInboxChanged: (inbox: AppInboxSlice) => void;
  /** Whether the window offers Channels, under which the Dock counts the open asks that wait on the account, every channel's summed, and no notice. */
  channelsOn: () => boolean;
  report: (line: string) => void;
}

export interface AgentNotices {
  /** Agents as an answer carried them: a task's list, or the one a Start or a Stop answered. */
  observeAgents(agents: readonly CodingAgentSummary[]): void;
  /** The agents with no plan as the plan list last carried them: the account's own are held, each with its automation's name. */
  observeTaskless(agents: readonly TasklessAgent[]): void;
  /** One agent's status as a transcript page carried it; an agent no answer has named yet is left for the list. */
  observeStatus(agentId: string, status: CodingAgentStatus): void;
  /** The agent as the answer to a message carried it: running, with a line awaiting the turn it opens. */
  observeMessaged(agent: CodingAgentSummary): void;
  /** A task the host no longer holds: its agents are forgotten. */
  observeTaskGone(taskId: string): void;
  /** Every agent on a plan as the list followed live carries them, and the plans it holds: an agent of any other plan, or one of a held plan the list no longer names, as one archived, is forgotten. */
  observeFollowed(agents: readonly CodingAgentSummary[], taskIds: readonly string[]): void;
  /** The panel said which agent's tab it shows, or none. */
  shown(agentId: string | null): void;
  /** The developer marked the agent as read by hand: its unseen dot goes, whichever page shows. */
  seen(agentId: string): void;
  /** Channels turned on or off: the badge counts what last waited again, since no answer moves with an experiment. */
  recount(): void;
}

/** What the ledger keeps of one agent: enough to tell one turn's end from the next's. */
interface HeldAgent {
  /** The plan it works on; null for one an automation started with no plan. */
  taskId: string | null;
  status: CodingAgentStatus;
  /** The turn the status is read from; none before the first. */
  turnId: string | null;
  /** Whether that turn's reply is a member's operator's quiet reply alone, a heartbeat that found nothing, whose end leaves no dot. */
  quietTurn?: boolean | undefined;
  /** The turns the agent has left behind, which a list that landed late may still describe. */
  pastTurns: ReadonlySet<string>;
}

function stillWriting(status: CodingAgentStatus): boolean {
  return WRITING_STATUSES.has(status);
}

/**
 * The answer as it waits on the account: a task's items that wait on it
 * (`waitsOn`), its assignee's, or its agent's starter's where nobody is
 * assigned, and the items of the agents with no task it started, since such
 * an agent runs on its starter's keys and asks its starter, and the tasks
 * holding any item whole, since every member's Inbox lists them. An item a
 * service before `waitsOn` names goes by its starter; one naming neither, or
 * an account whose id is not known, is the account's own, as every item was
 * before. Note that what counts is this, while the window
 * lists every member's items of agents with no task (`sliceOf`), as it does
 * a task's.
 */
function waitingOnAccount(
  answer: AccountInboxAnswer,
  accountId: string | undefined,
): AccountInboxAnswer {
  if (accountId === undefined) return answer;
  const ownOf = (item: { readonly startedBy?: string; readonly waitsOn?: string }) => {
    const waitsOn = item.waitsOn ?? item.startedBy;
    return waitsOn === undefined || waitsOn === accountId;
  };
  return {
    ...answer,
    items: answer.items.filter(ownOf),
    ...(answer.planless === undefined ? undefined : { planless: answer.planless.filter(ownOf) }),
  };
}

/** Whether an item holds an ask open rather than being a notice; one a service before it says nothing of is counted as asking, as every item was. */
function asking(item: { readonly asking?: boolean }): boolean {
  return item.asking !== false;
}

/** The items each task holds waiting, the task whose item changed latest first, as the read answered them latest first. */
function waitingTasks(items: readonly AccountInboxEntry[]): AppInboxSlice["waiting"] {
  const tasks = new Map<string, AppInboxWaitingItem[]>();
  for (const item of items) {
    const waiting = {
      id: item.id,
      agentId: item.agentId,
      title: item.title,
      postedAt: item.postedAt,
    };
    const held = tasks.get(item.planId);
    if (held === undefined) tasks.set(item.planId, [waiting]);
    else held.push(waiting);
  }
  return [...tasks].map(([taskId, held]) => ({ taskId, items: held }));
}

/** The open items of agents with no task as the window holds them: each with its agent, who started it, and the automation and repository standing in a task's place. */
function waitingTaskless(items: readonly AccountTasklessEntry[]): AppInboxSlice["taskless"] {
  return items.map((item) => ({
    id: item.id,
    agentId: item.agentId,
    title: item.title,
    postedAt: item.postedAt,
    agentTitle: item.agentTitle,
    agentModel: item.agentModel,
    automationId: item.automationId,
    automationName: item.automationName,
    repository: item.repository,
    ...(item.startedBy === undefined ? undefined : { startedBy: item.startedBy }),
    ...(item.waitsOn === undefined ? undefined : { waitsOn: item.waitsOn }),
    ...(item.workspaceId === undefined ? undefined : { workspaceId: item.workspaceId }),
  }));
}

/** What an answer of the inbox read carries that the window and the Dock are told of. */
type InboxAnswered = Pick<
  AccountInboxAnswer,
  "items" | "plans" | "planless" | "automations" | "failedRuns"
>;

/** Whether two answers say alike everything the window draws of each item of an agent with no task: its agent's title and model, the automation and repository standing in a task's place, and the workspace whose list it stands in, which change without the item's stamp moving, a service first naming the workspace among them. */
function sameTaskless(
  one: readonly AccountTasklessEntry[],
  other: readonly AccountTasklessEntry[],
): boolean {
  return (
    one.length === other.length &&
    one.every((item, at) => {
      const was = other[at];
      return (
        was !== undefined &&
        was.id === item.id &&
        was.agentTitle === item.agentTitle &&
        was.agentModel === item.agentModel &&
        was.automationId === item.automationId &&
        was.automationName === item.automationName &&
        was.repository === item.repository &&
        was.workspaceId === item.workspaceId
      );
    })
  );
}

/** Whether two answers list the same automations holding items, alike in order, count, and instant. */
function sameAutomations(
  one: readonly AccountInboxAutomation[],
  other: readonly AccountInboxAutomation[],
): boolean {
  return (
    one.length === other.length &&
    one.every((held, at) => {
      const was = other[at];
      return (
        was !== undefined &&
        was.automationId === held.automationId &&
        was.items === held.items &&
        was.updatedAt === held.updatedAt
      );
    })
  );
}

/** Whether two answers list the same tasks holding items, alike in order, count, To do count, and instant: a read mark moves the To do count alone. */
function sameTasks(one: readonly AccountInboxTask[], other: readonly AccountInboxTask[]): boolean {
  return (
    one.length === other.length &&
    one.every((task, at) => {
      const was = other[at];
      return (
        was !== undefined &&
        was.planId === task.planId &&
        was.items === task.items &&
        was.toDo === task.toDo &&
        was.updatedAt === task.updatedAt
      );
    })
  );
}

/**
 * The notices, built on the ambient scope: the inbox follow forks into it
 * and the focus subscription is given back when it closes, so both end with
 * the launch rather than with a handle a caller had to remember.
 */
export const createAgentNotices = /* @__PURE__ */ Effect.fn("desktop/createAgentNotices")(
  function* (
    dependencies: AgentNoticesDependencies,
  ): Effect.fn.Return<AgentNotices, never, Scope.Scope | AgentNoticeDoors> {
    const { onUnseenChanged, report } = dependencies;
    const doors = guardedDoors(yield* AgentNoticeDoors, report);
    const ledger = new Map<string, HeldAgent>();
    const unseen = new Set<string>();
    /** The agents on plans the followed list last named, so one it stops naming is known to have left it rather than not reached it yet. */
    let followedAgents = new Set<string>();
    /** How many pushes in a row have left out each agent the list has not named yet, as one only a Start answered. */
    const unnamedPushes = new Map<string, number>();
    let shownAgent: string | null = null;
    let focused = false;
    /** Whose agents the ledger holds: read as it takes its first, and moved only by another account. */
    let holder: string | undefined;
    /** The inbox read's last answer for the account signed in, as it waits on the account (`waitingOnAccount`), and every member's items of agents with no task the window lists; none before its first. */
    let waiting:
      | {
          readonly answer: AccountInboxAnswer;
          readonly listed: readonly AccountTasklessEntry[];
        }
      | undefined;

    function publishUnseen(): void {
      onUnseenChanged([...unseen]);
    }

    /** A turn ended: dot its tab, unless the developer is looking at it. */
    function ended(agentId: string, agent: HeldAgent): void {
      if (
        agent.status !== CODING_AGENT_STATUS.COMPLETED &&
        agent.status !== CODING_AGENT_STATUS.FAILED
      ) {
        return;
      }
      if (focused && shownAgent === agentId) return;
      // A heartbeat that found nothing leaves its member nothing to read, so its end is no news.
      if (agent.quietTurn === true && agent.status === CODING_AGENT_STATUS.COMPLETED) return;
      unseen.add(agentId);
      publishUnseen();
    }

    /**
     * What the window holds of an answer: each task's items waiting on the
     * account and every task holding one, and beside them the items of
     * agents with no task, every member's listed as a task's are, and the
     * automations holding them.
     */
    function sliceOf(
      answer: InboxAnswered,
      listed: readonly AccountTasklessEntry[],
    ): AppInboxSlice {
      return {
        waiting: waitingTasks(answer.items),
        tasks: answer.plans.map(({ planId: taskId, ...holding }) => ({
          ...holding,
          taskId,
        })),
        taskless: waitingTaskless(listed),
        automations: answer.automations ?? [],
        failedRuns: answer.failedRuns ?? [],
      };
    }

    /** What waits in the inbox that the Dock counts: every item, or under Channels its open asks alone, each channel's count of what waits on the reader summed. */
    function countedOf(answer: InboxAnswered): number {
      const waiting = [...answer.items, ...(answer.planless ?? [])];
      if (!dependencies.channelsOn()) return waiting.length;
      return waiting.filter(asking).length;
    }

    /** Writes what waits for the window, and its number, a task's items and an agent's with no task alike, the account's own alone, for the Dock. */
    function publishWaiting(answer: InboxAnswered, listed: readonly AccountTasklessEntry[]): void {
      dependencies.onInboxChanged(sliceOf(answer, listed));
      doors.badge(countedOf(answer));
    }

    /**
     * An answer of the inbox read, written whole. Nothing of it is announced:
     * the window's counts and the Dock's badge say what waits. Only what
     * waits on the account (`waitingOnAccount`) is counted, while every
     * member's items of agents with no task are written for the window.
     */
    function observeWaiting(read: AccountInboxAnswer): void {
      const answer = waitingOnAccount(read, dependencies.accountId());
      const listed = read.planless ?? [];
      const was = waiting;
      // Note that an answer at the same cursor holding fewer of the account's own items is written, because the account's id, which picks them, may have arrived since.
      if (
        was?.answer.cursor === answer.cursor &&
        was.answer.items.length === answer.items.length &&
        (was.answer.planless?.length ?? 0) === (answer.planless?.length ?? 0) &&
        was.listed.length === listed.length
      ) {
        // Note that the tasks and automations holding items, and what an item with no task is named
        // by, may move with nothing waiting moving, an archive, a rename, or a hold let go, so they are written alone.
        if (
          sameTasks(was.answer.plans, answer.plans) &&
          sameAutomations(was.answer.automations ?? [], answer.automations ?? []) &&
          sameTaskless(was.listed, listed)
        ) {
          return;
        }
        const moved = {
          ...was.answer,
          plans: answer.plans,
          automations: answer.automations ?? [],
          planless: answer.planless ?? [],
        };
        waiting = { ...was, answer: moved, listed };
        dependencies.onInboxChanged(sliceOf(moved, listed));
        return;
      }
      waiting = { answer, listed };
      publishWaiting(answer, listed);
    }

    /**
     * What waits for one account, followed for as long as it stays signed in:
     * whatever the last account left is let go first, and nobody's is
     * nothing to follow. Note that an answer is let go where the account it
     * was told for is no longer signed in, because it may land in the tick
     * before the change ends the follow, and one telling why there is none
     * says nothing: the host seals the follow again itself.
     */
    const waitingOf = (reader: string | undefined): Effect.Effect<void> =>
      Effect.suspend(() => {
        waiting = undefined;
        publishWaiting({ items: [], plans: [] }, []);
        if (reader === undefined) return Effect.void;
        // An answer that throws is reported rather than left to end the follow, which would never resume.
        const look = (answer: CodingAgentAccountInboxAnswerView) =>
          Effect.catchDefect(
            Effect.sync(() => {
              if (dependencies.signedInAs() !== reader || "failure" in answer) return;
              observeWaiting(answer);
            }),
            (defect) =>
              Effect.sync(() =>
                report(
                  `the inbox answer could not be noted: ${defect instanceof Error ? defect.message : String(defect)}`,
                ),
              ),
          );
        return Stream.runForEach(dependencies.followAccountInbox(), look);
      });

    /** One agent as an answer carried it, against where the ledger last had it. */
    function observe(agentId: string, next: HeldAgent): void {
      const was = ledger.get(agentId);
      // An agent first seen ended ended before Luke watched it; one first seen at work may have just started.
      if (was === undefined) {
        if (ledger.size === 0) holder = dependencies.signedInAs();
        ledger.set(agentId, next);
        return;
      }
      // The reads overlap, so a list can land after a newer read moved the
      // ledger on: one describing a turn the agent has left behind, or no
      // turn yet, says nothing newer and is let go whole.
      if (next.turnId === null ? was.turnId !== null : was.pastTurns.has(next.turnId)) return;
      if (was.turnId === next.turnId) {
        // A turn that ended stays ended, so an end is never a second turn's,
        // and running again under the ended turn's id is a late read or a
        // message awaiting the next turn, which its own answer says. A read
        // saying the ended turn was quiet still takes back what its end left.
        if (!stillWriting(was.status)) {
          if (
            next.quietTurn === true &&
            was.quietTurn !== true &&
            was.status === CODING_AGENT_STATUS.COMPLETED
          ) {
            ledger.set(agentId, { ...was, quietTurn: true });
            seen(agentId);
          }
          return;
        }
        ledger.set(agentId, { ...next, pastTurns: was.pastTurns });
        if (stillWriting(next.status)) return;
        ended(agentId, next);
        return;
      }
      // A new turn: the one before it is left behind, and its own end is the next dot.
      const pastTurns = new Set(was.pastTurns);
      if (was.turnId !== null) pastTurns.add(was.turnId);
      ledger.set(agentId, { ...next, pastTurns });
      if (!stillWriting(next.status)) ended(agentId, next);
    }

    /** Lets go of every agent `keep` refuses, their dots with them, as a plan or an agent deleted or an account left has no tab to clear one. */
    function forget(keep: (agent: HeldAgent, agentId: string) => boolean): void {
      let dotted = false;
      for (const [agentId, agent] of ledger) {
        if (keep(agent, agentId)) continue;
        ledger.delete(agentId);
        if (unseen.delete(agentId)) dotted = true;
      }
      if (dotted) publishUnseen();
    }

    function seen(agentId: string | null): void {
      if (agentId === null || !unseen.delete(agentId)) return;
      publishUnseen();
    }

    /** The agent as the ledger holds it, on a plan or with none. */
    function heldOf(
      agent: Pick<CodingAgentSummary, "planId" | "status" | "turnId" | "quietTurn">,
    ): HeldAgent {
      return {
        taskId: agent.planId,
        status: agent.status,
        turnId: agent.turnId,
        quietTurn: agent.quietTurn,
        pastTurns: new Set(),
      };
    }

    /**
     * Whether the ledger holds the agent: one on a plan as every plan read
     * names it, and one with no plan only where the account started it.
     * Note that a teammate's is left to its starter, because it asks its
     * starter, whose key it runs on, and the plan list carries every
     * member's, as an act on a teammate's agent's page answers it.
     */
    function heldHere(agent: Pick<CodingAgentSummary, "planId" | "startedBy">): boolean {
      const accountId = dependencies.accountId();
      return (
        agent.planId !== null || accountId === undefined || agent.startedBy?.userId === accountId
      );
    }

    const notices: AgentNotices = {
      observeAgents: (agents) => {
        for (const agent of agents) {
          if (!heldHere(agent)) continue;
          observe(agent.id, heldOf(agent));
        }
      },
      observeTaskless: (agents) => {
        for (const agent of agents) {
          if (!heldHere(agent)) continue;
          observe(agent.id, heldOf(agent));
        }
      },
      observeMessaged: (agent) => {
        if (!heldHere(agent)) return;
        observe(agent.id, heldOf(agent));
      },
      observeStatus: (agentId, status) => {
        const held = ledger.get(agentId);
        // The page's answer says nothing of quiet, so a quiet mark read while the turn ran is not taken as its end's.
        if (held !== undefined) observe(agentId, { ...held, status, quietTurn: undefined });
      },
      observeTaskGone: (taskId) => forget((agent) => agent.taskId !== taskId),
      observeFollowed: (agents, taskIds) => {
        const held = new Set(taskIds);
        // The list names every agent on its plans but the archived, so one it named and no longer
        // does takes its dot with it. One only a Start answered is kept through a push or two that
        // leave it out, since a push of the plans may carry agents from before that Start, and let go
        // after that, as one archived before the list ever named it.
        const named = new Set(agents.map((agent) => agent.id));
        forget((agent, agentId) => {
          if (agent.taskId === null) return true;
          if (!held.has(agent.taskId)) return false;
          if (named.has(agentId)) return true;
          if (followedAgents.has(agentId)) return false;
          const pushes = (unnamedPushes.get(agentId) ?? 0) + 1;
          unnamedPushes.set(agentId, pushes);
          return pushes <= UNNAMED_PUSHES_KEPT;
        });
        for (const agentId of unnamedPushes.keys()) {
          if (named.has(agentId) || !ledger.has(agentId)) unnamedPushes.delete(agentId);
        }
        followedAgents = named;
        notices.observeAgents(agents);
      },
      shown: (agentId) => {
        shownAgent = agentId;
        seen(agentId);
      },
      seen,
      recount: () => {
        if (waiting !== undefined) doors.badge(countedOf(waiting.answer));
      },
    };

    // Each account's inbox followed in turn, the follow for the last one
    // ended as the next is signed in, so nothing of one is told for another.
    yield* Effect.forkScoped(
      Stream.runDrain(
        Stream.switchMap(Stream.changes(dependencies.accounts), (reader) =>
          Stream.fromEffect(waitingOf(reader)),
        ),
      ),
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
    // that left is dotted for whoever signs in next, and an answer still on
    // its way lands as a first sighting, which dots nothing.
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
