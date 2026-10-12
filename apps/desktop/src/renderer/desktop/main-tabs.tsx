import {
  CODING_AGENT_BOUNDS,
  type CodingAgentBrief,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@sidecar/hosted/coding-agent-wire";
import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import { DocumentIcon, PlusIcon, TerminalIcon } from "@sidecar/panel";
import { useEffect, useRef } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { AgentGlyph, AgentTab } from "../planning/agent-tab";
import { AgentTabCard, cardCorner, heldLatest, lastFinished } from "../planning/agent-tab-card";
import { agentStateWords, agentStillWriting, agentTabLabel } from "../planning/coding-agent-model";
import { DRAFT_TAB_LABEL, DraftAgentTab } from "../planning/draft-agent-tab";
import {
  inPlanOrder,
  isDraftTab,
  type StripTab,
  sameTab,
  tabKey,
} from "../planning/tab-strip-model";
import {
  agentTranscript,
  readWholeTranscript,
  type TranscriptCopy,
} from "../planning/transcript-copy";
import type { CodingAgentsControl } from "../planning/use-coding-agents";
import { MAIN_TAB, type MainTab, type MainTabsControl } from "../planning/use-main-tabs";
import type { PinnedTab } from "../planning/use-side-panel";
import { PlanNameField, usePlanRename } from "./plan-name-field";
import {
  type AddEntry,
  AddTabButton,
  DoorsTab,
  type TabDoors,
  type TabLook,
  type TabViews,
  type TranscriptCopier,
  type TranscriptRead,
  useTranscriptCopier,
} from "./strip-tabs";
import { TabStrip } from "./tab-strip";

/**
 * main-tabs.tsx -- the plan's column's tabs: the plan's own, each coding agent's and the draft agent's after it, the "+" that opens one, and what an agent's or the draft's tab shows in the column.
 *
 * Each part draws what `use-main-tabs.ts` holds and hands every press back
 * to it. The strip is the side panel's in every way but its first tab: the
 * same pills, the same hover and chosen fills, dragged and stepped along,
 * closed by ×, Delete, ⌘W, or the menu's Close and Close others, each tab's
 * menu on a right-click (`strip-tabs.tsx`).
 *
 * The plan's tab stands first, named for the plan, with its repository in
 * its hint. It is anchored there: it never closes, never moves, and Close
 * others on it closes every agent's tab. A press chooses it; its menu
 * renames the plan in place, as the ⋯ menu does. While it is the column's
 * only tab it is quiet, drawing no fill at rest, as a lone tab need not be
 * told from others; beside an agent's it is drawn as any tab is.
 *
 * Each agent's tab is named by its title, or its model until it has one,
 * wearing its harness's mark for where the agent stands, a ring while it
 * works and an alert once it failed, and hangs a card naming it whole with
 * when it last moved and its latest step, read from what its tab last drew
 * and never from the service. Its menu offers Pin tab, which puts it in the
 * sidebar, Rename, which turns the tab into its name's field, and its
 * transcript's two copies. Closing it closes only the view: the agent goes
 * on as it was, and the "+" opens it again. A tab an agent ended on while no
 * one was looking at it reads in semibold until shown. The draft's tab
 * stands after the agents until its first message starts the agent, and
 * closing it lets the draft go.
 *
 * The "+" after the last tab drops the shared searchable menu: New coding
 * agent, which opens a draft agent's tab, or chooses the plan's draft where
 * it has one, unavailable with Start's own reason while Start could not
 * run, and each of the plan's agents in the order started, picking one
 * choosing its tab or opening it again. An archived plan starts no agent,
 * so its menu offers only the agents to read, and its agents are not
 * renamed.
 */

/** The "+" menu's section for the plan's agents. */
const AGENTS_SECTION = "Coding agents";

/** The "+" menu's row that opens a draft agent, which no agent's id spells. */
const NEW_AGENT_ROW = "new-coding-agent";

/** What the row that opens a draft says while a Start is out. */
const NEW_AGENT_STARTING = "Starting…";

/** A coding agent's transcript read whole from the service under the title given, since its tab holds it only while shown. */
export function agentTranscriptRead(
  readTranscript: CodingAgentsControl["readTranscript"],
  agentId: string,
  title: string,
  brief: CodingAgentBrief | undefined,
): TranscriptRead {
  return () =>
    readWholeTranscript(readTranscript, { agentId }).then((messages) =>
      messages === undefined ? undefined : agentTranscript({ title, messages, brief }),
    );
}

/**
 * A tab whose name may be edited where it stands: the plan's, or an agent's.
 * While the edit is open the tab is its name's field, and a key that ends
 * the edit hands focus back to the tab.
 */
function RenamableTab({
  look,
  doors,
  rename,
  field,
}: {
  look: TabLook;
  doors: TabDoors;
  /** The rename the tab's menu opens; none where nothing is renamed, as on an archived plan. */
  rename: ReturnType<typeof usePlanRename> | undefined;
  /** What the field is called for a reader and how long a name it takes; a plan's where absent. */
  field?: { label: string; maxLength: number } | undefined;
}): React.JSX.Element {
  const tab = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);
  const editing = rename?.editing === true;
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    tab.current?.focus();
  }, [editing]);
  const editor =
    rename?.editing === true ? (
      <PlanNameField
        name={look.label}
        className="tab-field"
        {...field}
        onEnd={(edit) => {
          refocus.current = edit.byKey;
          rename.end(edit);
        }}
      />
    ) : undefined;
  return (
    <DoorsTab
      look={look}
      doors={rename === undefined ? doors : { ...doors, onRename: rename.begin }}
      editor={editor}
      tabRef={tab}
    />
  );
}

