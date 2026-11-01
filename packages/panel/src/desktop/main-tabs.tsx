import {
  AGENT_BOUNDS,
  AGENT_STATUS,
  type AgentAttachment,
  type AgentStatus,
  type AgentSummary,
} from "@luke/features/agent-wire";
import { LINK_PLACE, type LinkPlace } from "@luke/features/link-grammar";
import { TASK_BOUNDS, type TaskSummary } from "@luke/features/task-wire";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  FILL_ELEMENT,
  Fill,
  INLINE_EDIT_LOOK,
  InlineEdit,
  RetryButton,
  STATUS_TONE,
  TABS_GROUND,
  VisuallyHidden,
} from "@luke/ui";
import { inTaskOrder, isDraftTab, type StripTab, sameTab, tabKey } from "@luke/ui/tab-strip-model";
import type { InlineRename } from "@luke/ui/use-inline-rename";
import { memo, useRef } from "react";
import { FOCUSED_OFFER, useAppCommand } from "../app-commands.js";
import { useDraftedAgents } from "../composer-drafts.js";
import { useCopyLinkItem } from "../copy-link-item.js";
import { DraftMark } from "../draft-mark.js";
import { agentName, startsOwnAgents } from "../tasks/agent-model.js";
import { agentCardReading } from "../tasks/agent-ref.js";
import { AgentTab, StartingAgentTab } from "../tasks/agent-tab.js";
import { AgentTabCard } from "../tasks/agent-tab-card.js";
import { AgentTabSkeleton } from "../tasks/agent-tab-skeleton.js";
import { DraftAgentTab } from "../tasks/draft-agent-tab.js";
import { agentForkDoors, ForkProvider } from "../tasks/fork-action.js";
import type { AgentFork } from "../tasks/fork-model.js";
import { NEEDS_YOU } from "../tasks/inbox-model.js";
import { agentEndMark, TAB_KIND, tabLook } from "../tasks/tab-look.js";
import type { ToolTarget } from "../tasks/tool-call-model.js";
import { TRANSCRIPT_COPY } from "../tasks/transcript-copy.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import {
  isOverviewTab,
  MAIN_TAB,
  type MainTab,
  type MainTabsControl,
} from "../tasks/use-main-tabs.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { type AgentTerminalDoors, useAgentActions } from "./agent-actions.js";
import type { TaskCards } from "./side-panel.js";
import {
  type AddEntry,
  AddTabButton,
  AddTabSkeleton,
  type DocumentMenu,
  DoorsTab,
  type HeldTranscripts,
  type ShownTab,
  type TabDoors,
  type TabLook,
  type TabPin,
  TabSkeleton,
  type TabViews,
} from "./strip-tabs.js";
import { LOOK_STRIP, useStripLooks } from "./switcher-looks.js";
import { TabStrip } from "./tab-strip.js";

