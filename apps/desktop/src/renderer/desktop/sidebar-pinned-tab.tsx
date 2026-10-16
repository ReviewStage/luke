import type { CodingAgentPullRequest } from "@luke/features/coding-agent-wire";
import type { TaskAgentLine, TaskSummary } from "@luke/features/task-wire";
import { CopyIcon, DocumentIcon, UnpinIcon } from "@luke/ui";
import { isAgentTab, isChangesTab, isFileTab } from "@luke/ui/tab-strip-model";
import { shownFiles } from "@luke/voice/code-pane-model";
import { ScrollTextIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CardHead, CardNote, CardRule, HoverCard } from "../hover-card";
import { TAB_KIND, type TabSubject, tabLook } from "../planning/tab-look";
import { TRANSCRIPT_COPY } from "../planning/transcript-copy";
import type { PullRequestReader } from "../planning/use-agent-pull-request";
import { MAIN_TAB } from "../planning/use-main-tabs";
import type { PlansControl } from "../planning/use-plans-tab";
import type { PinnedTab } from "../planning/use-side-panel";
import { Tooltip } from "../tooltip";
import { useClipped } from "../use-clipped";
import { ActionMenu, type MenuAction, useActionMenu } from "./action-menu";
import { agentTranscriptRead } from "./main-tabs";
import { CardDetail, PullRequestLine, RepositoryDetail } from "./plan-card";
import { type TranscriptCopier, useTranscriptCopier } from "./strip-tabs";

/**
 * sidebar-pinned-tab.tsx -- a tab of the plan's columns pinned to the sidebar: its row under Pinned, its Unpin, and its menu.
 *
 * A fixed tab, a file's, or an agent's Changes pinned from its menu in the side panel, or an
 * agent's from its menu in the plan's column, stands under Pinned beside
 * the pinned plans, as a row in the plan rows' own shape: the tab's glyph,
 * an agent's its harness's mark wearing where it stands as its tab does,
 * and its name on one line, cut short with a fade as a tab is. Its hover card
 * is a plan card (`plan-card.tsx`), drawn from its rows: the tab's whole
 * name after its glyph, then the plan it is of, which opens the plan, and
 * the plan's repository, which opens on GitHub, and for an agent's pin or
 * its Changes' the pull request it opened, which opens on GitHub too, once the one read of
 * it the card makes as it opens lands. A press opens the plan, where it is not the open one, and the tab
 * in its column: an agent's in the plan's column, any other in the side
 * panel, opening either where it is closed. The row it opened from is
 * then the one the sidebar marks, in its plan's row's place, for as long
 * as the plan stays open, whichever of the plan's tabs is shown, until the
 * plan's own row is pressed or another plan opens. Its Unpin stands at the row's end while it is hovered or
 * reached from the keyboard, in the plan rows' Pin and Archive style, and
 * part of the row to its card, as theirs are, and
 * a right-click offers Unpin, beside an agent's two copies of its
 * transcript while its plan is open.
 *
 * A pin outlives what it opens only on the open plan's word: an agent the
 * plan's agents no longer hold, its Changes too, or a file no longer among those Luke showed
 * on it, leaves the row dimmed, opening nothing, with a quiet note on its
 * card, until it is unpinned. Another plan's pins are drawn as they were kept, since
 * nothing of that plan is read.
 */

/** What a pin's card says once its plan no longer holds what it opens. */
const GONE_NOTE = "No longer on this task";

/** Whether the open plan has said the pin's agent, the agent of its Changes, or its file is gone from it; another plan's pins and a fixed tab's never are. */
function pinGone(pin: PinnedTab, plans: PlansControl): boolean {
  const { tab } = pin;
  if (pin.plan !== plans.activePlanId) return false;
  const agentId = pinAgentId(pin);
  if (agentId !== undefined) {
    const { agents } = plans.agents;
    return agents !== undefined && !agents.some((agent) => agent.id === agentId);
  }
  if (!isFileTab(tab) || plans.shownCode === undefined) return false;
  return !shownFiles(plans.shownCode).some((ref) => ref.path === tab.file);
}

/**
 * What a pin's glyph is drawn from, as its tab's look (`tab-look.tsx`): its
 * kind, a file's path, or an agent's as its tab wears it, where it stands
 * included, wherever the window last read the agent (`agent`), and
 * otherwise at rest in the harness it ran in when it was pinned.
 */
function pinSubject(pin: PinnedTab, agent: TaskAgentLine | undefined): TabSubject {
  const { tab } = pin;
  if (isAgentTab(tab)) {
    const pinned = pin.model === undefined ? undefined : { model: pin.model };
    return { kind: TAB_KIND.AGENT, name: pin.label, agent: agent ?? pinned };
  }
  if (tab === MAIN_TAB.INBOX) return { kind: TAB_KIND.INBOX };
  if (isChangesTab(tab)) return { kind: TAB_KIND.CHANGES, agentName: undefined };
  return isFileTab(tab) ? { kind: TAB_KIND.FILE, path: tab.file } : { kind: TAB_KIND.PANEL, tab };
}

/** The agent a pin of an agent's tab or of its Changes is of; none for any other pin. */
function pinAgentId({ tab }: PinnedTab): string | undefined {
  if (isAgentTab(tab)) return tab.agent;
  return isChangesTab(tab) ? tab.changes : undefined;
}

