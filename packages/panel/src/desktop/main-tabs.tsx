import {
  AGENT_BOUNDS,
  AGENT_STATUS,
  type AgentAttachment,
  type AgentStatus,
  type AgentSummary,
} from "@repo/features/agent-wire";
import { LINK_PLACE, type LinkPlace } from "@repo/features/link-grammar";
import { TASK_BOUNDS, type TaskSummary } from "@repo/features/task-wire";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  FILL_ELEMENT,
  Fill,
  IconButton,
  INLINE_EDIT_LOOK,
  InlineEdit,
  PlusIcon,
  RetryButton,
  TABS_GROUND,
  TOOLBAR_INSET,
  TOOLBAR_LOOK,
  Toolbar,
  Tooltip,
  useMenu,
} from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import {
  agentTab,
  draftTab,
  inTaskOrder,
  isDraftTab,
  type StripTab,
  sameTab,
  tabKey,
} from "@repo/ui/tab-strip-model";
import type { InlineRename } from "@repo/ui/use-inline-rename";
import { memo, useEffect, useRef } from "react";
import { FOCUSED_OFFER, useAppCommand } from "../app-commands.js";
import { useDraftedAgents } from "../composer-drafts.js";
import { useCopyLinkItem } from "../copy-link-item.js";
import { DraftMark, leftMark } from "../draft-mark.js";
import { agentName, startsOwnAgents } from "../tasks/agent-model.js";
import { agentCardReading } from "../tasks/agent-ref.js";
import { AgentTab, StartingAgentTab } from "../tasks/agent-tab.js";
import { AgentTabCard } from "../tasks/agent-tab-card.js";
import { AgentTabSkeleton } from "../tasks/agent-tab-skeleton.js";
import { DraftAgentTab } from "../tasks/draft-agent-tab.js";
import { useFailedAgents } from "../tasks/failed-lines.js";
import { agentForkDoors, ForkProvider } from "../tasks/fork-action.js";
import type { AgentFork } from "../tasks/fork-model.js";
import { stripTabTitle, UNREAD_TAB_NAMES } from "../tasks/strip-tab-kinds.js";
import { agentEndMark, TAB_KIND, tabLook } from "../tasks/tab-look.js";
import type { AgentThreads } from "../tasks/threads-dock.js";
import type { ToolTarget } from "../tasks/tool-call-model.js";
import { TRANSCRIPT_COPY } from "../tasks/transcript-copy.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import type { MAIN_TAB, MainTab, MainTabsControl } from "../tasks/use-main-tabs.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { type AgentTerminalDoors, useAgentActions } from "./agent-actions.js";
import { AgentHistory } from "./agent-history.js";
import type { TaskCards } from "./side-panel.js";
import {
  type AddEntry,
  type DocumentMenu,
  DoorsTab,
  type HeldTranscripts,
  type ShownTab,
  type TabDoors,
  type TabLook,
  type TabPin,
  type TabViews,
} from "./strip-tabs.js";
import { LOOK_STRIP, useStripLooks } from "./switcher-looks.js";
import { tabCard } from "./tab-card.js";
import { TabStrip } from "./tab-strip.js";
import { WaitingCount } from "./task-row-parts.js";