/** An agent's tab, renamed in place from its menu while its plan is not archived. */
function AgentMenuTab({
  agent,
  agents,
  look,
  doors,
}: {
  agent: CodingAgentSummary;
  agents: CodingAgentsControl;
  look: TabLook;
  doors: TabDoors;
}): React.JSX.Element {
  const rename = usePlanRename(agent.id, agents.onRename);
  return (
    <RenamableTab
      look={look}
      doors={doors}
      // A rename still open when the plan is archived elsewhere is let go unsaved.
      rename={agents.onUnarchive === undefined ? rename : undefined}
      field={{ label: "Agent name", maxLength: CODING_AGENT_BOUNDS.MAX_TITLE_CHARS }}
    />
  );
}

/** One tab the strip draws: the tab, how it looks, how it closes, how its transcript is copied, and the agent it is, for an agent's. */
interface DrawnTab {
  tab: MainTab;
  look: TabLook;
  /** Closes the tab, as its × does; none for the plan's. */
  close: (() => void) | undefined;
  copy?: ((copy: TranscriptCopy) => void) | undefined;
  agent?: CodingAgentSummary | undefined;
}

/**
 * The agents' tabs and the draft's, in the order started, each closing
 * through `main`. An agent's transcript is read whole from the service for a
 * copy, since its tab holds it only while shown, and its card previews its
 * latest step from what its tab last held (`heldLatest`).
 */
function agentTabs(input: {
  main: MainTabsControl;
  agents: CodingAgentsControl;
  unread: readonly StripTab[];
  views: TabViews;
  copied: TranscriptCopier;
}): DrawnTab[] {
  const { main, agents, unread, views, copied } = input;
  const chosen = (tab: MainTab) => sameTab(tab, main.tab);
  const models = agents.models ?? [];
  const look = (tab: MainTab, drawn: Omit<TabLook, "selected" | "onSelect">) => ({
    ...drawn,
    unread: unread.some((each) => sameTab(each, tab)),
    selected: chosen(tab),
    onSelect: () => main.onChoose(tab),
  });
  const open = (agents.agents ?? []).filter((agent) => main.openAgents?.includes(agent.id));
  const own = open.map((agent) => {
    const tab = { agent: agent.id };
    const label = agentTabLabel(agent, agents.models);
    const read = agentTranscriptRead(agents.readTranscript, agent.id, label, agent.brief);
    // Note that an agent with no turn finished in what its tab holds last
    // moved when its newest run began, the latest moment its summary knows.
    const readCard = () => {
      const writing = agentStillWriting(agent.status);
      const now = { writing, runStartedAt: agent.runStartedAt };
      const messages = heldLatest(views.held.agents.get(agent.id), now, chosen(tab));
      const movedAt = lastFinished(messages) ?? agent.runStartedAt ?? agent.createdAt;
      return {
        corner: cardCorner({
          writing,
          startedAt: agent.runStartedAt,
          movedAt,
          state: agentStateWords(agent.status),
        }),
        choice: { model: agent.model, effort: agent.effort },
        transcript: messages && agentTranscript({ title: label, messages, brief: agent.brief }),
      };
    };
    return {
      tab,
      agent,
      look: look(tab, {
        icon: <AgentGlyph agent={agent} />,
        label,
        card: <AgentTabCard name={label} models={models} read={readCard} />,
      }),
      close: () => main.onClose(tab),
      copy: copied(read),
    };
  });
  const draft = agents.draft?.id;
  const drafts =
    draft === undefined
      ? []
      : [
          {
            tab: { draft },
            look: look({ draft }, { icon: <PlusIcon />, label: DRAFT_TAB_LABEL }),
            close: () => {
              main.onClose({ draft });
              agents.onDiscardDraft(draft);
            },
          },
        ];
  return [...own, ...drafts];
}

