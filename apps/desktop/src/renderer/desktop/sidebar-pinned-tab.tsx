import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import { CopyIcon, UnpinIcon } from "@sidecar/panel";
import { ScrollTextIcon } from "lucide-react";
import { useRef } from "react";
import { shownFiles } from "../planning/code-pane-model";
import { TRANSCRIPT_COPY } from "../planning/transcript-copy";
import type { PlansControl } from "../planning/use-plans-tab";
import { isAgentTab, isFileTab, type PinnedTab } from "../planning/use-side-panel";
import { Tooltip } from "../tooltip";
import { useClipped } from "../use-clipped";
import { ActionMenu, atPointer, type MenuAction, useActionMenu } from "./action-menu";
import {
  agentTranscriptRead,
  pinnedTabIcon,
  type TranscriptCopier,
  useTranscriptCopier,
} from "./side-panel";

/**
 * sidebar-pinned-tab.tsx -- a side panel tab pinned to the sidebar: its row under Pinned, its Unpin, and its menu.
 *
 * A fixed tab, an agent's, or a file's pinned from its menu in the side
 * panel stands under Pinned beside the pinned plans, as a row in the plan
 * rows' own shape: the tab's glyph and name, cut short with a fade as a tab
 * is, and its plan's name beneath, muted. A press opens the plan, where it
 * is not the open one, and the side panel on the tab, opening either where
 * it is closed. Its Unpin stands at the row's end while it is hovered or
 * reached from the keyboard, in the plan rows' Pin and Archive style, and
 * a right-click offers Unpin, beside an agent's two copies of its
 * transcript while its plan is open.
 *
 * A pin outlives what it opens only on the open plan's word: an agent the
 * plan's agents no longer hold, or a file no longer among those Luke showed
 * on it, leaves the row dimmed with a quiet note, opening nothing, until it
 * is unpinned. Another plan's pins are drawn as they were kept, since
 * nothing of that plan is read.
 */

/** What a pin's row says beneath its name once its plan no longer holds what it opens. */
const GONE_NOTE = "No longer on this plan";

/** Whether the open plan has said the pin's agent or file is gone from it; another plan's pins and a fixed tab's never are. */
function pinGone(pin: PinnedTab, plans: PlansControl): boolean {
  const { tab } = pin;
  if (pin.plan !== plans.activePlanId) return false;
  if (isAgentTab(tab)) {
    const { agents } = plans.agents;
    return agents !== undefined && !agents.some((agent) => agent.id === tab.agent);
  }
  if (!isFileTab(tab) || plans.shownCode === undefined) return false;
  return !shownFiles(plans.shownCode).some((ref) => ref.path === tab.file);
}

/**
 * A pin's actions in the groups a rule divides: an agent's two copies of
 * its transcript, read whole from the service, then Unpin. Note that the
 * copies stand only while the agent's plan is open, because a copy heads its
 * brief as the plan or the task the agent was handed, which only the open
 * plan's agents say.
 */
function pinActionGroups(
  pin: PinnedTab,
  plans: PlansControl,
  copied: TranscriptCopier,
): MenuAction[][] {
  const { tab } = pin;
  const unpin: MenuAction = {
    label: "Unpin",
    icon: <UnpinIcon />,
    onSelect: () => plans.sidePanel.onUnpin(pin.plan, tab),
  };
  const agent =
    isAgentTab(tab) && pin.plan === plans.activePlanId
      ? plans.agents.agents?.find((each) => each.id === tab.agent)
      : undefined;
  if (agent === undefined) return [[unpin]];
  const read = agentTranscriptRead(plans.agents.readTranscript, agent.id, pin.label, agent.brief);
  const copy = copied(read);
  return [
    [
      {
        label: "Copy concise transcript",
        icon: <CopyIcon />,
        onSelect: () => copy(TRANSCRIPT_COPY.CONCISE),
      },
      {
        label: "Copy full transcript",
        icon: <ScrollTextIcon />,
        onSelect: () => copy(TRANSCRIPT_COPY.FULL),
      },
    ],
    [unpin],
  ];
}

/**
 * One tab pinned to the sidebar, on a plan the sidebar lists. Note that the
 * row only says it is unavailable rather than being disabled, because a
 * disabled button hears no right-click, and its menu's Unpin is what is
 * left to do with it.
 */
export function SidebarPinnedTab({
  plans,
  pin,
  plan,
  inSight,
  onOpen,
}: {
  plans: PlansControl;
  pin: PinnedTab;
  /** The plan the tab is of, whose name the row carries beneath the tab's. */
  plan: PlanSummary;
  /** Whether the sidebar is in sight: folded away, its menu stands over nothing. */
  inSight: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const [words, clipped] = useClipped();
  const copied = useTranscriptCopier();
  const menu = useActionMenu(plans.shown && inSight);
  const row = useRef<HTMLButtonElement | null>(null);
  const gone = pinGone(pin, plans);
  // The row is what the menu rings and hands focus back to, even when the
  // right-click lands on Unpin over its end.
  const showMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    if (row.current === null) return;
    menu.show(atPointer(event), row.current);
  };
  return (
    <li className="sidebar-plan-item sidebar-pinned-tab">
      <button
        ref={row}
        type="button"
        className="sidebar-plan"
        aria-disabled={gone}
        data-menu-open={String(menu.open !== undefined)}
        onClick={() => {
          menu.close(false);
          if (!gone) onOpen();
        }}
        onContextMenu={showMenu}
      >
        <span className="sidebar-plan-line">
          <span className="sidebar-pinned-tab-glyph">{pinnedTabIcon(pin.tab)}</span>
          <span ref={words} className="sidebar-pinned-tab-name" data-overflow={String(clipped)}>
            {pin.label}
          </span>
        </span>
        <span className="sidebar-pinned-tab-plan">{gone ? GONE_NOTE : plan.name}</span>
      </button>
      <span className="sidebar-plan-marks">
        <Tooltip label="Unpin">
          <button
            type="button"
            className="sidebar-plan-mark"
            aria-label={`Unpin ${pin.label}`}
            onClick={() => plans.sidePanel.onUnpin(pin.plan, pin.tab)}
            onContextMenu={showMenu}
          >
            <UnpinIcon />
          </button>
        </Tooltip>
      </span>
      {menu.open === undefined ? null : (
        <ActionMenu
          label={`${pin.label} actions`}
          menu={menu.open}
          groups={pinActionGroups(pin, plans, copied)}
          onClose={menu.close}
        />
      )}
    </li>
  );
}
