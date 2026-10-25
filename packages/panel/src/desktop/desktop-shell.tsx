import { ACCOUNT_STATUS, type AccountProvider } from "@luke/credentials/snapshot";
import type { Task } from "@luke/features/task-wire";
import { readingWords } from "@luke/features/words";
import { EXPERIMENT, HOST_CAPABILITY } from "@luke/settings";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BACK_BUTTON_LOOK,
  BackButton,
  COLLECTION_STATE,
  CollectionPage,
  DrawerScrim,
  IconButton,
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
} from "@luke/ui";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { ACTOR_SIZE, actorMarkWidth } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { appPlatform } from "../app-platform.js";
import { CALL_CARD_SURFACE, StandingCallCardDock } from "../call/call-card.js";
import { useCoarsePointer } from "../coarse-pointer.js";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import { lazyRoute } from "../lazy-route.js";
import type { NavigationHistory, WindowHistory } from "../navigation-history.js";
import { PANEL_TAB, type PanelTab } from "../panel-tabs.js";
import type { SettingsPanelProps } from "../settings/settings-panel.js";
import { type HiddenColumns, hiddenColumns, SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { SignInGate } from "../sign-in-gate.js";
import { useChatOn } from "../tasks/chat-gate.js";
import { ChipCards, type TaskFocus } from "../tasks/chip-cards.js";
import { MentionedAgents } from "../tasks/mentioned-agent-card.js";
import { NewTaskDialog } from "../tasks/new-task-dialog.js";
import { useInboxListing } from "../tasks/use-inbox-listing.js";
import { useAgentLook, useTaskLooks } from "../tasks/use-task-looks.js";
import {
  AUTOMATIONS_PAGE,
  type AutomationsPlace,
  type TasksControl,
} from "../tasks/use-tasks-tab.js";
import {
  useAdminAccess,
  useAdminAccessPending,
  useCapability,
  useExperiment,
} from "../use-app-state.js";
import {
  AutomationListSkeleton,
  AutomationsActsSkeleton,
  AutomationsToolbar,
} from "./automation-list-frame.js";
import { READING_AUTOMATIONS } from "./automation-words.js";
import { backPlaceOf } from "./back-place.js";
import { useColumnDock } from "./column-dock.js";
import { DesktopAgentPage } from "./desktop-agent-page.js";
import { DesktopChat, useChatSurface } from "./desktop-chat.js";
import { DesktopInbox } from "./desktop-inbox.js";
import type { SettingsStep } from "./desktop-settings.js";
import { DesktopSidebar } from "./desktop-sidebar.js";
import { DesktopTasks } from "./desktop-tasks.js";
import { useFloatDismiss } from "./hover-pane.js";
import { useLukeOperator } from "./luke-operator.js";
import { MobileBar, mobileBarShown } from "./mobile-bar.js";
import { NewTaskButton } from "./new-task-button.js";
import { OfflineMark, useOffline } from "./offline-mark.js";
import { ADMIN_PLACE, PERSON_PAGE, VERSION_HISTORY } from "./pages-on-demand.js";
import { PaneGlide } from "./pane-motion.js";
import { PersonPageSkeleton } from "./person-frame.js";
import { PhoneHead } from "./phone-head.js";
import { PLACE_LIST, PLACE_PAGE, PLACE_SPLIT } from "./place-columns.js";
import { SidePanelChord, SidePanelToggle } from "./side-panel.js";
import { SIDEBAR_OVERLAY, type SidebarCollapse, sidebarInSight } from "./sidebar-collapse.js";
import { homeTaskCardOf } from "./task-card.js";
import { awayBack } from "./task-pane-switcher.js";
import { useSummaryPin } from "./task-summary.js";
import { useWindowTitle } from "./window-title.js";

/**
 * Settings, loaded as a chunk of its own the first time it opens rather than
 * with the window, because the renderer bundle is parsed at every window
 * open, the voice window's included, and Settings is opened seldom. The chunk is a local file, so it stands a frame
 * later, over its frame of placeholders in the meantime (`SettingsLoading`).
 */
const SETTINGS_ROUTE = lazyRoute(() =>
  import("./desktop-settings.js").then((loaded) => loaded.DesktopSettings),
);

/**
 * The Automations pages, loaded as a chunk of their own the first time
 * they open, as Settings is and for the same reason: the renderer bundle is
 * parsed at every window open, and the pages, their editor and its triggers
 * among them, are opened seldom. What stands while
 * the chunk loads is the pages' own empty frame, for a frame.
 */
const AUTOMATIONS_ROUTE = lazyRoute(() =>
  import("./automations-page.js").then((loaded) => loaded.AutomationsPage),
);

/** The Tasks page, its List and its Board, its own chunk, loaded the first time it is opened. */
const TASKS_ROUTE = lazyRoute(() => import("./tasks-page.js").then((loaded) => loaded.TasksPage));

/** What stands while the Tasks page's chunk loads: its frame and title over quiet blocks, and its own way out, so Escape closes the page rather than reaching the plan behind it. */
function TasksLoading({ onExit }: { onExit: () => void }): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_BOARD, onExit);
  return (
    <CollectionPage
      frame={PAGE_FRAME.TOOLBAR}
      label="Tasks"
      toolbar={<Toolbar title="Tasks" />}
      state={COLLECTION_STATE.LOADING}
      loadingLabel="Reading tasks"
    />
  );
}

