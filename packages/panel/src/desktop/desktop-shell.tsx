import { ACCOUNT_STATUS, type AccountProvider } from "@repo/credentials/snapshot";
import type { Task } from "@repo/features/task-wire";
import { readingWords, type SignInFailure } from "@repo/features/words";
import { HOST_CAPABILITY } from "@repo/settings";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  BACK_BUTTON_LOOK,
  BackButton,
  COLLECTION_STATE,
  CollectionPage,
  DrawerScrim,
  IconButton,
  NOT_FOUND_THING,
  NotFound,
  PAGE_FRAME,
  PANE_PIN_ELEMENT,
  PanePin,
  ScrollArea,
  SETTINGS_ROW_MARK_WIDTH,
  SETTINGS_SKELETON_CONTROL,
  SettingsPageSkeleton,
  type SettingsSectionSkeletonShape,
  SidebarIcon,
  TOOLBAR_LOOK,
  Toolbar,
  Tooltip,
  useDrawerSwipe,
} from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { DOCUMENT_REGION, TASKS_PAGE } from "@repo/ui/tasks-model";
import { useQuery } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import {
  Activity,
  createContext,
  type RefObject,
  Suspense,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ACTOR_SIZE, actorMarkWidth } from "../actor-ref.js";
import { AdminCollectionPage, AdminPlaceFrameProvider } from "../admin/chrome/page-header.js";
import type { AdminView } from "../admin/routing.js";
import { useAppCommand } from "../app-commands.js";
import { appPlatform } from "../app-platform.js";
import { useCoarsePointer } from "../coarse-pointer.js";
import type { NavigationHistory, WindowHistory } from "../navigation-history.js";
import { NewWorkspaceSteps } from "../onboarding/new-workspace-steps.js";
import { SETUP_GATE } from "../onboarding/setup-model.js";
import { SetupSteps, useSetupGate } from "../onboarding/setup-steps.js";
import { PANEL_TAB, type PanelTab } from "../panel-tabs.js";
import type { SettingsPanelProps } from "../settings/settings-panel.js";
import { type HiddenColumns, hiddenColumns, SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { SignInGate } from "../sign-in-gate.js";
import { ChipCards, type TaskFocus } from "../tasks/chip-cards.js";
import { MentionedAgents } from "../tasks/mentioned-place.js";
import { NewTaskDialog } from "../tasks/new-task-dialog.js";
import { useAgentLook, useTaskLooks } from "../tasks/use-task-looks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import {
  appStateQuery,
  selectAdminAccess,
  selectAdminAccessPending,
  selectCapability,
} from "../use-app-state.js";
import { ADMIN_TITLE, adminFrame } from "./admin-frame.js";
import {
  AutomationListSkeleton,
  AutomationsActsSkeleton,
  AutomationsToolbar,
} from "./automation-list-frame.js";
import { READING_AUTOMATIONS } from "./automation-words.js";
import { backPlaceOf } from "./back-place.js";
import { DesktopAgentPage } from "./desktop-agent-page.js";
import { DesktopInbox } from "./desktop-inbox.js";
import type { SettingsStep } from "./desktop-settings.js";
import { DesktopSidebar } from "./desktop-sidebar.js";
import { DesktopTasks } from "./desktop-tasks.js";
import { useFloatDismiss } from "./hover-pane.js";
import { MobileBar, mobileBarShown } from "./mobile-bar.js";
import { NewTaskButton } from "./new-task-button.js";
import { OfflineMark } from "./offline-mark.js";
import { VERSION_HISTORY } from "./pages-on-demand.js";
import { PaneGlide } from "./pane-motion.js";
import { PersonPageSkeleton } from "./person-frame.js";
import { PhoneAccount } from "./phone-account.js";
import { PhoneHead, phoneBar } from "./phone-head.js";
import { PLACE_LIST, PLACE_PAGE, PLACE_SPLIT } from "./place-columns.js";
import { SidePanelChord, SidePanelToggle, usePanelToggleRoom } from "./side-panel.js";
import { SIDEBAR_OVERLAY, type SidebarCollapse } from "./sidebar-collapse.js";
import { homeTaskCardOf } from "./task-card.js";
import { awayBack } from "./task-pane-switcher.js";
import { useSummaryPin } from "./task-summary.js";
import { TasksPagesHeld } from "./tasks-page-held.js";
import { useWindowTitle } from "./window-title.js";

