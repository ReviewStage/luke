import { ACCOUNT_STATUS, type AccountProvider } from "@luke/credentials/snapshot";
import type { Task } from "@luke/features/task-wire";
import { EXPERIMENT, HOST_CAPABILITY } from "@luke/settings";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { APP_COMMAND, APP_SHORTCUTS } from "@luke/settings/shortcuts";
import {
  BackIcon,
  COLLECTION_STATE,
  CollectionPage,
  ComposeIcon,
  DetailPage,
  IconButton,
  NavItem,
  PAGE_FRAME,
  ScrollArea,
  SettingsPage,
  SettingsSectionsSkeleton,
  SidebarIcon,
  Skeleton,
} from "@luke/ui";
import { isAgentTab } from "@luke/ui/tab-strip-model";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import { useAppCommand } from "../app-commands.js";
import { appPlatform } from "../app-platform.js";
import { CALL_CARD_SURFACE, StandingCallCardDock } from "../call/call-card.js";
import { ExperimentTag } from "../experiment-marks.js";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import type { NavigationHistory, WindowHistory } from "../navigation-history.js";
import { PANEL_TAB, type PanelTab } from "../panel-tabs.js";
import type { SettingsPanelProps } from "../settings/settings-panel.js";
import { type HiddenColumns, hiddenColumns, SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { Shortcut } from "../shortcut.js";
import { SignInGate } from "../sign-in-gate.js";
import { useChatOn } from "../tasks/chat-gate.js";
import { ChipCards, type TaskFocus, WorkspaceDirectory } from "../tasks/chip-cards.js";
import { MentionedAgents } from "../tasks/mentioned-agent-card.js";
import { NewTaskDialog } from "../tasks/new-task-dialog.js";
import { useInboxListing } from "../tasks/use-inbox-listing.js";
import { useAgentLook, useTaskLooks } from "../tasks/use-task-looks.js";
import {
  AUTOMATIONS_PAGE,
  type AutomationsPlace,
  type TasksControl,
} from "../tasks/use-tasks-tab.js";
import { commandKeyshortcuts, Tooltip } from "../tooltip.js";
import {
  useAdminAccess,
  useAdminAccessPending,
  useCapability,
  useExperiment,
} from "../use-app-state.js";
import { useCallingAgent } from "../use-voice-view.js";
import { WindowVoiceNotice } from "../window-voice.js";
import { READING_AUTOMATIONS } from "./automation-words.js";
import { useColumnDock } from "./column-dock.js";
import { DesktopAgentPage } from "./desktop-agent-page.js";
import { DesktopChat } from "./desktop-chat.js";
import { DesktopInbox } from "./desktop-inbox.js";
import type { SettingsStep } from "./desktop-settings.js";
import { DesktopSidebar } from "./desktop-sidebar.js";
import { DesktopTasks } from "./desktop-tasks.js";
import { useFloatDismiss } from "./hover-pane.js";
import { OfflineMark, useOffline } from "./offline-mark.js";
import { ADMIN_PLACE, PERSON_PAGE, VERSION_HISTORY } from "./pages-on-demand.js";
import { PaneGlide } from "./pane-motion.js";
import { SidePanelToggle } from "./side-panel.js";
import { SIDEBAR_OVERLAY, type SidebarCollapse, sidebarInSight } from "./sidebar-collapse.js";
import { taskCardOf } from "./task-card.js";
import { useSummaryPin } from "./task-summary.js";
import { useWindowTitle } from "./window-title.js";

/**
 * Settings, loaded as a chunk of its own the first time it opens rather than
 * with the window, because the renderer bundle is parsed at every window
 * open, the voice window's included, and Settings is opened seldom. The chunk is a local file, so it stands a frame
 * later, over its frame of placeholders in the meantime (`SettingsLoading`).
 */
const DesktopSettings = lazy(() =>
  import("./desktop-settings.js").then((loaded) => ({ default: loaded.DesktopSettings })),
);

/**
 * The Automations pages, loaded as a chunk of their own the first time
 * they open, as Settings is and for the same reason: the renderer bundle is
 * parsed at every window open, and the pages, their editor and its triggers
 * among them, are opened seldom. What stands while
 * the chunk loads is the pages' own empty frame, for a frame.
 */
const AutomationsPage = lazy(() =>
  import("./automations-page.js").then((loaded) => ({
    default: loaded.AutomationsPage,
  })),
);

/** The Tasks page, its List and its Board, its own chunk, loaded the first time it is opened. */
const TasksPage = lazy(() =>
  import("./tasks-page.js").then((loaded) => ({ default: loaded.TasksPage })),
);

/** What stands while the Tasks page's chunk loads: its frame and title over quiet blocks, and its own way out, so Escape closes the page rather than reaching the plan behind it. */
function TasksLoading({ onExit }: { onExit: () => void }): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_BOARD, onExit);
  return (
    <CollectionPage
      frame={PAGE_FRAME.TOOLBAR}
      label="Tasks"
      toolbar={
        <header className="desktop-toolbar">
          <div className="desktop-toolbar-heading">
            <h1 className="desktop-toolbar-title">Tasks</h1>
          </div>
        </header>
      }
      state={COLLECTION_STATE.LOADING}
      loadingLabel="Reading tasks"
    />
  );
}

