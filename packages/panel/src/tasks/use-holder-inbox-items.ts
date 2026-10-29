import { type AgentInboxScope, INBOX_SCOPE_KIND } from "@luke/features/agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import type { AppInboxAgentHolding, AppInboxTaskHolding } from "@luke/host/app-state";
import { useMemo } from "react";
import { useFedInboxes, useFeedFailed, useRetryFeed, useUnderWindowRoot } from "./held-inboxes.js";
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
 * in brief. So under a window's root every holder, a task or an agent with
 * no task, is drawn from the account's feed of whole items the root holds
 * (`held-inboxes.tsx`), which stands for every holder whole: one it holds
 * nothing of holds nothing now. A surface drawn outside a window's root,
 * as a test or the catalog draws one, follows each holder handed here on
 * its own instead (`use-followed-inboxes.ts`). The holder whose item is
 * chosen is followed by its own control besides (`use-task-inbox.ts`),
 * which reads its settled items past the feed's bound and is drawn in this
 * one's place.
 */

type ScopeKind = AgentInboxScope["kind"];

/** One holder of inbox items as the Inbox follows it: a task or an agent with no task, by its id, and when main says the latest of its items, settled ones included, changed. */
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
  /** The holders current only because the account's feed holds nothing of them, whose own read may still hold an item a link names. */
  readonly feedHoldsNothing: ByHolderKind<ReadonlySet<string>>;
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

/** Each agent with no task main lists as holding items, an agent whose items are all settled among them, as a holding to follow, as a task's is. */
export function agentHoldings(holdings: readonly AppInboxAgentHolding[]): readonly InboxHolding[] {
  return holdings.map(({ agentId, updatedAt }) => ({
    kind: INBOX_SCOPE_KIND.AGENT,
    id: agentId,
    updatedAt,
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

/** No holder followed on its own. */
const NO_IDS: readonly string[] = [];

/** No holder held, as the feed stands before it first answers. */
const NOTHING_HELD: ReadonlyMap<string, readonly InboxItem[]> = new Map();

/**
 * The holders of one kind as the account's feed stands: each it holds with
 * its items, and each handed here that it holds nothing of with none, since
 * the feed stands for every holder whole; nothing until it first answers.
 */
function feedStanding(
  fed: ReadonlyMap<string, readonly InboxItem[]> | undefined,
  holdings: readonly InboxHolding[],
  kind: ScopeKind,
): ReadonlyMap<string, readonly InboxItem[]> {
  if (fed === undefined) return NOTHING_HELD;
  const standing = new Map(fed);
  for (const holding of holdings) {
    if (holding.kind === kind && !standing.has(holding.id)) standing.set(holding.id, []);
  }
  return standing;
}

/** The ids of the holders of one kind. */
function idsOf(holdings: readonly InboxHolding[], kind: ScopeKind): readonly string[] {
  return holdings.flatMap((holding) => (holding.kind === kind ? [holding.id] : []));
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
  /** The account's feed, where `pushed` stands as it does: a holder it holds nothing of is current. */
  fed?: ReadonlyMap<string, readonly InboxItem[]>,
): ReadonlySet<string> {
  return new Set(
    [...pushed].flatMap(([id, held]) => {
      const holding = holdings.find((each) => each.kind === kind && each.id === id);
      const absentFromFeed = fed !== undefined && !fed.has(id);
      return holding === undefined || absentFromFeed || newest(held) >= holding.updatedAt
        ? [id]
        : [];
    }),
  );
}

export function useHolderInboxItems(holdings: readonly InboxHolding[]): HolderInboxItems {
  const fromFeed = useUnderWindowRoot();
  const fedTasks = useFedInboxes(INBOX_SCOPE_KIND.PLAN);
  const fedAgents = useFedInboxes(INBOX_SCOPE_KIND.AGENT);
  const feedFailed = useFeedFailed();
  const retryFeed = useRetryFeed();
  const taskIds = useMemo(
    () => (fromFeed ? NO_IDS : idsOf(holdings, INBOX_SCOPE_KIND.PLAN)),
    [fromFeed, holdings],
  );
  const agentIds = useMemo(
    () => (fromFeed ? NO_IDS : idsOf(holdings, INBOX_SCOPE_KIND.AGENT)),
    [fromFeed, holdings],
  );
  const tasks = useFollowedInboxes(INBOX_SCOPE_KIND.PLAN, taskIds, windowInboxFollower);
  const agents = useFollowedInboxes(INBOX_SCOPE_KIND.AGENT, agentIds, windowInboxFollower);
  const items = useMemo(
    () => ({
      [INBOX_SCOPE_KIND.PLAN]: fromFeed
        ? feedStanding(fedTasks, holdings, INBOX_SCOPE_KIND.PLAN)
        : tasks.items,
      [INBOX_SCOPE_KIND.AGENT]: fromFeed
        ? feedStanding(fedAgents, holdings, INBOX_SCOPE_KIND.AGENT)
        : agents.items,
    }),
    [fromFeed, fedTasks, fedAgents, holdings, tasks.items, agents.items],
  );
  // Note that a holder the feed holds nothing of is current with none, since the feed stands for every holder whole.
  const current = useMemo(() => {
    const ofKind = (kind: ScopeKind, fed: ReadonlyMap<string, readonly InboxItem[]> | undefined) =>
      currentOf(items[kind], holdings, kind, fromFeed ? (fed ?? NOTHING_HELD) : undefined);
    return {
      [INBOX_SCOPE_KIND.PLAN]: ofKind(INBOX_SCOPE_KIND.PLAN, fedTasks),
      [INBOX_SCOPE_KIND.AGENT]: ofKind(INBOX_SCOPE_KIND.AGENT, fedAgents),
    };
  }, [items, holdings, fromFeed, fedTasks, fedAgents]);
  const feedHoldsNothing = useMemo(() => {
    const ofKind = (kind: ScopeKind, fed: ReadonlyMap<string, readonly InboxItem[]> | undefined) =>
      new Set(
        fromFeed && fed !== undefined
          ? holdings.flatMap((holding) =>
              holding.kind === kind && !fed.has(holding.id) ? [holding.id] : [],
            )
          : [],
      );
    return {
      [INBOX_SCOPE_KIND.PLAN]: ofKind(INBOX_SCOPE_KIND.PLAN, fedTasks),
      [INBOX_SCOPE_KIND.AGENT]: ofKind(INBOX_SCOPE_KIND.AGENT, fedAgents),
    };
  }, [fromFeed, fedTasks, fedAgents, holdings]);
  const failedOf = (holding: InboxHolding) =>
    fromFeed
      ? feedFailed
      : (holding.kind === INBOX_SCOPE_KIND.PLAN ? tasks : agents).failed.has(holding.id);
  const { onRetry: retryTasks } = tasks;
  const { onRetry: retryAgents } = agents;
  return {
    items,
    failed: holdings.some(failedOf),
    pending: holdings.some(
      (holding) => !current[holding.kind].has(holding.id) && !failedOf(holding),
    ),
    current,
    feedHoldsNothing,
    onRetry: () => {
      if (fromFeed) retryFeed();
      retryTasks();
      retryAgents();
    },
  };
}