/**
 * main-tabs.tsx -- the task's topbar and its column's tabs: the topbar naming the task, its name opening its details, and the task's ⋯, each agent's tab and the draft agent's under it, the "+" that opens one, and what an agent's or the draft's tab shows in the column.
 *
 * A task opens on its agents, as Conductor opens a workspace on its chats:
 * the topbar names the task across its page (`TaskTopbar`), and the column's
 * bar holds the agents' tabs (`MainTabBars`). Each part draws what
 * `use-main-tabs.ts` holds and hands every press back to it. The strip is
 * the side panel's in every way: the same pills, the
 * same hover and chosen fills, dragged and stepped along, closed by ×,
 * Delete, ⌘W, or the menu's Close and Close others, each tab's menu on a
 * right-click (`strip-tabs.tsx`). An agent's own actions, its one menu
 * (`agent-actions.tsx`), stand on its tab's right-click after the tab's
 * keeping, with what its transcript hands up while it is shown; no ⋯
 * stands on the bar.
 *
 * The task's details, its Overview (its head and its description, which
 * the task's page draws, `desktop-tasks.tsx`), are no tab among the agents:
 * the task's name in the topbar opens them across the page, in place of the column's
 * bar and the side panel, with the way back to the agents in their own card,
 * so no tab ever stands with none chosen. The task's menu is its name's right-click in the
 * topbar, whatever the column shows.
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
 * The "+" after the last tab opens a New agent at once, as ⌘T does: a draft
 * agent's tab, or the task's draft where it has one, unavailable with Start's
 * own reason while Start could not run. An archived task starts nothing, so
 * it draws no "+", and its agents are not renamed. The task's agents whose
 * tabs are closed, and those archived, stand behind History at the bar's
 * end (`agent-history.tsx`), which opens them again.
 */

/** The section the task's agents stand under where they are listed among other things, as ⌘K lists them, and the details' way back names. */
export const AGENTS_SECTION = "Agents";

/** What the row that opens a draft says while a Start is out. */
const NEW_AGENT_STARTING = "Starting…";