/** What stands while the Admin place's chunk loads (`pages-on-demand.ts`): its list's column and the view's frame over quiet blocks, and its own way out. */
function AdminLoading({
  onExit,
  hidden,
}: {
  onExit: () => void;
  hidden: HiddenColumns;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_ADMIN, onExit);
  return (
    <div className="desktop-admin">
      <nav className="admin-sections" aria-label="Admin sections" hidden={hidden.list}>
        <div className="desktop-drag-strip" />
      </nav>
      <section className="admin-page" aria-label="Admin" hidden={hidden.item}>
        <div className="desktop-drag-strip" />
        <CollectionPage
          frame={PAGE_FRAME.TOOLBAR}
          label="Admin"
          toolbar={
            <header className="desktop-toolbar">
              <div className="desktop-toolbar-heading">
                <h1 className="desktop-toolbar-title">Overview</h1>
              </div>
            </header>
          }
          state={COLLECTION_STATE.LOADING}
          loadingLabel="Reading the dashboard…"
        />
      </section>
    </div>
  );
}

/** What stands while a person's page's chunk loads: its frame, their name where the place that opened it knew it, and its own way out. */
function PersonLoading({
  name,
  onExit,
}: {
  name: string | undefined;
  onExit: () => void;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_PERSON_PAGE, onExit);
  return (
    <DetailPage
      frame={PAGE_FRAME.TOOLBAR}
      label={name ?? "Profile"}
      toolbar={
        <header className="desktop-toolbar">
          <div className="desktop-toolbar-heading">
            <h1 className="desktop-toolbar-title">
              {name ?? <Skeleton width={PERSON_SKELETON_NAME} />}
            </h1>
          </div>
        </header>
      }
    >
      {null}
    </DetailPage>
  );
}

/** How wide the placeholder name stands while a person's page's chunk loads, as the page's own does. */
const PERSON_SKELETON_NAME = "180px";

/**
 * What stands while a version history's chunk loads: its frame, the list's
 * column where the sidebar stood, and its own way out, its Back row and
 * Escape, so the history is left as it would be once drawn.
 */
function VersionHistoryLoading({
  onExit,
  hidden,
}: {
  onExit: () => void;
  hidden: HiddenColumns;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_VERSION_HISTORY, onExit);
  return (
    <div className="desktop-version-history">
      <nav className="version-log" aria-label="Versions" hidden={hidden.list}>
        <div className="desktop-drag-strip" />
        <NavItem
          icon={<BackIcon />}
          aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.EXIT_VERSION_HISTORY)}
          shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.EXIT_VERSION_HISTORY].chord} />}
          onClick={onExit}
        >
          Back
        </NavItem>
      </nav>
      <section className="version-page" aria-label="Version" hidden={hidden.item}>
        <div className="desktop-drag-strip" />
      </section>
    </div>
  );
}

/**
 * What stands while the Automations pages' chunk loads: their frame, its
 * toolbar's title over the list as quiet blocks, and their own way out, so
 * Escape pressed in that frame closes Automations as the list would rather
 * than falling through to the task behind it.
 */
function AutomationsLoading({ onExit }: { onExit: () => void }): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, onExit);
  return (
    <CollectionPage
      frame={PAGE_FRAME.TOOLBAR}
      label="Automations"
      toolbar={
        <header className="desktop-toolbar">
          <div className="desktop-toolbar-heading">
            <h1 className="desktop-toolbar-title">Automations</h1>
            <ExperimentTag />
          </div>
        </header>
      }
      state={COLLECTION_STATE.LOADING}
      loadingLabel={READING_AUTOMATIONS}
    />
  );
}

/**
 * How wide the placeholder title stands while Settings' chunk loads: a short
 * page name's, five controls' height across. Note that it is a length rather
 * than a share, because the title's line is only as wide as what it holds.
 */
const SETTINGS_SKELETON_TITLE = "calc(5 * var(--luke-control-height))";

/** How many rows each placeholder section stands while Settings' chunk loads. */
const SETTINGS_SKELETON = [3, 2] as const;