function TasksLoading({ onExit }: { onExit: () => void }): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_BOARD, onExit);
  return (
    <ReplayUnmask>
      <CollectionPage
        frame={PAGE_FRAME.TOOLBAR}
        label="Tasks"
        toolbar={<Toolbar title="Tasks" titleReplayUnmasked />}
        state={COLLECTION_STATE.LOADING}
        loadingLabel="Reading tasks"
      />
    </ReplayUnmask>
  );
}

function AdminLoading({
  room,
  view,
  onOpen,
  onExit,
}: {
  room: ShellRoom;
  view: AdminView;
  onOpen: (view: AdminView) => void;
  onExit: () => void;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_ADMIN, onExit);
  return (
    <AdminPlaceFrameProvider value={adminFrame(room, view, onOpen)}>
      <AdminCollectionPage
        title={ADMIN_TITLE}
        controls={null}
        filters={undefined}
        state={COLLECTION_STATE.LOADING}
        loadingLabel={readingWords("the dashboard")}
      />
    </AdminPlaceFrameProvider>
  );
}

function PersonLoading({
  name,
  onExit,
}: {
  name: string | undefined;
  onExit: () => void;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_PERSON_PAGE, onExit);
  return <PersonPageSkeleton name={name} />;
}

const TASKS_EXIT_PLACE = "tasks";

const HISTORY_EXIT_PLACE = "description";

const UNKNOWN_WORKSPACE_PHONE_PLACE = "unknown-workspace";

const NOT_FOUND_TITLE = "Not found";

const GO_HOME = "Go home";

function VersionHistoryLoading({
  onExit,
  place,
  onList,
  hidden,
}: {
  onExit: () => void;
  place: string;
  onList: () => void;
  hidden: HiddenColumns;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_VERSION_HISTORY, onExit);
  const narrow = hidden.list || hidden.item;
  const exit = (
    <BackButton
      look={narrow ? BACK_BUTTON_LOOK.HEADER : BACK_BUTTON_LOOK.COLUMN}
      label="Back"
      place={place}
      command={APP_COMMAND.EXIT_VERSION_HISTORY}
      onBack={onExit}
    />
  );
  return (
    <div className={`desktop-version-history ${PLACE_SPLIT}`}>
      <nav className={`version-log ${PLACE_LIST}`} aria-label="Versions" hidden={hidden.list}>
        <ReplayUnmask>
          {narrow ? (
            <PhoneHead
              place="version-log"
              start={exit}
              title="Version history"
              titleReplayUnmasked
              end={null}
            />
          ) : (
            <>
              <div className="desktop-drag-strip" />
              {exit}
            </>
          )}
        </ReplayUnmask>
      </nav>
      <section className={`version-page ${PLACE_PAGE}`} aria-label="Version" hidden={hidden.item}>
        {narrow ? (
          <PhoneHead
            place="version"
            start={<BackButton label="Versions" place="versions" onBack={onList} />}
            title={null}
            end={null}
          />
        ) : (
          <div className="desktop-drag-strip" />
        )}
      </section>
    </div>
  );
}

function AutomationsLoading({
  onExit,
  room,
}: {
  onExit: () => void;
  room: ShellRoom;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, onExit);
  return (
    <CollectionPage
      frame={PAGE_FRAME.TOOLBAR}
      label="Automations"
      toolbar={
        <AutomationsToolbar>
          <AutomationsActsSkeleton />
        </AutomationsToolbar>
      }
      state={COLLECTION_STATE.LOADING}
      loadingLabel={READING_AUTOMATIONS}
      skeleton={<AutomationListSkeleton narrow={room === SHELL_ROOM.NARROW} />}
    />
  );
}

const SETTINGS_SKELETON: readonly SettingsSectionSkeletonShape[] = [
  {
    headed: true,
    rows: [
      {
        described: true,
        mark: actorMarkWidth(ACTOR_SIZE.CARD),
        controls: [SETTINGS_SKELETON_CONTROL.BUTTON],
      },
      {
        described: false,
        mark: SETTINGS_ROW_MARK_WIDTH,
        controls: [SETTINGS_SKELETON_CONTROL.BUTTON],
      },
      { described: false, controls: [SETTINGS_SKELETON_CONTROL.BUTTON] },
    ],
  },
];

