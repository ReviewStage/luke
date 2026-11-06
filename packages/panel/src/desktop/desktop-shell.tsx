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

/** What stands while the Tasks page's chunk loads: its frame and title over quiet blocks, and its own way out, so Escape closes the page rather than reaching the plan behind it. */
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

/**
 * What stands while the Admin place's chunk loads, or while the account's
 * access is read: the place's toolbar and its bar of sections, as it will
 * stand, over rows of blocks, and its own way out, so Escape pressed in that
 * frame closes Admin as the place would.
 */
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

/** Where Settings' way out leads where no step stands behind it, as a hint names it. */
const TASKS_EXIT_PLACE = "tasks";

/** Where a version history's way out leads where no step stands behind it, as a hint names it. */
const HISTORY_EXIT_PLACE = "description";

/** What a phone's row is named for over a workspace's address that names none of the reader's. */
const UNKNOWN_WORKSPACE_PHONE_PLACE = "unknown-workspace";

/** The window's title over a workspace's address that names none of the reader's, as the state's own. */
const NOT_FOUND_TITLE = "Not found";

/** The way out of a workspace's address that names none of the reader's: the reader's own Home. */
const GO_HOME = "Go home";

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
  signInFailure?: SignInFailure | undefined;
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
 * with the window than handed to a neighbor of the same name.
 */
function found({ element, tag, label, alone }: Holder): HTMLElement | undefined {
  if (element.isConnected) return element;
  const called = calledSo(tag, label);
  return alone && called.length === 1 ? called[0] : undefined;
}

/**
 * The control that held the keyboard as Settings opened, named in the render
 * that turns the window over, because by the commit the places are gone
 * and the keyboard with them; it is handed back by the places once they
 * stand again (`useFocusHandedBack`).
 */
function useSettingsFocusHolder(inSettings: boolean): RefObject<Holder | undefined> {
  const before = useRef<Holder | undefined>(undefined);
  const was = useRef(false);
  if (inSettings && !was.current) before.current = holder();
  was.current = inSettings;
  return before;
}

/**
 * Hands the keyboard back, as the places stand again once Settings is left,
 * to the control that held it as Settings opened, where that is still to be
 * found. Note that it is handed back only from nowhere, since a press that
 * left Settings on a control of its own has put the keyboard where it was
 * meant to go, and that it waits on the places drawn, which the router
 * draws a moment after the window turns from Settings.
 */
function useFocusHandedBack(held: RefObject<Holder | undefined>): void {
  useLayoutEffect(() => {
    const back = held.current === undefined ? undefined : found(held.current);
    held.current = undefined;
    const now = document.activeElement;
    if (now === null || now === document.body) back?.focus({ preventScroll: true });
  }, [held]);
}

/**
 * The shortcuts that reach a place from anywhere past the sign-in: a new
 * task, Settings, Home, the Inbox, the tab closed latest, opened again on its
 * task, the Keyboard shortcuts page that lists them all, and back and
 * forward, which answer whether or not their buttons are drawn.
 */
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
  // The Admin place is an admin's alone, so ⌘K offers it only on the terms its sidebar row stands on.
  const adminOn = useQuery({ ...appStateQuery, select: selectAdminAccess }).data === true;
  useAppCommand(
    APP_COMMAND.ADMIN,
    pastGate && tasks.signedIn && adminOn ? () => tasks.adminView.onOpen() : undefined,
  );
  // Note that the Automations pages are the router's place, which its navigation stands from wherever the window stands.
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
  // The page lists an installed app's chords, and stands nowhere else (`pages.tsx`).
  const desktopApp =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.DESKTOP_APP) }).data ===
    true;
  useAppCommand(
    APP_COMMAND.KEYBOARD_SHORTCUTS,
    pastGate && desktopApp
      ? // Choosing the page opens Settings on it, one step (`settings-link.ts`).
        () => settings.onViewChange(SETTINGS_VIEW.SHORTCUTS)
      : undefined,
  );
}