/**
 * A pin's actions in the groups a rule divides: an agent's two copies of
 * its transcript, read whole from the service, then Unpin. Note that the
 * copies stand only while the agent's plan is open, because a copy heads its
 * brief as the plan or the prompt the agent was handed, which only the open
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
 * The agent an agent's pin opens, as the window last read it: the open
 * plan's own list where the pin is on it, else the few agents its plan's
 * row names. Nothing for any other pin, or an agent neither names.
 */
function pinAgent(
  pin: PinnedTab,
  plan: TaskSummary,
  plans: PlansControl,
): TaskAgentLine | undefined {
  const { tab } = pin;
  if (!isAgentTab(tab)) return undefined;
  const open = pin.plan === plans.activePlanId ? plans.agents.agents : undefined;
  return (open ?? plan.agents?.agents)?.find((agent) => agent.id === tab.agent);
}

/**
 * The pull request the agent of an agent's pin or of a Changes pin opened,
 * read once from the service as the card opens, which keeps its own answer a
 * short while: nothing for any other pin, before the answer lands, where it
 * did not, or where the agent opened none.
 */
function usePinPullRequest(
  pin: PinnedTab,
  read: PullRequestReader,
): CodingAgentPullRequest | undefined {
  const agentId = pinAgentId(pin);
  const [held, setHeld] = useState<CodingAgentPullRequest | undefined>(undefined);
  const reader = useRef(read);
  reader.current = read;
  useEffect(() => {
    if (agentId === undefined) return;
    let live = true;
    reader.current(agentId).then(
      (answer) => {
        if (live && !("failure" in answer)) setHeld(answer.pullRequest ?? undefined);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [agentId]);
  return held;
}

/**
 * The card a pin's row hangs, a plan card's own rows: the tab's name after
 * its glyph as its row draws it, wrapped to two lines, then the plan it is of and the plan's
 * repository, each opening where it says, a note where the plan no longer
 * holds the tab, and under a rule an agent's pull request.
 */
function PinnedTabCard({
  pin,
  plan,
  agent,
  gone,
  plans,
  onOpenPlan,
}: {
  pin: PinnedTab;
  plan: TaskSummary;
  agent: TaskAgentLine | undefined;
  gone: boolean;
  plans: PlansControl;
  onOpenPlan: () => void;
}): React.JSX.Element {
  const pullRequest = usePinPullRequest(pin, plans.agents.readPullRequest);
  const { repository } = plan;
  const { openGitHub, pictures } = plans.repositories;
  return (
    <HoverCard data-pinned-tab-card="">
      <CardHead glyph={tabLook(pinSubject(pin, agent)).icon} name={pin.label} />
      <div className="plan-card-rows">
        <CardDetail glyph={<DocumentIcon />} label={plan.name} onPress={onOpenPlan} />
        {repository === null ? null : (
          <RepositoryDetail repository={repository} pictures={pictures} onOpenGitHub={openGitHub} />
        )}
      </div>
      {gone ? <CardNote>{GONE_NOTE}</CardNote> : null}
      {pullRequest === undefined ? null : (
        <>
          <CardRule />
          <ul className="plan-card-rows" aria-label="Pull request">
            <PullRequestLine pullRequest={pullRequest} onOpenGitHub={openGitHub} />
          </ul>
        </>
      )}
    </HoverCard>
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
  current,
  inSight,
  onOpen,
  onOpenPlan,
}: {
  plans: PlansControl;
  pin: PinnedTab;
  /** Whether the open plan was opened from this pin, which the sidebar marks in the plan's place. */
  current: boolean;
  /** The plan the tab is of, whose name the row's card carries. */
  plan: TaskSummary;
  /** Whether the sidebar is in sight: folded away, its menu stands over nothing. */
  inSight: boolean;
  onOpen: () => void;
  /** Opens the plan the tab is of, as its own row does. */
  onOpenPlan: () => void;
}): React.JSX.Element {
  const [words, clipped] = useClipped();
  const copied = useTranscriptCopier();
  const menu = useActionMenu(plans.shown && inSight);
  const row = useRef<HTMLButtonElement | null>(null);
  const item = useRef<HTMLLIElement | null>(null);
  const gone = pinGone(pin, plans);
  const agent = pinAgent(pin, plan, plans);
  // The row is what the menu rings and hands focus back to, even when the
  // right-click lands on Unpin over its end.
  const showMenu = menu.contextMenu(row);
  return (
    <li ref={item} className="sidebar-plan-item sidebar-pinned-tab">
      <Tooltip
        label={pin.label}
        card={
          <PinnedTabCard
            pin={pin}
            plan={plan}
            agent={agent}
            gone={gone}
            plans={plans}
            onOpenPlan={onOpenPlan}
          />
        }
        cardBeside
        cardRegion={item}
      >
        <button
          ref={row}
          type="button"
          className="sidebar-plan"
          aria-current={current ? "page" : undefined}
          aria-disabled={gone}
          data-menu-open={String(menu.open !== undefined)}
          onClick={() => {
            menu.close(false);
            if (!gone) onOpen();
          }}
          onContextMenu={showMenu}
        >
          <span className="sidebar-plan-line">
            <span className="sidebar-pinned-tab-glyph">{tabLook(pinSubject(pin, agent)).icon}</span>
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
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${pin.label} actions`}
          menu={menu.drawn}
          groups={pinActionGroups(pin, plans, copied)}
          onClose={menu.close}
        />
      )}
    </li>
  );
}
