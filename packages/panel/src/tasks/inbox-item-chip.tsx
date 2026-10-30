import { INBOX_SCOPE_KIND } from "@luke/features/agent-view";
import type { TasklessAgent } from "@luke/features/agent-wire";
import type { InboxItem } from "@luke/features/inbox-wire";
import { LIVE_READ } from "@luke/features/live-wire";
import type {
  AppInboxItems,
  AppInboxSlice,
  AppInboxTasklessItem,
  AppInboxWaitingItem,
} from "@luke/host/app-state";
import { HoverCard, HoverCardHead, HoverCardNote, Time, useMinute } from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { type ReactNode, useMemo } from "react";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { useHostRead } from "../use-host-read.js";
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
import { useMentionedPlace } from "./mentioned-agent-card.js";

/**
 * inbox-item-chip.tsx -- a chip of an Inbox item: what it asks as its glyph and its Inbox row's own card, whatever the item's standing.
 *
 * A link to an item names the task, or the agent with no task, that holds it
 * and the item. Main's document holds only what waits, in brief, so the
 * item is drawn from the account's feed of every item (`use-host-read.ts`),
 * which the host holds for the session, as the Inbox draws it: the glyph
 * its row's second line leads with for what it asks (`inboxLineGlyph`),
 * never its agent's tile, which would draw it as a chip of the agent, and
 * the card its row hangs (`InboxItemCard`), waiting or answered. Until the
 * feed is read, where it holds nothing of the item, as of one settled past
 * its bound, or where the window holds neither the task nor the agent, the
 * chip draws the thread's glyph, and the card main's brief makes of an item
 * still waiting, else its own card.
 */

/** Where a link to an item says it stands: under a task, or under an agent with no task. */
type InboxItemPlace =
  | { readonly planId: string; readonly itemId: string }
  | { readonly agentId: string; readonly itemId: string };

/** The agent with no task an item stands under, as the Inbox groups it: the brief main holds of a waiting one, else the agent's own row among the window's agents (`inboxAgentOf`). */
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

/** The task main's brief says holds an item still waiting, by the item's id; none for one settled or unknown. */
function waitingTaskOf(inbox: AppInboxSlice | undefined, itemId: string): string | undefined {
  return inbox?.waiting.find((task) => task.items.some((each) => each.id === itemId))?.taskId;
}

/** The item a link names as the feed holds it, and the plan the feed holds it under where the link named its agent alone; none where the feed holds no such item. */
function fedItemOf(
  fed: AppInboxItems | undefined,
  place: InboxItemPlace,
): { readonly item: InboxItem; readonly planId: string | undefined } | undefined {
  if (fed === undefined) return undefined;
  const byId = (item: InboxItem) => item.id === place.itemId;
  if ("planId" in place) {
    const item = fed[INBOX_SCOPE_KIND.PLAN][place.planId]?.find(byId);
    return item === undefined ? undefined : { item, planId: place.planId };
  }
  const own = fed[INBOX_SCOPE_KIND.AGENT][place.agentId]?.find(byId);
  if (own !== undefined) return { item: own, planId: undefined };
  // Note that an agent on a plan posts under the plan, so its item is looked for among every plan's.
  for (const [planId, items] of Object.entries(fed[INBOX_SCOPE_KIND.PLAN])) {
    const item = items.find((each) => each.agentId === place.agentId && byId(each));
    if (item !== undefined) return { item, planId };
  }
  return undefined;
}

/**
 * The item a link names as the Inbox lists it, its holder named as its
 * group's header is; none until the feed is read, where it holds no such
 * item, or where the window holds neither its task nor its agent. Note that
 * a link under its agent leaves its task to be found: by the plan the feed
 * holds the item under, else by main's brief while it waits, else by the
 * window's agents with no task.
 */
function useLinkedItem(place: InboxItemPlace): InboxListed | undefined {
  const planId = "planId" in place ? place.planId : undefined;
  const agentId = "agentId" in place ? place.agentId : undefined;
  const { itemId } = place;
  const fed = useHostRead(LIVE_READ.INBOX_ITEMS).rows;
  const tasks = useAppSlice(APP_SLICE.TASKS);
  const inbox = useAppSlice(APP_SLICE.INBOX);
  const found = useMemo(
    () =>
      fedItemOf(
        fed,
        planId === undefined ? { agentId: agentId ?? "", itemId } : { planId, itemId },
      ),
    [fed, planId, agentId, itemId],
  );
  const item = found?.item;
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

/** The brief main holds of an item that waits, by its id; none for one settled or unknown. */
function useWaitingBrief(itemId: string): WaitingBrief | undefined {
  const inbox = useAppSlice(APP_SLICE.INBOX);
  return [...(inbox?.waiting ?? []).flatMap((task) => task.items), ...(inbox?.taskless ?? [])].find(
    (each) => each.id === itemId,
  );
}

/** A brief of an item main lists as waiting: a task's, which waits on the reader, or a taskless one, which names whom it waits on. */
type WaitingBrief = AppInboxWaitingItem &
  Partial<Pick<AppInboxTasklessItem, "startedBy" | "waitsOn">>;

/** What an item still waiting says of where it stands, before its inbox is read: "Needs you" where it waits on the reader, as its read card says; else "Waiting", which the read card's "Waiting on" them begins. */
function waitingWords(item: WaitingBrief, readerId: string | undefined): string {
  return waitsOnReader(item, readerId) ? NEEDS_YOU.LABEL : "Waiting";
}

/** An item's card from main's brief alone, wearing the thread glyph its chip wears until the item is read: its question, that it waits for an answer, and when it was asked. */
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

/** An item's title as its Inbox row names it, waiting or settled; main's brief's while its inbox is read; none where neither holds the item. */
export function useInboxItemTitle(place: InboxItemPlace): string | undefined {
  const listed = useLinkedItem(place);
  const waiting = useWaitingBrief(place.itemId);
  return listed?.item.title ?? waiting?.title;
}

/**
 * An item's glyph on its chip: what it asks, as its row's second line leads
 * with it (`inboxLineGlyph`), so the chip reads as a thread rather than as
 * the agent that posted it, whose tile its card still wears; the thread's
 * glyph where it asks nothing, and until the item is read.
 */
export function InboxItemChipGlyph({ place }: { place: InboxItemPlace }): ReactNode {
  const listed = useLinkedItem(place);
  return listed === undefined ? <GLYPH.THREAD /> : inboxItemGlyph(listed.item);
}

/** An item's card on its chip: the card its Inbox row hangs, whether it waits or not; while its inbox is read, or where that failed, the brief card of an item still waiting; else `fallback`. */
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