/**
 * What the window's title names: Settings alone, whose pages are not one
 * workspace's; the Inbox in the listed workspace, whatever task its item is
 * from; the Automations page in the listed workspace; the task on screen in its own workspace, or alone while that is not
 * read; else the listed workspace.
 */
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
  // The Admin place reads every workspace's accounts, so it is no one workspace's.
  if (tasks.adminView.open) return { signedIn, subject: "Admin", workspace: undefined };
  if (tasks.automationsView.open) {
    return { signedIn, subject: "Automations", workspace: tasks.workspace };
  }
  if (tasks.boardView.open) return { signedIn, subject: "Tasks", workspace: tasks.workspace };
  // A workspace not there for the reader names none, the listed one least of all.
  if (tasks.unknownWorkspace.open)
    return { signedIn, subject: NOT_FOUND_TITLE, workspace: undefined };
  if (shownTask === undefined) return { signedIn, subject: undefined, workspace: tasks.workspace };
  // Note that a task whose workspace is not read yet is named alone, because the listed one may not be its.
  const workspace = tasks.workspaces.find((each) => each.id === shownTask.workspaceId);
  return { signedIn, subject: shownTask.name, workspace };
}

/**
 * Whether the window keeps a page drawn while it is away from it, the Inbox
 * or the Tasks page: from the page's first visit, for as long as the shell
 * stands (`standing`) on the workspace it was visited in. Settings, a
 * version history, or the sign-in taking the window, or another workspace
 * listed, lets it go, so it is drawn afresh at its next visit rather than
 * kept for nothing.
 */
function usePageKept(open: boolean, workspaceId: string | undefined, standing: boolean): boolean {
  const keptFor = useRef<string | undefined>(undefined);
  if (!standing) keptFor.current = undefined;
  else if (open) keptFor.current = workspaceId;
  return standing && keptFor.current !== undefined && keptFor.current === workspaceId;
}

/**
 * A page of the window kept drawn, hidden, between visits, the Inbox or the
 * Tasks page, as ⌘K's dialog is between openings, so a return draws it in
 * its first frame as it stood: the Inbox's rows, scroll, view, and search,
 * the item chosen in it still the window's to say (`use-tasks-tab.ts`), none
 * from its row; the Tasks page's view, filter, and scroll. Note that React's
 * `Activity` hides it (`display: none`, so nothing in it takes focus or is
 * found) and takes down its effects, its keys, commands, and subscriptions
 * to the window's state among them, and that the page is held as it was
 * last shown, its cards' context with it, so a patch to the window draws
 * nothing in it until it is shown again. The Inbox's effects coming back up
 * is its return, which is where `inbox.open` ends (`use-inbox-spans.ts`).
 */
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

/**
 * What the window's places draw from, which the shell works out past its
 * gates and hands the routes standing (`panel-router.tsx`), since a route's
 * component takes no props: the window's controls, and what the shell holds
 * across its places, so a place drawn anew finds it as it stood.
 */
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
  /** What each workspace's Tasks page holds across its visits (`tasks-page-held.ts`). */
  readonly tasksPagesHeld: TasksPagesHeld;
  readonly adminAccess: boolean;
  readonly adminPending: boolean;
  readonly setToggleRoom: ReturnType<typeof usePanelToggleRoom>;
  /** The control that held the keyboard as Settings opened, which the places hand it back to. */
  readonly focusHolder: RefObject<Holder | undefined>;
}

const ShellPlacesContext = createContext<ShellPlacesInput | undefined>(undefined);

/** What the shell handed the places; a place is drawn under the shell alone. */
export function useShellPlaces(): ShellPlacesInput {
  const places = useContext(ShellPlacesContext);
  if (places === undefined)
    throw new Error("A place of the window is drawn under its shell alone.");
  return places;
}