function SettingsLoading({
  onExit,
  place,
  onList,
  hidden,
}: {
  onExit: () => void;
  place: string;
  onList: () => void;
  hidden: HiddenColumns;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_SETTINGS, onExit);
  const narrow = hidden.list || hidden.item;
  return (
    <div className={`desktop-settings ${PLACE_SPLIT}`}>
      <nav
        className={`settings-pages ${PLACE_LIST}`}
        aria-label="Settings pages"
        hidden={hidden.list}
      >
        <ReplayUnmask>
          {narrow ? (
            <PhoneHead
              place="settings-pages"
              start={
                <BackButton
                  label="Back"
                  place={place}
                  command={APP_COMMAND.EXIT_SETTINGS}
                  onBack={onExit}
                />
              }
              title="Settings"
              titleReplayUnmasked
              end={null}
            />
          ) : (
            <div className="desktop-drag-strip" />
          )}
        </ReplayUnmask>
      </nav>
      <section className={`settings-page ${PLACE_PAGE}`} aria-label="Settings" hidden={hidden.item}>
        <SettingsPageSkeleton
          label={readingWords("Settings")}
          sections={SETTINGS_SKELETON}
          {...(narrow
            ? {
                lead: <BackButton label="Settings" place="settings" onBack={onList} />,
                look: TOOLBAR_LOOK.PHONE,
              }
            : {})}
        />
      </section>
    </div>
  );
}

export interface DesktopGates {
  accountRequired: boolean;
  signInWait?: AccountProvider | undefined;
  signInFailure?: SignInFailure | undefined;
  lastSignIn?: AccountProvider | undefined;
  onBeginSignIn: (provider: AccountProvider) => void;
  onCancelSignIn: () => void;
}

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

function SidebarChord({ sidebar }: { sidebar: SidebarCollapse }): null {
  useAppCommand(APP_COMMAND.TOGGLE_SIDEBAR, sidebar.onToggle);
  return null;
}

interface Holder {
  element: HTMLElement;
  tag: string;
  label: string;
  alone: boolean;
}

function labelOf(element: HTMLElement): string {
  return (
    element.getAttribute("aria-label") ??
    element.getAttribute("placeholder") ??
    element.textContent?.trim() ??
    ""
  );
}

function calledSo(tag: string, label: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(tag)].filter((each) => labelOf(each) === label);
}

function holder(): Holder | undefined {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement) || element === document.body) return undefined;
  const tag = element.localName;
  const label = labelOf(element);
  if (label === "") return undefined;
  return { element, tag, label, alone: calledSo(tag, label).length === 1 };
}

function found({ element, tag, label, alone }: Holder): HTMLElement | undefined {
  if (element.isConnected) return element;
  const called = calledSo(tag, label);
  return alone && called.length === 1 ? called[0] : undefined;
}

function useSettingsFocusHolder(inSettings: boolean): RefObject<Holder | undefined> {
  const before = useRef<Holder | undefined>(undefined);
  const was = useRef(false);
  if (inSettings && !was.current) before.current = holder();
  was.current = inSettings;
  return before;
}

function useFocusHandedBack(held: RefObject<Holder | undefined>): void {
  useLayoutEffect(() => {
    const back = held.current === undefined ? undefined : found(held.current);
    held.current = undefined;
    const now = document.activeElement;
    if (now === null || now === document.body) back?.focus({ preventScroll: true });
  }, [held]);
}