/**
 * What stands while the Admin place's chunk loads (`pages-on-demand.ts`): its
 * list's column and the view's frame over quiet blocks, and its own way out.
 * A narrow room heads the column it shows as the place will, a phone's
 * header (`phone-head.tsx`) led by the way out of the list or back to it.
 */
function AdminLoading({
  onExit,
  place,
  onList,
  hidden,
}: {
  onExit: () => void;
  /** Where the way out leads, as its hint names it. */
  place: string;
  onList: () => void;
  hidden: HiddenColumns;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_ADMIN, onExit);
  const narrow = hidden.list || hidden.item;
  return (
    <div className={`desktop-admin ${PLACE_SPLIT}`}>
      <nav
        className={`admin-sections ${PLACE_LIST}`}
        aria-label="Admin sections"
        hidden={hidden.list}
      >
        {narrow ? (
          <PhoneHead
            place="admin-sections"
            start={
              <BackButton
                label="Back"
                place={place}
                command={APP_COMMAND.EXIT_ADMIN}
                onBack={onExit}
              />
            }
            title="Admin"
            end={null}
          />
        ) : (
          <div className="desktop-drag-strip" />
        )}
      </nav>
      <section className={`admin-page ${PLACE_PAGE}`} aria-label="Admin" hidden={hidden.item}>
        {narrow ? null : <div className="desktop-drag-strip" />}
        <CollectionPage
          frame={PAGE_FRAME.TOOLBAR}
          label="Admin"
          toolbar={
            narrow ? (
              <PhoneHead
                place="admin"
                start={<BackButton label="Admin" place="admin" onBack={onList} />}
                title="Overview"
                end={null}
              />
            ) : (
              <Toolbar title="Overview" />
            )
          }
          state={COLLECTION_STATE.LOADING}
          loadingLabel="Reading the dashboard…"
        />
      </section>
    </div>
  );
}

/** What stands while a person's page's chunk loads: the page as it stands until the members are read (`PersonPageSkeleton`), and its own way out. */
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

/** Where Settings' and Admin's ways out lead where no step stands behind them, as a hint names it. */
const TASKS_EXIT_PLACE = "tasks";

/** Where a version history's way out leads where no step stands behind it, as a hint names it. */
const HISTORY_EXIT_PLACE = "plan";