/**
 * The app's window: the sidebar on the left and the chosen work on the right,
 * or the sign-in over the whole window while no account stands. Every
 * press is the control's it came from; this only lays them out. Settings
 * keeps its page list whatever the sidebar's collapse says, and hands the
 * tasks back folded or not as it found them. The side panel's toggle is the
 * mirror of the sidebar's, at the window's top right on a task's page, so
 * neither pane carries the button that moves it. A description's version history
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
 * full screen, and Settings and a version history each show their
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
  const gated = gates.accountRequired && account.status !== ACCOUNT_STATUS.SIGNED_IN;
  // A new account is set up once, in the window before the app, until it finishes on any machine.
  const signedInId = account.status === ACCOUNT_STATUS.SIGNED_IN ? account.id : undefined;
  const [finishedHere, setFinishedHere] = useState<string>();
  const setup = useSetupGate(tasks, signedInId, finishedHere === signedInId);
  const keptStanding =
    !gated && tasks.signedIn && tab !== PANEL_TAB.SETTINGS && !tasks.history.open;
  const inboxKept = usePageKept(tasks.inboxView.open, tasks.workspace?.id, keptStanding);
  const [tasksPagesHeld] = useState(() => new TasksPagesHeld());
  const focusHolder = useSettingsFocusHolder(tab === PANEL_TAB.SETTINGS);
  const keepOverlay = useFloatDismiss({ state: sidebar.overlay, onState: sidebar.onOverlay });
  // A phone's drawer follows a finger swiping in from the screen's left edge, or back out, as a phone's own drawers do.
  const coarse = useCoarsePointer();
  useDrawerSwipe({
    // Note that a place over the bar takes no swipe, since the bar's Tasks is the tree's way in there.
    enabled: room === SHELL_ROOM.NARROW && coarse && !mobileBarShown(room, tasks),
    open: sidebar.overlay === SIDEBAR_OVERLAY.OPEN,
    stage: shell,
    drawer: () => shell.current?.querySelector<HTMLElement>(":scope > .desktop-sidebar") ?? null,
    onOpen: () => sidebar.onOverlay(SIDEBAR_OVERLAY.OPEN),
    onClose: () => sidebar.onOverlay(SIDEBAR_OVERLAY.CLOSED),
  });
  // A fixture run keeps the summary's pin as it keeps the sidebar's fold: not at all.
  const summary = useSummaryPin(sidebar.staged);
  // The box the side panel's toggle stands in, which the panel's "+" menu hangs from where the toggle asks for it with nothing to show.
  const setToggleRoom = usePanelToggleRoom();
  // Note that setup standing before the app holds the places' chords too, so none lands behind it, as New workspace's cards do.
  const founding = !gated && tasks.newWorkspace.open;
  usePlaceCommands(
    !gated && setup === SETUP_GATE.NONE && !founding,
    onTabChange,
    tasks,
    settings,
    history,
  );
  // The Admin place is an admin's alone: its route gives way for an account known to be no admin (`route-gates.ts`),
  // while one whose access is still being read, as a reloaded Admin address's is, has the place wait on it.
  const adminAccess = useQuery({ ...appStateQuery, select: selectAdminAccess }).data === true;
  const adminPending =
    useQuery({ ...appStateQuery, select: selectAdminAccessPending }).data ?? true;
  const { region } = tasks;
  // The window's title names what stands in it, the plan only while it is on screen, and its workspace;
  // the Inbox, an agent's or a person's page, the Automations page, or the Board standing in its place is not the plan.
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
  // The plan is looked at the moment it is on screen, whichever of its column's tabs is chosen,
  // from the mark and the agents' activity its row in the list carries.
  const looks = useTaskLooks(
    shownTask,
    tasks.me,
    shownTask === undefined
      ? undefined
      : (tasks.tasks.find((row) => row.id === shownTask.id) ?? shownTask),
  );
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
  // A phone's places lead their heads with the reader's face, their workspaces and account behind it (`phone-account.tsx`).
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
  // Note that the shell says whether the panel's toggle stands, because the
  // toolbar beneath it leaves the toggle room then and only then. The
  // Automations page stands in the plan's place, so it draws
  // no panel to toggle; an agent's page draws the agent's own, and the Inbox
  // the chosen item's task's.
  const descriptionToggle = tasks.page === TASKS_PAGE.DOCUMENT && !standingIn;
  // A phone's task leads its own row with the way back to the page it was opened from, named for it (`task-pane-switcher.tsx`).
  const awayLabel = awayBack(history.away, history.onLeave).label;
  const { onLeave } = history;
  const away = useMemo(() => ({ label: awayLabel, onPress: onLeave }), [awayLabel, onLeave]);
  // Note that the onboarding column's drag strip stands over its top rather
  // than in flow, because the AuthPage beneath is already a whole window tall
  // and a strip above it would overflow the window by the strip's height.
  if (setup !== SETUP_GATE.NONE && signedInId !== undefined) {
    // While a new account's agent is still read, the window waits on setup's own ground rather than glimpsing the app.
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
                // Finishing setup lets the app in on Home, wherever the window stood before it.
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
          {/* Signing in needs the network, so the gate says when there is none. */}
          <div className="title-bar-controls">
            <ReplayUnmask>
              <OfflineMark />
            </ReplayUnmask>
          </div>
        </div>
      </ScrollArea>
    );
  }
  // New workspace takes the whole window on setup's own ground, its cards being setup's.
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
  // What stands past the gates is the route's: Settings over the whole window, or a place beside the sidebar (`ShellPlaces`).
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

