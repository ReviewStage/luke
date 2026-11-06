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
  INLINE_EDIT_LOOK,
  InlineEdit,
  RetryButton,
  STATUS_TONE,
  TABS_GROUND,
  TOOLBAR_INSET,
  TOOLBAR_LOOK,
  Toolbar,
  useMenu,
  VisuallyHidden,
} from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { inTaskOrder, isDraftTab, type StripTab, sameTab, tabKey } from "@repo/ui/tab-strip-model";
import type { InlineRename } from "@repo/ui/use-inline-rename";
import { memo, useRef } from "react";
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
import { NEEDS_YOU } from "../tasks/inbox-model.js";
import { agentEndMark, TAB_KIND, tabLook } from "../tasks/tab-look.js";
import type { AgentThreads } from "../tasks/threads-dock.js";
import type { ToolTarget } from "../tasks/tool-call-model.js";
import { TRANSCRIPT_COPY } from "../tasks/transcript-copy.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import {
  isOverviewTab,
  type MAIN_TAB,
  type MainTab,
  type MainTabsControl,
} from "../tasks/use-main-tabs.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { type AgentTerminalDoors, useAgentActions } from "./agent-actions.js";
import type { TaskCards } from "./side-panel.js";
import {
  type AddEntry,
  AddTabButton,
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

export const ROW_COUNT =
  "inbox-row-count flex-none text-caption-inline text-muted-foreground tabular-nums data-[tone]:text-tone-ink";

export const AGENTS_SECTION = "Agents";

const NEW_AGENT_ROW = "new-agent";

const NEW_AGENT_STARTING = "Starting…";

export const INBOX_ROW = "inbox";

const RETRY_AGENTS = "Retry agents";

function RenamableTab({
  look,
  doors,
  rename,
  field,
  onShown,
}: {
  look: TabLook;
  doors: TabDoors;
  rename: InlineRename | undefined;
  field?: { label: string; maxLength: number } | undefined;
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
  keys: boolean;
  terminals: Pick<AgentTerminalDoors, "onOpenTerminal" | "onOpenLocal">;
  onOpenBrowser?: ((agentId: string) => void) | undefined;
  onShown: ((shown: ShownTab | undefined) => void) | undefined;
}): React.JSX.Element {
  const actions = useAgentActions(agent, agents, {
    label: look.label,
    shown,
    terminals,
    onOpenBrowser,
    onDeleted: doors.onClose,
  });
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

interface DrawnTab {
  tab: MainTab;
  look: TabLook;
  close: (() => void) | undefined;
  agent?: AgentSummary | undefined;
}

function agentTabs(input: {
  main: MainTabsControl;
  agents: AgentsControl;
  unread: readonly StripTab[];
  views: TabViews;
  drafted: readonly string[];
  failed: readonly string[];
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
    const tab = { agent: agent.id };
    const label = agentName(agent, agents.models);
    const readCard = agentCardReading(agent, label, views.held, chosen(tab), agents);
    const placeMark = chosen(tab)
      ? undefined
      : (leftMark(failed.includes(agent.id), drafted.includes(agent.id)) ?? undefined);
    return {
      tab,
      agent,
      look: look(tab, {
        ...tabLook({ kind: TAB_KIND.AGENT, name: label, agent }),
        endMark:
          waitingMark(waiting?.get(agent.id)?.length ?? 0) ??
          agentEndMark(agent, false) ??
          placeMark,
        card: <AgentTabCard name={label} models={models} read={readCard} />,
      }),
      close: () => main.onClose(tab),
    };
  });
  const pending = agents.start.pending;
  const startingTab = pending === undefined ? undefined : { agent: pending.key };
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
            tab: { draft },
            look: look(
              { draft },
              {
                ...tabLook({ kind: TAB_KIND.DRAFT }),
                labelReplayUnmasked: true,
                endMark: draftHolds && !chosen({ draft }) ? <DraftMark /> : undefined,
              },
            ),
            close: () => {
              main.onClose({ draft });
              agents.onDiscardDraft(draft);
            },
          },
        ];
  return [...own, ...starting, ...drafts];
}

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
        replayMasked: true,
      },
      endMark: agentEndMark(agent, true),
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

export function inboxEntry(onPick: () => void, waiting: number, drafted = false): AddEntry {
  const row = { id: INBOX_ROW, ...tabLook({ kind: TAB_KIND.INBOX }) };
  const count = waitingMark(waiting);
  const endMark = drafted ? (
    <>
      <DraftMark />
      {count}
    </>
  ) : (
    count
  );
  return { row, endMark, onPick };
}

function waitingMark(waiting: number): React.JSX.Element | undefined {
  return waiting === 0 ? undefined : (
    <span className={ROW_COUNT} data-tone={STATUS_TONE.ATTENTION}>
      {waiting}
      <VisuallyHidden> {waiting === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many}</VisuallyHidden>
    </span>
  );
}

export function inboxEntries(
  agents: AgentsControl,
  waiting: boolean,
  onPick: () => void,
): AddEntry[] {
  if ((agents.heldIds?.length ?? 0) === 0 && !waiting) return [];
  return [inboxEntry(onPick, 0)];
}

