import type { AccountSnapshot } from "@luke/credentials/snapshot";
import { APP_COMMAND, APP_SHORTCUTS } from "@luke/settings/shortcuts";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ComposeIcon,
  commandKeyshortcuts,
  dropBelowStart,
  Fill,
  GAP,
  HoldPress,
  IconButton,
  joinRefs,
  LAYOUT_ELEMENT,
  ListMotion,
  motionRows,
  NAV_CURRENT,
  NavItem,
  NOTE_LINE_LOOK,
  NoteLine,
  opensMenu,
  PanePin,
  RESIZE_EDGE_SIDE,
  ResizeEdge,
  type ResizeEdgeHandle,
  SCROLL_FADE,
  ScrollArea,
  SearchIcon,
  Shortcut,
  SidebarPlaces,
  SidebarRule,
  STATUS_TONE,
  Stack,
  Tooltip,
  useMenu,
  useResizeEdge,
  useRovingKeys,
} from "@luke/ui";
import { ListTodoIcon, ShieldUserIcon, ZapIcon } from "@luke/ui/icons";
import { isAgentTab } from "@luke/ui/tab-strip-model";
import { TASKS_PAGE } from "@luke/ui/tasks-model";
import type { UpdateControl } from "@luke/voice/settings-controls";
import { memo, useEffect, useMemo, useRef } from "react";
import { runAppCommand } from "../app-commands.js";
import { ColumnFoot } from "../call/call-card.js";
import { useNewTaskDrafted } from "../composer-drafts.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { DraftMark } from "../draft-mark.js";
import { MemberDirectory } from "../member-directory.js";
import {
  type HistoryPage,
  type HistoryStep,
  type NavigationHistory,
  sameHistoryPage,
} from "../navigation-history.js";
import {
  endWindowSpan,
  leaveWindowSpan,
  PANEL_SPAN,
  PANEL_SPAN_ATTRIBUTE,
} from "../panel-spans.js";
import { PANEL_TAB, type PanelTab } from "../panel-tabs.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { GLYPH_STATE, stateEndMark } from "../state-glyph.js";
import { shownChannel } from "../tasks/channels-model.js";
import { useChannelPlace, useChannels } from "../tasks/use-channels.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import { useAdminAccess } from "../use-app-state.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { runningRuns } from "./automation-runs-tab.js";
import { welcomed } from "./desktop-welcome.js";
import { useFailedRunsMark } from "./failed-runs.js";
import { type HoverPane, useHoverPane } from "./hover-pane.js";
import { LukeIdentity } from "./luke-identity.js";
import { isLuke, useLukeOperator } from "./luke-operator.js";
import { ADMIN_PLACE } from "./pages-on-demand.js";
import { SidebarChannels } from "./sidebar-channels.js";
import { SIDEBAR_WIDTH, type SidebarCollapse, sidebarInSight } from "./sidebar-collapse.js";
import { SidebarFoot } from "./sidebar-foot.js";
import { SidebarLuke } from "./sidebar-luke.js";
import { useWorkspaceRuns } from "./use-automation-runs.js";
import { WorkspaceSwitcher } from "./workspace-switcher.js";

/**
 * What the sidebar leaves the work column beside it, in CSS pixels: the
 * sidebar is dragged no wider than the window less this.
 */
const WORK_RESERVE = 360;

/** What the Automations row's count counts, as a reader hears it after the figure. */
const RUNNING_NOUN = "running";

/**
 * The edge of the window's left column, the tasks' sidebar or Settings' page
 * list, which share one width: resizing either resizes both. `onCollapse`
 * folds the column away past its least width; without it, as in Settings,
 * where there is no tasks' sidebar to fold, the drag holds at the bound.
 */
export function useSidebarEdge(
  sidebar: SidebarCollapse,
  onToggleCollapsed?: () => void,
): ResizeEdgeHandle {
  return useResizeEdge({
    side: RESIZE_EDGE_SIDE.RIGHT,
    width: sidebar.width,
    bounds: SIDEBAR_WIDTH,
    reserve: () => WORK_RESERVE,
    label: "Resize sidebar",
    onResize: sidebar.onResize,
    onToggleCollapsed,
  });
}

/** The display a browser tab answers, as against an installed web app's own window, which draws no Back of its own. */
const BROWSER_DISPLAY = "(display-mode: browser)";