/**
 * What stands while Settings' chunk loads: its frame, the page list's column
 * and a page of placeholder sections under a placeholder title, so Settings
 * lands where the blocks stood; and Settings' own way out, so Escape pressed
 * in that frame leaves Settings as it would once drawn, rather than falling
 * through to the task behind it. It is gone as Settings stands and offers the
 * same command itself. A narrow room hides the column Settings will hide.
 */
function SettingsLoading({
  onExit,
  hidden,
}: {
  onExit: () => void;
  hidden: HiddenColumns;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_SETTINGS, onExit);
  return (
    <div className="desktop-settings">
      <nav className="settings-pages" aria-label="Settings pages" hidden={hidden.list}>
        <div className="desktop-drag-strip" />
      </nav>
      <section className="settings-page" aria-label="Settings" hidden={hidden.item}>
        <div className="desktop-drag-strip" />
        <SettingsPage title={<Skeleton width={SETTINGS_SKELETON_TITLE} />}>
          <SettingsSectionsSkeleton label="Loading Settings" sections={SETTINGS_SKELETON} />
        </SettingsPage>
      </section>
    </div>
  );
}

/** What stands between the developer and the window's own content: the account sign-in. */
export interface DesktopGates {
  accountRequired: boolean;
  /** Whose sign-in the gate is waiting on in the browser. */
  signInWait?: AccountProvider | undefined;
  signInFailure?: string | undefined;
  /** The provider this Mac last signed in with, which the gate marks. */
  lastSignIn?: AccountProvider | undefined;
  onBeginSignIn: (provider: AccountProvider) => void;
  onCancelSignIn: () => void;
}

/**
 * Folds the sidebar away and back, or in a window too narrow to pin it,
 * floats it open over the work and puts it away. It stands beside the
 * traffic lights rather than in the sidebar, so it is in the same place
 * whichever way the sidebar is, and the task's toolbar leaves it room while
 * the sidebar is folded; in full screen, where macOS hides the lights, it
 * takes their place at the window's edge (`window-full-screen.ts`). It
 * stands only where there is a sidebar to fold, so it offers the chord too.
 * A peek is not yet open, so over one it still offers to show the sidebar.
 */
function SidebarToggle({ sidebar }: { sidebar: SidebarCollapse }): React.JSX.Element {
  const shown = !sidebar.collapsed || sidebar.overlay === SIDEBAR_OVERLAY.OPEN;
  const label = shown ? "Hide sidebar" : "Show sidebar";
  useAppCommand(APP_COMMAND.TOGGLE_SIDEBAR, sidebar.onToggle);
  return (
    <Tooltip label={label} command={APP_COMMAND.TOGGLE_SIDEBAR}>
      <IconButton icon={<SidebarIcon />} label={label} onClick={sidebar.onToggle} />
    </Tooltip>
  );
}

/**
 * The shortcuts that reach a place from anywhere past the sign-in: a new
 * task, Settings, the Inbox, the tab closed latest, opened again on its
 * task, the Keyboard shortcuts page that lists them all, and back and
 * forward, which answer whether or not their buttons are drawn.
 */
function usePlaceCommands(
  pastGate: boolean,
  tab: PanelTab,
  onTabChange: (tab: PanelTab) => void,
  tasks: TasksControl,
  settings: SettingsPanelProps,
  history: NavigationHistory,
): void {
  useAppCommand(APP_COMMAND.BACK, pastGate && history.canGoBack ? history.onBack : undefined);
  useAppCommand(
    APP_COMMAND.FORWARD,
    pastGate && history.canGoForward ? history.onForward : undefined,
  );
  useAppCommand(
    APP_COMMAND.NEW_TASK,
    pastGate && tasks.signedIn
      ? () => {
          if (tab !== PANEL_TAB.TASKS) onTabChange(PANEL_TAB.TASKS);
          tasks.onNewTask();
        }
      : undefined,
  );
  useAppCommand(APP_COMMAND.SETTINGS, pastGate ? () => onTabChange(PANEL_TAB.SETTINGS) : undefined);
  useAppCommand(
    APP_COMMAND.INBOX,
    pastGate && tasks.signedIn
      ? () => {
          if (tab !== PANEL_TAB.TASKS) onTabChange(PANEL_TAB.TASKS);
          tasks.inboxView.onOpen();
        }
      : undefined,
  );
  // Chat is an experiment, so ⌘K offers it only on the terms its sidebar row stands on.
  const chatOn = useChatOn();
  useAppCommand(
    APP_COMMAND.CHAT,
    pastGate && tasks.signedIn && chatOn && tasks.chatView.available
      ? () => {
          if (tab !== PANEL_TAB.TASKS) onTabChange(PANEL_TAB.TASKS);
          tasks.chatView.onOpen();
        }
      : undefined,
  );
  useAppCommand(
    APP_COMMAND.AUTOMATIONS,
    pastGate && tasks.signedIn
      ? () => {
          if (tab !== PANEL_TAB.TASKS) onTabChange(PANEL_TAB.TASKS);
          tasks.automationsView.onOpen();
        }
      : undefined,
  );
  const { onReopenClosedTab } = tasks;
  useAppCommand(
    APP_COMMAND.REOPEN_CLOSED_TAB,
    pastGate && tasks.signedIn && onReopenClosedTab !== undefined
      ? () => {
          if (tab !== PANEL_TAB.TASKS) onTabChange(PANEL_TAB.TASKS);
          onReopenClosedTab();
        }
      : undefined,
  );
  // The page lists an installed app's chords, and stands nowhere else (`pages.tsx`).
  const desktopApp = useCapability(HOST_CAPABILITY.DESKTOP_APP);
  useAppCommand(
    APP_COMMAND.KEYBOARD_SHORTCUTS,
    pastGate && desktopApp
      ? () => {
          // Arriving at Settings lands on Account, so the page is turned
          // after.
          onTabChange(PANEL_TAB.SETTINGS);
          settings.onViewChange(SETTINGS_VIEW.SHORTCUTS);
        }
      : undefined,
  );
}