/**
 * The window's places beside the sidebar, the layout every place but
 * Settings and a version history shares (`panel-router.tsx`'s pathless
 * `places` route): the sidebar, the work in its content slot, the route's
 * `Outlet`, and the pages kept drawn between visits beside it.
 */
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
  const inboxOpen = tasks.inboxView.open;
  const pageAgent = tasks.agentView.agentId;
  const boardOpen = tasks.boardView.open;
  const inboxItemShown = tasks.inboxView.chosen !== undefined;
  // A phone's task is headed by a row of its own, whose ⋯ stands for the panel's toggle (`task-pane-switcher.tsx`).
  const panelToggle =
    (descriptionToggle && room !== SHELL_ROOM.NARROW) ||
    pageAgent !== undefined ||
    (inboxOpen && inboxItemShown);
  // A phone's drawer is modal, as a phone's own drawers are: while it stands
  // over the work, the work is inert, so neither a screen reader nor a
  // keyboard reaches what the drawer covers, and a press there only puts it
  // away. Its toggle stays, the way to close it.
  const drawerOver = room === SHELL_ROOM.NARROW && sidebar.overlay !== SIDEBAR_OVERLAY.CLOSED;
  // A phone goes between its places by a bar at the screen's foot, standing on their lists alone (`mobile-bar.tsx`).
  const barShown = mobileBarShown(room, tasks);
  // A phone's Tasks page is the sidebar's tree, pinned in the work's place rather than floating in as a drawer (`mobile-bar.tsx`).
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
        data-inbox-shown={String(inboxOpen)}
      >
        {/* A chip of an agent off its task's page names its model and its starter as the agent's tab does. */}
        <MentionedAgents value={mentionedAgents}>
          <ChipCards value={chipCards}>
            <Outlet />
          </ChipCards>
        </MentionedAgents>
        {/* Note that the Inbox kept stands after the place shown, so a lookup of the place's first box finds the place's,
            and beside every place's route rather than in one, so another place standing, Admin, the Board, or a person's
            page, lets go of nothing it held; its own route draws nothing in the `Outlet` (`InboxPlace`). */}
        {inboxOpen || inboxKept ? (
          <KeptPage shown={inboxOpen} chipCards={chipCards} mentionedAgents={mentionedAgents}>
            <DesktopInbox tasks={tasks} room={room} phoneStart={phoneAccount} />
          </KeptPage>
        ) : null}
      </main>
      {barShown ? <MobileBar tasks={tasks} /> : null}
      {/* Note that the floating sidebar's title-bar row is claimed back from the work's drag strips here, after the work,
          because a later drag region wins and the sidebar comes before the work, so its Back and Forward keep their presses. */}
      {sidebar.overlay !== SIDEBAR_OVERLAY.CLOSED && room === SHELL_ROOM.WIDE ? (
        <div className="sidebar-float-claim" />
      ) : null}
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
          where these stood; off the places bar's places, the drawer opens by a swipe in from the screen's edge. */}
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
      {/* A phone's page offers the panel from its ⋯, and the panel, open, heads itself with its way out. */}
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

