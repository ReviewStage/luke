import {
  CODING_AGENT_BOUNDS,
  type CodingAgentAttachment,
  type CodingAgentBrief,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { LINK_PLACE, type LinkPlace } from "@luke/features/luke-link";
import { TASK_BOUNDS, type TaskSummary } from "@luke/features/task-wire";
import { useAppCommand } from "@luke/panel/app-commands";
import { useCopyLinkItem } from "@luke/panel/copy-link-item";
import { TabStrip } from "@luke/panel/desktop/tab-strip";
import { RetryButton } from "@luke/panel/retry-button";
import { SpinnerRegion } from "@luke/panel/spinner";
import { AgentTabCard } from "@luke/panel/tasks/agent-tab-card";
import { agentTabLabel } from "@luke/panel/tasks/coding-agent-model";
import type { AgentFork } from "@luke/panel/tasks/fork-model";
import { NEEDS_YOU } from "@luke/panel/tasks/inbox-model";
import { agentEndMark, TAB_KIND, tabLook } from "@luke/panel/tasks/tab-look";
import type { ToolTarget } from "@luke/panel/tasks/tool-call-model";
import {
  agentTranscript,
  readWholeTranscript,
  type TranscriptCopy,
} from "@luke/panel/tasks/transcript-copy";
import type { CodingAgentsControl } from "@luke/panel/tasks/use-coding-agents";
import { MAIN_TAB, type MainTab, type MainTabsControl } from "@luke/panel/tasks/use-main-tabs";
import type { ColumnPinnableTab, PinnedTab } from "@luke/panel/tasks/use-side-panel";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { INLINE_EDIT_LOOK, InlineEdit } from "@luke/ui";
import { inTaskOrder, isDraftTab, type StripTab, sameTab, tabKey } from "@luke/ui/tab-strip-model";
import { type InlineRename, useInlineRename } from "@luke/ui/use-inline-rename";
import { useEffect, useRef } from "react";
import { agentCardReading } from "../tasks/agent-ref";
import { AgentTab } from "../tasks/agent-tab";
import type { ChatNoticeDoors } from "../tasks/chat-notice";
import { DraftAgentTab } from "../tasks/draft-agent-tab";
import { agentForkDoors, ForkProvider } from "../tasks/fork-action";
import { useAgentArchive } from "./agent-archive";
import type { TaskCards } from "./side-panel";
import {
  type AddEntry,
  AddTabButton,
  DoorsTab,
  type TabDoors,
  type TabLook,
  type TabPin,
  type TabViews,
  type TranscriptCopier,
  type TranscriptRead,
  useTranscriptCopier,
} from "./strip-tabs";

/**
 * main-tabs.tsx -- the task's column's tabs: the plan's own, each coding agent's, the draft agent's, and the Inbox's after it, the "+" that opens one, and what an agent's or the draft's tab shows in the column.
 *
 * Each part draws what `use-main-tabs.ts` holds and hands every press back
 * to it. The strip is the side panel's in every way but its first tab: the
 * same pills, the same hover and chosen fills, dragged and stepped along,
 * closed by ×, Delete, ⌘W, or the menu's Close and Close others, each tab's
 * menu on a right-click (`strip-tabs.tsx`). The toolbar's ⋯ acts on the
 * chosen tab: the task's actions on the plan's tab, and on an agent's its
 * Rename, its Open terminal, its transcript's copies, and its Archive,
 * standing in the one slot the toolbar keeps for it, left empty on a tab
 * with nothing of the kind.
 *
 * The plan's tab stands first, named for the task, and hangs the task's
 * card, as its sidebar row does (`task-card.tsx`): its repository, its
 * agents, and its pull requests. It is anchored there: it never moves, and
 * Close others on it closes every other tab. Beside another tab it closes
 * as that tab does, and the "+" offers the plan first to open it again; as
 * the column's only tab it offers no close, so the column is never empty
 * (`use-main-tabs.ts`). A press chooses it; its menu renames the task in
 * place, as the ⋯ menu does. While it is the column's only tab it is quiet,
 * drawing no fill at rest, as a lone tab need not be told from others;
 * beside an agent's it is drawn as any tab is.
 *
 * The task's Inbox tab stands among the agents' while it is open: an item
 * the developer has not seen opens it after every tab, and it closes and
 * moves as an agent's tab does (`use-main-tabs.ts`). It counts the items
 * that wait on the developer after its name, dimmed as a model's effort is
 * after the model's, so an item posted while the developer reads elsewhere
 * is seen from any tab. Its menu offers Pin tab as an agent's does; pinned,
 * it wears no × and offers no Close, so it stands on its task whether or
 * not anything new waits, until Unpin tab.
 *
 * Each agent's tab is named by its title, or its model until it has one,
 * wearing its harness's mark for where the agent stands, a ring while it
 * works and an alert once it failed, and hangs a card naming it whole with
 * when it last moved and its latest step, read from what its tab last drew
 * and never from the service. Its menu offers Pin tab, which puts it in the
 * sidebar, Rename, which turns the tab into its name's field, Open
 * terminal, which shows the agent's own Terminal tab in the side panel as
 * ⌘J does from the tab, and its transcript's two copies. Closing it closes
 * only the view: the agent goes on as it was, and the "+" opens it again. A
 * tab an agent ended on while no one was looking at it reads in semibold
 * until shown. The draft's tab,
 * named New coding agent as the "+" row that opens it is, stands after the
 * agents until its first message starts the agent, and closing it lets the
 * draft go. Every tab wears its kind's look (`tab-look.tsx`).
 *
 * The "+" after the last tab drops the shared searchable menu: the plan,
 * which chooses its tab or opens it again where it was closed, New coding
 * agent, which opens a draft agent's tab, or chooses the task's draft where
 * it has one, unavailable with Start's own reason while Start could not
 * run, the task's Inbox where it has an agent, and each of the task's
 * agents in the order started, picking one choosing its tab or opening it
 * again. An archived task starts no agent,
 * so its menu offers only the agents to read, and its agents are not
 * renamed.
 */

/** The "+" menu's section for the task's agents, which the task's summary lists under the same heading. */
export const AGENTS_SECTION = "Coding agents";

/** The "+" menu's row that opens a draft agent, which no agent's id spells. */
const NEW_AGENT_ROW = "new-coding-agent";

/** What the row that opens a draft says while a Start is out. */
const NEW_AGENT_STARTING = "Starting…";

/** The row that opens the task's Inbox, which no agent's id spells. */
export const INBOX_ROW = "inbox";

/** The "+" menu's row that opens the plan's own tab, which no agent's id spells. */
const PLAN_ROW = "plan";

/** What the press that reads the plan's agents again, after a first read did not land, says. */
const RETRY_AGENTS = "Retry agents";
/** The "+" menu's row for the plan's Chat tab. */
const CHAT_ROW = "chat";

/** A coding agent's transcript read whole from the service under the title given, since its tab holds it only while shown. */
export function agentTranscriptRead(
  readTranscript: CodingAgentsControl["readTranscript"],
  agentId: string,
  title: string,
  brief: CodingAgentBrief | undefined,
  chatOn: boolean,
): TranscriptRead {
  return () =>
    readWholeTranscript(readTranscript, { agentId }).then((messages) =>
      messages === undefined ? undefined : agentTranscript({ title, messages, brief, chatOn }),
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
  slot,
}: {
  look: TabLook;
  doors: TabDoors;
  /** The rename the tab's menu opens; none where nothing is renamed, as on an archived task. */
  rename: InlineRename | undefined;
  /** What the field is called for a reader and how long a name it takes; a plan's where absent. */
  field?: { label: string; maxLength: number } | undefined;
  /** The toolbar's slot the chosen tab's ⋯ stands in; none for the plan's, whose ⋯ the toolbar draws itself. */
  slot?: HTMLElement | null | undefined;
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
      <InlineEdit
        value={look.label}
        label={field?.label ?? "Task name"}
        maxLength={field?.maxLength ?? TASK_BOUNDS.MAX_NAME_CHARS}
        look={INLINE_EDIT_LOOK.WELL}
        editing
        onEnd={(edit) => {
          refocus.current = edit.byKey;
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
    />
  );
}

/** An agent's tab, renamed in place from its menu while its task is not archived, and archived from it (`agent-archive.tsx`). */
function AgentMenuTab({
  agent,
  agents,
  look,
  doors,
  shown,
  slot,
}: {
  agent: CodingAgentSummary;
  agents: CodingAgentsControl;
  look: TabLook;
  doors: TabDoors;
  shown: boolean;
  slot: HTMLElement | null;
}): React.JSX.Element {
  const rename = useInlineRename(agent.id, agents.onRename);
  const archive = useAgentArchive(agent, agents, shown);
  return (
    <>
      <RenamableTab
        look={look}
        doors={{ ...doors, archive: archive.action }}
        // A rename still open when the task is archived elsewhere is let go unsaved.
        rename={agents.onUnarchive === undefined ? rename : undefined}
        field={{ label: "Agent name", maxLength: CODING_AGENT_BOUNDS.MAX_TITLE_CHARS }}
        slot={slot}
      />
      {archive.dialog}
    </>
  );
}

/** One tab the strip draws: the tab, how it looks, how it closes, how its transcript is copied, and the agent it is, for an agent's. */
interface DrawnTab {
  tab: MainTab;
  look: TabLook;
  /** Closes the tab, as its × does; none for the plan's while it stands alone. */
  close: (() => void) | undefined;
  copy?: ((copy: TranscriptCopy) => void) | undefined;
  agent?: CodingAgentSummary | undefined;
}

/**
 * The agents' tabs and the draft's, in the order started, each closing
 * through `main`. An agent's transcript is read whole from the service for a
 * copy, since its tab holds it only while shown, and its card previews its
 * latest step from what its tab last held (`heldLatest`). No tab wears the
 * Draft pencil, which marks only a task other than the one open
 * (`draft-mark.tsx`).
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
    const read = agentTranscriptRead(
      agents.readTranscript,
      agent.id,
      label,
      agent.brief,
      agents.chatOn,
    );
    const readCard = agentCardReading(agent, label, views.held, chosen(tab), agents);
    return {
      tab,
      agent,
      look: look(tab, {
        ...tabLook({ kind: TAB_KIND.AGENT, name: label, agent }),
        endMark: agentEndMark(agent, false),
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
            look: look({ draft }, tabLook({ kind: TAB_KIND.DRAFT })),
            close: () => {
              main.onClose({ draft });
              agents.onDiscardDraft(draft);
            },
          },
        ];
  return [...own, ...drafts];
}

/**
 * Each of the task's agents in the order started, as the "+" menu offers it,
 * the task's summary lists it (`task-summary.tsx`), and ⌘K finds it, in its
 * tab's look: its harness's mark wearing where it stands, and, where the
 * row draws one, a failure at its end, as its tab does. Picking an agent
 * whose tab is open chooses that tab rather than opening another, as a
 * browser's tab search does.
 */
export function agentEntries(main: MainTabsControl, agents: CodingAgentsControl): AddEntry[] {
  return (agents.agents ?? []).map((agent) => ({
    row: {
      id: agent.id,
      ...tabLook({ kind: TAB_KIND.AGENT, name: agentTabLabel(agent, agents.models), agent }),
      section: AGENTS_SECTION,
    },
    endMark: agentEndMark(agent, true),
    onPick: () => main.onChoose({ agent: agent.id }),
    agent,
  }));
}

/**
 * The task's Inbox as a row: its tray and its name, then what waits on the
 * developer counted at its end in the sidebar's quiet count, and nothing at
 * none. It names no section, so the summary lists it under Tabs, beside the
 * panel's kinds.
 */
export function inboxEntry(onPick: () => void, waiting: number): AddEntry {
  const row = { id: INBOX_ROW, ...tabLook({ kind: TAB_KIND.INBOX }) };
  const endMark =
    waiting === 0 ? undefined : (
      <span className="inbox-row-count">
        {waiting}
        <span className="visually-hidden">
          {" "}
          {waiting === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many}
        </span>
      </span>
    );
  return { row, endMark, onPick };
}

/**
 * The task's Inbox as the "+" menu and ⌘K offer it, by itself rather than
 * among the task's agents, though only they post to it; none on a task with
 * no agent. Picking it opens the tab where it was closed and chooses it,
 * through `onPick`.
 */
export function inboxEntries(agents: CodingAgentsControl, onPick: () => void): AddEntry[] {
  // An archived agent's items still stand, so the row stands while the task holds any agent.
  if ((agents.heldIds?.length ?? 0) === 0) return [];
  return [inboxEntry(onPick, 0)];
}

/** The plan's Chat tab as the "+" menu and ⌘K offer it, by itself, while there is a chat to read. */
export function chatEntries(available: boolean, onPick: () => void): AddEntry[] {
  if (!available) return [];
  return [
    { row: { id: CHAT_ROW, ...tabLook({ kind: TAB_KIND.CHAT }) }, endMark: undefined, onPick },
  ];
}

/**
 * The "+" menu's rows: the plan itself, which opens its tab again where it
 * was closed, its Inbox, and its Chat, each by itself under no heading
 * (`inboxEntries`); New coding agent, unavailable with Start's own reason
 * while Start could not run, and left out on an archived task; then each
 * of its agents under Coding agents (`agentEntries`).
 */
function addEntries(
  task: TaskSummary,
  main: MainTabsControl,
  agents: CodingAgentsControl,
  chat: boolean,
): AddEntry[] {
  const { start } = agents;
  const plan: AddEntry = {
    row: { id: PLAN_ROW, ...tabLook({ kind: TAB_KIND.PLAN, name: task.name }) },
    onPick: () => main.onChoose(MAIN_TAB.PLAN),
  };
  const newAgent: AddEntry = {
    row: {
      id: NEW_AGENT_ROW,
      ...tabLook({ kind: TAB_KIND.DRAFT }),
      // Start's reason stands exactly while Start could not run on the open task.
      disabled: start.busy ? NEW_AGENT_STARTING : start.reason,
    },
    onPick: () => main.onChoose({ draft: agents.onNewDraft() }),
  };
  const inbox = inboxEntries(agents, () => main.onChoose(MAIN_TAB.INBOX));
  const chatRows = chatEntries(chat, () => main.onChoose(MAIN_TAB.CHAT));
  const agentRows = agentEntries(main, agents);
  return [
    plan,
    ...inbox,
    ...chatRows,
    ...(agents.onUnarchive === undefined ? [newAgent] : []),
    ...agentRows,
  ];
}

/**
 * The column's strip across its toolbar: the plan's tab where open, the
 * agents', the draft's, and the Inbox's, then the "+", which stands apart
 * from the strip so it is never dragged nor dropped before. ⌘W closes the
 * chosen tab while the column holds the window's focus (`keys`), and
 * nothing on the plan's while it stands alone.
 */
export function MainTabStrip({
  task,
  taskCard,
  main,
  agents,
  unread,
  views,
  pins,
  rename,
  keys,
  shown,
  inbox,
  actionsSlot,
  onOpenTerminal,
  onOpenOnMac,
  chat,
}: {
  task: TaskSummary;
  /** The task's card, as its sidebar row hangs it, which its tab hangs (`task-card.tsx`). */
  taskCard: React.ReactNode;
  main: MainTabsControl;
  agents: CodingAgentsControl;
  /** The agents that ended while no one was looking, each in semibold until shown. */
  unread: readonly StripTab[];
  views: TabViews;
  /** The sidebar's pins, which an agent's tab is pinned among, and their presses. */
  pins: {
    pinned: readonly PinnedTab[];
    onPin: (tab: ColumnPinnableTab, label: string, model?: string) => void;
    onUnpin: (taskId: string, tab: ColumnPinnableTab) => void;
  };
  /** The task's rename, which its tab's menu opens; none while the task is archived. */
  rename: InlineRename | undefined;
  /** Whether the column offers its keys: on screen, and holding the window's focus. */
  keys: boolean;
  /** Whether the task's page is on screen, which a tab's Archive asks its question on. */
  shown: boolean;
  /** How many of the task's inbox items wait on the developer, which its Inbox tab counts. */
  inbox: number;
  /** The toolbar's slot the chosen tab's ⋯ stands in, where the plan's own stands on its tab. */
  actionsSlot: HTMLElement | null;
  /** Opens an agent's own Terminal tab in the side panel, adding no shell, by the agent; none where the platform runs no terminals. */
  onOpenTerminal?: ((agentId: string) => void) | undefined;
  /** Runs an agent's pushed branch in a terminal of this Mac in the side panel, by the agent; none where the task names no repository or the platform has no Mac terminal. */
  onOpenOnMac?: ((agentId: string) => void) | undefined;
  /** Whether there is a chat to read, so the "+" menu offers the plan's Chat tab. */
  chat: boolean;
}): React.JSX.Element {
  const copied = useTranscriptCopier();
  const pinnedOf = (tab: ColumnPinnableTab) =>
    pins.pinned.some((pin) => pin.task === task.id && sameTab(pin.tab, tab));
  // A pinned Inbox stands whatever arrives, so it offers no close until unpinned.
  const inboxPinned = pinnedOf(MAIN_TAB.INBOX);
  const inboxTab: DrawnTab[] = main.tabs.includes(MAIN_TAB.INBOX)
    ? [
        {
          tab: MAIN_TAB.INBOX,
          look: {
            ...tabLook({ kind: TAB_KIND.INBOX }),
            detail: inbox === 0 ? undefined : String(inbox),
            selected: main.tab === MAIN_TAB.INBOX,
            onSelect: () => main.onChoose(MAIN_TAB.INBOX),
          },
          close: inboxPinned ? undefined : () => main.onClose(MAIN_TAB.INBOX),
        },
      ]
    : [];
  const chatTab: DrawnTab[] = main.tabs.includes(MAIN_TAB.CHAT)
    ? [
        {
          tab: MAIN_TAB.CHAT,
          look: {
            ...tabLook({ kind: TAB_KIND.CHAT }),
            selected: main.tab === MAIN_TAB.CHAT,
            onSelect: () => main.onChoose(MAIN_TAB.CHAT),
          },
          close: () => main.onClose(MAIN_TAB.CHAT),
        },
      ]
    : [];
  // The agents', the draft's, the Inbox's, and Chat's tabs in the column's order,
  // which the developer's moves and their opening set (`use-main-tabs.ts`).
  const own = inTaskOrder(
    [...agentTabs({ main, agents, unread, views, copied }), ...inboxTab, ...chatTab],
    main.tabs,
    (entry) => entry.tab,
  );
  const taskTab: DrawnTab[] = main.tabs.includes(MAIN_TAB.PLAN)
    ? [
        {
          tab: MAIN_TAB.PLAN,
          look: {
            ...tabLook({ kind: TAB_KIND.PLAN, name: task.name }),
            selected: main.tab === MAIN_TAB.PLAN,
            quiet: own.length === 0,
            anchored: true,
            card: taskCard,
            onSelect: () => main.onChoose(MAIN_TAB.PLAN),
          },
          // Alone, the plan's tab stays, so the column always has one to show.
          close: own.length === 0 ? undefined : () => main.onClose(MAIN_TAB.PLAN),
        },
      ]
    : [];
  const strip = [...taskTab, ...own];
  const copyLink = useCopyLinkItem();
  const chosen = strip.find((entry) => entry.look.selected);
  useAppCommand(APP_COMMAND.CLOSE_TAB, keys ? chosen?.close : undefined);
  const pinDoor = (tab: ColumnPinnableTab, label: string, model?: string): TabPin => {
    const pinned = pinnedOf(tab);
    return {
      pinned,
      onToggle: () => (pinned ? pins.onUnpin(task.id, tab) : pins.onPin(tab, label, model)),
    };
  };
  const doorsOf = (entry: DrawnTab): TabDoors => {
    const linked: LinkPlace | undefined =
      entry.agent !== undefined
        ? { kind: LINK_PLACE.AGENT, planId: task.id, agentId: entry.agent.id }
        : entry.tab === MAIN_TAB.PLAN
          ? { kind: LINK_PLACE.TASK, planId: task.id }
          : undefined;
    const others = strip.flatMap((other) =>
      other === entry || other.close === undefined ? [] : [other.close],
    );
    const { agent } = entry;
    const pinTab: ColumnPinnableTab | undefined =
      agent !== undefined
        ? { agent: agent.id }
        : entry.tab === MAIN_TAB.INBOX
          ? MAIN_TAB.INBOX
          : undefined;
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
      pin: pinTab === undefined ? undefined : pinDoor(pinTab, entry.look.label, agent?.model),
      onCopy: entry.copy,
      onOpenTerminal:
        agent === undefined || onOpenTerminal === undefined
          ? undefined
          : () => onOpenTerminal(agent.id),
      onOpenOnMac:
        agent === undefined || onOpenOnMac === undefined ? undefined : () => onOpenOnMac(agent.id),
      copyLink: linked === undefined ? undefined : copyLink(linked),
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
              <DoorsTab
                key={tabKey(entry.tab)}
                look={entry.look}
                doors={doorsOf(entry)}
                slot={actionsSlot}
              />
            )
          ) : (
            <AgentMenuTab
              key={tabKey(entry.tab)}
              agent={entry.agent}
              agents={agents}
              look={entry.look}
              doors={doorsOf(entry)}
              shown={shown}
              slot={actionsSlot}
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
      <AddTabButton
        label="Open a tab"
        placeholder="Search tabs"
        noMatch="No tabs match"
        entries={addEntries(task, main, agents, chat)}
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
  if (tab === MAIN_TAB.INBOX) return tabLook({ kind: TAB_KIND.INBOX }).label;
  if (tab === MAIN_TAB.CHAT) return tabLook({ kind: TAB_KIND.CHAT }).label;
  if (isDraftTab(tab)) return tabLook({ kind: TAB_KIND.DRAFT }).label;
  const agent = agents.agents?.find((each) => each.id === tab.agent);
  return agent === undefined ? undefined : agentTabLabel(agent, agents.models);
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
  chat,
  onFork,
  onContinue,
}: {
  tab: Exclude<MainTab, typeof MAIN_TAB.PLAN | typeof MAIN_TAB.INBOX | typeof MAIN_TAB.CHAT>;
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
  /** Opens the agent's pull request in the side panel, by the agent; none where no side panel stands to show it. */
  onOpenPullRequest?: ((agentId: string) => void) | undefined;
  /** Opens what a call in the agent's transcript is about in the tab that draws it. */
  onOpenTarget: (target: ToolTarget) => void;
  /** The cards the transcript's rows that open a tab hang, as those tabs hang them. */
  cards: TaskCards;
  /** The chat a chat notice's card reads and opens; none where the window holds none. */
  chat?: ChatNoticeDoors | undefined;
  /** Opens the task's draft as a fork of one of an agent's messages; none where no draft opens, as on an agent no task holds. */
  onFork?: ((fork: AgentFork) => void) | undefined;
  /** Opens the task's draft as a continue of an agent with the words and files its closed box held; none where no draft opens, as on an agent no task holds. */
  onContinue?:
    | ((agentId: string, words: string, attachments: readonly CodingAgentAttachment[]) => void)
    | undefined;
}): React.JSX.Element {
  if (isDraftTab(tab)) {
    // The tab stands for a draft the task no longer holds only until the
    // column moves back to the task, a render away.
    return agents.draft?.id === tab.draft ? (
      <DraftAgentTab key={tab.draft} draft={agents.draft} control={agents} cards={cards.call} />
    ) : (
      <SpinnerRegion label="Loading agent" />
    );
  }
  const agent = agents.agents?.find((each) => each.id === tab.agent);
  // The tab stands for an agent the list no longer holds only until the
  // column moves back to the task, a render away.
  return agent === undefined ? (
    <SpinnerRegion label="Loading agent" />
  ) : (
    <ForkProvider
      key={agent.id}
      value={agentForkDoors({
        agent,
        control: agents,
        onFork,
        onContinue,
        cards: cards.agent(agent.id),
        onOpenTarget,
      })}
    >
      <AgentTab
        agent={agent}
        control={agents}
        shown={shown}
        onOpenSubagent={(callId, task, status) => onOpenDelegation(agent.id, callId, task, status)}
        onOpenPullRequest={
          onOpenPullRequest === undefined ? undefined : () => onOpenPullRequest(agent.id)
        }
        onOpenTarget={onOpenTarget}
        cards={cards.agent(agent.id)}
        chat={chat}
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
 */
export function AgentPane({
  label,
  tabbed,
  ...content
}: Parameters<typeof MainTabContent>[0] & {
  /** What the pane is called to a reader: the agent's tab's name. */
  label: string | undefined;
  /** Whether the pane is the panel of a tab in a strip, as the task column's is. */
  tabbed: boolean;
}): React.JSX.Element {
  return (
    <section
      className="desktop-agent"
      role={tabbed ? "tabpanel" : undefined}
      aria-label={label}
      data-popover-room=""
    >
      <MainTabContent {...content} />
    </section>
  );
}