export function newAgentStarts(main: MainTabsControl, agents: AgentsControl): MenuAction[] {
  if (agents.onUnarchive !== undefined || !startsOwnAgents(agents.mode)) return [];
  const reason = agents.start.busy ? NEW_AGENT_STARTING : undefined;
  return [
    {
      label: tabLook({ kind: TAB_KIND.DRAFT }).label,
      detail: reason,
      disabled: reason !== undefined,
      onSelect: () => main.onChoose({ draft: agents.onNewDraft() }),
    },
  ];
}

function addEntries(
  main: MainTabsControl,
  agents: AgentsControl,
  held: HeldTranscripts,
): AddEntry[] {
  const starts = newAgentStarts(main, agents).map(
    (start): AddEntry => ({
      row: { id: NEW_AGENT_ROW, ...tabLook({ kind: TAB_KIND.DRAFT }), disabled: start.detail },
      onPick: start.onSelect,
    }),
  );
  return [...starts, ...agentEntries(main, agents, held)];
}

export function phoneAgentStarts(main: MainTabsControl, agents: AgentsControl): MenuAction[] {
  const retry: MenuAction[] =
    agents.listFailed && agents.agents === undefined
      ? [{ label: RETRY_AGENTS, onSelect: agents.onRetryList }]
      : [];
  return [...newAgentStarts(main, agents), ...retry];
}

function MainTabsRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="main-tabs flex items-center gap-list-gap">{children}</div>;
}

export const DETAILS_WORDS = { HINT: "Task details", PLACE: "agents" } as const;

const TASK_MENU_LABEL = "Task actions";

export function TaskTopbar({
  task,
  details,
  descriptionMenu,
  shown,
  actions,
}: {
  task: Pick<TaskSummary, "id" | "name" | "status"> | undefined;
  details: { readonly shown: boolean; readonly onToggle: () => void } | undefined;
  descriptionMenu: DocumentMenu | undefined;
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
  waiting,
}: {
  task: Pick<TaskSummary, "id">;
  main: MainTabsControl;
  agents: AgentsControl;
  unread: readonly StripTab[];
  views: TabViews;
  pins: {
    pinned: (agentId: string) => boolean;
    onPin: (agentId: string, pinned: boolean) => void;
  };
  keys: boolean;
  shown: boolean;
  onOpenTerminal?: ((agentId: string) => void) | undefined;
  onOpenLocal?: ((agentId: string) => void) | undefined;
  onOpenBrowser?: ((agentId: string) => void) | undefined;
  onShown?: ((shown: ShownTab | undefined) => void) | undefined;
  waiting?: ReadonlyMap<string, readonly unknown[]> | undefined;
}): React.JSX.Element {
  const drafted = useDraftedAgents();
  const failed = useFailedAgents();
  const strip = inTaskOrder(
    agentTabs({ main, agents, unread, views, drafted, failed, waiting }),
    main.tabs,
    (entry) => entry.tab,
  );
  useStripLooks(LOOK_STRIP.COLUMN, task.id, strip);
  const copyLink = useCopyLinkItem();
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
  const pinDoor = (agentId: string): TabPin => {
    const pinned = pins.pinned(agentId);
    return { pinned, onToggle: () => pins.onPin(agentId, !pinned), agent: true };
  };
  const doorsOf = (entry: DrawnTab): TabDoors => {
    const linked: LinkPlace | undefined =
      entry.agent === undefined ? undefined : { kind: LINK_PLACE.AGENT, agentId: entry.agent.id };
    const { agent } = entry;
    return {
      chosen: entry.look.selected,
      onClose: entry.close,
      onCloseOthers: closeOthersOf(entry),
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
          {agents.listFailed && agents.agents === undefined ? (
            <ReplayUnmask>
              <RetryButton label={RETRY_AGENTS} onRetry={agents.onRetryList} />
            </ReplayUnmask>
          ) : null}
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
      }
    />
  );
}

export function mainTabLabel(tab: MainTab, agents: AgentsControl): string | undefined {
  if (isOverviewTab(tab)) return tabLook({ kind: TAB_KIND.OVERVIEW }).label;
  if (isDraftTab(tab)) return tabLook({ kind: TAB_KIND.DRAFT }).label;
  const agent = agents.agents?.find((each) => each.id === tab.agent);
  return agent === undefined ? undefined : agentName(agent, agents.models);
}

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
  shown: boolean;
  views: TabViews;
  onOpenDelegation: (agentId: string, callId: string, task: string, status: AgentStatus) => void;
  onOpenPullRequest?: ((agentId: string) => void) | undefined;
  onOpenTarget: (target: ToolTarget) => void;
  cards: TaskCards;
  onFork?: ((fork: AgentFork) => void) | undefined;
  onContinue?:
    | ((agentId: string, words: string, attachments: readonly AgentAttachment[]) => void)
    | undefined;
  threads?: AgentThreads | undefined;
}): React.JSX.Element {
  if (isDraftTab(tab)) {
    return agents.draft?.id === tab.draft ? (
      <DraftAgentTab key={tab.draft} draft={agents.draft} control={agents} cards={cards.call} />
    ) : (
      <AgentTabSkeleton />
    );
  }
  const agentId = tab.agent;
  if (agents.start.pending?.key === agentId) return <StartingAgentTab key={agentId} />;
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

export const AgentPane = memo(function AgentPane({
  label,
  tabbed,
  ...content
}: Omit<Parameters<typeof MainTabContent>[0], "tab"> & {
  tab: Exclude<MainTab, typeof MAIN_TAB.OVERVIEW>;
  label: string | undefined;
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
