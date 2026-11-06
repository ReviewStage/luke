import type {
  AccountInboxAgent,
  AccountInboxAnswer,
  AccountInboxAutomation,
  AccountInboxEntry,
  AccountInboxTask,
  AccountTasklessEntry,
} from "@repo/features/account-inbox-wire";
import type { AgentAccountInboxAnswerView } from "@repo/features/agent-view";
import {
  AGENT_STATUS,
  type AgentStatus,
  type AgentSummary,
  type TasklessAgent,
} from "@repo/features/agent-wire";
import { Context, Effect, type Scope, Stream } from "effect";
import type { AppInboxSlice, AppInboxWaitingItem } from "./app-state.js";

const WRITING_STATUSES: ReadonlySet<AgentStatus> = new Set([
  AGENT_STATUS.STARTING,
  AGENT_STATUS.RUNNING,
]);

const UNNAMED_PUSHES_KEPT = 2;

export const NOTICE_KIND = {
  MAC_COMMAND_ASK: "mac-command-ask",
} as const;

type NoticeSubject = { readonly kind: typeof NOTICE_KIND.MAC_COMMAND_ASK; readonly askId: string };

export interface AgentNotice {
  subject: NoticeSubject;
  title: string;
  body: string;
  onClick: () => void;
}

export interface AgentNoticeDoorsSurface {
  post(notice: AgentNotice): void;
  badge(count: number): void;
}

export class AgentNoticeDoors extends Context.Service<AgentNoticeDoors, AgentNoticeDoorsSurface>()(
  "@repo/desktop/AgentNoticeDoors",
) {}

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
  onUnseenChanged: (unseen: readonly string[]) => void;
  onPanelFocusChanged: (listener: (focused: boolean) => void) => () => void;
  signedInAs: () => string | undefined;
  accountId: () => string | undefined;
  onAccountChanged: (listener: (signedInAs: string | undefined) => void) => () => void;
  followAccountInbox: () => Stream.Stream<AgentAccountInboxAnswerView>;
  accounts: Stream.Stream<string | undefined>;
  onInboxChanged: (inbox: AppInboxSlice) => void;
  report: (line: string) => void;
}

export interface AgentNotices {
  observeAgents(agents: readonly (AgentSummary | TasklessAgent)[]): void;
  observeStatus(agentId: string, status: AgentStatus): void;
  observeMessaged(agent: AgentSummary): void;
  observeTaskGone(taskId: string): void;
  observeFollowed(agents: readonly AgentSummary[], taskIds: readonly string[]): void;
  shown(agentId: string | null): void;
  seen(agentId: string): void;
}

interface HeldAgent {
  taskId: string | null;
  status: AgentStatus;
  turnId: string | null;
  pastTurns: ReadonlySet<string>;
}

function stillWriting(status: AgentStatus): boolean {
  return WRITING_STATUSES.has(status);
}

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

function asking(item: { readonly asking?: boolean }): boolean {
  return item.asking !== false;
}

function reminderOf(item: { readonly remindAt?: number | null }): {
  readonly remindAt?: number;
} {
  return item.remindAt === undefined || item.remindAt === null ? {} : { remindAt: item.remindAt };
}

function waitingTasks(items: readonly AccountInboxEntry[]): AppInboxSlice["waiting"] {
  const tasks = new Map<string, AppInboxWaitingItem[]>();
  for (const item of items) {
    const waiting = {
      id: item.id,
      agentId: item.agentId,
      title: item.title,
      postedAt: item.postedAt,
      ...(item.asking === undefined ? undefined : { asking: item.asking }),
      ...reminderOf(item),
    };
    const held = tasks.get(item.planId);
    if (held === undefined) tasks.set(item.planId, [waiting]);
    else held.push(waiting);
  }
  return [...tasks].map(([taskId, held]) => ({ taskId, items: held }));
}