function usePlaceCommands(
  pastGate: boolean,
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
          onTabChange(PANEL_TAB.TASKS);
          tasks.onNewTask();
        }
      : undefined,
  );
  useAppCommand(APP_COMMAND.SETTINGS, pastGate ? () => onTabChange(PANEL_TAB.SETTINGS) : undefined);
  useAppCommand(
    APP_COMMAND.HOME,
    pastGate && tasks.signedIn
      ? () => {
          onTabChange(PANEL_TAB.TASKS);
          tasks.onGoHome();
        }
      : undefined,
  );
  useAppCommand(
    APP_COMMAND.INBOX,
    pastGate && tasks.signedIn
      ? () => {
          onTabChange(PANEL_TAB.TASKS);
          tasks.inboxView.onOpen();
        }
      : undefined,
  );
  useAppCommand(
    APP_COMMAND.TASKS,
    pastGate && tasks.signedIn
      ? () => {
          onTabChange(PANEL_TAB.TASKS);
          tasks.boardView.onOpen();
        }
      : undefined,
  );
  const adminOn = useQuery({ ...appStateQuery, select: selectAdminAccess }).data === true;
  useAppCommand(
    APP_COMMAND.ADMIN,
    pastGate && tasks.signedIn && adminOn ? () => tasks.adminView.onOpen() : undefined,
  );
  useAppCommand(
    APP_COMMAND.AUTOMATIONS,
    pastGate && tasks.signedIn ? () => tasks.automationsView.onOpen() : undefined,
  );
  const { onReopenClosedTab } = tasks;
  useAppCommand(
    APP_COMMAND.REOPEN_CLOSED_TAB,
    pastGate && tasks.signedIn && onReopenClosedTab !== undefined
      ? () => {
          onTabChange(PANEL_TAB.TASKS);
          onReopenClosedTab();
        }
      : undefined,
  );
  const desktopApp =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.DESKTOP_APP) }).data ===
    true;
  useAppCommand(
    APP_COMMAND.KEYBOARD_SHORTCUTS,
    pastGate && desktopApp ? () => settings.onViewChange(SETTINGS_VIEW.SHORTCUTS) : undefined,
  );
}

function titleSubject(
  tab: PanelTab,
  tasks: TasksControl,
  shownTask: Task | undefined,
): Parameters<typeof useWindowTitle>[0] {
  const { signedIn } = tasks;
  if (tab === PANEL_TAB.SETTINGS) return { signedIn, subject: "Settings", workspace: undefined };
  if (tasks.inboxView.open) {
    return { signedIn, subject: "Inbox", workspace: tasks.workspace };
  }
  if (tasks.agentView.agentId !== undefined) {
    return { signedIn, subject: "Agent", workspace: tasks.workspace };
  }
  if (tasks.personView.userId !== undefined) {
    return { signedIn, subject: "Profile", workspace: tasks.workspace };
  }
  if (tasks.adminView.open) return { signedIn, subject: "Admin", workspace: undefined };
  if (tasks.automationsView.open) {
    return { signedIn, subject: "Automations", workspace: tasks.workspace };
  }
  if (tasks.boardView.open) return { signedIn, subject: "Tasks", workspace: tasks.workspace };
  if (tasks.unknownWorkspace.open)
    return { signedIn, subject: NOT_FOUND_TITLE, workspace: undefined };
  if (shownTask === undefined) return { signedIn, subject: undefined, workspace: tasks.workspace };
  const workspace = tasks.workspaces.find((each) => each.id === shownTask.workspaceId);
  return { signedIn, subject: shownTask.name, workspace };
}

function usePageKept(open: boolean, workspaceId: string | undefined, standing: boolean): boolean {
  const keptFor = useRef<string | undefined>(undefined);
  if (!standing) keptFor.current = undefined;
  else if (open) keptFor.current = workspaceId;
  return standing && keptFor.current !== undefined && keptFor.current === workspaceId;
}

function KeptPage({
  shown,
  chipCards,
  mentionedAgents,
  children,
}: {
  shown: boolean;
  chipCards: React.ComponentProps<typeof ChipCards>["value"];
  mentionedAgents: React.ComponentProps<typeof MentionedAgents>["value"];
  children: React.ReactNode;
}): React.JSX.Element {
  const page = (
    <MentionedAgents value={mentionedAgents}>
      <ChipCards value={chipCards}>{children}</ChipCards>
    </MentionedAgents>
  );
  const held = useRef(page);
  if (shown) held.current = page;
  return <Activity mode={shown ? "visible" : "hidden"}>{held.current}</Activity>;
}

