import { ACCOUNT_STATUS, type AccountProvider } from "@luke/credentials/snapshot";
import type { Task } from "@luke/features/task-wire";
import { useAppCommand } from "@luke/panel/app-commands";
import { READING_AUTOMATIONS } from "@luke/panel/desktop/automation-words";
import { useColumnDock } from "@luke/panel/desktop/column-dock";
import { useFloatDismiss } from "@luke/panel/desktop/hover-pane";
import { OfflineMark, useOffline } from "@luke/panel/desktop/offline-mark";
import { PaneGlide } from "@luke/panel/desktop/pane-motion";
import { SIDEBAR_OVERLAY, type SidebarCollapse } from "@luke/panel/desktop/sidebar-collapse";
import { useWindowTitle } from "@luke/panel/desktop/window-title";
import { FIND_PAGE, PageFind } from "@luke/panel/find-in-tab";
import { PANEL_TAB, type PanelTab } from "@luke/panel/panel-tabs";
import { SignInGate } from "@luke/panel/sign-in-gate";
import { useChatOn } from "@luke/panel/tasks/chat-gate";
import { SIDE_PANEL_TAB } from "@luke/panel/tasks/use-side-panel";
import { useTaskLooks } from "@luke/panel/tasks/use-task-looks";
import { Tooltip } from "@luke/panel/tooltip";
import { useExperiment } from "@luke/panel/use-app-state";
import { EXPERIMENT } from "@luke/settings";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  COLLECTION_STATE,
  CollectionPage,
  ComposeIcon,
  IconButton,
  PAGE_FRAME,
  ScrollArea,
  SettingsPage,
  SettingsSectionsSkeleton,
  SidebarIcon,
  Skeleton,
} from "@luke/ui";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { TRANSCRIPT_REGION } from "@luke/voice/transcript-model";
import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import { CALL_CARD_SURFACE, CallCardDock, type CallCardInput } from "../call/call-card";
import { CaptionStrip, type CaptionStripProps } from "../caption-strip";
import { ExperimentTag } from "../experiment-marks";
import type { NavigationHistory, WindowHistory } from "../navigation-history";
import type { SettingsPanelProps } from "../settings/settings-panel";
import { ChipCards, type TaskFocus, WorkspaceDirectory } from "../tasks/chip-cards";
import { MentionedAgents } from "../tasks/mentioned-agent-card";
import { NewTaskDialog } from "../tasks/new-task-dialog";
import {
  AUTOMATIONS_PAGE,
  type AutomationsPlace,
  ISSUES_PAGE,
  type TasksControl,
} from "../tasks/use-tasks-tab";
import { DesktopAgentPage } from "./desktop-agent-page";
import { DesktopChat } from "./desktop-chat";
import { DesktopFactory } from "./desktop-factory";
import { DesktopInbox } from "./desktop-inbox";
import { DesktopSidebar } from "./desktop-sidebar";
import { DesktopTasks } from "./desktop-tasks";
import { DesktopVersionHistory, taskVersionSubject } from "./desktop-version-history";
import { PersonPage } from "./person-page";
import { SidePanelToggle } from "./side-panel";
import { taskCardOf } from "./task-card";
import { useSummaryPin } from "./task-summary";

/**
 * Settings, loaded as a chunk of its own the first time it opens rather than
 * with the window, because the renderer bundle is parsed at every window
 * open, the voice window's included, and Settings is opened seldom
 * (`bundle-budget.json`). The chunk is a local file, so it stands a frame
 * later, over its frame of placeholders in the meantime (`SettingsLoading`).
 */
const DesktopSettings = lazy(() =>
  import("./desktop-settings").then((loaded) => ({ default: loaded.DesktopSettings })),
);

/**
 * The Automations pages, loaded as a chunk of their own the first time
 * they open, as Settings is and for the same reason: the renderer bundle is
 * parsed at every window open, and the pages, their editor and its triggers
 * among them, are opened seldom (`bundle-budget.json`). What stands while
 * the chunk loads is the pages' own empty frame, for a frame.
 */
const AutomationsPage = lazy(() =>
  import("./automations-page").then((loaded) => ({ default: loaded.AutomationsPage })),
);

/**
 * The Issues page, loaded as a chunk of its own the first time it opens,
 * as the Automations pages are and for the same reason.
 */
const IssuesPage = lazy(() =>
  import("./issues-page").then((loaded) => ({ default: loaded.IssuesPage })),
);

/**
 * What stands while the Issues page's chunk loads: its empty frame, and its
 * own way out, so Escape pressed in that frame closes Issues as the list
 * would rather than falling through to the plan behind it.
 */
