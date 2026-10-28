import { type CodingAgentInboxScope, INBOX_SCOPE_KIND } from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import type { AppInboxTaskHolding, AppInboxTasklessItem } from "@luke/host/app-state";
import { useMemo } from "react";
import {
  agentGroups,
  type InboxGroup,
  type TasklessInboxAgent,
  taskHolder,
} from "./inbox-model.js";
import { useSettledReads } from "./inbox-settling.js";
import { useFollowedInboxes, windowInboxFollower } from "./use-followed-inboxes.js";

/**
 * use-holder-inbox-items.ts -- every holder's inbox items for the window's Inbox, each task or agent with no task followed while it is listed and pushed as it changes.
 *
 * The window's Inbox lists the items of every holder of one, settled as
 * well as waiting, and main's read of the account carries only what waits,
 * in brief. So each holder handed here, a task or an agent with no task, is
 * followed whole (`use-followed-inboxes.ts`), and its items are pushed to
 * the window as they change rather than read again. The holder whose item
 * is chosen is followed by its own control besides (`use-task-inbox.ts`),
 * which answers and is drawn in this one's place, and the window's own
 * answers stand over every holder's push until it holds them
 * (`inbox-settling.ts`), so a stale push never brings an answered item
 * back. A holder that could not be read leaves its items as they were last
 * pushed, or none, and says so, with Try again; one no longer handed here
 * keeps its items as last pushed.
 */

type ScopeKind = CodingAgentInboxScope["kind"];

/** One holder of inbox items as the Inbox follows it: a task or an agent with no task, by its id, and when main says the latest of its items changed. */
export interface InboxHolding {
  readonly kind: ScopeKind;
  readonly id: string;
  readonly updatedAt: number;
}

/** One value for each kind of holder, a task's and an agent's apart, since each is keyed by its own id. */
export type ByHolderKind<Value> = { readonly [Kind in ScopeKind]: Value };

/** What the window's Inbox lists from. */
export interface HolderInboxItems {
  /** Each holder's items as last pushed, the window's own answers laid over them, by kind and then by id; a holder not yet pushed is absent. */
  readonly items: ByHolderKind<ReadonlyMap<string, readonly InboxItem[]>>;
  /** Whether a holder handed here could not be read, so the list offers to try again. */
  readonly failed: boolean;
  /** Whether a holder handed here has not been pushed as main says it now stands, and was not refused: its items are on their way. */
  readonly pending: boolean;
  /** The holders pushed as main says they now stand, or pushed and handed here no more, which stand for them whole, so an item they do not hold is not theirs. */
  readonly current: ByHolderKind<ReadonlySet<string>>;
  readonly onRetry: () => void;
}

/** No holder at all, for a surface that follows nothing until it is asked. */
export const NO_HOLDINGS: readonly InboxHolding[] = [];

/** Each task main lists as holding items, as a holding to follow. */
export function taskHoldings(holdings: readonly AppInboxTaskHolding[]): readonly InboxHolding[] {
  return holdings.map(({ taskId, updatedAt }) => ({
    kind: INBOX_SCOPE_KIND.PLAN,
    id: taskId,
    updatedAt,
  }));
}

/**
 * Each agent with no task main lists an item of, once, as a holding to
 * follow, changed when the latest of its items listed did. Note that main
 * lists an agent's open items alone, so an agent whose items are all
 * settled is not among them.
 */
export function agentHoldings(waiting: readonly AppInboxTasklessItem[]): readonly InboxHolding[] {
  const latest = new Map<string, number>();
  for (const { agentId, updatedAt } of waiting) {
    latest.set(agentId, Math.max(latest.get(agentId) ?? Number.NEGATIVE_INFINITY, updatedAt));
  }
  return [...latest].map(([id, updatedAt]) => ({ kind: INBOX_SCOPE_KIND.AGENT, id, updatedAt }));
}

/**
 * Every holder as the Inbox groups it, with its items as `read` holds them:
 * each task main says holds items that the listed workspace's list holds,
 * so one not yet read, or another workspace's, is listed nowhere, and each
 * agent with no task of the listed workspace (`agentGroups`). Note that a
 * task's status never leaves it out: a task done or canceled is listed,
 * its items with it.
 */