/**
 * main-tabs.tsx -- the task's column's tabs: its Overview, each agent's and the draft agent's, the "+" that opens one, and what an agent's or the draft's tab shows in the column.
 *
 * Each part draws what `use-main-tabs.ts` holds and hands every press back
 * to it. The strip is the side panel's in every way: the same pills, the
 * same hover and chosen fills, dragged and stepped along, closed by ×,
 * Delete, ⌘W, or the menu's Close and Close others, each tab's menu on a
 * right-click (`strip-tabs.tsx`). An agent's own actions, its one menu
 * (`agent-actions.tsx`), stand on its tab's right-click after the tab's
 * keeping, and the chosen agent's in the toolbar's ⋯, drawn into the slot
 * the toolbar keeps for it (`slot`), so the ⋯ acts on what is under the bar.
 *
 * Overview leads the strip on every task, named by the task itself, its
 * status mark and name, since no bar over the column names the task: it
 * shows the task's plan document, which the task's page draws and hands
 * in (`desktop-tasks.tsx`), and offers the task's own menu on its
 * right-click and in the toolbar's ⋯, as the task's plan did where it stood
 * in the side panel. It never closes, and the agents' tabs move after it.
 *
 * Each agent's tab is named by its title, or its model until it has one,
 * wearing its harness's mark for where the agent stands, a ring while it
 * works and an alert once it failed, and hangs a card naming it whole with when it
 * last moved and its latest step, read from what its tab last drew and
 * never from the service. Its menu offers Pin tab, which puts it in the
 * sidebar, then the agent's menu: Copy link and its transcript's two copies,
 * Rename, which turns the tab into its name's field, Show terminal,
 * which shows the agent's own Terminal tab in the side panel as ⌘J does from
 * the tab, its Archive, and its Permanently delete. Closing it closes only the view:
 * the agent goes on as it was, and the "+" opens it again. A tab an agent
 * ended on while no one was looking at it reads in semibold until shown. The
 * draft's tab, named New agent as the "+" row that opens it is, stands after
 * the agents until its first message starts the agent, and
 * closing it lets the draft go at once, a toast's Undo bringing it back with
 * its words and files where it held any (`use-agents.ts`). A task with no other tab standing shows a
 * draft's (`use-main-tabs.ts`), so a new agent is the developer's to start
 * from its composer. Every tab wears its kind's look (`tab-look.tsx`), and an
 * agent's or the draft's, while its box holds words and another tab is
 * chosen, the Draft pencil at its end (`draft-mark.tsx`).
 *
 * The "+" after the last tab drops the shared searchable menu: New agent,
 * which opens a draft agent's tab, or chooses the
 * task's draft where it has one, unavailable with Start's own reason while
 * Start could not run; and each of the
 * task's agents in the order started, picking one choosing its tab or
 * opening it again. An archived task starts nothing, so its menu offers
 * only the agents to read, and its agents are not renamed.
 */

/**
 * A count at a summary row's end, or a tab's, in the quiet count a folded
 * sidebar group shows after its name; the Inbox's, of what needs the reader,
 * in the tone its `data-tone` names.
 */
export const ROW_COUNT =
  "inbox-row-count flex-none text-caption-inline text-muted-foreground tabular-nums data-[tone]:text-tone-ink";

/** The "+" menu's section for the task's agents, which the task's summary lists under the same heading. */
export const AGENTS_SECTION = "Agents";

/** The "+" menu's row that opens a draft agent, which no agent's id spells. */
const NEW_AGENT_ROW = "new-agent";

/** What the row that opens a draft says while a Start is out. */
const NEW_AGENT_STARTING = "Starting…";

/** The row that opens the task's Inbox, which no agent's id spells. */
export const INBOX_ROW = "inbox";

/** What the press that reads the plan's agents again, after a first read did not land, says. */
const RETRY_AGENTS = "Retry agents";

/**
 * A tab whose name may be edited where it stands: an agent's.
 * While the edit is open the tab is its name's field, and a key that ends
 * the edit hands focus back to the tab.
 */
function RenamableTab({
  look,
  doors,
  rename,
  field,
  slot,
  onShown,
}: {
  look: TabLook;
  doors: TabDoors;
  /** The rename the tab's menu opens; none where nothing is renamed, as on an archived task. */
  rename: InlineRename | undefined;
  /** What the field is called for a reader and how long a name it takes; a task's where absent. */
  field?: { label: string; maxLength: number } | undefined;
  /** The toolbar's slot the chosen tab's ⋯ stands in. */
  slot?: HTMLElement | null | undefined;
  /** Hears the tab while it is the one shown, for a phone's header (`DoorsTab`). */
  onShown?: ((shown: ShownTab | undefined) => void) | undefined;
}): React.JSX.Element {
  const tab = useRef<HTMLButtonElement | null>(null);
  const editing = rename?.editing === true;
  const endedByKey = useRefocusAfterEdit(editing, tab);
  const editor =
    rename?.editing === true ? (
      <InlineEdit
        value={rename.asked ?? look.label}
        label={field?.label ?? "Task name"}
        maxLength={field?.maxLength ?? TASK_BOUNDS.MAX_NAME_CHARS}
        look={INLINE_EDIT_LOOK.WELL}
        editing
        onEnd={(edit) => {
          endedByKey(edit.byKey);
          rename.end(edit.value);
        }}
      />
    ) : undefined;
  return (
    <DoorsTab
      look={look}
      doors={rename === undefined ? doors : { ...doors, onRename: rename.begin }}
      editor={editor}
      tabRef={tab}
      slot={slot}
      onShown={onShown}
    />
  );
}