/**
 * Back and forward, at the right of the left column's title-bar row, level
 * with the traffic lights, the way Cursor and Codex keep them: in the
 * column, so they ride its right edge as it is dragged and slide away with
 * it when it folds, after the column's drag strip so they claim their
 * presses back from the window frame. A way with nothing along it is dimmed
 * rather than gone, so neither button moves. The chords are the shell's to
 * offer, since they answer while the column is folded too. A phone's
 * browser tab draws none, since its own Back and Forward walk the same
 * history (`navigation-history.ts`) and the drawer's head is short of room;
 * a phone's installed web app keeps them, having no browser around it.
 */
export function HistoryButtons({
  history,
  room,
}: {
  history: NavigationHistory;
  room: ShellRoom;
}): React.JSX.Element | null {
  if (room === SHELL_ROOM.NARROW && window.matchMedia(BROWSER_DISPLAY).matches) return null;
  return (
    <div className="title-bar-controls" data-edge="column">
      <HistoryButton
        label="Back"
        command={APP_COMMAND.BACK}
        icon={<ArrowLeftIcon />}
        able={history.canGoBack}
        onPress={history.onBack}
        steps={history.steps.back}
        onGoTo={history.onGoTo}
      />
      <HistoryButton
        label="Forward"
        command={APP_COMMAND.FORWARD}
        icon={<ArrowRightIcon />}
        able={history.canGoForward}
        onPress={history.onForward}
        steps={history.steps.forward}
        onGoTo={history.onGoTo}
      />
    </div>
  );
}

/** The steps a list names a step by where nothing named it as the window stood on it. */
const UNNAMED_STEP = "Earlier page";

/**
 * The steps along one way of the history as its button's menu lists them:
 * the nearest first, a page's steps gathered together between rules, each
 * named as the window called it there, with what it showed under it.
 */
function historyGroups(
  steps: readonly HistoryStep[],
  onGoTo: (at: number) => void,
): (readonly MenuAction[])[] {
  const groups: MenuAction[][] = [];
  let page: HistoryPage | undefined;
  for (const step of steps) {
    const item: MenuAction = {
      label: step.title?.label ?? UNNAMED_STEP,
      detail: step.title?.detail,
      onSelect: () => onGoTo(step.at),
    };
    if (page !== undefined && sameHistoryPage(step.page, page)) groups.at(-1)?.push(item);
    else groups.push([item]);
    page = step.page;
  }
  return groups;
}

/**
 * Back or Forward: a press takes one step, and a press held (`HoldPress`),
 * a right-click, or the menu key (⇧F10 too) lists the steps along that way, any
 * of which it goes straight to, as a browser's Back and Forward do.
 */