export function inboxGroups(
  read: ByHolderKind<ReadonlyMap<string, readonly InboxItem[]>>,
  holders: {
    readonly tasks: readonly AppInboxTaskHolding[];
    readonly listed: readonly TaskSummary[];
    readonly agents: readonly TasklessInboxAgent[];
    readonly workspaceId: string | undefined;
  },
): readonly InboxGroup[] {
  const ofTasks = holders.tasks.flatMap(({ taskId }) => {
    const task = holders.listed.find((each) => each.id === taskId);
    if (task === undefined) return [];
    return [{ holder: taskHolder(task), items: read[INBOX_SCOPE_KIND.PLAN].get(taskId) ?? [] }];
  });
  return [
    ...ofTasks,
    ...agentGroups(holders.agents, read[INBOX_SCOPE_KIND.AGENT], holders.workspaceId),
  ];
}

/** When the latest of the items changed; nothing for none. */
function newest(items: readonly InboxItem[]): number {
  return items.reduce((latest, item) => Math.max(latest, item.updatedAt), Number.NEGATIVE_INFINITY);
}

/** The ids of the holders of one kind. */
function idsOf(holdings: readonly InboxHolding[], kind: ScopeKind): readonly string[] {
  return holdings.flatMap((holding) => (holding.kind === kind ? [holding.id] : []));
}

/**
 * The holders of one kind pushed as main says they now stand, or pushed and
 * handed here no more. Note that a holder main says changed later than
 * anything pushed of it is not current yet, because its push may land a
 * moment after main's own word of the change.
 */
function currentOf(
  pushed: ReadonlyMap<string, readonly InboxItem[]>,
  holdings: readonly InboxHolding[],
  kind: ScopeKind,
): ReadonlySet<string> {
  return new Set(
    [...pushed].flatMap(([id, held]) => {
      const holding = holdings.find((each) => each.kind === kind && each.id === id);
      return holding === undefined || newest(held) >= holding.updatedAt ? [id] : [];
    }),
  );
}

export function useHolderInboxItems(holdings: readonly InboxHolding[]): HolderInboxItems {
  const taskIds = useMemo(() => idsOf(holdings, INBOX_SCOPE_KIND.PLAN), [holdings]);
  const agentIds = useMemo(() => idsOf(holdings, INBOX_SCOPE_KIND.AGENT), [holdings]);
  const tasks = useFollowedInboxes(INBOX_SCOPE_KIND.PLAN, taskIds, windowInboxFollower);
  const agents = useFollowedInboxes(INBOX_SCOPE_KIND.AGENT, agentIds, windowInboxFollower);
  const current = useMemo(
    () => ({
      [INBOX_SCOPE_KIND.PLAN]: currentOf(tasks.items, holdings, INBOX_SCOPE_KIND.PLAN),
      [INBOX_SCOPE_KIND.AGENT]: currentOf(agents.items, holdings, INBOX_SCOPE_KIND.AGENT),
    }),
    [tasks.items, agents.items, holdings],
  );
  // Note that the window's own answers and messages stand over a push until it holds them, so a stale push never brings an answered item back.
  const taskItems = useSettledReads(tasks.items);
  const agentItems = useSettledReads(agents.items);
  const items = useMemo(
    () => ({ [INBOX_SCOPE_KIND.PLAN]: taskItems, [INBOX_SCOPE_KIND.AGENT]: agentItems }),
    [taskItems, agentItems],
  );
  const failedOf = (holding: InboxHolding) =>
    (holding.kind === INBOX_SCOPE_KIND.PLAN ? tasks : agents).failed.has(holding.id);
  const { onRetry: retryTasks } = tasks;
  const { onRetry: retryAgents } = agents;
  return {
    items,
    failed: holdings.some(failedOf),
    pending: holdings.some(
      (holding) => !current[holding.kind].has(holding.id) && !failedOf(holding),
    ),
    current,
    onRetry: () => {
      retryTasks();
      retryAgents();
    },
  };
}
