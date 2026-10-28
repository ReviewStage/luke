import { type CodingAgentInboxScope, INBOX_SCOPE_KIND } from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import type { AppInboxTaskHolding, AppInboxTasklessItem } from "@luke/host/app-state";
import { useMemo } from "react";
import { useFedInboxes } from "./held-inboxes.js";
import {
  agentGroups,
  type InboxGroup,
  type TasklessInboxAgent,
  taskHolder,
} from "./inbox-model.js";
import { useFollowedInboxes, windowInboxFollower } from "./use-followed-inboxes.js";

/**
 * use-holder-inbox-items.ts -- every holder's inbox items for the window's Inbox, each task or agent with no task followed while it is listed and pushed as it changes.
 *
 * The window's Inbox lists the items of every holder of one, settled as
 * well as waiting, and main's read of the account carries only what waits,
 * in brief. So a task the account's feed of whole items holds whole is
 * drawn from it (`held-inboxes.tsx`), and each other holder handed here, a
 * task or an agent with no task, is followed whole
 * (`use-followed-inboxes.ts`), its items pushed to the window as they
 * change rather than read again. The holder whose item
 * is chosen is followed by its own control besides (`use-task-inbox.ts`),
 * which answers and is drawn in this one's place; the host draws the
 * window's own answers and marks into every push the moment they are
 * asked (`@luke/host`'s `inbox-collections.ts`). A holder that could not be read leaves its items as they were last
 * pushed, or none, and says so, with Try again; one no longer handed here
 * keeps its items as last pushed.
 */

type ScopeKind = CodingAgentInboxScope["kind"];

/** One holder of inbox items as the Inbox follows it: a task or an agent with no task, by its id, and when main says the latest of its items changed. */
export interface InboxHolding {
  readonly kind: ScopeKind;
  readonly id: string;
  readonly updatedAt: number;
  /**
   * The items main lists of it, each with when it changed, where main lists
   * only some of them: an agent's open items, which leave out its settled
   * ones. A push is current only once it holds each as new as main says it
   * is, since a newer settled item says nothing of them. Absent where
   * `updatedAt` is of every item, as a task's is.
   */
  readonly listed?: readonly Pick<InboxItem, "id" | "updatedAt">[];
  /** How many items main counts of it, where it counts them all, as a task's; absent where it does not, as an agent's. */
  readonly count?: number;
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
  return holdings.map(({ taskId, updatedAt, items }) => ({
    kind: INBOX_SCOPE_KIND.PLAN,
    id: taskId,
    updatedAt,
    count: items,
  }));
}

/**
 * Each agent with no task main lists an item of, once, as a holding to
 * follow, changed when the latest of its items listed did, and those items
 * (`listed`). Note that main lists an agent's open items alone, so an agent
 * whose items are all settled is not among them.
 */
export function agentHoldings(waiting: readonly AppInboxTasklessItem[]): readonly InboxHolding[] {
  const listed = new Map<string, Pick<InboxItem, "id" | "updatedAt">[]>();
  for (const { agentId, id, updatedAt } of waiting) {
    listed.set(agentId, [...(listed.get(agentId) ?? []), { id, updatedAt }]);
  }
  return [...listed].map(([id, items]) => ({
    kind: INBOX_SCOPE_KIND.AGENT,
    id,
    updatedAt: Math.max(...items.map((item) => item.updatedAt)),
    listed: items,
  }));
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
 * The tasks to follow on their own: each the account's feed holds in part,
 * its settled items older than the feed's bound, or not at all, or every
 * task while the feed is not answering. Note that a task the feed holds as
 * many items of as main counts is drawn from the feed alone.
 */
function taskIdsToFollow(
  holdings: readonly InboxHolding[],
  fed: ReadonlyMap<string, readonly InboxItem[]> | undefined,
): readonly string[] {
  return holdings.flatMap((holding) => {
    if (holding.kind !== INBOX_SCOPE_KIND.PLAN) return [];
    const whole =
      fed !== undefined &&
      holding.count !== undefined &&
      (fed.get(holding.id)?.length ?? 0) >= holding.count;
    return whole ? [] : [holding.id];
  });
}

/** Whether a push holds a holder as main says it now stands: each item it lists as new as main says, or, where it lists none, something as new as its latest. */
function holdsAsMainSays(held: readonly InboxItem[], holding: InboxHolding): boolean {
  if (holding.listed === undefined) return newest(held) >= holding.updatedAt;
  return holding.listed.every((listed) =>
    held.some((each) => each.id === listed.id && each.updatedAt >= listed.updatedAt),
  );
}

/**
 * The holders of one kind pushed as main says they now stand, or pushed and
 * handed here no more. Note that a holder main says changed later than its
 * push is not current yet, because its push may land a moment after main's
 * own word of the change.
 */
function currentOf(
  pushed: ReadonlyMap<string, readonly InboxItem[]>,
  holdings: readonly InboxHolding[],
  kind: ScopeKind,
): ReadonlySet<string> {
  return new Set(
    [...pushed].flatMap(([id, held]) => {
      const holding = holdings.find((each) => each.kind === kind && each.id === id);
      return holding === undefined || holdsAsMainSays(held, holding) ? [id] : [];
    }),
  );
}

export function useHolderInboxItems(holdings: readonly InboxHolding[]): HolderInboxItems {
  const fed = useFedInboxes(INBOX_SCOPE_KIND.PLAN);
  const taskIds = useMemo(() => taskIdsToFollow(holdings, fed), [holdings, fed]);
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
  const items = useMemo(
    () => ({ [INBOX_SCOPE_KIND.PLAN]: tasks.items, [INBOX_SCOPE_KIND.AGENT]: agents.items }),
    [tasks.items, agents.items],
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