/**
 * The sidebar's New task, kept in reach while the sidebar is folded: an icon
 * beside the toggle, the way a chat app keeps its compose button beside its
 * own. It asks for exactly what the sidebar's button asks for: the New task
 * dialog, over whatever stands.
 */
function TitleBarNewTask({ tasks }: { tasks: TasksControl }): React.JSX.Element {
  return (
    <Tooltip label="New task" command={APP_COMMAND.NEW_TASK}>
      <IconButton
        icon={<ComposeIcon />}
        label="New task"
        disabled={!tasks.signedIn}
        onClick={tasks.onNewTask}
      />
    </Tooltip>
  );
}

/** The voice's notice line, one element for every draw, which reads the line where it is drawn (`WindowVoiceNotice`). */
const NOTICE_STRIP = <WindowVoiceNotice />;

/**
 * Whether the tab of the agent the call speaks into is on screen, where its
 * transcript streams the call's words as they are said and its foot draws
 * the call bar. A tab standing behind another chosen tab, or under a side
 * panel filling the window, is not on screen.
 */
function callTabShown(tasks: TasksControl, calling: string | undefined): boolean {
  const { mainTabs, sidePanel } = tasks;
  const tab = mainTabs.tab;
  return (
    calling !== undefined &&
    !sidePanel.fullScreen &&
    tab !== undefined &&
    isAgentTab(tab) &&
    tab.agent === calling
  );
}

/**
 * What the window's title names: Settings alone, whose pages are not one
 * workspace's; the Inbox in the listed workspace, whatever task its item is
 * from; the Automations page and Chat in the listed workspace; the task on screen in its own workspace, or alone while that is not
 * read; else the listed workspace.
 */
function titleSubject(
  tab: PanelTab,
  tasks: TasksControl,
  shownTask: Task | undefined,
): Parameters<typeof useWindowTitle>[0] {
  const { signedIn } = tasks;
  if (tab === PANEL_TAB.SETTINGS) return { signedIn, subject: "Settings", workspace: undefined };
  if (tasks.inboxView.open) return { signedIn, subject: "Inbox", workspace: tasks.workspace };
  if (tasks.agentView.agentId !== undefined) {
    return { signedIn, subject: "Agent", workspace: tasks.workspace };
  }
  if (tasks.personView.userId !== undefined) {
    return { signedIn, subject: "Profile", workspace: tasks.workspace };
  }
  // The Admin place reads every workspace's accounts, so it is no one workspace's.
  if (tasks.adminView.open) return { signedIn, subject: "Admin", workspace: undefined };
  if (tasks.automationsView.open) {
    return { signedIn, subject: "Automations", workspace: tasks.workspace };
  }
  if (tasks.chatView.open) return { signedIn, subject: "Chat", workspace: tasks.workspace };
  if (tasks.boardView.open) return { signedIn, subject: "Tasks", workspace: tasks.workspace };
  if (shownTask === undefined) return { signedIn, subject: undefined, workspace: tasks.workspace };
  // Note that a task whose workspace is not read yet is named alone, because the listed one may not be its.
  const workspace = tasks.workspaces.find((each) => each.id === shownTask.workspaceId);
  return { signedIn, subject: shownTask.name, workspace };
}