interface ShellPlacesInput {
  readonly tab: PanelTab;
  readonly onTabChange: (tab: PanelTab) => void;
  readonly tasks: TasksControl;
  readonly history: WindowHistory;
  readonly sidebar: SidebarCollapse;
  readonly room: ShellRoom;
  readonly settingsStep: SettingsStep;
  readonly settings: SettingsPanelProps;
  readonly shell: RefObject<HTMLDivElement | null>;
  readonly keepOverlay: ReturnType<typeof useFloatDismiss>;
  readonly summary: ReturnType<typeof useSummaryPin>;
  readonly looks: ReturnType<typeof useTaskLooks>;
  readonly mentionedAgents: React.ComponentProps<typeof MentionedAgents>["value"];
  readonly chipCards: React.ComponentProps<typeof ChipCards>["value"];
  readonly newTaskDialog: React.JSX.Element;
  readonly phoneAccount: React.JSX.Element | null;
  readonly away: { readonly label: string; readonly onPress: () => void };
  readonly descriptionToggle: boolean;
  readonly standingIn: boolean;
  readonly inboxKept: boolean;
  readonly tasksPagesHeld: TasksPagesHeld;
  readonly adminAccess: boolean;
  readonly adminPending: boolean;
  readonly setToggleRoom: ReturnType<typeof usePanelToggleRoom>;
  readonly focusHolder: RefObject<Holder | undefined>;
}

const ShellPlacesContext = createContext<ShellPlacesInput | undefined>(undefined);

