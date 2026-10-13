import type { PlanAgentLine, PlanSummary } from "@sidecar/hosted/plan-wire";
import { CopyIcon, DocumentIcon, UnpinIcon } from "@sidecar/panel";
import { ScrollTextIcon } from "lucide-react";
import { useRef } from "react";
import { AgentGlyph, agentEndMark } from "../planning/agent-tab";
import { shownFiles } from "../planning/code-pane-model";
import { agentStateWords } from "../planning/coding-agent-model";
import { ModelLabel } from "../planning/model-label";
import { isAgentTab, isFileTab } from "../planning/tab-strip-model";
import { TRANSCRIPT_COPY } from "../planning/transcript-copy";
import type { PlansControl } from "../planning/use-plans-tab";
import { type PinnedTab, SIDE_PANEL_TAB_KIND } from "../planning/use-side-panel";
import { Tooltip } from "../tooltip";
import { useClipped } from "../use-clipped";
import { ActionMenu, atPointer, type MenuAction, useActionMenu } from "./action-menu";
import { agentTranscriptRead } from "./main-tabs";
import { pinnedTabIcon } from "./side-panel";
import { type TranscriptCopier, useTranscriptCopier } from "./strip-tabs";

/**
 * sidebar-pinned-tab.tsx -- a tab of the plan's columns pinned to the sidebar: its row under Pinned, its Unpin, and its menu.
 *
 * A fixed tab or a file's pinned from its menu in the side panel, or an
 * agent's from its menu in the plan's column, stands under Pinned beside
 * the pinned plans, as a row in the plan rows' own shape: the tab's glyph,
 * an agent's its harness's mark wearing where it stands as its tab does,
 * and its name on one line, cut short with a fade as a tab is. Its hover card,
 * in the plan card's look (`plan-card.tsx`), says the rest: the tab's whole
 * name, its kind under its glyph, the plan it is of, and an agent's model
 * and where it stands. A press opens the plan, where it is not the open one, and the tab
 * in its column: an agent's in the plan's column, any other in the side
 * panel, opening either where it is closed. Its Unpin stands at the row's end while it is hovered or
 * reached from the keyboard, in the plan rows' Pin and Archive style, and
 * a right-click offers Unpin, beside an agent's two copies of its
 * transcript while its plan is open.
 *
 * A pin outlives what it opens only on the open plan's word: an agent the
 * plan's agents no longer hold, or a file no longer among those Luke showed
 * on it, leaves the row dimmed, opening nothing, with a quiet note on its
 * card, until it is unpinned. Another plan's pins are drawn as they were kept, since
 * nothing of that plan is read.
 */

/** What a pin's card says once its plan no longer holds what it opens. */
const GONE_NOTE = "No longer on this plan";

/** What a pin's card calls its kind, beside the fixed tabs' own names (`SIDE_PANEL_TAB_KIND`). */
const PIN_KIND = {
  AGENT: "Coding agent",
  FILE: "File",
} as const;

/** What an agent's line on a pin's card says of an agent at rest, which its glyph does not tell from any other. */
const AGENT_DONE = "Done";

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

/** What a pin's card says its kind is: a fixed tab's name, or an agent's or a file's word, with a file's path after it. */
function pinKind(pin: PinnedTab): string {
  const { tab } = pin;
  if (isAgentTab(tab)) return PIN_KIND.AGENT;
  return isFileTab(tab) ? `${PIN_KIND.FILE} · ${tab.file}` : SIDE_PANEL_TAB_KIND[tab].label;
}

/**
 * The agent an agent's pin opens, as the window last read it: the open
 * plan's own list where the pin is on it, else the few agents its plan's
 * row names. Nothing for any other pin, or an agent neither names.
 */
function pinAgent(
  pin: PinnedTab,
  plan: PlanSummary,
  plans: PlansControl,
): PlanAgentLine | undefined {
  const { tab } = pin;
  if (!isAgentTab(tab)) return undefined;
  const open = pin.plan === plans.activePlanId ? plans.agents.agents : undefined;
  return (open ?? plan.agents?.agents)?.find((agent) => agent.id === tab.agent);
}

/**
 * The card a pin's row hangs, in a plan card's look: the tab's name,
 * wrapped to two lines, its glyph and kind under it, then the plan it is
 * of, or a note that the plan no longer holds it, and for an agent's pin
 * the agent's model, its harness's mark wearing where it stands, and the
 * word for where it stands at the line's end.
 */
function PinnedTabCard({
  pin,
  plan,
  agent,
  gone,
  plans,
}: {
  pin: PinnedTab;
  plan: PlanSummary;
  agent: PlanAgentLine | undefined;
  gone: boolean;
  plans: PlansControl;
}): React.JSX.Element {
  return (
    <div className="plan-card" data-pinned-tab-card="">
      <div className="plan-card-heading">
        <div className="plan-card-head">
          <span className="plan-card-name">{pin.label}</span>
        </div>
        <span className="plan-card-repository">
          {pinnedTabIcon(pin, agent)}
          {pinKind(pin)}
        </span>
      </div>
      <ul className="plan-card-lines">
        <li>
          <span className="plan-card-line">
            <span className="plan-card-glyph">
              <DocumentIcon />
            </span>
            <span className="plan-card-label">{plan.name}</span>
          </span>
        </li>
        {agent === undefined ? null : (
          <li>
            <span className="plan-card-line">
              <span className="plan-card-glyph">
                <AgentGlyph agent={agent} />
              </span>
              <span className="plan-card-label">
                <ModelLabel choice={agent} models={plans.agents.models ?? []} />
              </span>
              {agentEndMark(agent, false)}
              <span className="plan-card-corner">
                {agentStateWords(agent.status) ?? AGENT_DONE}
              </span>
            </span>
          </li>
        )}
        {gone ? <li className="plan-card-more">{GONE_NOTE}</li> : null}
      </ul>
    </div>
  );
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
  /** The plan the tab is of, whose name the row's card carries. */
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
  const agent = pinAgent(pin, plan, plans);
  // The row is what the menu rings and hands focus back to, even when the
  // right-click lands on Unpin over its end.
  const showMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    if (row.current === null) return;
    menu.show(atPointer(event), row.current);
  };
  return (
    <li className="sidebar-plan-item sidebar-pinned-tab">
      <Tooltip
        label={pin.label}
        card={
          <PinnedTabCard
            pin={pin}
            plan={plan}
            agent={agent}
            gone={gone}
            plans={plans}
          />
        }
        cardBeside
      >
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
            <span className="sidebar-pinned-tab-glyph">{pinnedTabIcon(pin, agent)}</span>
            <span ref={words} className="sidebar-pinned-tab-name" data-overflow={String(clipped)}>
              {pin.label}
            </span>
          </span>
        </button>
      </Tooltip>
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