/** Where on the Automations page a find stands: its list, a new automation, or one automation's editor, each a place of its own. */
function automationsPlaceKey(place: AutomationsPlace): string {
  return place.kind === AUTOMATIONS_PAGE.EDIT ? place.automationId : place.kind;
}

/**
 * Luke's window: the sidebar on the left and the chosen work on the right,
 * or the sign-in over the whole window while no account stands. Every
 * press is the control's it came from; this only lays them out. Settings
 * keeps its page list whatever the sidebar's collapse says, and hands the
 * tasks back folded or not as it found them. The side panel's toggle is the
 * mirror of the sidebar's, at the window's top right on a task's page, so
 * neither pane carries the button that moves it. A plan's version history
 * takes the whole window as Settings does, its versions listed where the
 * sidebar was, and leaves the same way; the Inbox stands in the task's
 * place beside the sidebar (`desktop-inbox.tsx`); it is still a stay on the task, so
 * what changed since the developer last looked is held here, across it,
 * rather than by the task's page (`use-task-looks.ts`). Folding the sidebar,
 * opening, shutting, or growing the side panel, or the task's summary pinned
 * or folded to its rail, by a press or by its column's room
 * (task-summary.tsx), glides the work beside them (pane-motion.tsx). A
 * window too narrow to pin the sidebar folds it, and a folded sidebar floats
 * over the work rather than beside it (`sidebar-collapse.ts`), put away by a
 * press outside it and its toggle. A stage as narrow as a phone's stands the
 * window as one pane at a time (`shell-room.ts`): the sidebar is a drawer its
 * toggle opens, with no edge to peek it out, and the side panel stands only
 * full screen, and Settings, a version history, and Chat each show their
 * list or the item chosen in it, one at a time. Back and forward ride the left column's title-bar row,
 * the tasks' sidebar or Settings' page list alike, and leaving Settings is
 * going back to wherever it was opened from, or to the tasks when nothing
 * stands behind it. New task's dialog stands over the tasks or a version
 * history, whichever is drawn (`new-task-dialog.tsx`). The voice's notice line rides the foot of the call's
 * agent's tab while it is drawn, and floats at the window's foot wherever
 * else a call can still be heard.
 */