export function useShellPlaces(): ShellPlacesInput {
  const places = useContext(ShellPlacesContext);
  if (places === undefined)
    throw new Error("A place of the window is drawn under its shell alone.");
  return places;
}

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
  room: ShellRoom;
  settingsStep: SettingsStep;
  settings: SettingsPanelProps;
}): React.JSX.Element {
  const { account } = settings;
  const shell = useRef<HTMLDivElement>(null);
  const gated = gates.accountRequired && account.status !== ACCOUNT_STATUS.SIGNED_IN;
  const signedInId = account.status === ACCOUNT_STATUS.SIGNED_IN ? account.id : undefined;
  const [finishedHere, setFinishedHere] = useState<string>();
  const setup = useSetupGate(tasks, signedInId, finishedHere === signedInId);
  const keptStanding =
    !gated && tasks.signedIn && tab !== PANEL_TAB.SETTINGS && !tasks.history.open;
  const inboxKept = usePageKept(tasks.inboxView.open, tasks.workspace?.id, keptStanding);
  const [tasksPagesHeld] = useState(() => new TasksPagesHeld());
  const focusHolder = useSettingsFocusHolder(tab === PANEL_TAB.SETTINGS);
  const keepOverlay = useFloatDismiss({ state: sidebar.overlay, onState: sidebar.onOverlay });
  const coarse = useCoarsePointer();
  useDrawerSwipe({
    enabled: room === SHELL_ROOM.NARROW && coarse && !mobileBarShown(room, tasks),
    open: sidebar.overlay === SIDEBAR_OVERLAY.OPEN,
    stage: shell,
    drawer: () => shell.current?.querySelector<HTMLElement>(":scope > .desktop-sidebar") ?? null,
    onOpen: () => sidebar.onOverlay(SIDEBAR_OVERLAY.OPEN),
    onClose: () => sidebar.onOverlay(SIDEBAR_OVERLAY.CLOSED),
  });
  const summary = useSummaryPin(sidebar.staged);
  const setToggleRoom = usePanelToggleRoom();
  const founding = !gated && tasks.newWorkspace.open;
  usePlaceCommands(
    !gated && setup === SETUP_GATE.NONE && !founding,
    onTabChange,
    tasks,
    settings,
    history,
  );
  const adminAccess = useQuery({ ...appStateQuery, select: selectAdminAccess }).data === true;
  const adminPending =
    useQuery({ ...appStateQuery, select: selectAdminAccessPending }).data ?? true;
  const { region } = tasks;
  const standingIn =
    tasks.inboxView.open ||
    tasks.agentView.agentId !== undefined ||
    tasks.personView.userId !== undefined ||
    tasks.automationsView.open ||
    tasks.boardView.open ||
    tasks.adminView.open ||
    tasks.unknownWorkspace.open;
  const shownTask =
    tab === PANEL_TAB.TASKS && !standingIn && region.kind === DOCUMENT_REGION.READY
      ? region.task
      : undefined;
  useWindowTitle(titleSubject(tab, tasks, shownTask));
  const looks = useTaskLooks(
    shownTask,
    tasks.me,
    shownTask === undefined
      ? undefined
      : (tasks.tasks.find((row) => row.id === shownTask.id) ?? shownTask),
  );
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
  const chipCards = useMemo(
    () => ({
      taskCard: (taskId: string, now: number, focus: TaskFocus | undefined) => {
        const task = tasks.tasks.find((each) => each.id === taskId);
        return task === undefined ? undefined : homeTaskCardOf(tasks, task, now, focus);
      },
    }),
    [tasks],
  );
  const newTaskDialog = useMemo(() => <NewTaskDialog newTask={tasks.newTask} />, [tasks.newTask]);
  const { onSignOut } = settings;
  const phoneAccount = useMemo(
    () =>
      room === SHELL_ROOM.NARROW && tasks.signedIn ? (
        <PhoneAccount
          tasks={tasks}
          account={account}
          onSettings={() => onTabChange(PANEL_TAB.SETTINGS)}
          onSignOut={onSignOut}
        />
      ) : null,
    [room, tasks, account, onTabChange, onSignOut],
  );
  const descriptionToggle = tasks.page === TASKS_PAGE.DOCUMENT && !standingIn;
  const awayLabel = awayBack(history.away, history.onLeave).label;
  const { onLeave } = history;
  const away = useMemo(() => ({ label: awayLabel, onPress: onLeave }), [awayLabel, onLeave]);
  if (setup !== SETUP_GATE.NONE && signedInId !== undefined) {
    return (
      <ScrollArea>
        <div className="desktop-onboarding relative">
          <div className="desktop-drag-strip absolute inset-x-0 top-0" />
          {setup === SETUP_GATE.OWED ? (
            <SetupSteps
              tasks={tasks}
              accountId={signedInId}
              onFinish={() => {
                setFinishedHere(signedInId);
                onTabChange(PANEL_TAB.TASKS);
                tasks.onGoHome();
              }}
            />
          ) : null}
        </div>
      </ScrollArea>
    );
  }
  if (gated) {
    const macAppLink = appPlatform().macAppLink?.();
    return (
      <ScrollArea>
        <div className="desktop-onboarding relative">
          <div className="desktop-drag-strip absolute inset-x-0 top-0" />
          <ReplayUnmask>
            <SignInGate
              account={account}
              {...(gates.signInWait ? { waiting: gates.signInWait } : undefined)}
              {...(gates.signInFailure ? { failure: gates.signInFailure } : undefined)}
              {...(gates.lastSignIn ? { lastUsed: gates.lastSignIn } : undefined)}
              {...(macAppLink === undefined ? undefined : { macAppLink })}
              onBegin={gates.onBeginSignIn}
              onCancel={gates.onCancelSignIn}
            />
          </ReplayUnmask>
          <div className="title-bar-controls">
            <ReplayUnmask>
              <OfflineMark />
            </ReplayUnmask>
          </div>
        </div>
      </ScrollArea>
    );
  }
  if (founding) {
    return (
      <ScrollArea>
        <div className="desktop-onboarding relative">
          <div className="desktop-drag-strip absolute inset-x-0 top-0" />
          <NewWorkspaceSteps tasks={tasks} onClose={tasks.newWorkspace.onClose} />
        </div>
      </ScrollArea>
    );
  }
  const places: ShellPlacesInput = {
    tab,
    onTabChange,
    tasks,
    history,
    sidebar,
    room,
    settingsStep,
    settings,
    shell,
    keepOverlay,
    summary,
    looks,
    mentionedAgents,
    chipCards,
    newTaskDialog,
    phoneAccount,
    away,
    descriptionToggle,
    standingIn,
    inboxKept,
    tasksPagesHeld,
    adminAccess,
    adminPending,
    setToggleRoom,
    focusHolder,
  };
  return (
    <ShellPlacesContext value={places}>
      <Outlet />
    </ShellPlacesContext>
  );
}