/**
 * The "+" menu's rows: New coding agent, unavailable with Start's own
 * reason while Start could not run, and left out on an archived plan; then
 * each of the plan's agents in the order started, wearing the Coding agents
 * glyph and saying nothing of where it stands, which its tab does. Picking
 * an agent whose tab is open chooses that tab rather than opening another,
 * as a browser's tab search does.
 */
function addEntries(main: MainTabsControl, agents: CodingAgentsControl): AddEntry[] {
  const { start } = agents;
  const newAgent: AddEntry = {
    row: {
      id: NEW_AGENT_ROW,
      label: "New coding agent",
      icon: <PlusIcon />,
      // Start's reason stands exactly while Start could not run on the open plan.
      disabled: start.busy ? NEW_AGENT_STARTING : start.reason,
    },
    onPick: () => main.onChoose({ draft: agents.onNewDraft() }),
  };
  const agentRows = (agents.agents ?? []).map((agent) => ({
    row: {
      id: agent.id,
      label: agentTabLabel(agent, agents.models),
      icon: <TerminalIcon />,
      section: AGENTS_SECTION,
    },
    onPick: () => main.onChoose({ agent: agent.id }),
  }));
  return [...(agents.onUnarchive === undefined ? [newAgent] : []), ...agentRows];
}

/**
 * The column's strip across its toolbar: the plan's tab, the agents' and
 * the draft's, then the "+", which stands apart from the strip so it is
 * never dragged nor dropped before. ⌘W closes the chosen tab while the
 * column holds the window's focus (`keys`), and nothing on the plan's.
 */