/** The row that opens the task's Inbox, which no agent's id spells. */
const INBOX_ROW = "inbox";

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
  onShown,
}: {
  look: TabLook;
  doors: TabDoors;
  /** The rename the tab's menu opens; none where nothing is renamed, as on an archived task. */
  rename: InlineRename | undefined;
  /** What the field is called for a reader and how long a name it takes; a task's where absent. */
  field?: { label: string; maxLength: number } | undefined;
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
  onOpenBrowser,
  onShown,
}: {
  agent: AgentSummary;
  agents: AgentsControl;
  look: TabLook;
  doors: TabDoors;
  shown: boolean;
  /** Whether the strip drawing the tab offers its keys, which the chosen agent's copies and delete answer while it does. */
  keys: boolean;
  terminals: Pick<AgentTerminalDoors, "onOpenTerminal" | "onOpenLocal">;
  /** Opens a new tab of the agent's cloud browser in the side panel, by the agent; a phone's alone (`useAgentActions`). */
  onOpenBrowser?: ((agentId: string) => void) | undefined;
  /** Hears the tab while it is the one shown, for a phone's header (`DoorsTab`). */
  onShown: ((shown: ShownTab | undefined) => void) | undefined;
}): React.JSX.Element {
  const actions = useAgentActions(agent, agents, {
    label: look.label,
    shown,
    terminals,
    onOpenBrowser,
    onDeleted: doors.onClose,
  });
  // The chosen agent's ⌥⌘C, ⇧⌥⌘C, and ⌘⌫ while the column has the keys, over the open task's description and its delete.
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
 * The agents' tabs and the draft's, in the order started, each closing
 * through `main`. An agent's card previews its
 * latest step from what its tab last held (`heldLatest`). An agent's tab,
 * and the draft's, wears the Draft pencil at its end while its box holds
 * words and another tab is chosen (`draft-mark.tsx`), or the failed mark in
 * its place while a message sent to it was not delivered; an agent's failure
 * says more, so it keeps its failed mark in the pencil's place.
 */
function agentTabs(input: {
  main: MainTabsControl;
  agents: AgentsControl;
  unread: readonly StripTab[];
  views: TabViews;
  /** The started agents whose boxes hold a draft (`useDraftedAgents`). */
  drafted: readonly string[];
  /** The started agents holding a message not delivered (`useFailedAgents`). */
  failed: readonly string[];
  /** The threads waiting on the developer, by the agent that posted them, which an agent's tab counts. */
  waiting: ReadonlyMap<string, readonly unknown[]> | undefined;
}): DrawnTab[] {
  const { main, agents, unread, views, drafted, failed, waiting } = input;
  const chosen = (tab: MainTab) => main.tab !== undefined && sameTab(tab, main.tab);
  const models = agents.models ?? [];
  const look = (tab: MainTab, drawn: Omit<TabLook, "selected" | "onSelect">) => ({
    ...drawn,
    unread: unread.some((each) => sameTab(each, tab)),
    selected: chosen(tab),
    onSelect: () => main.onChoose(tab),
  });
  const open = (agents.agents ?? []).filter((agent) => main.openAgents?.includes(agent.id));
  const own = open.map((agent) => {
    const tab = agentTab(agent.id);
    const label = agentName(agent, agents.models);
    const readCard = agentCardReading(agent, label, views.held, chosen(tab), agents);
    // A message to it that did not go wears the failed mark in the pencil's place.
    const placeMark = chosen(tab)
      ? undefined
      : (leftMark(failed.includes(agent.id), drafted.includes(agent.id)) ?? undefined);
    const waits = waiting?.get(agent.id)?.length ?? 0;
    return {
      tab,
      agent,
      look: look(tab, {
        ...tabLook({ kind: TAB_KIND.AGENT, name: label, agent }),
        // A count of threads waiting on the developer leads, as the task's Inbox row counts them.
        endMark:
          (waits === 0 ? undefined : <WaitingCount count={waits} />) ??
          agentEndMark(agent, false) ??
          placeMark,
        card: <AgentTabCard name={label} models={models} read={readCard} />,
      }),
      close: () => main.onClose(tab),
    };
  });
  // A Start still making its agent stands as that agent's tab under the press's key, which nothing closes but its answer.
  const pending = agents.start.pending;
  const startingTab = pending === undefined ? undefined : agentTab(pending.key);
  const starting =
    startingTab === undefined || main.openAgents?.includes(startingTab.agent) !== true
      ? []
      : [
          {
            tab: startingTab,
            look: look(startingTab, {
              ...tabLook({
                kind: TAB_KIND.AGENT,
                name: undefined,
                agent: { model: pending?.model ?? "", status: AGENT_STATUS.STARTING },
              }),
              labelReplayUnmasked: true,
            }),
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
            tab: draftTab(draft),
            look: look(draftTab(draft), {
              ...tabLook({ kind: TAB_KIND.DRAFT }),
              labelReplayUnmasked: true,
              endMark: draftHolds && !chosen(draftTab(draft)) ? <DraftMark /> : undefined,
            }),
            close: () => {
              main.onClose(draftTab(draft));
              agents.onDiscardDraft(draft);
            },
          },
        ];
  return [...own, ...starting, ...drafts];
}

/**
 * Each of the task's agents in the order started, as History lists a closed
 * one (`agent-history.tsx`), the Overview's agents list it, and ⌘K finds it, in its
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
    const chosen = main.tab !== undefined && sameTab(agentTab(agent.id), main.tab);
    return {
      row: {
        id: agent.id,
        ...tabLook({ kind: TAB_KIND.AGENT, name: label, agent }),
        section: AGENTS_SECTION,
        replayMasked: true,
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
      onPick: () => main.onChoose(agentTab(agent.id)),
      agent,
    };
  });
}

/** The task's Inbox as a row, its tray and its name, which picking opens through `onPick`. */
function inboxEntry(waiting: number, onPick: () => void): AddEntry {
  return {
    row: { id: INBOX_ROW, ...tabLook({ kind: TAB_KIND.INBOX }) },
    endMark: waiting === 0 ? undefined : <WaitingCount count={waiting} />,
    onPick,
  };
}

/**
 * The task's Inbox as ⌘K offers it, by itself rather than among the task's
 * agents, though only they post to it; none on a task with no agent and
 * nothing main says waits on it (`waiting`, how many), which holds the Inbox
 * while its agents are unread and is counted at its end as the task's Inbox
 * row counts it. Picking it opens the window's Inbox narrowed to the task,
 * through `onPick`.
 */
export function inboxEntries(
  agents: AgentsControl,
  waiting: number,
  onPick: () => void,
): AddEntry[] {
  // An archived agent's items still stand, so the row stands while the task holds any agent.
  if ((agents.heldIds?.length ?? 0) === 0 && waiting === 0) return [];
  return [inboxEntry(waiting, onPick)];
}

/**
 * New agent, the one start the "+" and the plan's agents offer alike:
 * a draft opened in the column, unavailable while a Start is out, and left
 * out on an archived task and on a pilot task, whose agents are its pilot's
 * to start (`startsOwnAgents`).
 */
export function newAgentStarts(main: MainTabsControl, agents: AgentsControl): MenuAction[] {
  if (agents.onUnarchive !== undefined || !startsOwnAgents(agents.mode)) return [];
  const reason = agents.start.busy ? NEW_AGENT_STARTING : undefined;
  return [
    {
      label: tabLook({ kind: TAB_KIND.DRAFT }).label,
      detail: reason,
      disabled: reason !== undefined,
      onSelect: () => main.onChoose(draftTab(agents.onNewDraft())),
    },
  ];
}

/**
 * The "+" after the column's last tab: New agent (`newAgentStarts`) on a
 * press, unavailable with Start's reason while a Start is out, and nothing
 * on a task that starts no agent of its own. ⌘T's ask starts it as a press
 * does, once the column is on screen to take it (`answers`), and is let go
 * once answered, since the "+" stands again each time its column is shown.
 */
function NewAgentButton({
  start,
  asked,
  answers,
  onAnswered,
}: {
  start: MenuAction | undefined;
  asked: boolean;
  answers: boolean;
  onAnswered: () => void;
}): React.JSX.Element | null {
  const onStart = start === undefined || start.disabled === true ? undefined : start.onSelect;
  useEffect(() => {
    if (!asked || !answers) return;
    onAnswered();
    onStart?.();
  }, [asked, answers, onAnswered, onStart]);
  if (start === undefined) return null;
  return (
    <Tooltip label={start.detail ?? start.label} command={APP_COMMAND.NEW_TAB}>
      <IconButton
        icon={<PlusIcon />}
        label={start.label}
        disabled={start.disabled}
        focusableWhenDisabled
        onClick={start.onSelect}
      />
    </Tooltip>
  );
}

/**
 * What a phone's Overview offers after the task's agents in place of the
 * column's hidden "+" (`plan-agents.tsx`): New agent as the "+" offers it
 * (`newAgentStarts`), and the agents' read again where it never landed, as
 * the strip's Retry offers it.
 */
export function phoneAgentStarts(main: MainTabsControl, agents: AgentsControl): MenuAction[] {
  const retry: MenuAction[] =
    agents.listFailed && agents.agents === undefined
      ? [{ label: RETRY_AGENTS, onSelect: agents.onRetryList }]
      : [];
  return [...newAgentStarts(main, agents), ...retry];
}

/** The row the column's tabs stand in, which is its toolbar's title: the strip, what follows it, and the "+" last. */
function MainTabsRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="main-tabs flex items-center gap-list-gap">{children}</div>;
}