/**
 * An agent's tab, whose menu offers the agent's own actions
 * (`agent-actions.tsx`), renamed in place while its task is not archived:
 * the task's column's, and the side panel's beside the Inbox; while it is
 * the tab shown, a phone's header is handed it, whole doors and all, to
 * offer what its ⋯ would (`DoorsTab`'s `onShown`).
 */
export function AgentMenuTab({
  agent,
  agents,
  look,
  doors,
  shown,
  keys,
  terminals,
  slot,
  onShown,
}: {
  agent: AgentSummary;
  agents: AgentsControl;
  look: TabLook;
  doors: TabDoors;
  shown: boolean;
  /** Whether the strip drawing the tab offers its keys, which the chosen agent's copies and delete answer while it does. */
  keys: boolean;
  terminals: Pick<AgentTerminalDoors, "onOpenTerminal">;
  /** The toolbar's slot the chosen agent's ⋯ stands in; none where the toolbar keeps none. */
  slot: HTMLElement | null | undefined;
  /** Hears the tab while it is the one shown, for a phone's header (`DoorsTab`). */
  onShown: ((shown: ShownTab | undefined) => void) | undefined;
}): React.JSX.Element {
  const actions = useAgentActions(agent, agents, {
    label: look.label,
    shown,
    terminals,
    onDeleted: doors.onClose,
  });
  // The chosen agent's ⌥⌘C, ⇧⌥⌘C, and ⌘⌫ while the column has the keys, over the open task's plan and its delete.
  const { onCopy, deletion } = actions.doors;
  const focused = keys && doors.chosen;
  useAppCommand(
    APP_COMMAND.COPY_CONTENT,
    focused && onCopy !== undefined ? () => onCopy(TRANSCRIPT_COPY.CONCISE) : undefined,
    FOCUSED_OFFER,
  );
  useAppCommand(
    APP_COMMAND.COPY_FULL_TRANSCRIPT,
    focused && onCopy !== undefined ? () => onCopy(TRANSCRIPT_COPY.FULL) : undefined,
    FOCUSED_OFFER,
  );
  useAppCommand(
    APP_COMMAND.DELETE,
    focused && deletion !== undefined && deletion.disabled !== true ? deletion.onSelect : undefined,
    FOCUSED_OFFER,
  );
  const whole: TabDoors = { ...doors, ...actions.doors };
  return (
    <>
      <RenamableTab
        look={look}
        doors={whole}
        rename={actions.rename}
        field={{ label: "Agent name", maxLength: AGENT_BOUNDS.MAX_TITLE_CHARS }}
        slot={slot}
        onShown={onShown}
      />
      {actions.dialog}
    </>
  );
}

/** One tab the strip draws: the tab, how it looks, how it closes, and the agent it is, for an agent's. */
interface DrawnTab {
  tab: MainTab;
  look: TabLook;
  /** Closes the tab, as its × does; none for a Start's still making its agent, which only its answer closes. */
  close: (() => void) | undefined;
  agent?: AgentSummary | undefined;
}

/**
 * Overview's tab, named by the task's status mark and name, then the agents' tabs and the draft's, in the order
 * started, each but Overview closing through `main`. An agent's card previews its
 * latest step from what its tab last held (`heldLatest`). An agent's tab,
 * and the draft's, wears the Draft pencil at its end while its box holds
 * words and another tab is chosen (`draft-mark.tsx`); an agent's failure
 * says more, so it keeps its failed mark in the pencil's place.
 */