function waitingTaskless(items: readonly AccountTasklessEntry[]): AppInboxSlice["taskless"] {
  return items.map((item) => ({
    id: item.id,
    agentId: item.agentId,
    title: item.title,
    postedAt: item.postedAt,
    updatedAt: item.updatedAt,
    agentTitle: item.agentTitle,
    agentModel: item.agentModel,
    automationId: item.automationId,
    automationName: item.automationName,
    repository: item.repository,
    ...(item.asking === undefined ? undefined : { asking: item.asking }),
    ...(item.startedBy === undefined ? undefined : { startedBy: item.startedBy }),
    ...(item.waitsOn === undefined ? undefined : { waitsOn: item.waitsOn }),
    ...(item.workspaceId === undefined ? undefined : { workspaceId: item.workspaceId }),
    ...reminderOf(item),
  }));
}

function agentsOfOpenItems(
  items: readonly AccountTasklessEntry[],
  waiting: readonly AccountTasklessEntry[],
): AppInboxSlice["agents"] {
  const toDo = new Set(waiting.filter(asking).map((item) => item.id));
  const held = new Map<string, AppInboxSlice["agents"][number]>();
  for (const item of items) {
    const was = held.get(item.agentId);
    held.set(item.agentId, {
      ...(was ?? {
        agentId: item.agentId,
        agentTitle: item.agentTitle,
        agentModel: item.agentModel,
        automationId: item.automationId,
        automationName: item.automationName,
        repository: item.repository,
        ...(item.workspaceId === undefined ? undefined : { workspaceId: item.workspaceId }),
        updatedAt: item.updatedAt,
      }),
      items: (was?.items ?? 0) + 1,
      toDo: (was?.toDo ?? 0) + (toDo.has(item.id) ? 1 : 0),
    });
  }
  return [...held.values()];
}

type InboxAnswered = Pick<
  AccountInboxAnswer,
  "items" | "plans" | "planless" | "automations" | "agents" | "failedRuns"
>;

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
        was.updatedAt === item.updatedAt &&
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

function sameAgents(
  one: readonly AccountInboxAgent[],
  other: readonly AccountInboxAgent[],
): boolean {
  return (
    one.length === other.length &&
    one.every((held, at) => {
      const was = other[at];
      return (
        was !== undefined &&
        was.agentId === held.agentId &&
        was.items === held.items &&
        was.toDo === held.toDo &&
        was.updatedAt === held.updatedAt &&
        was.agentTitle === held.agentTitle &&
        was.agentModel === held.agentModel &&
        was.automationId === held.automationId &&
        was.automationName === held.automationName &&
        was.repository === held.repository &&
        was.workspaceId === held.workspaceId
      );
    })
  );
}

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

