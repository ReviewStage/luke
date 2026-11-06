import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import type { TasklessAgent } from "@repo/features/agent-wire";
import type { InboxItem } from "@repo/features/inbox-wire";
import type {
  AppInboxItems,
  AppInboxSlice,
  AppInboxTasklessItem,
  AppInboxWaitingItem,
} from "@repo/host/app-state";
import { HoverCard, HoverCardHead, HoverCardNote, Time, useMinute } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { inboxItemsQuery } from "../live-reads.js";
import { appStateQuery, selectInbox, selectTasks } from "../use-app-state.js";
import { InboxItemCard, inboxItemGlyph } from "./inbox-item-parts.js";
import {
  agentHolder,
  type InboxListed,
  inboxAgentOf,
  NEEDS_YOU,
  type TasklessInboxAgent,
  taskHolder,
  waitsOnReader,
} from "./inbox-model.js";
import { useMentionedPlace } from "./mentioned-place.js";

type InboxItemPlace =
  | { readonly planId: string; readonly itemId: string }
  | { readonly agentId: string; readonly itemId: string }
  | { readonly itemId: string };

function tasklessAgentOf(
  agentId: string,
  waiting: readonly TasklessInboxAgent[],
  agents: readonly TasklessAgent[],
): TasklessInboxAgent | undefined {
  const brief = waiting.find((each) => each.agentId === agentId);
  if (brief !== undefined) return brief;
  const agent = agents.find((each) => each.id === agentId);
  return agent === undefined ? undefined : inboxAgentOf(agent);
}

function waitingTaskOf(inbox: AppInboxSlice | undefined, itemId: string): string | undefined {
  return inbox?.waiting.find((task) => task.items.some((each) => each.id === itemId))?.taskId;
}

interface FedItem {
  readonly item: InboxItem;
  readonly planId: string | undefined;
}

function fedItemById(fed: AppInboxItems, itemId: string): FedItem | undefined {
  for (const items of Object.values(fed[INBOX_SCOPE_KIND.AGENT])) {
    const item = items.find((each) => each.id === itemId);
    if (item !== undefined) return { item, planId: undefined };
  }
  for (const [planId, items] of Object.entries(fed[INBOX_SCOPE_KIND.PLAN])) {
    const item = items.find((each) => each.id === itemId);
    if (item !== undefined) return { item, planId };
  }
  return undefined;
}

function fedItemOf(fed: AppInboxItems | undefined, place: InboxItemPlace): FedItem | undefined {
  if (fed === undefined) return undefined;
  const byId = (item: InboxItem) => item.id === place.itemId;
  if ("planId" in place) {
    const item = fed[INBOX_SCOPE_KIND.PLAN][place.planId]?.find(byId);
    return item === undefined ? undefined : { item, planId: place.planId };
  }
  if (!("agentId" in place)) return fedItemById(fed, place.itemId);
  const own = fed[INBOX_SCOPE_KIND.AGENT][place.agentId]?.find(byId);
  if (own !== undefined) return { item: own, planId: undefined };
  for (const [planId, items] of Object.entries(fed[INBOX_SCOPE_KIND.PLAN])) {
    const item = items.find((each) => each.agentId === place.agentId && byId(each));
    if (item !== undefined) return { item, planId };
  }
  return undefined;
}

function useLinkedItem(place: InboxItemPlace): InboxListed | undefined {
  const planId = "planId" in place ? place.planId : undefined;
  const namedAgent = "agentId" in place ? place.agentId : undefined;
  const { itemId } = place;
  const fed = useQuery(inboxItemsQuery()).data;
  const tasks = useQuery({ ...appStateQuery, select: selectTasks }).data;
  const inbox = useQuery({ ...appStateQuery, select: selectInbox }).data;
  const found = useMemo(() => {
    if (planId !== undefined) return fedItemOf(fed, { planId, itemId });
    return fedItemOf(fed, namedAgent === undefined ? { itemId } : { agentId: namedAgent, itemId });
  }, [fed, planId, namedAgent, itemId]);
  const item = found?.item;
  const agentId = namedAgent ?? item?.agentId;
  const linkedTask =
    planId ?? found?.planId ?? (agentId === undefined ? undefined : waitingTaskOf(inbox, itemId));
  const taskless = useMemo(
    () =>
      agentId === undefined || linkedTask !== undefined
        ? undefined
        : tasklessAgentOf(agentId, inbox?.taskless ?? [], tasks?.tasklessAgents ?? []),
    [agentId, linkedTask, inbox, tasks],
  );
  const taskId = linkedTask;
  return useMemo(() => {
    if (item === undefined) return undefined;
    if (taskId !== undefined) {
      const task = tasks?.tasks.find((each) => each.id === taskId);
      return task === undefined ? undefined : { holder: taskHolder(task), item };
    }
    if (agentId === undefined || taskless === undefined) return undefined;
    return { holder: agentHolder(taskless), item };
  }, [item, taskId, agentId, taskless, tasks]);
}

function useWaitingBrief(itemId: string): WaitingBrief | undefined {
  const inbox = useQuery({ ...appStateQuery, select: selectInbox }).data;
  return [...(inbox?.waiting ?? []).flatMap((task) => task.items), ...(inbox?.taskless ?? [])].find(
    (each) => each.id === itemId,
  );
}

type WaitingBrief = AppInboxWaitingItem &
  Partial<Pick<AppInboxTasklessItem, "startedBy" | "waitsOn">>;

function waitingWords(item: WaitingBrief, readerId: string | undefined): string {
  return waitsOnReader(item, readerId) ? NEEDS_YOU.LABEL : "Waiting";
}

function WaitingItemCard({
  item,
  now,
  readerId,
}: {
  item: WaitingBrief;
  now: number;
  readerId: string | undefined;
}): React.JSX.Element {
  return (
    <HoverCard data-inbox-item-card="">
      <HoverCardHead
        glyph={<GLYPH.THREAD />}
        name={item.title}
        corner={<Time at={item.postedAt} now={now} hint={false} />}
      />
      <HoverCardNote>{waitingWords(item, readerId)}</HoverCardNote>
    </HoverCard>
  );
}

export function useInboxItemTitle(place: InboxItemPlace): string | undefined {
  const listed = useLinkedItem(place);
  const waiting = useWaitingBrief(place.itemId);
  return listed?.item.title ?? waiting?.title;
}

export function InboxItemChipGlyph({ place }: { place: InboxItemPlace }): ReactNode {
  const listed = useLinkedItem(place);
  return listed === undefined ? <GLYPH.THREAD /> : inboxItemGlyph(listed.item);
}

export function InboxItemChipCard({
  place,
  fallback,
}: {
  place: InboxItemPlace;
  fallback: ReactNode;
}): ReactNode {
  const listed = useLinkedItem(place);
  const { models, me } = useMentionedPlace();
  const now = useMinute();
  const waiting = useWaitingBrief(place.itemId);
  if (listed === undefined) {
    return waiting === undefined ? (
      fallback
    ) : (
      <WaitingItemCard item={waiting} now={now} readerId={me} />
    );
  }
  return <InboxItemCard listed={listed} now={now} models={models} readerId={me} />;
}