export function ShellPlaces(): React.JSX.Element {
  const {
    tab,
    onTabChange,
    tasks,
    history,
    sidebar,
    room,
    settings,
    shell,
    keepOverlay,
    summary,
    mentionedAgents,
    chipCards,
    newTaskDialog,
    descriptionToggle,
    setToggleRoom,
    focusHolder,
    inboxKept,
    phoneAccount,
  } = useShellPlaces();
  const { account } = settings;
  useFocusHandedBack(focusHolder);
  if (tasks.history.open) {
    const exitHistory = history.canGoBack ? history.onBack : tasks.history.onClose;
    return (
      <div className="desktop-shell" data-room={room}>
        <MentionedAgents value={mentionedAgents}>
          <ChipCards value={chipCards}>
            <Suspense
              fallback={
                <VersionHistoryLoading
                  onExit={exitHistory}
                  place={backPlaceOf(history, HISTORY_EXIT_PLACE)}
                  onList={tasks.history.onList}
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
        {newTaskDialog}
      </div>
    );
  }
  const inboxOpen = tasks.inboxView.open;
  const inboxShown = inboxOpen && !tasks.adminView.open;
  const pageAgent = tasks.agentView.agentId;
  const boardOpen = tasks.boardView.open;
  const inboxItemShown = tasks.inboxView.chosen !== undefined;
  const panelToggle =
    (descriptionToggle && room !== SHELL_ROOM.NARROW) ||
    pageAgent !== undefined ||
    (inboxOpen && inboxItemShown);
  const drawerOver = room === SHELL_ROOM.NARROW && sidebar.overlay !== SIDEBAR_OVERLAY.CLOSED;
  const barShown = mobileBarShown(room, tasks);
  const phoneTasks = barShown && boardOpen;
  const placed = phoneTasks
    ? { ...sidebar, collapsed: false, overlay: SIDEBAR_OVERLAY.CLOSED }
    : sidebar;
  return (
    <div
      ref={shell}
      className="desktop-shell"
      data-room={room}
      data-sidebar-collapsed={String(placed.collapsed)}
      data-sidebar-overlay={placed.overlay}
      data-panel-toggle={String(panelToggle && room !== SHELL_ROOM.NARROW)}
      data-mobile-bar={String(barShown)}
    >
      <DesktopSidebar
        sidebar={placed}
        history={history}
        tasks={tasks}
        tab={tab}
        onTabChange={onTabChange}
        account={account}
        updates={settings.updates}
        onSignOut={settings.onSignOut}
        onPressWithin={keepOverlay}
        room={room}
      />
      {room === SHELL_ROOM.NARROW ? <DrawerScrim open={drawerOver} /> : null}
      <main
        className="desktop-main"
        inert={drawerOver || phoneTasks}
        data-inbox-shown={String(inboxShown)}
      >
        <MentionedAgents value={mentionedAgents}>
          <ChipCards value={chipCards}>
            <Outlet />
          </ChipCards>
        </MentionedAgents>
        {inboxOpen || inboxKept ? (
          <KeptPage shown={inboxShown} chipCards={chipCards} mentionedAgents={mentionedAgents}>
            <DesktopInbox tasks={tasks} room={room} phoneStart={phoneAccount} />
          </KeptPage>
        ) : null}
      </main>
      {barShown ? <MobileBar tasks={tasks} /> : null}
      {sidebar.overlay !== SIDEBAR_OVERLAY.CLOSED && room === SHELL_ROOM.WIDE ? (
        <div className="sidebar-float-claim" />
      ) : null}
      {sidebar.collapsed &&
      sidebar.overlay === SIDEBAR_OVERLAY.CLOSED &&
      room === SHELL_ROOM.WIDE ? (
        <div
          className="sidebar-peek-edge"
          data-sidebar-peek-edge=""
          onPointerEnter={() => sidebar.onOverlay(SIDEBAR_OVERLAY.PEEK)}
        />
      ) : null}
      {room === SHELL_ROOM.NARROW ? (
        <SidebarChord sidebar={sidebar} />
      ) : (
        <PanePin as={PANE_PIN_ELEMENT.DIV} className="title-bar-controls" onPin={keepOverlay}>
          <SidebarToggle sidebar={sidebar} />
          {sidebar.collapsed ? <NewTaskButton tasks={tasks} /> : null}
          {sidebar.collapsed ? (
            <ReplayUnmask>
              <OfflineMark />
            </ReplayUnmask>
          ) : null}
        </PanePin>
      )}
      {panelToggle && room === SHELL_ROOM.NARROW ? (
        <SidePanelChord
          panel={tasks.sidePanel}
          disabled={descriptionToggle && tasks.region.kind !== DOCUMENT_REGION.READY}
        />
      ) : panelToggle ? (
        <div ref={setToggleRoom} className="title-bar-controls" data-edge="end" inert={drawerOver}>
          <SidePanelToggle
            panel={tasks.sidePanel}
            disabled={descriptionToggle && tasks.region.kind !== DOCUMENT_REGION.READY}
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

export function StatePlace(): React.JSX.Element | null {
  const { tasks, room, sidebar, settings, looks, summary, away } = useShellPlaces();
  const { account } = settings;
  const inboxOpen = tasks.inboxView.open;
  const pageAgent = tasks.agentView.agentId;
  const unknownWorkspace = tasks.unknownWorkspace.open;
  return inboxOpen ? null : pageAgent !== undefined ? (
    <DesktopAgentPage
      key={pageAgent}
      tasks={tasks}
      agentId={pageAgent}
      away={room === SHELL_ROOM.NARROW ? away : undefined}
    />
  ) : unknownWorkspace ? (
    <ReplayUnmask>
      <NotFound
        replayUnmasked
        thing={NOT_FOUND_THING.WORKSPACE}
        bar={
          room === SHELL_ROOM.NARROW
            ? phoneBar({ place: UNKNOWN_WORKSPACE_PHONE_PLACE, start: null, end: null })
            : {}
        }
        action={{ label: GO_HOME, onClick: tasks.unknownWorkspace.onClose }}
      />
    </ReplayUnmask>
  ) : (
    <DesktopTasks
      tasks={tasks}
      looks={looks}
      summary={summary}
      room={room}
      away={away}
      accountName={account.status === ACCOUNT_STATUS.SIGNED_IN ? account.name : undefined}
      staged={sidebar.staged}
    />
  );
}

export function BoardRouteLoading(): React.JSX.Element | null {
  const { tasks, room } = useShellPlaces();
  if (mobileBarShown(room, tasks)) return null;
  return <TasksLoading onExit={tasks.boardView.onClose} />;
}

export function AutomationsRouteLoading(): React.JSX.Element {
  const { tasks, room } = useShellPlaces();
  return <AutomationsLoading onExit={tasks.automationsView.onClose} room={room} />;
}

export function PersonRouteLoading(): React.JSX.Element {
  const { tasks } = useShellPlaces();
  return <PersonLoading name={tasks.personView.name} onExit={tasks.personView.onClose} />;
}

export function AdminRouteLoading(): React.JSX.Element {
  const { tasks, room } = useShellPlaces();
  return (
    <AdminLoading
      room={room}
      view={tasks.adminView.view}
      onOpen={tasks.adminView.onOpen}
      onExit={tasks.adminView.onClose}
    />
  );
}

export function SettingsFrame({
  children,
}: {
  children: (exit: () => void) => React.ReactNode;
}): React.JSX.Element {
  const { tasks, history, room, onTabChange } = useShellPlaces();
  const exitSettings = history.canGoBack ? history.onBack : () => onTabChange(PANEL_TAB.TASKS);
  const settingsBar = room === SHELL_ROOM.NARROW && tasks.signedIn;
  return (
    <div className="desktop-shell" data-room={room} data-mobile-bar={String(settingsBar)}>
      {children(exitSettings)}
      {settingsBar ? <MobileBar tasks={tasks} leave={() => onTabChange(PANEL_TAB.TASKS)} /> : null}
    </div>
  );
}

export function SettingsRouteLoading(): React.JSX.Element {
  const { history, room, settingsStep } = useShellPlaces();
  return (
    <SettingsFrame>
      {(exit) => (
        <SettingsLoading
          onExit={exit}
          place={backPlaceOf(history, TASKS_EXIT_PLACE)}
          onList={settingsStep.onList}
          hidden={hiddenColumns(room, settingsStep.listed)}
        />
      )}
    </SettingsFrame>
  );
}