function agentTabs(input: {
  task: Pick<TaskSummary, "name" | "status">;
  main: MainTabsControl;
  agents: AgentsControl;
  unread: readonly StripTab[];
  views: TabViews;
  /** The started agents whose boxes hold a draft (`useDraftedAgents`). */
  drafted: readonly string[];
}): DrawnTab[] {
  const { task, main, agents, unread, views, drafted } = input;
  const chosen = (tab: MainTab) => main.tab !== undefined && sameTab(tab, main.tab);
  const models = agents.models ?? [];
  const look = (tab: MainTab, drawn: Omit<TabLook, "selected" | "onSelect">) => ({
    ...drawn,
    unread: unread.some((each) => sameTab(each, tab)),
    selected: chosen(tab),
    onSelect: () => main.onChoose(tab),
  });
  const overview = {
    tab: MAIN_TAB.OVERVIEW,
    // Note that the first tab names the task by its status mark and name, since no bar over the column names it.
    look: {
      ...look(
        MAIN_TAB.OVERVIEW,
        tabLook({ kind: TAB_KIND.PLAN, status: task.status, name: task.name }),
      ),
      anchored: true,
    },
    close: undefined,
  };
  const open = (agents.agents ?? []).filter((agent) => main.openAgents?.includes(agent.id));
  const own = open.map((agent) => {
    const tab = { agent: agent.id };
    const label = agentName(agent, agents.models);
    const readCard = agentCardReading(agent, label, views.held, chosen(tab), agents);
    const draftMark = drafted.includes(agent.id) && !chosen(tab) ? <DraftMark /> : undefined;
    return {
      tab,
      agent,
      look: look(tab, {
        ...tabLook({ kind: TAB_KIND.AGENT, name: label, agent }),
        endMark: agentEndMark(agent, false) ?? draftMark,
        card: <AgentTabCard name={label} models={models} read={readCard} />,
      }),
      close: () => main.onClose(tab),
    };
  });
  // A Start still making its agent stands as that agent's tab under the press's key, which nothing closes but its answer.
  const pending = agents.start.pending;
  const startingTab = pending === undefined ? undefined : { agent: pending.key };
  const starting =
    startingTab === undefined || main.openAgents?.includes(startingTab.agent) !== true
      ? []
      : [
          {
            tab: startingTab,
            look: look(
              startingTab,
              tabLook({
                kind: TAB_KIND.AGENT,
                name: undefined,
                agent: { model: pending?.model ?? "", status: AGENT_STATUS.STARTING },
              }),
            ),
            close: undefined,
          },
        ];
  const draft = agents.draft?.id;
  const draftHolds =
    agents.draft !== undefined &&
    (agents.draft.prompt !== "" || agents.draft.attachments.length > 0);
  const drafts =
    draft === undefined
      ? []
      : [
          {
            tab: { draft },
            look: look(
              { draft },
              {
                ...tabLook({ kind: TAB_KIND.DRAFT }),
                endMark: draftHolds && !chosen({ draft }) ? <DraftMark /> : undefined,
              },
            ),
            close: () => {
              main.onClose({ draft });
              agents.onDiscardDraft(draft);
            },
          },
        ];
  return [overview, ...own, ...starting, ...drafts];
}

/**
 * Each of the task's agents in the order started, as the "+" menu offers it,
 * the task's summary lists it (`task-summary.tsx`), and ⌘K finds it, in its
 * tab's look: its harness's mark wearing where it stands, and, where the
 * row draws one, a failure at its end, as its tab does. Picking an agent
 * whose tab is open chooses that tab rather than opening another, as a
 * browser's tab search does.
 */