/**
 * What stands while a version history's chunk loads: its frame, the list's
 * column where the sidebar stood, and its own way out, its Back row and
 * Escape, so the history is left as it would be once drawn. A narrow room
 * heads the column it shows as the history will, a phone's header
 * (`phone-head.tsx`) led by the way out of the list or back to it.
 */
function VersionHistoryLoading({
  onExit,
  place,
  onList,
  hidden,
}: {
  onExit: () => void;
  /** Where the way out leads, as its hint names it. */
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
        {narrow ? (
          <PhoneHead place="version-log" start={exit} title="Version history" end={null} />
        ) : (
          <>
            <div className="desktop-drag-strip" />
            {exit}
          </>
        )}
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

/**
 * What stands while the Automations pages' chunk loads: the list's own
 * toolbar and card as quiet blocks (`AutomationListSkeleton`), as the list
 * stands while it is first read, and their own way out, so Escape pressed in
 * that frame closes Automations as the list would rather than falling
 * through to the task behind it.
 */
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

/**
 * The sections that stand while Settings' chunk loads, in the shape of the
 * Account page Settings opens on: who is signed in, their face leading; the
 * GitHub token, its mark leading; and Delete account. Note that they are not
 * read from the page itself, because that would draw its chunk in with this one.
 */
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

/**
 * What stands while Settings' chunk loads: its frame, the page list's column
 * and a page of placeholder sections under a placeholder title, so Settings
 * lands where the blocks stood; and Settings' own way out, so Escape pressed
 * in that frame leaves Settings as it would once drawn, rather than falling
 * through to the task behind it. It is gone as Settings stands and offers the
 * same command itself. A narrow room hides the column Settings will hide,
 * and heads the one it shows as Settings will, a phone's header
 * (`phone-head.tsx`) led by the way out of the list or back to it.
 */
function SettingsLoading({
  onExit,
  place,
  onList,
  hidden,
}: {
  onExit: () => void;
  /** Where the way out leads, as its hint names it. */
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
            end={null}
          />
        ) : (
          <div className="desktop-drag-strip" />
        )}
      </nav>
      <section className={`settings-page ${PLACE_PAGE}`} aria-label="Settings" hidden={hidden.item}>
        {/* Note that the page draws its own bar, the window's drag handle, as Settings' page does once drawn. */}
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

/** The sidebar's chord alone, where its toggle is not drawn, as on a phone's task, whose header stands in its place, though the drawer is still there to open. */
function SidebarChord({ sidebar }: { sidebar: SidebarCollapse }): null {
  useAppCommand(APP_COMMAND.TOGGLE_SIDEBAR, sidebar.onToggle);
  return null;
}

/** What held the keyboard as Settings opened, named by what a control is called, since the shell it stood in is drawn anew as Settings goes. */
interface Holder {
  element: HTMLElement;
  tag: string;
  label: string;
  /** Whether it was the only control so called, as it was named, which is what lets another so called stand for it. */
  alone: boolean;
}

/** What a control is called: its label, its placeholder, or its words. */
function labelOf(element: HTMLElement): string {
  return (
    element.getAttribute("aria-label") ??
    element.getAttribute("placeholder") ??
    element.textContent?.trim() ??
    ""
  );
}

/** Every control of `tag` called `label`, in the order the window draws them. */
function calledSo(tag: string, label: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(tag)].filter((each) => labelOf(each) === label);
}

/** The control holding the keyboard now, named; none where it stands nowhere or on a control with no name. */
function holder(): Holder | undefined {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement) || element === document.body) return undefined;
  const tag = element.localName;
  const label = labelOf(element);
  if (label === "") return undefined;
  return { element, tag, label, alone: calledSo(tag, label).length === 1 };
}

/**
 * The control that held the keyboard, as it stands now: itself where it never left, else the one drawn in its place.
 * Note that a name shared by several controls, as a row's Pin is, finds none, whether it was shared as Settings opened
 * or is now, and so does one no longer borne by any, as a row's time moves on, because the keyboard is better left
 * with the window than handed to a neighbour of the same name.
 */