/** What the task's name in its topbar opens, and the place the details' way back leads to. */
export const DETAILS_WORDS = { HINT: "Task details", PLACE: "agents" } as const;

/** What the task's menu is named, which a right-click on its name opens. */
const TASK_MENU_LABEL = "Task actions";

/**
 * The task's topbar, across the task's page over its column and its side
 * panel: the task's status mark and name, the two one press, hanging the
 * task's card, that opens the
 * task's details across the page and, pressed again, goes back to the agents
 * (`details`), as a channel's name opens its details, and whose right-click
 * is the task's own menu (`descriptionMenu`), whichever the page shows; then
 * `actions`. No ⋯ stands on the bar, as none stands on the tab rows under
 * it: every menu there is a right-click. The window's side panel toggle
 * stands at its end (`desktop-shell.tsx`).
 */
export function TaskTopbar({
  task,
  details,
  descriptionMenu,
  shown,
  actions,
}: {
  /** The task as the list names it now, its name and status first there. */
  task: Pick<TaskSummary, "id" | "name" | "status"> | undefined;
  /** Whether the task's details stand in the column, and the press that opens or leaves them. */
  details: { readonly shown: boolean; readonly onToggle: () => void } | undefined;
  /** The task's own menu, which its ⋯ draws. */
  descriptionMenu: DocumentMenu | undefined;
  /** Whether the task's page is on screen, for the menu not to outlive it. */
  shown: boolean;
  actions?: React.ReactNode;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const look =
    task === undefined
      ? undefined
      : tabLook({ kind: TAB_KIND.PLAN, status: task.status, name: task.name });
  return (
    <>
      <Toolbar
        // Note that the status mark stands inside the name's press, as a task's chip wears it, where the name opens the details.
        lead={details === undefined ? look?.icon : undefined}
        title={task?.name}
        titleMenu={
          task === undefined || descriptionMenu === undefined
            ? undefined
            : { contextMenu: menu.contextMenu(), keyMenu: menu.keyMenu }
        }
        titlePress={
          details === undefined || task === undefined
            ? undefined
            : {
                open: details.shown,
                label: DETAILS_WORDS.HINT,
                icon: look?.icon,
                // The task's card, as its sidebar row and its chips hang it.
                card: tabCard({
                  kind: TAB_KIND.PLAN,
                  taskId: task.id,
                  name: task.name,
                  status: task.status,
                }),
                onPress: details.onToggle,
              }
        }
        measure
        actions={actions}
      />
      {menu.drawn === undefined || descriptionMenu === undefined ? null : (
        <ActionMenu
          label={TASK_MENU_LABEL}
          menu={menu.drawn}
          subject={descriptionMenu.subject}
          footer={descriptionMenu.footer}
          groups={descriptionMenu.groups()}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/**
 * The column's bar: the agents' tabs and the draft's, then the "+", which
 * stands apart from the strip so it is never dragged nor dropped before,
 * then the chosen agent's ⋯ and `actions`. The task's details stand in place
 * of the bar and the side panel alike, so no tab ever stands with none
 * chosen. ⌘W closes the chosen tab while the column holds the window's
 * focus (`keys`).
 */
export function MainTabBars({
  task,
  main,
  agents,
  unread,
  views,
  pins,
  keys,
  shown,
  onOpenTerminal,
  onOpenLocal,
  onOpenBrowser,
  onShown,
  onOpenAgent,
  waiting,
}: {
  /** The task the column is, whose strip's looks the switcher keeps. */
  task: Pick<TaskSummary, "id">;
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
  /** Opens a cloud agent's own Local tab in the side panel, adding no shell, by the agent; none where the platform mirrors no agent's files. */
  onOpenLocal?: ((agentId: string) => void) | undefined;
  /** Opens a new tab of an agent's cloud browser in the side panel, by the agent; a phone's alone, whose ⋯ offers it beside Show terminal. */
  onOpenBrowser?: ((agentId: string) => void) | undefined;
  /** Hears the tab the column shows, for a phone's header, whose ⋯ offers what the tab's right-click would (`task-pane-switcher.tsx`); none wider than a phone. */
  onShown?: ((shown: ShownTab | undefined) => void) | undefined;
  /** Opens an agent from History: a closed one's tab in the column, an archived one's own page. */
  onOpenAgent: (agentId: string) => void;
  /** The threads waiting on the developer, by the agent that posted them (`waitingByAgent`), which each agent's tab counts. */
  waiting?: ReadonlyMap<string, readonly unknown[]> | undefined;
}): React.JSX.Element {
  const drafted = useDraftedAgents();
  const failed = useFailedAgents();
  // The agents' and the draft's tabs in the column's order, which the
  // developer's moves and their opening set (`use-main-tabs.ts`).
  const strip = inTaskOrder(
    agentTabs({ main, agents, unread, views, drafted, failed, waiting }),
    main.tabs,
    (entry) => entry.tab,
  );
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
    return { pinned, onToggle: () => pins.onPin(agentId, !pinned), agent: true };
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
    };
  };
  return (
    <Toolbar
      start={TOOLBAR_INSET.COLUMN}
      look={TOOLBAR_LOOK.TABS}
      measure
      title={
        <MainTabsRow>
          <TabStrip
            label="Agents"
            ground={TABS_GROUND.GROUND}
            onMove={(from, to) => {
              const entry = strip[from];
              if (entry !== undefined) main.onMove(entry.tab, to);
            }}
          >
            {strip.map((entry) =>
              entry.agent === undefined ? (
                <DoorsTab
                  key={tabKey(entry.tab)}
                  look={entry.look}
                  doors={doorsOf(entry)}
                  onShown={onShown}
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
                  terminals={{ onOpenTerminal, onOpenLocal }}
                  onOpenBrowser={onOpenBrowser}
                  onShown={onShown}
                />
              ),
            )}
          </TabStrip>
          {/* The first read of the task's agents did not land: nothing is known
                to draw, so the row offers the read again where the tabs would be,
                after the strip rather than in it, so the strip's scrolling never
                takes it out of reach, and as its glyph alone where the bar is
                short of room (desktop.css's `main-tabs`). */}
          {agents.listFailed && agents.agents === undefined ? (
            <ReplayUnmask>
              <RetryButton label={RETRY_AGENTS} onRetry={agents.onRetryList} />
            </ReplayUnmask>
          ) : null}
          <NewAgentButton
            start={newAgentStarts(main, agents)[0]}
            asked={main.newTabAsked}
            answers={keys}
            onAnswered={main.onNewTabAnswered}
          />
        </MainTabsRow>
      }
      actions={
        <AgentHistory
          main={main}
          agents={agents}
          held={views.held}
          shown={shown}
          onOpenAgent={onOpenAgent}
        />
      }
    />
  );
}

/** What a tab of the column is called to a reader of it. */
export function mainTabLabel(tab: MainTab, agents: AgentsControl): string | undefined {
  return stripTabTitle(tab, {
    ...UNREAD_TAB_NAMES,
    agent: (agentId) => {
      const agent = agents.agents?.find((each) => each.id === agentId);
      return agent === undefined ? undefined : agentName(agent, agents.models);
    },
  });
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
  threads,
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
  /** The threads the agent posted that wait on the developer, docked over its box; none where nothing waits. */
  threads?: AgentThreads | undefined;
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
        threads={threads}
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
  hidden = false,
  ...content
}: Omit<Parameters<typeof MainTabContent>[0], "tab"> & {
  /** The agent's or the draft's tab whose pane it is; Overview's is the task's page's own. */
  tab: Exclude<MainTab, typeof MAIN_TAB.OVERVIEW>;
  /** What the pane is called to a reader: the agent's tab's name. */
  label: string | undefined;
  /** Whether the pane is the panel of a tab in a strip, as the task column's is. */
  tabbed: boolean;
  /** Whether the agent's threads stand in its place (`agent-threads.tsx`), which keeps it drawn beneath, hidden, so going back finds the transcript where it was. */
  hidden?: boolean | undefined;
}): React.JSX.Element {
  return (
    <Fill
      as={FILL_ELEMENT.SECTION}
      className="desktop-agent"
      role={tabbed ? "tabpanel" : undefined}
      aria-label={label}
      hidden={hidden}
      data-popover-room=""
    >
      <MainTabContent {...content} />
    </Fill>
  );
});