function HistoryButton({
  label,
  command,
  icon,
  able,
  onPress,
  steps,
  onGoTo,
}: {
  label: string;
  command: typeof APP_COMMAND.BACK | typeof APP_COMMAND.FORWARD;
  icon: React.JSX.Element;
  able: boolean;
  onPress: () => void;
  steps: readonly HistoryStep[];
  onGoTo: (at: number) => void;
}): React.JSX.Element {
  const menu = useMenu(able);
  const button = useRef<HTMLButtonElement>(null);
  const openList = () => {
    const element = button.current;
    if (element !== null && steps.length > 0) menu.show(dropBelowStart(element), element);
  };
  return (
    // A press held, the mouse's as a touch's, opens the list, as a browser's Back does, and so
    // does a right-click, which opens no list a hold already opened.
    <HoldPress
      mouse
      disabled={!able}
      onHold={openList}
      onKeyDown={(event) => {
        // Note that the list hangs from the button, not from the wrapper this key bubbles to, because the wrapper lays nothing out.
        if (!able || !opensMenu(event)) return;
        event.preventDefault();
        openList();
      }}
      onContextMenu={() => {
        if (menu.open === undefined) openList();
      }}
    >
      <Tooltip label={label} command={command}>
        <IconButton
          ref={button}
          icon={icon}
          label={label}
          disabled={!able}
          aria-haspopup="menu"
          aria-expanded={menu.open !== undefined}
          onClick={onPress}
        />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${label} history`}
          menu={menu.drawn}
          groups={historyGroups(steps, onGoTo)}
          onClose={menu.close}
        />
      )}
    </HoldPress>
  );
}

/** What the sidebar is drawn with while it floats, or could. */
interface FloatingSidebar extends HoverPane {
  /** Whether the sidebar is on screen: pinned, or floating over the work. */
  readonly inSight: boolean;
}

/** Where a sidebar opened from away takes the keyboard: the row it marks, else New task, the first of its places. */
function sidebarFocus(sidebar: HTMLElement): HTMLElement | null {
  return (
    sidebar.querySelector<HTMLElement>('[aria-current="page"]') ??
    sidebar.querySelector<HTMLElement>(".sidebar-places > button")
  );
}

/**
 * The floating sidebar's doors (`hover-pane.ts`), the pointer leaving a peek
 * for the toggle standing over its head leaving it out. It goes with the
 * sidebar, so a menu's way to Settings or a version history, or any other
 * way off the plans, leaves it away for their return.
 */
function useFloatingSidebar(sidebar: SidebarCollapse): FloatingSidebar {
  const pane = useHoverPane(
    { state: sidebar.overlay, onState: sidebar.onOverlay },
    { focusAt: sidebarFocus, stays: ".title-bar-controls" },
  );
  return { ...pane, inSight: sidebarInSight(sidebar) };
}

/**
 * The Tasks page's row, under the Inbox's. A press opens the listed
 * workspace's tasks as a List or a Board (`tasks-page.tsx`), as its chord
 * does, and the row is the place shown while it stands. It is always offered.
 */
function SidebarTasksRow({
  current,
  disabled,
  onOpen,
}: {
  current: boolean;
  disabled: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <NavItem
      icon={<ListTodoIcon />}
      current={current ? NAV_CURRENT.PAGE : undefined}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.TASKS)}
      shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.TASKS].chord} />}
      disabled={disabled}
      onClick={onOpen}
    >
      Tasks
    </NavItem>
  );
}

/**
 * The Automations page's row, after the Tasks page's and drawn as it is: the
 * zap, its name, and its chord. A press opens the window's Automations page
 * (`automations-page.tsx`), and the row is the place shown while it stands.
 * While a run of the account's own automation failed to start since that
 * automation was opened, the row wears the failed mark at its end, where the
 * Inbox's count stands on its row, giving way to the chord as that does.
 * While agents its workspace's automations started still work, it counts
 * them in the working tone beside that mark, as the Runs tab does.
 */
function SidebarAutomationsRow({
  current,
  failed,
  running,
  disabled,
  onOpen,
}: {
  current: boolean;
  failed: boolean;
  /** How many runs of the listed workspace's automations still have an agent at work. */
  running: number;
  disabled: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <NavItem
      icon={<ZapIcon />}
      current={current ? NAV_CURRENT.PAGE : undefined}
      count={{ value: running, noun: RUNNING_NOUN, tone: STATUS_TONE.WORKING }}
      mark={failed ? stateEndMark(GLYPH_STATE.FAILED, false) : undefined}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.AUTOMATIONS)}
      shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.AUTOMATIONS].chord} />}
      disabled={disabled}
      onClick={onOpen}
    >
      Automations
    </NavItem>
  );
}

/**
 * The Admin row, after Automations' and drawn as it is, for an admin alone:
 * a non-admin is drawn nothing, not a row held back. A press opens the
 * window's Admin place (`desktop-admin.tsx`) in the task's place, as
 * Automations' row does, and the row is the place shown while it stands.
 * Note that the row is a convenience: the service's own gate decides every
 * read the place makes.
 */
function SidebarAdminRow({
  current,
  onOpen,
}: {
  current: boolean;
  onOpen: () => void;
}): React.JSX.Element | null {
  const admin = useAdminAccess();
  if (!admin) return null;
  return (
    <NavItem
      icon={<ShieldUserIcon />}
      current={current ? NAV_CURRENT.PAGE : undefined}
      // The pointer on the row is the way to the place, so its chunk, charts and all, is read now rather than at the press.
      onPointerEnter={ADMIN_PLACE.prefetch}
      onClick={onOpen}
    >
      Admin
    </NavItem>
  );
}

/** What the sidebar is drawn from. */
interface DesktopSidebarProps {
  sidebar: SidebarCollapse;
  history: NavigationHistory;
  tasks: TasksControl;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  account: AccountSnapshot;
  updates: UpdateControl;
  /** Signs the account out, when the account menu's Sign out is pressed. */
  onSignOut: () => Promise<void>;
  /** Hears every press in the sidebar, which a press outside it would put away while it floats. */
  onPressWithin: () => void;
  /** The room the panel's stage gives; narrow, the sidebar is a phone's drawer. Wide where left out. */
  room?: ShellRoom | undefined;
}

/**
 * New task, heading the list: a press opens the New task dialog at once, as
 * the menu bar's and the chord's New task do, whose name field also
 * searches the workspace's Linear issues where Linear is connected
 * (`new-task-dialog.tsx`). While words left in its card wait as the
 * workspace's draft, it wears the Draft pencil at its end, which its chord
 * takes the place of while it is hovered; none while the card or a new
 * account's welcome, whose composer shows those words, is open, as a task
 * open wears none.
 */
function NewTaskButton({
  tasks,
  shown,
  onNewTask,
}: {
  tasks: TasksControl;
  /** Whether New task's words are in sight: its card open, or a new account's welcome shown. */
  shown: boolean;
  onNewTask: () => void;
}): React.JSX.Element {
  const drafted = useNewTaskDrafted(tasks.newTask.workspaceId) && tasks.signedIn && !shown;
  return (
    <NavItem
      icon={<ComposeIcon />}
      mark={drafted ? <DraftMark /> : undefined}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.NEW_TASK)}
      shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.NEW_TASK].chord} />}
      disabled={!tasks.signedIn}
      onClick={onNewTask}
    >
      New task
    </NavItem>
  );
}

/**
 * Times the window's first usable screen: its start to the sidebar's first
 * task list read answered, saying how many tasks the read answered, every
 * workspace's, since the workspace chosen may not stand yet. A window whose
 * first read fails is left untimed rather than timed through the
 * developer's Retry. Note that a window opening signed out is not left,
 * because every window opens so until the account's session is restored.
 */
function useFirstUsableSpan(tasks: TasksControl): void {
  const { listRead, listFailed } = tasks;
  const listed = tasks.tasks.length;
  useEffect(() => {
    if (listFailed) leaveWindowSpan(PANEL_SPAN.WINDOW_FIRST_USABLE);
    else if (listRead)
      endWindowSpan(PANEL_SPAN.WINDOW_FIRST_USABLE, () => ({
        [PANEL_SPAN_ATTRIBUTE.TASK_COUNT]: listed,
      }));
  }, [listRead, listFailed, listed]);
}

/**
 * The window's left column: at its head the workspace chosen, by its tile
 * and name and who shares it, with the menu that chooses another
 * (`workspace-switcher.tsx`), or Luke while no workspace is read; the way to
 * a new task, Search, which opens the command palette, the Tasks page's
 * row, the Automations page's, and Admin's for an admin, above the rule;
 * Luke, the account's operator, where it stands; then the workspace's
 * channels, each counting the asks that wait on the developer there
 * (`sidebar-channels.tsx`), a press opening its stream in the task's place,
 * which is also where the window rests with no task open
 * (`resting-page.ts`); and the account's row at its foot, whose menu and
 * gear lead to Settings and the rest. It is where the developer moves
 * between things; what they work on is the column beside it. The place
 * shown is marked: a channel's row while its stream stands, else the page's.
 * The strip above Luke is the window's drag handle and the traffic lights'
 * room, with back and forward at its right. Its right edge resizes it, and a drag well past its least width
 * folds it away. Folded away, it is inert as well as out of sight, so no key
 * reaches a row nobody can see, until it floats open over the work
 * (`sidebar-collapse.ts`). A floating sidebar is put away by a choice in it,
 * by Escape, by a press outside, or once the pointer leaves a peek, a press
 * in it or not, though not for a menu it raised (`hover-pane.ts`). Opened
 * from away, it takes the keyboard at the row it marks, else at New task,
 * holds it there against Tab, and Escape gives the keyboard back where it
 * was. Floating, it has no edge to drag, since only a pinned sidebar is
 * resized.
 */
function SidebarColumn({
  sidebar,
  history,
  tasks,
  tab,
  onTabChange,
  account,
  updates,
  onSignOut,
  onPressWithin,
  room = SHELL_ROOM.WIDE,
}: DesktopSidebarProps): React.JSX.Element {
  const onTasks = tab === PANEL_TAB.TASKS;
  const overlay = useFloatingSidebar(sidebar);
  useFirstUsableSpan(tasks);
  const body = useRef<HTMLDivElement>(null);
  // The column's rows, Luke's and the channels', are one Tab stop that ↑↓ walk.
  const roving = useRovingKeys<HTMLDivElement>();
  const bodyRef = useMemo(() => joinRefs(body, roving.ref), [roving.ref]);
  // Channels, an agent's page, the Automations page, the Tasks page, and Admin stand in the task's place, so while one does no task is the place shown.
  const inInbox = onTasks && tasks.inboxView.open;
  const inAutomations = onTasks && tasks.automationsView.open;
  const inBoard = onTasks && tasks.boardView.open;
  const inAdmin = onTasks && tasks.adminView.open;
  // Opening an automation sees its failed run, which the Automations row is marked for until then.
  const { place: automationsPlace } = tasks.automationsView;
  // The workspace's runs, followed while the sidebar stands, as the Runs tab follows them, for the row to count the ones still at work.
  const { read: workspaceRuns } = useWorkspaceRuns(
    tasks.signedIn ? tasks.workspace?.id : undefined,
  );
  const automationsRunning = runningRuns(workspaceRuns);
  const automationFailed = useFailedRunsMark(
    tasks.failedRuns,
    tasks.workspace?.id,
    inAutomations && automationsPlace.kind === AUTOMATIONS_PAGE.EDIT
      ? automationsPlace.automationId
      : undefined,
    sidebar.staged,
  );
  const standingIn =
    inInbox ||
    inAutomations ||
    inBoard ||
    inAdmin ||
    (onTasks && tasks.agentView.agentId !== undefined);
  const channels = useChannels(tasks.signedIn ? tasks.workspace?.id : undefined, tasks.shown);
  const channelPlace = useChannelPlace();
  const shownChannelId = inInbox
    ? shownChannel(channels.channels ?? [], channelPlace.channelId)?.id
    : undefined;
  const showTasks = () => {
    if (!onTasks) onTabChange(PANEL_TAB.TASKS);
  };
  const newTask = () => {
    showTasks();
    tasks.onNewTask();
  };
  const openChannel = (channelId: string) => {
    showTasks();
    channelPlace.onChoose(channelId);
    tasks.inboxView.onOpen();
    // Note that a phone's Channels opens on its list of channels, so a channel chosen in the drawer asks for its stream instead, never a thread left open in it.
    if (room === SHELL_ROOM.NARROW) {
      channelPlace.onCloseThread();
      tasks.inboxView.onListed(false);
    }
  };
  const openBoard = () => {
    showTasks();
    tasks.boardView.onOpen();
  };
  const openAutomations = () => {
    showTasks();
    tasks.automationsView.onOpen();
  };
  const openAdmin = () => {
    showTasks();
    tasks.adminView.onOpen();
  };
  const openAgent = (agentId: string) => {
    showTasks();
    tasks.agentView.onOpen(agentId);
  };
  // A new account's welcome stands while no task is open, nothing stands in
  // its place, and no launch is still reopening a task: New task's composer is
  // on it, so its row draws no Draft pencil for the words shown there.
  const atWelcome =
    onTasks && !standingIn && tasks.page === TASKS_PAGE.HOME && !tasks.restoring && welcomed(tasks);
  const edge = useSidebarEdge(sidebar, sidebar.onToggle);
  // An agent with no plan stands on its own page, which is the place shown while it stands.
  const agentShown = onTasks ? tasks.agentView.agentId : undefined;
  // Luke stands in his own row at the list's head.
  const operator = useLukeOperator({
    accountId: tasks.me,
    workspaceId: tasks.signedIn ? tasks.workspace?.id : undefined,
  });
  const lukeId = operator?.agentId;
  const { chosen } = overlay;
  return (
    <PanePin
      ref={overlay.ref}
      className="desktop-sidebar"
      inert={!overlay.inSight}
      onPin={onPressWithin}
      onPointerLeave={overlay.onPointerLeave}
      onKeyDown={overlay.onKeyDown}
    >
      <div className="desktop-drag-strip" />
      <HistoryButtons history={history} room={room} />
      {/* The workspace heads the sidebar once one is read, as everything under it is that
          workspace's; Luke's own head stands until then. */}
      {tasks.signedIn && tasks.workspace !== undefined ? (
        <WorkspaceSwitcher tasks={tasks} inSight={overlay.inSight} />
      ) : (
        <LukeIdentity />
      )}

      {/* One scroller for the pages' rows and the channels, so the rows do not hold the column
          above the rest: on an iPad's or a short window's column they left the channels a strip. */}
      <Fill className="sidebar-section -m-ring-reach">
        <ScrollArea fade={SCROLL_FADE.BOTH}>
          <ListMotion root={body}>
            <div
              {...roving}
              ref={bodyRef}
              className="sidebar-section-body flex min-h-list-held flex-col p-ring-reach [&_.sidebar-group+.sidebar-group]:mt-section-gap"
              {...motionRows()}
            >
              <SidebarPlaces>
                <NewTaskButton
                  tasks={tasks}
                  // A person's page stands in the welcome's place without leaving its page, and draws no composer.
                  shown={tasks.newTask.open || (atWelcome && tasks.personView.userId === undefined)}
                  onNewTask={chosen(newTask)}
                />
                {/* Search is a second door to the command palette, drawn as New task
                    is, since it heads the list the same way. */}
                <NavItem
                  icon={<SearchIcon />}
                  aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.COMMAND_PALETTE)}
                  shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.COMMAND_PALETTE].chord} />}
                  onClick={chosen(() => runAppCommand(APP_COMMAND.COMMAND_PALETTE))}
                >
                  Search
                </NavItem>
                <SidebarTasksRow
                  current={inBoard}
                  disabled={!tasks.signedIn}
                  onOpen={chosen(openBoard)}
                />
                <SidebarAutomationsRow
                  current={inAutomations}
                  failed={automationFailed}
                  running={automationsRunning}
                  disabled={!tasks.signedIn}
                  onOpen={chosen(openAutomations)}
                />
                <SidebarAdminRow current={inAdmin} onOpen={chosen(openAdmin)} />
              </SidebarPlaces>
              <SidebarRule />
              {operator === undefined ? null : (
                <nav className="sidebar-group" aria-label="Luke">
                  <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.ROW} className="sidebar-tasks">
                    <SidebarLuke
                      operator={operator}
                      agent={tasks.listedAgents.standing.find(
                        (agent) =>
                          agent.workspaceId === operator.workspaceId && isLuke(agent, operator),
                      )}
                      current={lukeId !== undefined && lukeId === agentShown}
                      unread={
                        lukeId !== undefined &&
                        tasks.unreadTabs.some((tab) => isAgentTab(tab) && tab.agent === lukeId)
                      }
                      shown={tasks.shown && overlay.inSight}
                      onOpen={chosen(openAgent)}
                    />
                  </Stack>
                </nav>
              )}
              {tasks.signedIn ? (
                <SidebarChannels
                  workspaceId={tasks.workspace?.id}
                  channels={channels}
                  currentId={shownChannelId}
                  shown={tasks.shown && overlay.inSight}
                  onOpen={chosen(openChannel)}
                />
              ) : (
                <NoteLine look={NOTE_LINE_LOOK.ROWS}>Sign in to start a task.</NoteLine>
              )}
            </div>
          </ListMotion>
        </ScrollArea>
      </Fill>

      <ColumnFoot docked={!sidebar.collapsed}>
        <SidebarFoot
          account={account}
          updates={updates}
          shown={overlay.inSight}
          settingsOpen={tab === PANEL_TAB.SETTINGS}
          onSettings={chosen(() => onTabChange(PANEL_TAB.SETTINGS))}
          onSignOut={onSignOut}
        />
      </ColumnFoot>
      {/* Last, so the drag strip above Luke does not take the edge's top from it. */}
      {sidebar.collapsed ? null : <ResizeEdge edge={edge} />}
    </PanePin>
  );
}

/**
 * The sidebar, read against the listed workspace's members: a teammate's
 * face on a row, a creator's group's header, and the order of those groups
 * by the names their headers say. Its links are written under that
 * workspace, which is every row's.
 *
 * A memo boundary: the shell drawn again over the same tasks, history, and
 * fold, as a setting that moves draws it, leaves the sidebar and every row
 * of it as they were.
 */
export const DesktopSidebar = memo(function DesktopSidebar(
  props: DesktopSidebarProps,
): React.JSX.Element {
  const { workspace } = props.tasks;
  return (
    <LinkWorkspaceProvider value={workspace?.slug ?? workspace?.id}>
      <MemberDirectory workspace={workspace} readerId={props.tasks.me}>
        <SidebarColumn {...props} />
      </MemberDirectory>
    </LinkWorkspaceProvider>
  );
});