export function agentEntries(
  main: Pick<MainTabsControl, "tab" | "onChoose">,
  agents: AgentsControl,
  held?: HeldTranscripts,
): AddEntry[] {
  return (agents.agents ?? []).map((agent) => {
    const label = agentName(agent, agents.models);
    const chosen = main.tab !== undefined && sameTab({ agent: agent.id }, main.tab);
    return {
      row: {
        id: agent.id,
        ...tabLook({ kind: TAB_KIND.AGENT, name: label, agent }),
        section: AGENTS_SECTION,
      },
      endMark: agentEndMark(agent, true),
      // Note that a caller handing what its tabs hold gets the card its tab hangs; ⌘K and the summary hang theirs themselves.
      card:
        held === undefined ? undefined : (
          <AgentTabCard
            name={label}
            models={agents.models ?? []}
            read={agentCardReading(agent, label, held, chosen, agents)}
          />
        ),
      onPick: () => main.onChoose({ agent: agent.id }),
      agent,
    };
  });
}

/**
 * The task's Inbox as a row: its tray and its name, then what waits on the
 * developer counted at its end in the attention tone the rows it counts
 * wear, and nothing at none. It names no section, so the summary lists it under Tabs, beside the
 * panel's other kinds; picking it opens the window's Inbox narrowed to the task.
 */
export function inboxEntry(onPick: () => void, waiting: number): AddEntry {
  const row = { id: INBOX_ROW, ...tabLook({ kind: TAB_KIND.INBOX }) };
  const endMark =
    waiting === 0 ? undefined : (
      <span className={ROW_COUNT} data-tone={STATUS_TONE.ATTENTION}>
        {waiting}
        <VisuallyHidden>
          {" "}
          {waiting === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many}
        </VisuallyHidden>
      </span>
    );
  return { row, endMark, onPick };
}

/**
 * The task's Inbox as ⌘K offers it, by itself rather than among the task's
 * agents, though only they post to it; none on a task with no agent.
 * Picking it opens the window's Inbox narrowed to the task, through `onPick`.
 */
export function inboxEntries(agents: AgentsControl, onPick: () => void): AddEntry[] {
  // An archived agent's items still stand, so the row stands while the task holds any agent.
  if ((agents.heldIds?.length ?? 0) === 0) return [];
  return [inboxEntry(onPick, 0)];
}

/**
 * The "+" menu's rows: New agent, unavailable with Start's own reason while
 * Start could not run, left out on an archived task and on a pilot task
 * (`startsOwnAgents`), by itself under no heading; then each of its agents under Agents (`agentEntries`).
 */
function addEntries(
  main: MainTabsControl,
  agents: AgentsControl,
  held: HeldTranscripts,
): AddEntry[] {
  const { start } = agents;
  const newAgent: AddEntry = {
    row: {
      id: NEW_AGENT_ROW,
      ...tabLook({ kind: TAB_KIND.DRAFT }),
      // Start's reason stands exactly while Start could not run on the open task.
      disabled: start.busy ? NEW_AGENT_STARTING : start.reason,
    },
    onPick: () => main.onChoose({ draft: agents.onNewDraft() }),
  };
  const agentRows = agentEntries(main, agents, held);
  // A pilot task's agents are its pilot's to start, so its menu offers no New agent.
  const starts = agents.onUnarchive === undefined && startsOwnAgents(agents.mode) ? [newAgent] : [];
  return [...starts, ...agentRows];
}

/** The row the column's tabs stand in, which is its toolbar's title: the strip, what follows it, and the "+" last. */
function MainTabsRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="main-tabs flex items-center gap-list-gap">{children}</div>;
}

/**
 * The column's strip while the task is read: one tab's block where the
 * first tab will stand and the "+"'s after it, in the strip's own row, so
 * the row holds still, and a narrow room wraps it under the toolbar's
 * actions, as the strip that replaces it is.
 */
export function MainTabStripSkeleton(): React.JSX.Element {
  return (
    <MainTabsRow>
      <TabSkeleton />
      <AddTabSkeleton />
    </MainTabsRow>
  );
}

/**
 * The column's strip across its toolbar: Overview, the agents' and the draft's, then the "+", which stands apart from the strip so it is never
 * dragged nor dropped before. ⌘W closes the chosen tab while the column
 * holds the window's focus (`keys`).
 */
