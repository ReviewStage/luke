import { type AgentInboxScope, INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import type { InboxItem } from "@repo/features/inbox-wire";
import type { TaskSummary } from "@repo/features/task-wire";
import type {
  AppInboxAgentHolding,
  AppInboxItems,
  AppInboxTaskHolding,
} from "@repo/host/app-state";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { inboxItemsQuery, inboxItemsRetryMutation } from "../live-reads.js";
import {
  agentGroups,
  type InboxGroup,
  inboxGroup,
  NO_ITEMS,
  type TasklessInboxAgent,
  taskHolder,
} from "./inbox-model.js";

type ScopeKind = AgentInboxScope["kind"];

export interface InboxHolding {
  readonly kind: ScopeKind;
  readonly id: string;
  readonly updatedAt: number;
}

export type ByHolderKind<Value> = { readonly [Kind in ScopeKind]: Value };

export interface HolderInboxItems {
  readonly items: ByHolderKind<ReadonlyMap<string, readonly InboxItem[]>>;
  readonly failed: boolean;
  readonly pending: boolean;
  readonly current: ByHolderKind<ReadonlySet<string>>;
  readonly feedHoldsNothing: ByHolderKind<ReadonlySet<string>>;
  readonly onRetry: () => void;
}

export const NO_HOLDINGS: readonly InboxHolding[] = [];

export function taskHoldings(holdings: readonly AppInboxTaskHolding[]): readonly InboxHolding[] {
  return holdings.map(({ taskId, updatedAt }) => ({
    kind: INBOX_SCOPE_KIND.PLAN,
    id: taskId,
    updatedAt,
  }));
}

export function agentHoldings(holdings: readonly AppInboxAgentHolding[]): readonly InboxHolding[] {
  return holdings.map(({ agentId, updatedAt }) => ({
    kind: INBOX_SCOPE_KIND.AGENT,
    id: agentId,
    updatedAt,
  }));
}

export function inboxGroups(
  read: ByHolderKind<ReadonlyMap<string, readonly InboxItem[]>>,
  holders: {
    readonly tasks: readonly AppInboxTaskHolding[];
    readonly listed: readonly TaskSummary[];
    readonly agents: readonly TasklessInboxAgent[];
    readonly workspaceId: string | undefined;
  },
): readonly InboxGroup[] {
  const listed = new Map(holders.listed.map((task) => [task.id, task]));
  const ofTasks = holders.tasks.flatMap(({ taskId }) => {
    const task = listed.get(taskId);
    if (task === undefined) return [];
    return [inboxGroup(taskHolder(task), read[INBOX_SCOPE_KIND.PLAN].get(taskId) ?? NO_ITEMS)];
  });
  return [
    ...ofTasks,
    ...agentGroups(holders.agents, read[INBOX_SCOPE_KIND.AGENT], holders.workspaceId),
  ];
}

function newest(items: readonly InboxItem[]): number {
  return items.reduce((latest, item) => Math.max(latest, item.updatedAt), Number.NEGATIVE_INFINITY);
}

const NOTHING_HELD: ReadonlyMap<string, readonly InboxItem[]> = new Map();

type FedKind = AppInboxItems[ScopeKind] | undefined;

function feedStanding(
  fed: FedKind,
  holdings: readonly InboxHolding[],
  kind: ScopeKind,
): ReadonlyMap<string, readonly InboxItem[]> {
  if (fed === undefined) return NOTHING_HELD;
  const standing = new Map(Object.entries(fed));
  for (const holding of holdings) {
    if (holding.kind === kind && !standing.has(holding.id)) standing.set(holding.id, []);
  }
  return standing;
}

function currentOf(
  pushed: ReadonlyMap<string, readonly InboxItem[]>,
  holdings: readonly InboxHolding[],
  kind: ScopeKind,
  fed: FedKind,
): ReadonlySet<string> {
  const ofKind = new Map<string, InboxHolding>();
  for (const holding of holdings) {
    if (holding.kind === kind && !ofKind.has(holding.id)) ofKind.set(holding.id, holding);
  }
  return new Set(
    [...pushed].flatMap(([id, held]) => {
      const holding = ofKind.get(id);
      const absentFromFeed = fed !== undefined && !Object.hasOwn(fed, id);
      return holding === undefined || absentFromFeed || newest(held) >= holding.updatedAt
        ? [id]
        : [];
    }),
  );
}

function byKind<Value>(of: (kind: ScopeKind) => Value): ByHolderKind<Value> {
  return {
    [INBOX_SCOPE_KIND.PLAN]: of(INBOX_SCOPE_KIND.PLAN),
    [INBOX_SCOPE_KIND.AGENT]: of(INBOX_SCOPE_KIND.AGENT),
  };
}

export function useHolderInboxItems(holdings: readonly InboxHolding[]): HolderInboxItems {
  const feed = useQuery(inboxItemsQuery());
  const { mutate: retry } = useMutation(inboxItemsRetryMutation());
  const onRetry = useCallback(() => retry(), [retry]);
  const fed = feed.data;
  const read = useMemo(() => {
    const items = byKind((kind) => feedStanding(fed?.[kind], holdings, kind));
    const absent = (kind: ScopeKind, id: string) =>
      fed !== undefined && !Object.hasOwn(fed[kind], id);
    return {
      items,
      current: byKind((kind) => currentOf(items[kind], holdings, kind, fed?.[kind])),
      feedHoldsNothing: byKind(
        (kind) =>
          new Set(
            holdings.flatMap((each) =>
              each.kind === kind && absent(kind, each.id) ? [each.id] : [],
            ),
          ),
      ),
    };
  }, [fed, holdings]);
  const failed = holdings.length > 0 && feed.isError;
  return {
    ...read,
    failed,
    pending: !failed && holdings.some((holding) => !read.current[holding.kind].has(holding.id)),
    onRetry,
  };
}