function found({ element, tag, label, alone }: Holder): HTMLElement | undefined {
  if (element.isConnected) return element;
  const called = calledSo(tag, label);
  return alone && called.length === 1 ? called[0] : undefined;
}

/**
 * Hands the keyboard back as Settings is left to the control that held it as
 * Settings opened, where that is still to be found.
 * Note that the control is named as Settings opens, in the render that turns
 * the window over, because by the commit its shell is gone and the keyboard
 * with it; and that it is handed back only from nowhere, since a press that
 * left Settings on a control of its own has put the keyboard where it was
 * meant to go.
 */
function useSettingsFocusReturn(inSettings: boolean): void {
  const before = useRef<Holder | undefined>(undefined);
  const was = useRef(false);
  if (inSettings && !was.current) before.current = holder();
  useLayoutEffect(() => {
    if (inSettings) {
      was.current = true;
      return;
    }
    if (!was.current) return;
    was.current = false;
    const back = before.current === undefined ? undefined : found(before.current);
    before.current = undefined;
    const now = document.activeElement;
    if (now === null || now === document.body) back?.focus({ preventScroll: true });
  }, [inSettings]);
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
  useAppCommand(
    APP_COMMAND.TASKS,
    pastGate && tasks.signedIn
      ? () => {
          if (tab !== PANEL_TAB.TASKS) onTabChange(PANEL_TAB.TASKS);
          tasks.boardView.onOpen();
        }
      : undefined,
  );
  // The Admin place is an admin's alone, so ⌘K offers it only on the terms its sidebar row stands on.
  const adminOn = useAdminAccess();
  useAppCommand(
    APP_COMMAND.ADMIN,
    pastGate && tasks.signedIn && adminOn
      ? () => {
          if (tab !== PANEL_TAB.TASKS) onTabChange(PANEL_TAB.TASKS);
          tasks.adminView.onOpen();
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
  // Luke's chord opens his page in the listed workspace, or asks his ensure again where it failed; while the account has him off it is no chord at all.
  const operator = useLukeOperator({
    accountId: tasks.me,
    workspaceId: pastGate && tasks.signedIn ? tasks.workspace?.id : undefined,
  });
  const lukeId = operator?.agentId;
  useAppCommand(
    APP_COMMAND.ASK_LUKE,
    operator === undefined
      ? undefined
      : () => {
          if (lukeId === undefined) {
            operator.retry();
            return;
          }
          if (tab !== PANEL_TAB.TASKS) onTabChange(PANEL_TAB.TASKS);
          tasks.agentView.onOpen(lukeId);
        },
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
 * history, whichever is drawn (`new-task-dialog.tsx`).
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
  useSettingsFocusReturn(tab === PANEL_TAB.SETTINGS);
  const keepOverlay = useFloatDismiss({ state: sidebar.overlay, onState: sidebar.onOverlay });
  // A phone's drawer follows a finger swiping in from the screen's left edge, or back out, as a phone's own drawers do.
  const coarse = useCoarsePointer();
  useDrawerSwipe({
    enabled: room === SHELL_ROOM.NARROW && coarse,
    open: sidebar.overlay === SIDEBAR_OVERLAY.OPEN,
    stage: shell,
    drawer: () => shell.current?.querySelector<HTMLElement>(":scope > .desktop-sidebar") ?? null,
    onOpen: () => sidebar.onOverlay(SIDEBAR_OVERLAY.OPEN),
    onClose: () => sidebar.onOverlay(SIDEBAR_OVERLAY.CLOSED),
  });
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
  // Note that a narrow room's drawer is too skinny for the list, so there the Inbox's page lists its items itself, the list and then the item each across the screen.
  const sidebarListsInbox = inboxFirst && tasks.signedIn && room !== SHELL_ROOM.NARROW;
  // Note that the sidebar draws its list, so the list holds still while the sidebar is in sight.
  const inboxListing = useInboxListing(
    tasks,
    sidebarListsInbox,
    tasks.shown && sidebarInSight(sidebar),
  );
  const sharedListing = sidebarListsInbox ? inboxListing : undefined;
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
        const task = tasks.tasks.find((each) => each.id === taskId);
        return task === undefined ? undefined : homeTaskCardOf(tasks, task, now, focus);
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
  // Chat is handed only what it reads of the tasks, so a delivery that moves the rest draws none of it.
  const chatSurface = useChatSurface(tasks);
  // A phone's task leads its own row with the way back to the page it was opened from, named for it (`task-pane-switcher.tsx`).
  const awayLabel = awayBack(history.away, history.onLeave).label;
  const { onLeave } = history;
  const away = useMemo(() => ({ label: awayLabel, onPress: onLeave }), [awayLabel, onLeave]);
  if (gated) {
    const macAppLink = appPlatform().macAppLink?.();
    return (
      <ScrollArea>
        <div className="desktop-onboarding flex min-h-full flex-col pb-onboarding-foot">
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
    // A phone keeps its places bar under Settings, each press leaving Settings for the place pressed (`mobile-bar.tsx`).
    const settingsBar = room === SHELL_ROOM.NARROW && tasks.signedIn;
    return (
      <div className="desktop-shell" data-room={room} data-mobile-bar={String(settingsBar)}>
        <Suspense
          fallback={
            <SettingsLoading
              onExit={exitSettings}
              place={backPlaceOf(history, TASKS_EXIT_PLACE)}
              onList={settingsStep.onList}
              hidden={hiddenColumns(room, settingsStep.listed)}
            />
          }
        >
          <SETTINGS_ROUTE.Route
            sidebar={sidebar}
            room={room}
            step={settingsStep}
            history={history}
            settings={settings}
            onExit={exitSettings}
          />
        </Suspense>
        {settingsBar ? (
          <MobileBar
            tasks={tasks}
            chatOn={chatOn}
            sidebar={sidebar}
            onPressMore={keepOverlay}
            leave={() => onTabChange(PANEL_TAB.TASKS)}
          />
        ) : null}
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
  // The Admin place takes the whole window as Settings does, its sections listed where the tasks were.
  if (tasks.adminView.open && (adminAccess || adminPending)) {
    const exitAdmin = history.canGoBack ? history.onBack : tasks.adminView.onClose;
    const loading = (
      <AdminLoading
        onExit={exitAdmin}
        place={backPlaceOf(history, TASKS_EXIT_PLACE)}
        onList={tasks.adminView.onList}
        hidden={hiddenColumns(room, tasks.adminView.listed)}
      />
    );
    // While the account's access is read, the place stands as it does while its chunk loads.
    if (!adminAccess) {
      return (
        <div className="desktop-shell" data-room={room}>
          {loading}
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
      </div>
    );
  }
  const inboxOpen = tasks.inboxView.open;
  const pageAgent = tasks.agentView.agentId;
  const pagePerson = tasks.personView.userId;
  const automationsOpen = tasks.automationsView.open;
  const chatOpen = tasks.chatView.open && chatOn;
  const boardOpen = tasks.boardView.open;
  // A phone's task is headed by a row of its own, whose ⋯ stands for the panel's toggle (`task-pane-switcher.tsx`).
  const panelToggle =
    (planToggle && room !== SHELL_ROOM.NARROW) ||
    pageAgent !== undefined ||
    (inboxOpen && tasks.inboxView.chosen !== undefined);
  // A phone's drawer is modal, as a phone's own drawers are: while it stands
  // over the work, the work is inert, so neither a screen reader nor a
  // keyboard reaches what the drawer covers, and a press there only puts it
  // away. Its toggle stays, the way to close it.
  const drawerOver = room === SHELL_ROOM.NARROW && sidebar.overlay !== SIDEBAR_OVERLAY.CLOSED;
  // A phone goes between its places by a bar at the screen's foot, standing on their lists alone (`mobile-bar.tsx`).
  const barShown = mobileBarShown(room, tasks, chatOn);
  return (
    <div
      ref={shell}
      className="desktop-shell"
      data-room={room}
      data-sidebar-collapsed={String(sidebar.collapsed)}
      data-sidebar-overlay={sidebar.overlay}
      data-panel-toggle={String(panelToggle && room !== SHELL_ROOM.NARROW)}
      data-offline={String(offline)}
      data-mobile-bar={String(barShown)}
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
      {room === SHELL_ROOM.NARROW ? <DrawerScrim open={drawerOver} /> : null}
      <main className="desktop-main" inert={drawerOver}>
        {/* A chip of an agent off its task's page names its model and its starter as the agent's tab does. */}
        <MentionedAgents value={mentionedAgents}>
          <ChipCards value={chipCards}>
            {chatOpen ? (
              <PageFind page={FIND_PAGE.CHAT} active={tasks.shown}>
                <DesktopChat
                  tasks={chatSurface}
                  room={room}
                  accountName={
                    account.status === ACCOUNT_STATUS.SIGNED_IN ? account.name : undefined
                  }
                />
              </PageFind>
            ) : inboxOpen ? (
              <DesktopInbox tasks={tasks} listing={sharedListing} room={room} />
            ) : pageAgent !== undefined ? (
              // Keyed by the agent, so another agent's page is a page of its own, holding nothing of the last.
              <DesktopAgentPage
                key={pageAgent}
                tasks={tasks}
                agentId={pageAgent}
                away={room === SHELL_ROOM.NARROW ? away : undefined}
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
                    away={room === SHELL_ROOM.NARROW ? away : undefined}
                  />
                </Suspense>
              </PageFind>
            ) : boardOpen ? (
              // The Tasks page holds its own find, its subject the view it shows, so a search in the List does not follow into the Board.
              <Suspense fallback={<TasksLoading onExit={tasks.boardView.onClose} />}>
                <TASKS_ROUTE.Route tasks={tasks} room={room} />
              </Suspense>
            ) : automationsOpen ? (
              <PageFind
                page={FIND_PAGE.AUTOMATIONS}
                at={automationsPlaceKey(tasks.automationsView.place)}
                active={tasks.shown}
              >
                <Suspense
                  fallback={
                    <AutomationsLoading onExit={tasks.automationsView.onClose} room={room} />
                  }
                >
                  <AUTOMATIONS_ROUTE.Route tasks={tasks} room={room} />
                </Suspense>
              </PageFind>
            ) : (
              <DesktopTasks tasks={tasks} looks={looks} summary={summary} room={room} away={away} />
            )}
          </ChipCards>
        </MentionedAgents>
      </main>
      {barShown ? (
        <MobileBar tasks={tasks} chatOn={chatOn} sidebar={sidebar} onPressMore={keepOverlay} />
      ) : null}
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
      {/* A phone's every page heads itself with one row of its own (`phone-head.tsx`), its way back or its one control
          where these stood; the drawer opens from the places bar's More, or a swipe in from the screen's edge. */}
      {room === SHELL_ROOM.NARROW ? (
        <SidebarChord sidebar={sidebar} />
      ) : (
        <PanePin as={PANE_PIN_ELEMENT.DIV} className="title-bar-controls" onPin={keepOverlay}>
          <SidebarToggle sidebar={sidebar} />
          {sidebar.collapsed ? <NewTaskButton tasks={tasks} /> : null}
          {sidebar.collapsed ? <OfflineMark /> : null}
        </PanePin>
      )}
      {/* A phone's page offers the panel from its ⋯, and the panel, open, heads itself with its way out. */}
      {panelToggle && room === SHELL_ROOM.NARROW ? (
        <SidePanelChord
          panel={tasks.sidePanel}
          disabled={planToggle && tasks.region.kind !== DOCUMENT_REGION.READY}
        />
      ) : panelToggle ? (
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