export function MainTabStrip({
  task,
  main,
  agents,
  unread,
  views,
  pins,
  keys,
  shown,
  onOpenTerminal,
  slot,
  onShown,
  planMenu,
}: {
  /** The task as the list names it now, its name and status first there, which its first tab wears. */
  task: TaskSummary;
  main: MainTabsControl;
  agents: AgentsControl;
  /** The agents that ended while no one was looking, each in semibold until shown. */
  unread: readonly StripTab[];
  views: TabViews;
  /** Whether the reader pinned an agent on the account, which pins it among the sidebar's pins, and its press. */
  pins: {
    pinned: (agentId: string) => boolean;
    onPin: (agentId: string, pinned: boolean) => void;
  };
  /** Whether the column offers its keys: on screen, and holding the window's focus. */
  keys: boolean;
  /** Whether the task's page is on screen, which a tab's Archive asks its question on. */
  shown: boolean;
  /** Opens an agent's own Terminal tab in the side panel, adding no shell, by the agent; none where the platform runs no terminals. */
  onOpenTerminal?: ((agentId: string) => void) | undefined;
  /** The toolbar's slot the chosen agent's ⋯ is drawn into; none where the toolbar keeps none, as a phone's. */
  slot?: HTMLElement | null | undefined;
  /** Hears the tab the column shows, for a phone's header, whose ⋯ offers what the agent's ⋯ would (`task-pane-switcher.tsx`); none where the toolbar draws the ⋯. */
  onShown?: ((shown: ShownTab | undefined) => void) | undefined;
  /** The task's own menu, which Overview's right-click and ⋯ draw. */
  planMenu?: DocumentMenu | undefined;
}): React.JSX.Element {
  const drafted = useDraftedAgents();
  // Overview, then the agents' and the draft's tabs in the column's order,
  // which the developer's moves and their opening set (`use-main-tabs.ts`).
  const own = inTaskOrder(
    agentTabs({ task, main, agents, unread, views, drafted }),
    main.tabs,
    (entry) => entry.tab,
  );
  const strip = own;
  useStripLooks(LOOK_STRIP.COLUMN, task.id, strip);
  const copyLink = useCopyLinkItem();
  // Close others closes every tab but `entry` that closes, then shows it; none where no other tab closes.
  const closeOthersOf = (entry: DrawnTab): (() => void) | undefined => {
    const others = strip.flatMap((other) =>
      other === entry || other.close === undefined ? [] : [other.close],
    );
    if (others.length === 0) return undefined;
    return () => {
      for (const close of others) close();
      main.onChoose(entry.tab);
    };
  };
  const chosen = strip.find((entry) => entry.look.selected);
  useAppCommand(APP_COMMAND.CLOSE_TAB, keys ? chosen?.close : undefined);
  useAppCommand(
    APP_COMMAND.CLOSE_OTHER_TABS,
    keys && chosen !== undefined ? closeOthersOf(chosen) : undefined,
  );
  // Note that an agent is pinned as itself, on the account, wherever it stands, so its tab's Pin is the agent's.
  const pinDoor = (agentId: string): TabPin => {
    const pinned = pins.pinned(agentId);
    return { pinned, onToggle: () => pins.onPin(agentId, !pinned) };
  };
  const doorsOf = (entry: DrawnTab): TabDoors => {
    // An agent's link is its own action (`agent-actions.tsx`).
    const linked: LinkPlace | undefined =
      entry.agent === undefined ? undefined : { kind: LINK_PLACE.AGENT, agentId: entry.agent.id };
    const { agent } = entry;
    return {
      chosen: entry.look.selected,
      onClose: entry.close,
      onCloseOthers: closeOthersOf(entry),
      // Note that an archived agent offers no pin, as its sidebar row does none, since no pin of it is drawn until it comes back.
      pin: agent === undefined || agent.archivedAt !== undefined ? undefined : pinDoor(agent.id),
      copyLink: linked === undefined ? undefined : copyLink(linked),
      // Overview's menu is the task's own, its Pin and Copy link among it.
      document: isOverviewTab(entry.tab) ? planMenu : undefined,
    };
  };
  return (
    <MainTabsRow>
      <TabStrip
        label="Task"
        ground={TABS_GROUND.GROUND}
        onMove={(from, to) => {
          // Note that the strip counts its moves among the tabs after Overview, which never moves.
          const entry = strip.filter((each) => !isOverviewTab(each.tab))[from];
          if (entry !== undefined) main.onMove(entry.tab, to);
        }}
      >
        {strip.map((entry) =>
          entry.agent === undefined ? (
            <DoorsTab
              key={tabKey(entry.tab)}
              look={entry.look}
              doors={doorsOf(entry)}
              slot={slot}
              // A phone's header names itself by the task, and offers the task's menu on Overview.
              onShown={isOverviewTab(entry.tab) ? undefined : onShown}
            />
          ) : (
            <AgentMenuTab
              key={tabKey(entry.tab)}
              agent={entry.agent}
              agents={agents}
              look={entry.look}
              doors={doorsOf(entry)}
              shown={shown}
              keys={keys}
              terminals={{ onOpenTerminal }}
              slot={slot}
              onShown={onShown}
            />
          ),
        )}
      </TabStrip>
      {/* The first read of the plan's agents did not land: nothing is known
          to draw, so the row offers the read again where the tabs would be,
          after the strip rather than in it, so the strip's scrolling never
          takes it out of reach, and as its glyph alone where the bar is
          short of room (desktop.css's `plan-toolbar`). */}
      {agents.listFailed && agents.agents === undefined ? (
        <RetryButton label={RETRY_AGENTS} onRetry={agents.onRetryList} />
      ) : null}
      {/* While the agents are read, one tab-shaped block stands where their
          tabs will, as it stood while the task was read, so the row holds
          still until they land. */}
      {agents.agents === undefined && !agents.listFailed ? <TabSkeleton /> : null}
      <AddTabButton
        label="Open a tab"
        placeholder="Search tabs"
        noMatch="No tabs match"
        entries={addEntries(main, agents, views.held)}
        onOpen={agents.onRetryList}
        asked={main.newTabAsked}
        answers={keys}
        onAnswered={main.onNewTabAnswered}
      />
    </MainTabsRow>
  );
}