export function MainTabStrip({
  plan,
  main,
  agents,
  unread,
  views,
  pins,
  rename,
  keys,
}: {
  plan: PlanSummary;
  main: MainTabsControl;
  agents: CodingAgentsControl;
  /** The agents that ended while no one was looking, each in semibold until shown. */
  unread: readonly StripTab[];
  views: TabViews;
  /** The sidebar's pins, which an agent's tab is pinned among, and their presses. */
  pins: {
    pinned: readonly PinnedTab[];
    onPin: (tab: { agent: string }, label: string) => void;
    onUnpin: (planId: string, tab: { agent: string }) => void;
  };
  /** The plan's rename, which its tab's menu opens; none while the plan is archived. */
  rename: ReturnType<typeof usePlanRename> | undefined;
  /** Whether the column offers its keys: on screen, and holding the window's focus. */
  keys: boolean;
}): React.JSX.Element {
  const copied = useTranscriptCopier();
  // The agents' and the draft's tabs in the column's order, which the
  // developer's moves set (`use-main-tabs.ts`).
  const own = inPlanOrder(
    agentTabs({ main, agents, unread, views, copied }),
    main.tabs,
    (entry) => entry.tab,
  );
  const planTab: DrawnTab = {
    tab: MAIN_TAB.PLAN,
    look: {
      icon: <DocumentIcon />,
      label: plan.name,
      selected: main.tab === MAIN_TAB.PLAN,
      quiet: own.length === 0,
      anchored: true,
      tooltip: plan.repository ?? undefined,
      onSelect: () => main.onChoose(MAIN_TAB.PLAN),
    },
    close: undefined,
  };
  const strip = [planTab, ...own];
  const chosen = strip.find((entry) => entry.look.selected);
  useAppCommand(APP_COMMAND.CLOSE_TAB, keys ? chosen?.close : undefined);
  const doorsOf = (entry: DrawnTab): TabDoors => {
    const others = strip.flatMap((other) =>
      other === entry || other.close === undefined ? [] : [other.close],
    );
    const { agent } = entry;
    const pinned =
      agent !== undefined &&
      pins.pinned.some((pin) => pin.plan === plan.id && sameTab(pin.tab, { agent: agent.id }));
    return {
      chosen: entry.look.selected,
      onClose: entry.close,
      onCloseOthers:
        others.length === 0
          ? undefined
          : () => {
              for (const close of others) close();
              main.onChoose(entry.tab);
            },
      pin:
        agent === undefined
          ? undefined
          : {
              pinned,
              onToggle: () =>
                pinned
                  ? pins.onUnpin(plan.id, { agent: agent.id })
                  : pins.onPin({ agent: agent.id }, entry.look.label),
            },
      onCopy: entry.copy,
    };
  };
  return (
    <div className="desktop-toolbar-heading main-tabs">
      <TabStrip
        label="Plan"
        onMove={(from, to) => {
          const entry = own[from];
          if (entry !== undefined) main.onMove(entry.tab, to);
        }}
      >
        {strip.map((entry) =>
          entry.agent === undefined ? (
            entry.tab === MAIN_TAB.PLAN ? (
              <RenamableTab
                key={tabKey(entry.tab)}
                look={entry.look}
                doors={doorsOf(entry)}
                rename={rename}
              />
            ) : (
              <DoorsTab key={tabKey(entry.tab)} look={entry.look} doors={doorsOf(entry)} />
            )
          ) : (
            <AgentMenuTab
              key={tabKey(entry.tab)}
              agent={entry.agent}
              agents={agents}
              look={entry.look}
              doors={doorsOf(entry)}
            />
          ),
        )}
        {/* The first read of the plan's agents did not land: nothing is known
            to draw, so the strip offers the read again where the tabs would be. */}
        {agents.listFailed && agents.agents === undefined ? (
          <button type="button" className="toolbar-button" onClick={agents.onRetryList}>
            Agents · Try again
          </button>
        ) : null}
      </TabStrip>
      <AddTabButton
        label="Open a coding agent"
        placeholder="Search coding agents"
        noMatch="No coding agents match"
        entries={addEntries(main, agents)}
        onOpen={agents.onRetryList}
        asked={main.newTabAsked}
        answers={keys}
        onAnswered={main.onNewTabAnswered}
      />
    </div>
  );
}

/** What an agent's or the draft's tab is called to a reader of the column. */
export function mainTabLabel(tab: MainTab, agents: CodingAgentsControl): string | undefined {
  if (tab === MAIN_TAB.PLAN) return undefined;
  if (isDraftTab(tab)) return DRAFT_TAB_LABEL;
  const agent = agents.agents?.find((each) => each.id === tab.agent);
  return agent === undefined ? undefined : agentTabLabel(agent, agents.models);
}

/**
 * What an agent's or the draft's tab shows in the column: the agent's
 * transcript and composer, or the draft's composer. A delegation's row in an
 * agent's transcript opens its worker in the side panel, through
 * `onOpenDelegation`.
 */
export function MainTabContent({
  tab,
  agents,
  shown,
  views,
  onOpenDelegation,
}: {
  tab: Exclude<MainTab, typeof MAIN_TAB.PLAN>;
  agents: CodingAgentsControl;
  /** Whether the column is on screen, so an agent's tab knows to follow its transcript. */
  shown: boolean;
  views: TabViews;
  onOpenDelegation: (
    agentId: string,
    callId: string,
    task: string,
    status: CodingAgentStatus,
  ) => void;
}): React.JSX.Element {
  if (isDraftTab(tab)) {
    // The tab stands for a draft the plan no longer holds only until the
    // column moves back to the plan, a render away.
    return agents.draft?.id === tab.draft ? (
      <DraftAgentTab key={tab.draft} draft={agents.draft} control={agents} />
    ) : (
      <p className="side-panel-empty">Reading the agent…</p>
    );
  }
  const agent = agents.agents?.find((each) => each.id === tab.agent);
  // The tab stands for an agent the list does not hold only while the list
  // is on its way, or until the column moves back to the plan, a render away.
  return agent === undefined ? (
    <p className="side-panel-empty">Reading the agent…</p>
  ) : (
    <AgentTab
      key={agent.id}
      agent={agent}
      control={agents}
      shown={shown}
      onOpenSubagent={(callId, task, status) => onOpenDelegation(agent.id, callId, task, status)}
      onHeld={views.onAgentHeld}
    />
  );
}