function IssuesLoading({ onExit }: { onExit: () => void }): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_ISSUES, onExit);
  return <section className="automations-view" aria-label="Issues" />;
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
 * same command itself.
 */
function SettingsLoading({ onExit }: { onExit: () => void }): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_SETTINGS, onExit);
  return (
    <div className="desktop-settings">
      <nav className="settings-pages" aria-label="Settings pages">
        <div className="desktop-drag-strip" />
      </nav>
      <section className="settings-page" aria-label="Settings">
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
 * task, Settings, the home page, the Inbox, the tab closed latest, opened again on its
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
    APP_COMMAND.HOME,
    pastGate && tasks.signedIn
      ? () => {
          if (tab !== PANEL_TAB.TASKS) onTabChange(PANEL_TAB.TASKS);
          tasks.onGoHome();
        }
      : undefined,
  );
  useAppCommand(
    APP_COMMAND.INBOX,
    pastGate && tasks.signedIn
      ? () => {
          if (tab !== PANEL_TAB.TASKS) onTabChange(PANEL_TAB.TASKS);
          tasks.inboxView.onOpen();
        }
      : undefined,
  );
  // The Issues page is an experiment on the same terms as Factory.
  const issuesOn = useExperiment(EXPERIMENT.ISSUES);
  useAppCommand(
    APP_COMMAND.ISSUES,
    pastGate && tasks.signedIn && issuesOn
      ? () => {
          if (tab !== PANEL_TAB.TASKS) onTabChange(PANEL_TAB.TASKS);
          tasks.issuesView.onOpen();
        }
      : undefined,
  );
  // Factory is an experiment: offered nowhere, ⌘K, its chord, or the menu, while it is off.
  const factoryOn = useExperiment(EXPERIMENT.FACTORY);
  useAppCommand(
    APP_COMMAND.FACTORY,
    pastGate && tasks.signedIn && factoryOn
      ? () => {
          if (tab !== PANEL_TAB.TASKS) onTabChange(PANEL_TAB.TASKS);
          tasks.factoryView.onOpen();
        }
      : undefined,
  );
  // The Automations page is an experiment on the same terms as Factory.
  const automationsOn = useExperiment(EXPERIMENT.AUTOMATIONS);
  useAppCommand(
    APP_COMMAND.AUTOMATIONS,
    pastGate && tasks.signedIn && automationsOn
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
  useAppCommand(
    APP_COMMAND.KEYBOARD_SHORTCUTS,
    pastGate
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

/**
 * Whether the open task's Transcript is on screen with its words, streaming
 * a call's as they are said. A Call tab standing behind another chosen
 * tab is not on screen, and one still reading, or failed, shows no words.
 */
function transcriptStreaming(tasks: TasksControl): boolean {
  const { sidePanel, transcript } = tasks;
  return (
    sidePanel.open &&
    sidePanel.tab === SIDE_PANEL_TAB.CALL &&
    transcript.region.kind === TRANSCRIPT_REGION.READY
  );
}

/**
 * What the window's title names: Settings alone, whose pages are not one
 * workspace's; the Inbox in the listed workspace, whatever task its item is
 * from; Factory, the Automations page, and Chat in the listed workspace; the task on screen in its own workspace, or alone while that is not
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
  if (tasks.factoryView.open) return { signedIn, subject: "Factory", workspace: tasks.workspace };
  if (tasks.automationsView.open) {
    return { signedIn, subject: "Automations", workspace: tasks.workspace };
  }
  if (tasks.chatView.open) return { signedIn, subject: "Chat", workspace: tasks.workspace };
  if (tasks.issuesView.open) return { signedIn, subject: "Issues", workspace: tasks.workspace };
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
 * press outside it and its toggle. Back and forward ride the left column's title-bar row,
 * the tasks' sidebar or Settings' page list alike, and leaving Settings is
 * going back to wherever it was opened from, or to the tasks when nothing
 * stands behind it. New task's dialog stands over the tasks or a version
 * history, whichever is drawn (`new-task-dialog.tsx`). The live captions ride the call bar while the task's
 * column is drawn, and float at the window's foot wherever else a call can
 * still be heard; they hold back spoken words while the task's Transcript
 * is on screen streaming the same ones.
 */
export function DesktopShell({
  gates,
  tab,
  onTabChange,
  tasks,
  history,
  sidebar,
  call,
  captions,
  settings,
}: {
  gates: DesktopGates;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  tasks: TasksControl;
  history: WindowHistory;
  sidebar: SidebarCollapse;
  /** The call card, while this window is to draw one; docked by the shell wherever the window stands. */
  call: CallCardInput | undefined;
  captions: CaptionStripProps;
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
  // Factory switched off while it stands, here or on another Mac, gives the task's place back.
  const factoryOn = useExperiment(EXPERIMENT.FACTORY);
  const { open: factoryShown, onClose: closeFactory } = tasks.factoryView;
  useEffect(() => {
    if (factoryShown && !factoryOn) closeFactory();
  }, [factoryShown, factoryOn, closeFactory]);
  const automationsOn = useExperiment(EXPERIMENT.AUTOMATIONS);
  const { open: automationsShown, onClose: closeAutomations } = tasks.automationsView;
  useEffect(() => {
    if (automationsShown && !automationsOn) closeAutomations();
  }, [automationsShown, automationsOn, closeAutomations]);
  // Chat is an experiment on the same terms: turned off while it stands, it puts itself away.
  const chatOn = useChatOn();
  const { open: chatShown, onClose: closeChat } = tasks.chatView;
  useEffect(() => {
    if (chatShown && !chatOn) closeChat();
  }, [chatShown, chatOn, closeChat]);
  const issuesOn = useExperiment(EXPERIMENT.ISSUES);
  const { open: issuesShown, onClose: closeIssues } = tasks.issuesView;
  useEffect(() => {
    if (issuesShown && !issuesOn) closeIssues();
  }, [issuesShown, issuesOn, closeIssues]);
  const { region } = tasks;
  // The folded sidebar's call card stands over the column's foot, clear of its dock.
  useColumnDock(
    shell,
    tasks.sidePanel.fullScreen,
    `${tab}:${tasks.page}:${tasks.history.open}:${tasks.inboxView.open}:${tasks.agentView.agentId}:${tasks.personView.userId}:${tasks.factoryView.open}:${tasks.automationsView.open}:${tasks.chatView.open}:${tasks.issuesView.open}:${sidebar.collapsed}`,
  );
  // The window's title names what stands in it, the plan only while it is on screen, and its workspace;
  // the Inbox, an agent's or a person's page, Factory, the Automations page, or Chat standing in its place is not the plan.
  const standingIn =
    tasks.inboxView.open ||
    tasks.agentView.agentId !== undefined ||
    tasks.personView.userId !== undefined ||
    tasks.factoryView.open ||
    tasks.automationsView.open ||
    tasks.chatView.open ||
    tasks.issuesView.open;
  const shownTask =
    tab === PANEL_TAB.TASKS && !standingIn && region.kind === DOCUMENT_REGION.READY
      ? region.task
      : undefined;
  useWindowTitle(titleSubject(tab, tasks, shownTask));
  // The plan is looked at the moment it is on screen, whichever of its column's tabs is chosen.
  const looks = useTaskLooks(shownTask, tasks.me);
  const mentionedAgents = useMemo(
    () => ({ models: tasks.agents.models, me: tasks.me }),
    [tasks.agents.models, tasks.me],
  );
  // A chip naming a task hangs the task's card, as its sidebar row does.
  const chipCards = {
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
  };
  if (gated) {
    return (
      <ScrollArea>
        <div className="desktop-onboarding">
          <div className="desktop-drag-strip" />
          <SignInGate
            account={account}
            {...(gates.signInWait ? { waiting: gates.signInWait } : undefined)}
            {...(gates.signInFailure ? { failure: gates.signInFailure } : undefined)}
            {...(gates.lastSignIn ? { lastUsed: gates.lastSignIn } : undefined)}
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
      <div className="desktop-shell">
        <Suspense fallback={<SettingsLoading onExit={exitSettings} />}>
          <DesktopSettings
            sidebar={sidebar}
            history={history}
            settings={settings}
            call={call}
            onExit={exitSettings}
          />
        </Suspense>
        <CaptionStrip {...captions} />
      </div>
    );
  }
  // New task asks over whatever stands, the tasks or a version history.
  const newTaskDialog = <NewTaskDialog newTask={tasks.newTask} />;
  // A plan's version history takes the whole window too, its versions listed
  // where the sidebar was, and hands the task back as it found it.
  if (tasks.history.open) {
    return (
      <div className="desktop-shell">
        {/* A chip in a version's words hangs the cards the plan's own words do. */}
        <MentionedAgents value={mentionedAgents}>
          <ChipCards value={chipCards}>
            <DesktopVersionHistory
              sidebar={sidebar}
              history={history}
              subject={taskVersionSubject(tasks)}
              account={account}
              call={call}
              onExit={history.canGoBack ? history.onBack : tasks.history.onClose}
              onRestored={history.onLeaveVersionHistory}
            />
          </ChipCards>
        </MentionedAgents>
        <CaptionStrip {...captions} />
        {newTaskDialog}
      </div>
    );
  }
  // Note that the shell says whether the panel's toggle stands, because the
  // toolbar beneath it leaves the toggle room then and only then. Factory,
  // the Automations page, and Chat stand in the plan's place, so they draw
  // no panel to toggle; an agent's page draws the agent's own, the Inbox
  // the chosen item's task's, and the Issues list the issue it peeked.
  const inboxOpen = tasks.inboxView.open;
  const pageAgent = tasks.agentView.agentId;
  const pagePerson = tasks.personView.userId;
  const factoryOpen = tasks.factoryView.open && factoryOn;
  const automationsOpen = tasks.automationsView.open && automationsOn;
  const chatOpen = tasks.chatView.open && chatOn;
  const issuesOpen = tasks.issuesView.open && issuesOn;
  const planToggle = tasks.page === TASKS_PAGE.DOCUMENT && !standingIn;
  // The Issues list draws the panel beside it once an issue has been peeked there, as the Inbox does once an item is chosen.
  const issuePeeked =
    issuesOpen &&
    tasks.issuesView.place.kind === ISSUES_PAGE.LIST &&
    tasks.issuesView.peeked !== undefined;
  const panelToggle =
    planToggle ||
    pageAgent !== undefined ||
    (inboxOpen && tasks.inboxView.chosen !== undefined) ||
    issuePeeked;
  const taskDrawn = planToggle && tasks.region.kind === DOCUMENT_REGION.READY;
  // Note that a panel filling the window hides the task's column, call bar
  // and all, so the captions float in its place then.
  const captionsInColumn = taskDrawn && !tasks.sidePanel.fullScreen;
  const captionStrip = (
    <CaptionStrip {...captions} speechHidden={taskDrawn && transcriptStreaming(tasks)} />
  );
  return (
    <div
      ref={shell}
      className="desktop-shell"
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
        call={sidebar.collapsed ? undefined : call}
        onPressWithin={keepOverlay}
      />
      <main className="desktop-main">
        {/* A chip of an agent off its task's page names its model and its starter as the agent's tab does. */}
        <MentionedAgents value={mentionedAgents}>
          <ChipCards value={chipCards}>
            {chatOpen ? (
              <DesktopChat
                tasks={tasks}
                accountName={account.status === ACCOUNT_STATUS.SIGNED_IN ? account.name : undefined}
              />
            ) : inboxOpen ? (
              <DesktopInbox tasks={tasks} />
            ) : pageAgent !== undefined ? (
              // Keyed by the agent, so another agent's page is a page of its own, holding nothing of the last.
              <DesktopAgentPage key={pageAgent} tasks={tasks} agentId={pageAgent} />
            ) : pagePerson !== undefined ? (
              // Keyed by the person, so another person's page holds nothing of the last, its find among it.
              <PageFind
                key={pagePerson}
                page={FIND_PAGE.PERSON}
                at={pagePerson}
                active={tasks.shown}
              >
                <PersonPage
                  tasks={tasks}
                  userId={pagePerson}
                  name={tasks.personView.name}
                  staged={sidebar.staged}
                />
              </PageFind>
            ) : factoryOpen ? (
              <PageFind page={FIND_PAGE.FACTORY} active={tasks.shown}>
                <DesktopFactory tasks={tasks} />
              </PageFind>
            ) : issuesOpen ? (
              <PageFind page={FIND_PAGE.ISSUES} active={tasks.shown}>
                <Suspense fallback={<IssuesLoading onExit={tasks.issuesView.onClose} />}>
                  <IssuesPage tasks={tasks} />
                </Suspense>
              </PageFind>
            ) : automationsOpen ? (
              <PageFind
                page={FIND_PAGE.AUTOMATIONS}
                at={automationsPlaceKey(tasks.automationsView.place)}
                active={tasks.shown}
              >
                <Suspense fallback={<AutomationsLoading onExit={tasks.automationsView.onClose} />}>
                  <AutomationsPage tasks={tasks} />
                </Suspense>
              </PageFind>
            ) : (
              <DesktopTasks
                tasks={tasks}
                looks={looks}
                captions={captionsInColumn ? captionStrip : undefined}
                summary={summary}
                accountName={account.status === ACCOUNT_STATUS.SIGNED_IN ? account.name : undefined}
              />
            )}
          </ChipCards>
        </MentionedAgents>
      </main>
      {captionsInColumn ? null : captionStrip}
      {/* Folded, the sidebar's card floats in the corner it would have stood over. */}
      <CallCardDock
        call={sidebar.collapsed ? call : undefined}
        surface={CALL_CARD_SURFACE.FLOATING}
      />
      {/* The folded sidebar peeks out while the pointer rests at the window's left edge, as Linear's does. */}
      {sidebar.collapsed && sidebar.overlay === SIDEBAR_OVERLAY.CLOSED ? (
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
        <div className="title-bar-controls" data-edge="end">
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