export const createAgentNotices = Effect.fn("desktop/createAgentNotices")(function* (
  dependencies: AgentNoticesDependencies,
): Effect.fn.Return<AgentNotices, never, Scope.Scope | AgentNoticeDoors> {
  const { onUnseenChanged, report } = dependencies;
  const doors = guardedDoors(yield* AgentNoticeDoors, report);
  const ledger = new Map<string, HeldAgent>();
  const unseen = new Set<string>();
  let followedAgents = new Set<string>();
  const unnamedPushes = new Map<string, number>();
  let shownAgent: string | null = null;
  let focused = false;
  let holder: string | undefined;
  let waiting:
    | {
        readonly answer: AccountInboxAnswer;
        readonly listed: readonly AccountTasklessEntry[];
      }
    | undefined;

  function publishUnseen(): void {
    onUnseenChanged([...unseen]);
  }

  function ended(agentId: string, agent: HeldAgent): void {
    if (agent.status !== AGENT_STATUS.COMPLETED && agent.status !== AGENT_STATUS.FAILED) {
      return;
    }
    if (focused && shownAgent === agentId) return;
    unseen.add(agentId);
    publishUnseen();
  }

  function sliceOf(answer: InboxAnswered, listed: readonly AccountTasklessEntry[]): AppInboxSlice {
    return {
      waiting: waitingTasks(answer.items),
      tasks: answer.plans.map(({ planId: taskId, ...holding }) => ({
        ...holding,
        taskId,
      })),
      taskless: waitingTaskless(listed),
      automations: answer.automations ?? [],
      agents: answer.agents ?? agentsOfOpenItems(listed, answer.planless ?? []),
      failedRuns: answer.failedRuns ?? [],
    };
  }

  function countedOf(answer: InboxAnswered): number {
    return [...answer.items, ...(answer.planless ?? [])].filter(asking).length;
  }

  function publishWaiting(answer: InboxAnswered, listed: readonly AccountTasklessEntry[]): void {
    dependencies.onInboxChanged(sliceOf(answer, listed));
    doors.badge(countedOf(answer));
  }

  function observeWaiting(read: AccountInboxAnswer): void {
    const answer = waitingOnAccount(read, dependencies.accountId());
    const listed = read.planless ?? [];
    const was = waiting;
    if (
      was?.answer.cursor === answer.cursor &&
      was.answer.items.length === answer.items.length &&
      (was.answer.planless?.length ?? 0) === (answer.planless?.length ?? 0) &&
      was.listed.length === listed.length
    ) {
      if (
        sameTasks(was.answer.plans, answer.plans) &&
        sameAutomations(was.answer.automations ?? [], answer.automations ?? []) &&
        sameAgents(was.answer.agents ?? [], answer.agents ?? []) &&
        sameTaskless(was.listed, listed)
      ) {
        return;
      }
      const moved = {
        ...was.answer,
        plans: answer.plans,
        automations: answer.automations ?? [],
        agents: answer.agents ?? [],
        planless: answer.planless ?? [],
      };
      waiting = { ...was, answer: moved, listed };
      dependencies.onInboxChanged(sliceOf(moved, listed));
      return;
    }
    waiting = { answer, listed };
    publishWaiting(answer, listed);
  }

  const waitingOf = (reader: string | undefined): Effect.Effect<void> =>
    Effect.suspend(() => {
      waiting = undefined;
      publishWaiting({ items: [], plans: [] }, []);
      if (reader === undefined) return Effect.void;
      const look = (answer: AgentAccountInboxAnswerView) =>
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

  function observe(agentId: string, next: HeldAgent): void {
    const was = ledger.get(agentId);
    if (was === undefined) {
      if (ledger.size === 0) holder = dependencies.signedInAs();
      ledger.set(agentId, next);
      return;
    }
    if (next.turnId === null ? was.turnId !== null : was.pastTurns.has(next.turnId)) return;
    if (was.turnId === next.turnId) {
      if (!stillWriting(was.status)) return;
      ledger.set(agentId, { ...next, pastTurns: was.pastTurns });
      if (stillWriting(next.status)) return;
      ended(agentId, next);
      return;
    }
    const pastTurns = new Set(was.pastTurns);
    if (was.turnId !== null) pastTurns.add(was.turnId);
    ledger.set(agentId, { ...next, pastTurns });
    if (!stillWriting(next.status)) ended(agentId, next);
  }

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

  function heldOf(agent: Pick<AgentSummary, "planId" | "status" | "turnId">): HeldAgent {
    return {
      taskId: agent.planId,
      status: agent.status,
      turnId: agent.turnId,
      pastTurns: new Set(),
    };
  }

  const notices: AgentNotices = {
    observeAgents: (agents) => {
      for (const agent of agents) observe(agent.id, heldOf(agent));
    },
    observeMessaged: (agent) => observe(agent.id, heldOf(agent)),
    observeStatus: (agentId, status) => {
      const held = ledger.get(agentId);
      if (held !== undefined) observe(agentId, { ...held, status });
    },
    observeTaskGone: (taskId) => forget((agent) => agent.taskId !== taskId),
    observeFollowed: (agents, taskIds) => {
      const held = new Set(taskIds);
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
  };

  yield* Effect.forkScoped(
    Stream.runDrain(
      Stream.switchMap(Stream.changes(dependencies.accounts), (reader) =>
        Stream.fromEffect(waitingOf(reader)),
      ),
    ),
  );
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      dependencies.onPanelFocusChanged((next) => {
        focused = next;
        if (focused) seen(shownAgent);
      }),
    ),
    (unsubscribe) => Effect.sync(unsubscribe),
  );
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
});