/**
 * What the Inbox's route draws in the places' content slot: nothing, since
 * the Inbox is kept drawn beside every place's route (`ShellPlaces`), and it
 * is what stands while its route does.
 */
export function InboxPlace(): null {
  return null;
}

/**
 * What a place the window's state says draws in the places' content slot:
 * a task, an agent's page, or a workspace not there for the reader. Every
 * route not yet moved onto the router draws this one component, so moving
 * between them keeps it drawn.
 */
export function StatePlace(): React.JSX.Element {
  const { tasks, room, sidebar, settings, looks, summary, away } = useShellPlaces();
  const { account } = settings;
  const pageAgent = tasks.agentView.agentId;
  const unknownWorkspace = tasks.unknownWorkspace.open;
  return pageAgent !== undefined ? (
    // Keyed by the agent, so another agent's page is a page of its own, holding nothing of the last.
    <DesktopAgentPage
      key={pageAgent}
      tasks={tasks}
      agentId={pageAgent}
      away={room === SHELL_ROOM.NARROW ? away : undefined}
    />
  ) : unknownWorkspace ? (
    // A workspace's address naming none of the reader's workspaces says nothing of whose it may be, its way out the reader's own Home.
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

/** The Board's frame while its chunk loads; nothing on a phone, whose Tasks page is the sidebar's tree pinned in the work's place (`mobile-bar.tsx`). */
export function BoardRouteLoading(): React.JSX.Element | null {
  const { tasks, room } = useShellPlaces();
  if (mobileBarShown(room, tasks)) return null;
  return <TasksLoading onExit={tasks.boardView.onClose} />;
}

/** The Automations pages' frame while their chunk loads. */
export function AutomationsRouteLoading(): React.JSX.Element {
  const { tasks, room } = useShellPlaces();
  return <AutomationsLoading onExit={tasks.automationsView.onClose} room={room} />;
}

/** A person's page's frame while its chunk loads. */
export function PersonRouteLoading(): React.JSX.Element {
  const { tasks } = useShellPlaces();
  return <PersonLoading name={tasks.personView.name} onExit={tasks.personView.onClose} />;
}

/** Admin's frame, which stands while its chunk loads and while the account's access is still read. */
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

/**
 * Settings over the whole window, its pages listed where the tasks were, as
 * the route draws it once its chunk lands (`settings-route.lazy.tsx`) or its
 * frame while it loads: a phone keeps its places bar under it, each press
 * leaving Settings for the place pressed (`mobile-bar.tsx`).
 */
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

/**
 * A task's version history over the whole window, as its route draws it
 * (`version-history-route.lazy.tsx`), its versions listed where the sidebar
 * was: a chip in a version's words hangs the cards the description's own
 * words do, and New task's dialog stands over it as it does over the tasks.
 * Its way out goes back a step, or leaves it for its task where none stands
 * behind it.
 */
export function VersionHistoryFrame({
  children,
}: {
  children: (exit: () => void) => React.ReactNode;
}): React.JSX.Element {
  const { tasks, history, room, mentionedAgents, chipCards, newTaskDialog } = useShellPlaces();
  const exitHistory = history.canGoBack ? history.onBack : tasks.history.onClose;
  return (
    <div className="desktop-shell" data-room={room}>
      <MentionedAgents value={mentionedAgents}>
        <ChipCards value={chipCards}>{children(exitHistory)}</ChipCards>
      </MentionedAgents>
      {newTaskDialog}
    </div>
  );
}

/** A version history's frame while its chunk loads, and while the task it is of opens under it. */
export function VersionHistoryRouteLoading(): React.JSX.Element {
  const { tasks, history, room } = useShellPlaces();
  return (
    <VersionHistoryFrame>
      {(exit) => (
        <VersionHistoryLoading
          onExit={exit}
          place={backPlaceOf(history, HISTORY_EXIT_PLACE)}
          onList={tasks.history.onList}
          hidden={hiddenColumns(room, tasks.history.listed)}
        />
      )}
    </VersionHistoryFrame>
  );
}

/** Settings' frame while its chunk loads. */
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