/** What a tab of the column is called to a reader of it. */
export function mainTabLabel(tab: MainTab, agents: AgentsControl): string | undefined {
  if (isOverviewTab(tab)) return tabLook({ kind: TAB_KIND.OVERVIEW }).label;
  if (isDraftTab(tab)) return tabLook({ kind: TAB_KIND.DRAFT }).label;
  const agent = agents.agents?.find((each) => each.id === tab.agent);
  return agent === undefined ? undefined : agentName(agent, agents.models);
}

/**
 * What an agent's or the draft's tab shows in the column: the agent's
 * transcript and composer, or the draft's composer. A delegation's row in an
 * agent's transcript opens its worker in the side panel, through
 * `onOpenDelegation`, its pull request's chip the pull request,
 * through `onOpenPullRequest`, and a call about something drawn in a tab of its
 * own that tab, through `onOpenTarget`, each such row hanging that tab's
 * card (`cards`).
 */
export function MainTabContent({
  tab,
  agents,
  shown,
  views,
  onOpenDelegation,
  onOpenPullRequest,
  onOpenTarget,
  cards,
  onFork,
  onContinue,
}: {
  tab: Exclude<MainTab, typeof MAIN_TAB.OVERVIEW>;
  agents: AgentsControl;
  /** Whether the column is on screen, so an agent's tab knows to follow its transcript. */
  shown: boolean;
  views: TabViews;
  onOpenDelegation: (agentId: string, callId: string, task: string, status: AgentStatus) => void;
  /** Opens the agent's pull request in the side panel, by the agent; none where no side panel stands to show it. */
  onOpenPullRequest?: ((agentId: string) => void) | undefined;
  /** Opens what a call in the agent's transcript is about in the tab that draws it. */
  onOpenTarget: (target: ToolTarget) => void;
  /** The cards the transcript's rows that open a tab hang, as those tabs hang them. */
  cards: TaskCards;
  /** Opens the task's draft as a fork of one of an agent's messages; none where no draft opens, as on an agent no task holds. */
  onFork?: ((fork: AgentFork) => void) | undefined;
  /** Opens the task's draft as a continue of an agent with the words and files its closed box held; none where no draft opens, as on an agent no task holds. */
  onContinue?:
    | ((agentId: string, words: string, attachments: readonly AgentAttachment[]) => void)
    | undefined;
}): React.JSX.Element {
  if (isDraftTab(tab)) {
    // The tab stands for a draft the task no longer holds only until the
    // column moves back to the task, a render away.
    return agents.draft?.id === tab.draft ? (
      <DraftAgentTab key={tab.draft} draft={agents.draft} control={agents} cards={cards.call} />
    ) : (
      <AgentTabSkeleton />
    );
  }
  const agentId = tab.agent;
  // A Start still making its agent draws the agent's tab as it will land, saying it is starting.
  if (agents.start.pending?.key === agentId) return <StartingAgentTab key={agentId} />;
  // The tab follows its agent's transcript by the id alone, so a task opened
  // on an agent reads it beside the task's list of agents rather than after
  // it; what needs the agent itself waits for the list in the tab's shape.
  // Note that the tab stands for an agent the list no longer holds only until
  // the column moves back to the task, a render away.
  const agent = agents.agents?.find((each) => each.id === agentId);
  return (
    <ForkProvider
      key={agentId}
      value={
        agent === undefined
          ? undefined
          : agentForkDoors({
              agent,
              control: agents,
              onFork,
              onContinue,
              cards: cards.agent(agentId),
              onOpenTarget,
            })
      }
    >
      <AgentTab
        agentId={agentId}
        agent={agent}
        control={agents}
        shown={shown}
        onOpenSubagent={(callId, task, status) => onOpenDelegation(agentId, callId, task, status)}
        onOpenPullRequest={
          onOpenPullRequest === undefined ? undefined : () => onOpenPullRequest(agentId)
        }
        onOpenTarget={onOpenTarget}
        cards={cards.agent(agentId)}
        onHeld={views.onAgentHeld}
        run={agents.origin}
      />
    </ForkProvider>
  );
}

