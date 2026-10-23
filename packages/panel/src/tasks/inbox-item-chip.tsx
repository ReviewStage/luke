import { INBOX_SCOPE_KIND } from "@luke/features/coding-agent-view";
import type { TasklessAgent } from "@luke/features/coding-agent-wire";
import { useMinute } from "@luke/ui";
import { InboxIcon } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { InboxItemCard, ItemMark } from "./inbox-item-parts.js";
import {
  type InboxListed,
  type TasklessInboxAgent,
  taskHolder,
  tasklessGroups,
} from "./inbox-model.js";
import { useSettledReads } from "./inbox-settling.js";
import { useMentionedPlace } from "./mentioned-agent-card.js";
import { useFollowedInboxes, windowInboxFollower } from "./use-followed-inboxes.js";

/**
 * inbox-item-chip.tsx -- a chip of an Inbox item: its agent's tile as its glyph and its Inbox row's own card, whatever the item's standing.
 *
 * A link to an item names the task, or the agent with no task, that holds it
 * and the item. Main's document holds only what waits, in brief, so the one
 * inbox the link names is followed while its chip stands (`use-followed-inboxes.ts`),
 * and the item is drawn as the Inbox draws it: its agent's tile
 * (`ItemMark`) and the card its row hangs (`InboxItemCard`), waiting or
 * answered. Until the inbox is read, or where the window holds nothing of
 * the task or agent, the chip draws the Inbox's glyph and its own card.
 */

/** Where a link to an item says it stands: under a task, or under an agent with no task. */
type InboxItemPlace =
  | { readonly planId: string; readonly itemId: string }
  | { readonly agentId: string; readonly itemId: string };

/** The agent with no task an item stands under, as the Inbox groups it: the brief main holds of a waiting one, else the agent's own row among the window's agents. */
function tasklessAgentOf(
  agentId: string,
  waiting: readonly TasklessInboxAgent[],
  agents: readonly TasklessAgent[],
): TasklessInboxAgent | undefined {
  const brief = waiting.find((each) => each.agentId === agentId);
  if (brief !== undefined) return brief;
  const agent = agents.find((each) => each.id === agentId);
  if (agent === undefined) return undefined;
  return {
    agentId,
    agentTitle: agent.title,
    agentModel: agent.model,
    automationId: agent.automationId,
    automationName: agent.automationName ?? null,
    repository: agent.repository ?? "",
    ...(agent.workspaceId === undefined ? undefined : { workspaceId: agent.workspaceId }),
  };
}

/** The item a link names as the Inbox lists it, its holder named as its group's header is; none until its inbox is read, or where the window holds neither its task nor its agent. */
function useLinkedItem(place: InboxItemPlace): InboxListed | undefined {
  const planId = "planId" in place ? place.planId : undefined;
  const agentId = "agentId" in place ? place.agentId : undefined;
  const followed = planId ?? agentId;
  const read = useFollowedInboxes(
    planId === undefined ? INBOX_SCOPE_KIND.AGENT : INBOX_SCOPE_KIND.PLAN,
    followed === undefined ? [] : [followed],
    windowInboxFollower,
  );
  const items = useSettledReads(read.items);
  const tasks = useAppSlice(APP_SLICE.TASKS);
  const inbox = useAppSlice(APP_SLICE.INBOX);
  const held = followed === undefined ? undefined : items.get(followed);
  return useMemo(() => {
    const item = held?.find((each) => each.id === place.itemId);
    if (item === undefined) return undefined;
    if (planId !== undefined) {
      const task = tasks?.tasks.find((each) => each.id === planId);
      return task === undefined ? undefined : { holder: taskHolder(task), item };
    }
    if (agentId === undefined) return undefined;
    const agent = tasklessAgentOf(agentId, inbox?.taskless ?? [], tasks?.tasklessAgents ?? []);
    if (agent === undefined) return undefined;
    const [group] = tasklessGroups([agent], new Map([[agentId, [item]]]), undefined);
    return group === undefined ? undefined : { holder: group.holder, item };
  }, [held, place.itemId, planId, agentId, tasks, inbox]);
}

/** An item's glyph on its chip: its agent's tile, as its row leads with it; the Inbox's own glyph until the item is read. */
export function InboxItemChipGlyph({ place }: { place: InboxItemPlace }): ReactNode {
  const listed = useLinkedItem(place);
  const { models, me } = useMentionedPlace();
  if (listed === undefined) return <InboxIcon aria-hidden="true" />;
  return (
    <ItemMark
      holder={listed.holder}
      agentId={listed.item.agentId}
      models={models}
      readerId={me}
      plain
    />
  );
}

/** An item's card on its chip: the card its Inbox row hangs, whether it waits or not; else `fallback`. */
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
  if (listed === undefined) return fallback;
  return <InboxItemCard listed={listed} now={now} models={models} readerId={me} />;
}