export function DesktopShell({
  gates,
  tab,
  onTabChange,
  tasks,
  history,
  sidebar,
  room,
  settingsStep,
  settings,
}: {
  gates: DesktopGates;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  tasks: TasksControl;
  history: WindowHistory;
  sidebar: SidebarCollapse;
  /** The room the panel's stage gives; narrow, the sidebar is a drawer and the side panel stands only full screen. */
  room: ShellRoom;
  /** Whether Settings stands on its page list or a page, which a narrow room draws one at a time. */
  settingsStep: SettingsStep;
  settings: SettingsPanelProps;
}): React.JSX.Element {
  const { account } = settings;
  const shell = useRef<HTMLDivElement>(null);
  const keepOverlay = useFloatDismiss({ state: sidebar.overlay, onState: sidebar.onOverlay });
  // A fixture run keeps the summary's pin as it keeps the sidebar's fold: not at all.
  const summary = useSummaryPin(sidebar.staged);
  const gated = gates.accountRequired && account.status !== ACCOUNT_STATUS.SIGNED_IN;
  const offline = useOffline();
  usePlaceCommands(!gated, tab, onTabChange, tasks, settings, history);
  // Chat is an experiment: switched off while it stands, here or on another Mac, it puts itself away.
  const chatOn = useChatOn();
  const { open: chatShown, onClose: closeChat } = tasks.chatView;
  useEffect(() => {
    if (chatShown && !chatOn) closeChat();
  }, [chatShown, chatOn, closeChat]);
  // The Admin place is an admin's alone: an account known to be no admin, or no longer one, is given the task's place back,
  // while one whose access is still being read, as a reloaded Admin address's is, has the place wait on it.
  const adminAccess = useAdminAccess();
  const adminPending = useAdminAccessPending();
  const { open: adminShown, onClose: closeAdmin } = tasks.adminView;
  useEffect(() => {
    if (adminShown && !adminAccess && !adminPending) closeAdmin();
  }, [adminShown, adminAccess, adminPending, closeAdmin]);
  const { region } = tasks;
  // The folded sidebar's call card stands over the column's foot, clear of its dock.
  useColumnDock(
    shell,
    tasks.sidePanel.fullScreen,
    room === SHELL_ROOM.NARROW,
    `${tab}:${tasks.page}:${tasks.history.open}:${tasks.inboxView.open}:${tasks.agentView.agentId}:${tasks.personView.userId}:${tasks.automationsView.open}:${tasks.chatView.open}:${tasks.boardView.open}:${tasks.adminView.open}:${sidebar.collapsed}`,
  );
  // The window's title names what stands in it, the plan only while it is on screen, and its workspace;
  // the Inbox, an agent's or a person's page, the Automations page, Chat, or the Board standing in its place is not the plan.
  const standingIn =
    tasks.inboxView.open ||
    tasks.agentView.agentId !== undefined ||
    tasks.personView.userId !== undefined ||
    tasks.automationsView.open ||
    tasks.chatView.open ||
    tasks.boardView.open ||
    tasks.adminView.open;
  const shownTask =
    tab === PANEL_TAB.TASKS && !standingIn && region.kind === DOCUMENT_REGION.READY
      ? region.task
      : undefined;
  const inboxFirst = useExperiment(EXPERIMENT.INBOX_FIRST);
  // With the inbox-first sidebar on, the Inbox is read once here, the sidebar listing it and the Inbox's page showing its chosen item; off, it reads nothing.
  // Note that the sidebar draws its list, so the list holds still while the sidebar is in sight.
  const inboxListing = useInboxListing(
    tasks,
    inboxFirst && tasks.signedIn,
    tasks.shown && sidebarInSight(sidebar),
  );
  const sharedListing = inboxFirst && tasks.signedIn ? inboxListing : undefined;
  useWindowTitle(titleSubject(tab, tasks, shownTask));
  // The plan is looked at the moment it is on screen, whichever of its column's tabs is chosen.
  const looks = useTaskLooks(shownTask, tasks.me);
  // An agent with no plan is looked at as its page is on screen, as the plan is.
  const { agentId: pageAgentId } = tasks.agentView;
  useAgentLook(
    tab === PANEL_TAB.TASKS && pageAgentId !== undefined
      ? [...tasks.listedAgents.standing, ...tasks.listedAgents.archived].find(
          (agent) => agent.id === pageAgentId,
        )
      : undefined,
  );
  const mentionedAgents = useMemo(
    () => ({ models: tasks.agents.models, me: tasks.me }),
    [tasks.agents.models, tasks.me],
  );
  // A chip naming a task hangs the task's card, as its sidebar row does.
  // Note that what the columns are handed is held across draws over the same
  // tasks, because each column holds while what it is handed does
  // (`DesktopSidebar`, `DesktopTasks`), and a chip reads its cards from here.
  const chipCards = useMemo(
    () => ({
      taskCard: (taskId: string, now: number, focus: TaskFocus | undefined) => {
        const task = [...tasks.tasks, ...tasks.archived].find((each) => each.id === taskId);
        if (task === undefined) return undefined;
        // Note that the card names its creator as the task's own workspace holds them, whatever workspace the chip stands in.
        const home = tasks.workspaces.find((each) => each.id === task.workspaceId);
        const card = taskCardOf(tasks, task, now, focus);
        return home === undefined ? (
          card
        ) : (
          <WorkspaceDirectory workspace={home}>{card}</WorkspaceDirectory>
        );
      },
    }),
    [tasks],
  );
  // New task asks over whatever stands, the tasks or a version history.
  const newTaskDialog = useMemo(() => <NewTaskDialog newTask={tasks.newTask} />, [tasks.newTask]);
  // Note that the shell says whether the panel's toggle stands, because the
  // toolbar beneath it leaves the toggle room then and only then. The
  // Automations page and Chat stand in the plan's place, so they draw
  // no panel to toggle; an agent's page draws the agent's own, and the Inbox
  // the chosen item's task's.
  const planToggle = tasks.page === TASKS_PAGE.DOCUMENT && !standingIn;
  const taskDrawn = planToggle && tasks.region.kind === DOCUMENT_REGION.READY;
  const calling = useCallingAgent();
  const callShown = taskDrawn && callTabShown(tasks, calling);
  if (gated) {
    const macAppLink = appPlatform().macAppLink?.();
    return (
      <ScrollArea>
        <div className="desktop-onboarding">
          <div className="desktop-drag-strip" />
          <SignInGate
            account={account}
            {...(gates.signInWait ? { waiting: gates.signInWait } : undefined)}
            {...(gates.signInFailure ? { failure: gates.signInFailure } : undefined)}
            {...(gates.lastSignIn ? { lastUsed: gates.lastSignIn } : undefined)}
            {...(macAppLink === undefined ? undefined : { macAppLink })}
            onBegin={gates.onBeginSignIn}
            onCancel={gates.onCancelSignIn}
          />
          {/* Signing in needs the network, so the gate says when there is none. */}
          <div className="title-bar-controls">
            <OfflineMark />
          </div>
        </div>
      </ScrollArea>
    );
  }
  // Settings takes the whole window, its pages listed where the tasks were.
  if (tab === PANEL_TAB.SETTINGS) {
    const exitSettings = history.canGoBack ? history.onBack : () => onTabChange(PANEL_TAB.TASKS);
    return (
      <div className="desktop-shell" data-room={room}>
        <Suspense
          fallback={
            <SettingsLoading
              onExit={exitSettings}
              hidden={hiddenColumns(room, settingsStep.listed)}
            />
          }
        >
          <DesktopSettings
            sidebar={sidebar}
            room={room}
            step={settingsStep}
            history={history}
            settings={settings}
            onExit={exitSettings}
          />
        </Suspense>
        {NOTICE_STRIP}
      </div>
    );
  }
  // A plan's version history takes the whole window too, its versions listed
  // where the sidebar was, and hands the task back as it found it.
  if (tasks.history.open) {
    const exitHistory = history.canGoBack ? history.onBack : tasks.history.onClose;
    return (
      <div className="desktop-shell" data-room={room}>
        {/* A chip in a version's words hangs the cards the plan's own words do. */}
        <MentionedAgents value={mentionedAgents}>
          <ChipCards value={chipCards}>
            <Suspense
              fallback={
                <VersionHistoryLoading
                  onExit={exitHistory}
                  hidden={hiddenColumns(room, tasks.history.listed)}
                />
              }
            >
              <VERSION_HISTORY.Route
                sidebar={sidebar}
                room={room}
                history={history}
                tasks={tasks}
                account={account}
                onExit={exitHistory}
                onRestored={history.onLeaveVersionHistory}
              />
            </Suspense>
          </ChipCards>
        </MentionedAgents>
        {NOTICE_STRIP}
        {newTaskDialog}
      </div>
    );
  }
  // The Admin place takes the whole window as Settings does, its sections listed where the tasks were.
  if (tasks.adminView.open && (adminAccess || adminPending)) {
    const exitAdmin = history.canGoBack ? history.onBack : tasks.adminView.onClose;
    const loading = (
      <AdminLoading onExit={exitAdmin} hidden={hiddenColumns(room, tasks.adminView.listed)} />
    );
    // While the account's access is read, the place stands as it does while its chunk loads.
    if (!adminAccess) {
      return (
        <div className="desktop-shell" data-room={room}>
          {loading}
          {NOTICE_STRIP}
        </div>
      );
    }
    return (
      <div className="desktop-shell" data-room={room}>
        <Suspense fallback={loading}>
          <ADMIN_PLACE.Route
            sidebar={sidebar}
            room={room}
            history={history}
            view={tasks.adminView.view}
            listed={tasks.adminView.listed}
            onOpen={tasks.adminView.onOpen}
            onList={tasks.adminView.onList}
            onExit={exitAdmin}
          />
        </Suspense>
        {NOTICE_STRIP}
      </div>
    );
  }
  const inboxOpen = tasks.inboxView.open;
  const pageAgent = tasks.agentView.agentId;
  const pagePerson = tasks.personView.userId;
  const automationsOpen = tasks.automationsView.open;
  const chatOpen = tasks.chatView.open && chatOn;
  const boardOpen = tasks.boardView.open;
  const panelToggle =
    planToggle || pageAgent !== undefined || (inboxOpen && tasks.inboxView.chosen !== undefined);
  // Note that the notice line rides the foot of the call's agent's
  // tab, or its own page, while that is on screen, and floats at the
  // window's foot otherwise.
  const pageCallShown =
    !inboxOpen &&
    !chatOpen &&
    pageAgent !== undefined &&
    pageAgent === calling &&
    !tasks.sidePanel.fullScreen;
  const noticeInColumn = callShown || pageCallShown;
  // A phone's drawer is modal, as a phone's own drawers are: while it stands
  // over the work, the work is inert, so neither a screen reader nor a
  // keyboard reaches what the drawer covers, and a press there only puts it
  // away. Its toggle stays, the way to close it.
  const drawerOver = room === SHELL_ROOM.NARROW && sidebar.overlay !== SIDEBAR_OVERLAY.CLOSED;
  return (
    <div
      ref={shell}
      className="desktop-shell"
      data-room={room}
      data-sidebar-collapsed={String(sidebar.collapsed)}
      data-sidebar-overlay={sidebar.overlay}
      data-panel-toggle={String(panelToggle)}
      data-offline={String(offline)}
    >
      <DesktopSidebar
        sidebar={sidebar}
        history={history}
        tasks={tasks}
        tab={tab}
        onTabChange={onTabChange}
        account={account}
        updates={settings.updates}
        onSignOut={settings.onSignOut}
        onPressWithin={keepOverlay}
        room={room}
        inboxListing={sharedListing}
      />
      <main className="desktop-main" inert={drawerOver}>
        {/* A chip of an agent off its task's page names its model and its starter as the agent's tab does. */}
        <MentionedAgents value={mentionedAgents}>
          <ChipCards value={chipCards}>
            {chatOpen ? (
              <PageFind page={FIND_PAGE.CHAT} active={tasks.shown}>
                <DesktopChat
                  tasks={tasks}
                  room={room}
                  accountName={
                    account.status === ACCOUNT_STATUS.SIGNED_IN ? account.name : undefined
                  }
                />
              </PageFind>
            ) : inboxOpen ? (
              <DesktopInbox tasks={tasks} listing={sharedListing} />
            ) : pageAgent !== undefined ? (
              // Keyed by the agent, so another agent's page is a page of its own, holding nothing of the last.
              <DesktopAgentPage
                key={pageAgent}
                tasks={tasks}
                agentId={pageAgent}
                notice={pageCallShown ? NOTICE_STRIP : undefined}
              />
            ) : pagePerson !== undefined ? (
              // Keyed by the person, so another person's page holds nothing of the last, its find among it.
              <PageFind
                key={pagePerson}
                page={FIND_PAGE.PERSON}
                at={pagePerson}
                active={tasks.shown}
              >
                <Suspense
                  fallback={
                    <PersonLoading name={tasks.personView.name} onExit={tasks.personView.onClose} />
                  }
                >
                  <PERSON_PAGE.Route
                    tasks={tasks}
                    userId={pagePerson}
                    name={tasks.personView.name}
                    staged={sidebar.staged}
                  />
                </Suspense>
              </PageFind>
            ) : boardOpen ? (
              // The Tasks page holds its own find, its subject the view it shows, so a search in the List does not follow into the Board.
              <Suspense fallback={<TasksLoading onExit={tasks.boardView.onClose} />}>
                <TasksPage tasks={tasks} room={room} />
              </Suspense>
            ) : automationsOpen ? (
              <PageFind
                page={FIND_PAGE.AUTOMATIONS}
                at={automationsPlaceKey(tasks.automationsView.place)}
                active={tasks.shown}
              >
                <Suspense fallback={<AutomationsLoading onExit={tasks.automationsView.onClose} />}>
                  <AutomationsPage tasks={tasks} room={room} />
                </Suspense>
              </PageFind>
            ) : (
              <DesktopTasks
                tasks={tasks}
                looks={looks}
                notice={noticeInColumn ? NOTICE_STRIP : undefined}
                summary={summary}
              />
            )}
          </ChipCards>
        </MentionedAgents>
      </main>
      {noticeInColumn ? null : NOTICE_STRIP}
      {/* Folded, the sidebar's card floats in the corner it would have stood over. */}
      <StandingCallCardDock docked={sidebar.collapsed} surface={CALL_CARD_SURFACE.FLOATING} />
      {/* The folded sidebar peeks out while the pointer rests at the window's left edge, as Linear's does;
          a narrow room's drawer opens by its toggle alone, as a phone's does. */}
      {sidebar.collapsed &&
      sidebar.overlay === SIDEBAR_OVERLAY.CLOSED &&
      room === SHELL_ROOM.WIDE ? (
        <div
          className="sidebar-peek-edge"
          data-sidebar-peek-edge=""
          onPointerEnter={() => sidebar.onOverlay(SIDEBAR_OVERLAY.PEEK)}
        />
      ) : null}
      {/* Note that they follow the drag strips they cover, because a later drag region wins.
          Folded, the sidebar's offline pill stands here, as its New task does. */}
      <div className="title-bar-controls" onPointerDown={keepOverlay}>
        <SidebarToggle sidebar={sidebar} />
        {sidebar.collapsed ? <TitleBarNewTask tasks={tasks} /> : null}
        {sidebar.collapsed ? <OfflineMark /> : null}
      </div>
      {panelToggle ? (
        <div className="title-bar-controls" data-edge="end" inert={drawerOver}>
          <SidePanelToggle
            panel={tasks.sidePanel}
            disabled={planToggle && tasks.region.kind !== DOCUMENT_REGION.READY}
          />
        </div>
      ) : null}
      {newTaskDialog}
      <PaneGlide
        root={shell}
        layout={{
          sidebarCollapsed: sidebar.collapsed,
          panelOpen: tasks.sidePanel.open,
          panelFullScreen: tasks.sidePanel.fullScreen,
          summaryPinned: summary.pinned && summary.wide,
        }}
      />
    </div>
  );
}