/**
 * One agent's pane: what an agent's or the draft's tab shows
 * (`MainTabContent`), at the document's reading width (`.desktop-agent`).
 * The task column draws it for the tab it shows, as the panel of that tab,
 * and the page of an agent no plan holds draws it for its agent
 * (`desktop-agent-page.tsx`), so an agent reads, finds, and is written to
 * alike wherever it stands.
 *
 * A memo boundary: the task's page drawn again over the same agent and the
 * same doors, as its column's focus and its side panel's width draw it,
 * leaves the agent's transcript as it was.
 */
export const AgentPane = memo(function AgentPane({
  label,
  tabbed,
  ...content
}: Omit<Parameters<typeof MainTabContent>[0], "tab"> & {
  /** The agent's or the draft's tab whose pane it is; Overview's is the task's page's own. */
  tab: Exclude<MainTab, typeof MAIN_TAB.OVERVIEW>;
  /** What the pane is called to a reader: the agent's tab's name. */
  label: string | undefined;
  /** Whether the pane is the panel of a tab in a strip, as the task column's is. */
  tabbed: boolean;
}): React.JSX.Element {
  return (
    <Fill
      as={FILL_ELEMENT.SECTION}
      className="desktop-agent"
      role={tabbed ? "tabpanel" : undefined}
      aria-label={label}
      data-popover-room=""
    >
      <MainTabContent {...content} />
    </Fill>
  );
});
