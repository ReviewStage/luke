import type { AccountSnapshot } from "@luke/credentials/snapshot";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { PlanSummary } from "@luke/features/plan-wire";
import { EXPERIMENT } from "@luke/settings";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ComposeIcon,
  EllipsisIcon,
  FolderIcon,
  PinIcon,
  PlusIcon,
  ProviderMark,
  SearchIcon,
  UnpinIcon,
} from "@luke/ui";
import { sameTab } from "@luke/ui/tab-strip-model";
import type { UpdateControl } from "@luke/voice/settings-controls";
import { FactoryIcon, HouseIcon, InboxIcon, MessagesSquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { APP_COMMAND, APP_SHORTCUTS } from "#shared/shortcuts";
import { runAppCommand, useAppCommand } from "../app-commands";
import { CALL_CARD_SURFACE, CallCardDock, type CallCardInput } from "../call/call-card";
import type { NavigationHistory } from "../navigation-history";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { forYou } from "../planning/chat-model";
import { NEEDS_YOU } from "../planning/inbox-model";
import { useMinute } from "../planning/plan-time";
import {
  PLANS_PAGE,
  type RepositoryGroup,
  repositoryGroups,
  repositoryLabel,
  repositoryPageUrl,
} from "../planning/planning-model";
import { useUnreadPlans } from "../planning/use-plan-looks";
import type { PlansControl } from "../planning/use-plans-tab";
import { inColumn, type PinnedTab } from "../planning/use-side-panel";
import { ReadFailure } from "../read-failure";
import { RepositoryPicture } from "../repository-picture";
import { Shortcut } from "../shortcut";
import { Skeleton, SkeletonRegion } from "../skeleton";
import { commandKeyshortcuts, Tooltip } from "../tooltip";
import { useExperiment } from "../use-app-state";
import { ActionMenu, type MenuAction, useActionMenu } from "./action-menu";
import { type FoldedGroups, useFoldedGroups } from "./folded-groups";
import { LukeIdentity } from "./luke-identity";
import { SidebarPlan } from "./plan-actions";
import { SIDEBAR_OVERLAY, SIDEBAR_WIDTH, type SidebarCollapse } from "./sidebar-collapse";
import { SidebarFoot } from "./sidebar-foot";
import { type CountNoun, SidebarGroupHeader } from "./sidebar-group-header";
import { SidebarPinnedTab } from "./sidebar-pinned-tab";
import { EDGE_SIDE, type ResizableEdgeProps, useResizableEdge } from "./use-resizable-edge";
import { WorkspaceSwitcher } from "./workspace-switcher";

/**
 * What the sidebar leaves the work column beside it, in CSS pixels: the
 * sidebar is dragged no wider than the window less this.
 */
const WORK_RESERVE = 360;

/** What the header over the plans with no repository says. */
const NO_REPOSITORY = "No repository";

/** The widths of the plans' names while the list is first read, uneven as names are. */
const LIST_SKELETON = ["72%", "54%", "64%", "46%"] as const;

/**
 * The edge of the window's left column, the plans' sidebar or Settings' page
 * list, which share one width: resizing either resizes both. `onCollapse`
 * folds the column away past its least width; without it, as in Settings,
 * where there is no plans' sidebar to fold, the drag holds at the bound.
 */
export function useSidebarEdge(
  sidebar: SidebarCollapse,
  onToggleCollapsed?: () => void,
): ResizableEdgeProps {
  return useResizableEdge({
    side: EDGE_SIDE.RIGHT,
    width: sidebar.width,
    bounds: SIDEBAR_WIDTH,
    reserve: () => WORK_RESERVE,
    label: "Resize sidebar",
    onResize: sidebar.onResize,
    onToggleCollapsed,
  });
}

/**
 * The left column's right edge, dragged to resize it; double-clicked, it goes
 * back to the default width.
 */
export function SidebarResizeEdge({ edge }: { edge: ResizableEdgeProps }): React.JSX.Element {
  return <div className="sidebar-resize" {...edge} />;
}

/**
 * Back and forward, at the right of the left column's title-bar row, level
 * with the traffic lights, the way Cursor and Codex keep them: in the
 * column, so they ride its right edge as it is dragged and slide away with
 * it when it folds, after the column's drag strip so they claim their
 * presses back from the window frame. A way with nothing along it is dimmed
 * rather than gone, so neither button moves. The chords are the shell's to
 * offer, since they answer while the column is folded too.
 */
export function HistoryButtons({ history }: { history: NavigationHistory }): React.JSX.Element {
  return (
    <div className="title-bar-controls" data-edge="column">
      <Tooltip label="Back" command={APP_COMMAND.BACK}>
        <button
          type="button"
          className="icon-button"
          aria-label="Back"
          disabled={!history.canGoBack}
          onClick={history.onBack}
        >
          <ArrowLeftIcon />
        </button>
      </Tooltip>
      <Tooltip label="Forward" command={APP_COMMAND.FORWARD}>
        <button
          type="button"
          className="icon-button"
          aria-label="Forward"
          disabled={!history.canGoForward}
          onClick={history.onForward}
        >
          <ArrowRightIcon />
        </button>
      </Tooltip>
    </div>
  );
}

/** What every row of the plans is drawn with, whichever section it stands in. */
interface RowContext {
  readonly plans: PlansControl;
  /** Whether a plan is the one open, which a fold still leaves standing. */
  readonly current: (planId: string) => boolean;
  /** Whether a row is the one the sidebar marks: the pin the open plan was opened from, else the open plan's own row. */
  readonly marked: (planId: string, pin: PinnedTab | undefined) => boolean;
  readonly onOpen: (planId: string) => void;
  /** Whether a plan was saved since the developer last looked at it on this Mac. */
  readonly unread: (plan: PlanSummary) => boolean;
  /** The time each row's last update is counted back from. */
  readonly now: number;
  /** Whether the sidebar is in sight: folded away, nothing it opened stands over the window. */
  readonly inSight: boolean;
}

/** One section's plans, each a row of the sidebar. */
function PlanRows({
  rows,
  context,
}: {
  rows: readonly PlanSummary[];
  context: RowContext;
}): React.JSX.Element {
  return (
    <ul className="sidebar-plans">
      {rows.map((plan) => (
        <SidebarPlan
          key={plan.id}
          plans={context.plans}
          plan={plan}
          current={context.marked(plan.id, undefined)}
          unread={context.unread(plan)}
          now={context.now}
          onOpen={() => context.onOpen(plan.id)}
        />
      ))}
    </ul>
  );
}

/** One row under Pinned: a pinned plan, or a tab pinned on a listed plan, and when it was pinned. */
interface PinnedRow {
  readonly plan: PlanSummary;
  readonly pin: PinnedTab | undefined;
  readonly at: number;
}

/**
 * The rows under Pinned, newest pinned first: the pinned plans, and the
 * tabs pinned to the sidebar on plans the list holds. A tab of an archived
 * or deleted plan is drawn nowhere, its plan being out of the list.
 */
function pinnedRows(pinned: readonly PlanSummary[], plans: PlansControl): PinnedRow[] {
  const planRows = pinned.map((plan) => ({ plan, pin: undefined, at: plan.pinnedAt ?? 0 }));
  const tabRows = plans.sidePanel.pins.flatMap((pin): PinnedRow[] => {
    const plan = plans.listed.plans.find((each) => each.id === pin.plan);
    return plan === undefined ? [] : [{ plan, pin, at: pin.at }];
  });
  return [...planRows, ...tabRows].sort((a, b) => b.at - a.at);
}

/**
 * The Pinned section's rows, each a plan's or a tab's. A tab's row is keyed
 * by when it was pinned, which no other pin shares, and a plan's by its id.
 */
function PinnedRows({
  rows,
  context,
  onOpenTab,
}: {
  rows: readonly PinnedRow[];
  context: RowContext;
  onOpenTab: (pin: PinnedTab) => void;
}): React.JSX.Element {
  return (
    <ul className="sidebar-plans">
      {rows.map(({ plan, pin }) =>
        pin === undefined ? (
          <SidebarPlan
            key={plan.id}
            plans={context.plans}
            plan={plan}
            current={context.marked(plan.id, undefined)}
            unread={context.unread(plan)}
            now={context.now}
            onOpen={() => context.onOpen(plan.id)}
          />
        ) : (
          <SidebarPinnedTab
            key={String(pin.at)}
            plans={context.plans}
            pin={pin}
            plan={plan}
            current={context.marked(plan.id, pin)}
            inSight={context.inSight}
            onOpen={() => onOpenTab(pin)}
            onOpenPlan={() => context.onOpen(plan.id)}
          />
        ),
      )}
    </ul>
  );
}

/**
 * The Pinned section, its header drawn as a repository's is: the pin in the
 * picture's place, giving way to the fold's chevron while hovered or reached
 * from the keyboard, and folded, the count after its name. The fold is kept
 * across launches as a repository's is, and folded, the open plan, or the
 * pinned tab on show, still stands under it, as under a repository's fold.
 */
function PinnedSection({
  rows,
  folds,
  shown,
  context,
  onOpenTab,
}: {
  rows: readonly PinnedRow[];
  folds: FoldedGroups;
  /** Whether a row is the plan open or the pinned tab on show, which a fold leaves standing. */
  shown: (row: PinnedRow) => boolean;
  context: RowContext;
  onOpenTab: (pin: PinnedTab) => void;
}): React.JSX.Element {
  const folded = folds.pinnedFolded;
  const drawn = folded ? rows.filter(shown) : rows;
  return (
    <nav className="sidebar-group" aria-label="Pinned">
      <SidebarGroupHeader
        glyph={<PinIcon />}
        name="Pinned"
        folded={folded}
        count={rows.length}
        noun={PIN_NOUN}
        onToggle={folds.togglePinned}
      />
      {drawn.length === 0 ? null : (
        <PinnedRows rows={drawn} context={context} onOpenTab={onOpenTab} />
      )}
    </nav>
  );
}

/**
 * A repository's actions, offered alike from its header's ⋯ and from a
 * right-click on the header: Pin holds the group above the rest on the
 * account, Archive plans puts every plan under the header away, and Open on
 * GitHub opens the repository's page, under GitHub's mark rather than the
 * owner's picture, since it is about GitHub. The plans with no repository
 * have no pin, since they always stand last, and no page to open.
 */
function repositoryActionGroups(group: RepositoryGroup, plans: PlansControl): MenuAction[][] {
  const { repository } = group;
  const archive: MenuAction = {
    label: "Archive plans",
    icon: <ArchiveIcon />,
    onSelect: () => plans.onArchivePlans(group.plans.map((plan) => plan.id)),
  };
  if (repository === null) return [[archive]];
  const pin: MenuAction = plans.pinnedRepositories.includes(repository)
    ? {
        label: "Unpin",
        icon: <UnpinIcon />,
        onSelect: () => plans.onPinRepository(repository, false),
      }
    : { label: "Pin", icon: <PinIcon />, onSelect: () => plans.onPinRepository(repository, true) };
  const github: MenuAction = {
    label: "Open on GitHub",
    icon: <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />,
    onSelect: () => plans.repositories.openGitHub(repositoryPageUrl(repository)),
  };
  return [[pin, archive], [github]];
}

/** Pinned holds tabs as well as plans, so its count is read as pins. */
const PIN_NOUN: CountNoun = { one: "pin", many: "pins" };

/**
 * One repository's plans under a header in the headings' voice, which folds
 * and unfolds them, the fold kept across launches. The header is a row like
 * a plan's, with its hover, led by the owner's picture, which gives way to
 * the fold's chevron while the header is hovered or reached from the
 * keyboard, pointing down while the group is open and right while it is
 * folded, the way Codex and Cursor draw a project. Its actions stand at its end while it is hovered or holds
 * focus: a ⋯ that drops the repository's menu, which a right-click anywhere
 * on the header opens too, and a + that starts a new plan with the
 * repository already chosen. Both stand beside the fold rather than inside
 * it, so pressing either folds nothing. Folded, the header counts its plans
 * at its end while hovered or reached from the keyboard, and the open plan
 * still stands under it, so the plan being worked on never leaves the list.
 * The plans with no repository stand under "No repository", with nothing to
 * preset and no page to open.
 */
function RepositorySection({
  group,
  label,
  folds,
  onNewPlanIn,
  context,
}: {
  group: RepositoryGroup;
  /** What the header says for the repository: its name, or `owner/name` where another shares the name. */
  label: string;
  folds: FoldedGroups;
  onNewPlanIn: (repository: string) => void;
  context: RowContext;
}): React.JSX.Element {
  const { repository } = group;
  const folded = folds.folded(repository);
  const named = repository === null ? NO_REPOSITORY : label;
  const rows = folded ? group.plans.filter((plan) => context.current(plan.id)) : group.plans;
  // The menu is drawn over the window rather than inside the sidebar, so it
  // closes with the sidebar folding away as well as with the tab hiding.
  const menu = useActionMenu(context.plans.shown && context.inSight);
  const ellipsis = useRef<HTMLButtonElement | null>(null);
  return (
    <div className="sidebar-repository">
      <SidebarGroupHeader
        glyph={
          repository === null ? (
            <FolderIcon />
          ) : (
            <RepositoryPicture
              repository={repository}
              pictures={context.plans.repositories.pictures}
              fallback={<FolderIcon />}
            />
          )
        }
        name={named}
        folded={folded}
        count={group.plans.length}
        trailing={
          repository !== null && context.plans.pinnedRepositories.includes(repository) ? (
            <span className="sidebar-repository-pinned">
              <PinIcon />
              <span className="visually-hidden">(pinned)</span>
            </span>
          ) : null
        }
        tooltip={repository === null || label === repository ? undefined : repository}
        menuOpen={menu.open !== undefined}
        onContextMenu={menu.contextMenu(ellipsis)}
        onToggle={() => folds.toggle(repository)}
        actions={
          <>
            <Tooltip label="Repository actions">
              <button
                ref={ellipsis}
                type="button"
                className="sidebar-repository-action"
                aria-label={`Actions for ${named}`}
                {...menu.trigger()}
              >
                <EllipsisIcon />
              </button>
            </Tooltip>
            {repository === null ? null : (
              <Tooltip label={`New plan in ${label}`}>
                <button
                  type="button"
                  className="sidebar-repository-action sidebar-repository-new"
                  aria-label={`New plan in ${label}`}
                  onClick={() => onNewPlanIn(repository)}
                >
                  <PlusIcon />
                </button>
              </Tooltip>
            )}
          </>
        }
      />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${named} actions`}
          menu={menu.drawn}
          groups={repositoryActionGroups(group, context.plans)}
          onClose={menu.close}
        />
      )}
      {rows.length === 0 ? null : <PlanRows rows={rows} context={context} />}
    </div>
  );
}

/**
 * The plans under Archived, folded away behind a header drawn as a
 * repository's is, the way Codex and ChatGPT keep theirs: an archive box in
 * the picture's place, giving way to the fold's chevron while hovered or
 * reached from the keyboard, and folded, the count after its name. A press
 * unfolds the list beneath it, and each archived plan opens and offers its
 * actions like any other. It draws nothing
 * while no plan is archived, and it starts folded, because an archived plan
 * is one the developer put out of the way.
 */
function ArchivedPlans({ context }: { context: RowContext }): React.JSX.Element | null {
  const [unfolded, setUnfolded] = useState(false);
  const { archived } = context.plans.listed;
  if (archived.length === 0) return null;
  return (
    <div className="sidebar-archived">
      <SidebarGroupHeader
        glyph={<ArchiveIcon />}
        name="Archived"
        folded={!unfolded}
        count={archived.length}
        onToggle={() => setUnfolded((was) => !was)}
      />
      {unfolded ? <PlanRows rows={archived} context={context} /> : null}
    </div>
  );
}

/**
 * The plans while the list is first read: a plan row's room and its name's
 * type for each block, one line as a row's name is, so the rows land where
 * the blocks stood. Nothing stands for the repository headers, whose number
 * nobody knows yet.
 */
function ListSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label="Reading your plans…" className="sidebar-skeleton">
      {LIST_SKELETON.map((width) => (
        <div key={width} className="sidebar-skeleton-row">
          <Skeleton width={width} />
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** How many items wait on the developer across every plan: the sum of the Inbox's row counts. */
function waitingItems(plans: PlansControl): number {
  return plans.inbox.reduce((sum, plan) => sum + plan.items.length, 0);
}

/**
 * The home page's row, between Search and the Inbox and drawn as they are:
 * the house, its name, and its chord at its end while the row is hovered or
 * reached from the keyboard. A press goes to the home page from wherever the
 * window stands, and the row is the place shown while the home page is.
 */
function SidebarHomeRow({
  current,
  disabled,
  onOpen,
}: {
  current: boolean;
  disabled: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="sidebar-search sidebar-home"
      aria-current={current ? "page" : undefined}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.HOME)}
      disabled={disabled}
      onClick={onOpen}
    >
      <HouseIcon />
      Home
      <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.HOME].chord} className="row-shortcut" />
    </button>
  );
}

/**
 * The Inbox's row, last of the rows heading the list and drawn as they are:
 * the tray, its name, and how many items wait on the developer across every
 * plan at its end, the sum of the counts the Inbox's rows show, muted in
 * even figures as a group's count is, and nothing at none. Its chord takes the count's place while the row is hovered or
 * reached from the keyboard, as New plan's and Search's show theirs. A press
 * opens the window's Inbox (`desktop-inbox.tsx`), and the row is the place
 * shown while it stands.
 */
function SidebarInboxRow({
  waiting,
  current,
  disabled,
  onOpen,
}: {
  waiting: number;
  current: boolean;
  disabled: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="sidebar-search sidebar-inbox"
      aria-current={current ? "page" : undefined}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.INBOX)}
      disabled={disabled}
      onClick={onOpen}
    >
      <InboxIcon />
      Inbox
      {waiting === 0 ? null : (
        <span className="sidebar-inbox-waiting">
          {waiting}
          <span className="visually-hidden">
            {" "}
            {waiting === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many}
          </span>
        </span>
      )}
      <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.INBOX].chord} className="row-shortcut" />
    </button>
  );
}

/** How many messages wait on the developer in Chat: what For you lists. */
function waitingMessages(plans: PlansControl): number {
  const read = plans.chatView.chat;
  return read === undefined ? 0 : forYou(read.answer).length;
}

/**
 * Chat's row, under the Inbox's and drawn as it is: the glyph, its name, and
 * how many messages wait on the developer in For you at its end, in the
 * Inbox's muted figures, nothing at none. A press opens the window's Chat
 * (`desktop-chat.tsx`), and the row is the place shown while it stands.
 */
function SidebarChatRow({
  waiting,
  current,
  onOpen,
}: {
  waiting: number;
  current: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="sidebar-search sidebar-inbox"
      aria-current={current ? "page" : undefined}
      onClick={onOpen}
    >
      <MessagesSquareIcon />
      Chat
      {waiting === 0 ? null : (
        <span className="sidebar-inbox-waiting">
          {waiting}
          <span className="visually-hidden"> waiting on you</span>
        </span>
      )}
    </button>
  );
}

/** The layers that answer their own Escape before a floating sidebar is put away. */
const KEY_LAYERS = '[role="menu"], [role="dialog"], [role="alertdialog"]';

/** What the sidebar is drawn with while it floats, or could. */
interface FloatingSidebar {
  readonly ref: React.RefObject<HTMLElement | null>;
  /** Whether the sidebar is on screen: pinned, or floating over the work. */
  readonly inSight: boolean;
  /** A choice made in the sidebar, which puts a floating sidebar away once made. */
  readonly chosen: <A extends unknown[]>(go: (...args: A) => void) => (...args: A) => void;
  readonly onPress: () => void;
  readonly onPointerLeave: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}

/**
 * The floating sidebar's doors: a press in a peek opens it, the pointer
 * leaving a peek puts it away, though not for the toggle standing over its
 * head, and Escape puts it away while no menu in it took the key first,
 * wherever the keyboard stands, a peek leaving it in the work under it.
 * Opened from away, it takes the keyboard, which Escape gives back. It goes
 * with the sidebar, so a menu's way to Settings or a version history, or
 * any other way off the plans, leaves it away for their return.
 */
function useFloatingSidebar(sidebar: SidebarCollapse): FloatingSidebar {
  const ref = useRef<HTMLElement | null>(null);
  const handBack = useRef<HTMLElement | null>(null);
  const was = useRef(sidebar.overlay);
  const { overlay, onOverlay } = sidebar;
  const floating = overlay !== SIDEBAR_OVERLAY.CLOSED;
  useEffect(() => {
    const from = was.current;
    was.current = overlay;
    const held = ref.current;
    if (overlay !== SIDEBAR_OVERLAY.OPEN || from !== SIDEBAR_OVERLAY.CLOSED || held === null) {
      return;
    }
    handBack.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first =
      held.querySelector<HTMLElement>('[aria-current="page"]') ??
      held.querySelector<HTMLElement>(".sidebar-new-plan");
    first?.focus();
  }, [overlay]);
  useEffect(() => () => onOverlay(SIDEBAR_OVERLAY.CLOSED), [onOverlay]);
  // Note that a floating sidebar need not hold the keyboard, a peek or one a
  // bare press opened leaving it in the work under it, so Escape is heard at
  // the window before the work's layers hear it. A key aimed into the
  // sidebar is left to its own handler, and one aimed into a menu or a
  // dialog to that layer, which may have been raised from the sidebar.
  useEffect(() => {
    if (!floating) return;
    const putAway = (event: KeyboardEvent) => {
      const held = ref.current;
      const target = event.target instanceof Element ? event.target : null;
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (target !== null && (held?.contains(target) || target.closest(KEY_LAYERS) !== null)) {
        return;
      }
      event.preventDefault();
      onOverlay(SIDEBAR_OVERLAY.CLOSED);
    };
    window.addEventListener("keydown", putAway, true);
    return () => window.removeEventListener("keydown", putAway, true);
  }, [floating, onOverlay]);
  return {
    ref,
    inSight: !sidebar.collapsed || floating,
    chosen:
      (go) =>
      (...args) => {
        go(...args);
        if (floating) onOverlay(SIDEBAR_OVERLAY.CLOSED);
      },
    onPress: () => {
      if (overlay === SIDEBAR_OVERLAY.PEEK) onOverlay(SIDEBAR_OVERLAY.OPEN);
    },
    onPointerLeave: (event) => {
      if (overlay !== SIDEBAR_OVERLAY.PEEK) return;
      const to = event.relatedTarget;
      if (to instanceof Element && to.closest(".title-bar-controls") !== null) return;
      onOverlay(SIDEBAR_OVERLAY.CLOSED);
    },
    onKeyDown: (event) => {
      if (event.key !== "Escape" || event.defaultPrevented || !floating) return;
      // Note that the window's layered Escape stands down for a key already taken.
      event.preventDefault();
      onOverlay(SIDEBAR_OVERLAY.CLOSED);
      handBack.current?.focus();
      handBack.current = null;
    },
  };
}

/**
 * Factory's row, after the Inbox's and drawn as it is: the factory, its
 * name, and its chord at its end while the row is hovered or reached from
 * the keyboard. A press opens the window's Factory (`desktop-factory.tsx`),
 * and the row is the place shown while it stands.
 */
function SidebarFactoryRow({
  current,
  disabled,
  onOpen,
}: {
  current: boolean;
  disabled: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="sidebar-search sidebar-factory"
      aria-current={current ? "page" : undefined}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.FACTORY)}
      disabled={disabled}
      onClick={onOpen}
    >
      <FactoryIcon />
      Factory
      <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.FACTORY].chord} className="row-shortcut" />
    </button>
  );
}

/**
 * The window's left column: at its head the workspace chosen, by its tile
 * and name and who shares it, with the menu that chooses another
 * (`workspace-switcher.tsx`), or Luke while no workspace is read; the way to
 * a new plan, Search, which opens the command palette, every plan of the
 * workspace chosen, and the account's
 * row, whose menu and gear lead to Settings and the rest. Home's row, the
 * Inbox's, and Factory's follow Search above the rule: Home's goes to the
 * home page, the Inbox's counts what waits on the developer and opens the
 * window's Inbox, and Factory's, while its experiment is on, opens the
 * window's Factory; Chat's, where a chat is read, counts what waits on the
 * developer in Chat and opens it. The pinned plans, and the side panel tabs
 * pinned to the sidebar, stand in a section of their own above the rest
 * while any are pinned, newest pinned first, under a header that folds as
 * a repository's does, every row one line whose hover card says the rest;
 * the rest are grouped
 * under their repositories' headers, the pinned repositories first, newest
 * pinned first, then the group updated most recently first;
 * and the archived ones are folded away under them all.
 * It is where the developer moves between things; what they work on is the
 * column beside it.
 * The open plan's row is marked, or, where the plan was opened from a pin,
 * that pin's row, while the plan stays open.
 * A plan's actions are a right-click on it away, whether or not it is open.
 * The strip above Luke is the window's drag handle and the traffic lights'
 * room, with back and forward at its right. Its right edge resizes it, and a drag well past its least width
 * folds it away. Folded away, it is inert as well as out of sight, so no key
 * reaches a row nobody can see, until it floats open over the work
 * (`sidebar-collapse.ts`). A floating sidebar is put away by a choice in it,
 * by Escape, or once the pointer leaves a peek; a press in a peek opens it,
 * so a menu it raises outlasts the pointer. Opened from away, it takes the
 * keyboard at the row it marks, else at New plan, and Escape gives the
 * keyboard back where it was. Floating, it has no edge to drag, since only a
 * pinned sidebar is resized.
 */
export function DesktopSidebar({
  sidebar,
  history,
  plans,
  tab,
  onTabChange,
  account,
  updates,
  onSignOut,
  call,
  onPressWithin,
}: {
  sidebar: SidebarCollapse;
  history: NavigationHistory;
  plans: PlansControl;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  account: AccountSnapshot;
  updates: UpdateControl;
  /** Signs the account out, once the account menu's Log out is answered. */
  onSignOut: () => Promise<void>;
  /** The call card, at the column's foot above the account row, while one is to be drawn here. */
  call: CallCardInput | undefined;
  /** Hears every press in the sidebar, which a press outside it would put away while it floats. */
  onPressWithin: () => void;
}): React.JSX.Element {
  const onPlans = tab === PANEL_TAB.PLANS;
  const overlay = useFloatingSidebar(sidebar);
  // The window's Inbox, an agent's page, Factory, and Chat stand in the plan's place, so while one does no plan is the place shown.
  const inInbox = onPlans && plans.inboxView.open;
  const inFactory = onPlans && plans.factoryView.open;
  const inChat = onPlans && plans.chatView.open;
  const standingIn =
    inInbox || inFactory || inChat || (onPlans && plans.agentView.agentId !== undefined);
  // Factory is an experiment: its row stands only while the account has it on.
  const factoryOn = useExperiment(EXPERIMENT.FACTORY);
  // A press in the list is always about plans, so it brings the Plans tab
  // forward from Settings as well as choosing.
  const openPlan = (planId: string) => {
    if (!onPlans) onTabChange(PANEL_TAB.PLANS);
    plans.onSelect(planId);
  };
  const newPlan = () => {
    if (!onPlans) onTabChange(PANEL_TAB.PLANS);
    plans.onNewPlan();
  };
  const openPinnedTab = (pin: PinnedTab) => {
    if (!onPlans) onTabChange(PANEL_TAB.PLANS);
    plans.onOpenPinnedTab(pin);
  };
  const openInbox = () => {
    if (!onPlans) onTabChange(PANEL_TAB.PLANS);
    plans.inboxView.onOpen();
  };
  const openFactory = () => {
    if (!onPlans) onTabChange(PANEL_TAB.PLANS);
    plans.factoryView.onOpen();
  };
  const openChat = () => {
    if (!onPlans) onTabChange(PANEL_TAB.PLANS);
    plans.chatView.onOpen();
  };
  const goHome = () => {
    if (!onPlans) onTabChange(PANEL_TAB.PLANS);
    plans.onGoHome();
  };
  // The home page is the place shown while no plan is open, the Inbox is not
  // standing in its place, and no launch is still reopening a plan.
  const atHome = onPlans && !standingIn && plans.page === PLANS_PAGE.HOME && !plans.restoring;
  const newPlanIn = (repository: string) => {
    if (!onPlans) onTabChange(PANEL_TAB.PLANS);
    plans.onNewPlanIn(repository);
  };
  const folds = useFoldedGroups(sidebar.staged);
  const unread = useUnreadPlans([...plans.plans, ...plans.archived], {
    listRead: plans.listRead,
    staged: sidebar.staged,
  });
  const now = useMinute();
  const edge = useSidebarEdge(sidebar, sidebar.onToggle);
  const current = (planId: string) => onPlans && !standingIn && planId === plans.activePlanId;
  // The list is the chosen workspace's; the unread marks above read every plan.
  const unlisted = plans.listed.plans.length === 0 && plans.listed.archived.length === 0;
  const pinned = plans.listed.plans.filter((plan) => plan.pinnedAt !== undefined);
  const pinnedSection = pinnedRows(pinned, plans);
  // The pin the open plan was opened from is marked in its plan's place,
  // whichever of the plan's tabs is shown, while its row still stands.
  const { chosenPin } = plans;
  const pinMarked = pinnedSection.find(
    ({ plan, pin }) =>
      pin !== undefined &&
      chosenPin !== undefined &&
      current(plan.id) &&
      pin.plan === chosenPin.plan &&
      pin.at === chosenPin.at,
  )?.pin;
  const { chosen } = overlay;
  const context: RowContext = {
    plans,
    current,
    marked: (planId, pin) =>
      pinMarked === undefined ? pin === undefined && current(planId) : pin === pinMarked,
    onOpen: chosen(openPlan),
    unread,
    now,
    inSight: overlay.inSight,
  };
  // A pinned tab is on show where its plan is open and its column shows it:
  // an agent's or the Inbox in the plan's own column, any other in the side panel. The
  // pin marked stands too, so a fold never hides the row the sidebar marks.
  const pinnedShown = ({ plan, pin }: PinnedRow) =>
    (pin !== undefined && pin === pinMarked) ||
    (current(plan.id) &&
      (pin === undefined ||
        (inColumn(pin.tab)
          ? sameTab(plans.mainTabs.tab, pin.tab)
          : plans.sidePanel.open &&
            plans.sidePanel.tab !== undefined &&
            sameTab(plans.sidePanel.tab, pin.tab))));
  // The pinned repositories' groups stand above the rest, newest pinned
  // first, and the rest keep the groups' own order.
  const grouped = repositoryGroups(
    plans.listed.plans.filter((plan) => plan.pinnedAt === undefined),
  );
  const pinnedAt = (group: RepositoryGroup) =>
    group.repository === null ? -1 : plans.pinnedRepositories.indexOf(group.repository);
  const groups = [
    ...grouped.filter((group) => pinnedAt(group) >= 0).sort((a, b) => pinnedAt(a) - pinnedAt(b)),
    ...grouped.filter((group) => pinnedAt(group) < 0),
  ];
  // The rows as the list draws them: the pinned, then each group not folded
  // away, the open plan standing in its place even under a fold, so walking
  // the list still moves from it.
  const drawn = [
    ...(folds.pinnedFolded ? pinned.filter((plan) => current(plan.id)) : pinned),
    ...groups.flatMap((group) =>
      folds.folded(group.repository) ? group.plans.filter((plan) => current(plan.id)) : group.plans,
    ),
  ];
  // Moving up and down the list as it reads: down from the home page, where
  // no plan is open, is the first plan. The ends go no further.
  const at = drawn.findIndex((plan) => plan.id === plans.activePlanId);
  const step = (by: number) => {
    const plan = drawn[at + by];
    if (plan !== undefined) openPlan(plan.id);
  };
  const listed = plans.signedIn && drawn.length > 0;
  useAppCommand(APP_COMMAND.PREVIOUS_PLAN, listed && at > 0 ? () => step(-1) : undefined);
  useAppCommand(APP_COMMAND.NEXT_PLAN, listed && at < drawn.length - 1 ? () => step(1) : undefined);

  return (
    <aside
      ref={overlay.ref}
      className="desktop-sidebar"
      inert={!overlay.inSight}
      onPointerDown={() => {
        onPressWithin();
        overlay.onPress();
      }}
      onPointerLeave={overlay.onPointerLeave}
      onKeyDown={overlay.onKeyDown}
    >
      <div className="desktop-drag-strip" />
      <HistoryButtons history={history} />
      {/* The workspace heads the sidebar once one is read, as everything under it is that
          workspace's; Luke's own head stands until then. */}
      {plans.signedIn && plans.workspace !== undefined ? (
        <WorkspaceSwitcher plans={plans} inSight={overlay.inSight} />
      ) : (
        <LukeIdentity />
      )}

      <button
        type="button"
        className="sidebar-new-plan"
        aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.NEW_PLAN)}
        disabled={!plans.signedIn}
        onClick={chosen(newPlan)}
      >
        <ComposeIcon />
        New plan
        <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.NEW_PLAN].chord} className="row-shortcut" />
      </button>
      {/* Search is a second door to the command palette, drawn as New plan
          is, since it heads the list the same way. */}
      <button
        type="button"
        className="sidebar-search"
        aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.COMMAND_PALETTE)}
        onClick={chosen(() => runAppCommand(APP_COMMAND.COMMAND_PALETTE))}
      >
        <SearchIcon />
        Search
        <Shortcut
          chord={APP_SHORTCUTS[APP_COMMAND.COMMAND_PALETTE].chord}
          className="row-shortcut"
        />
      </button>
      <SidebarHomeRow current={atHome} disabled={!plans.signedIn} onOpen={chosen(goHome)} />
      <SidebarInboxRow
        waiting={plans.signedIn ? waitingItems(plans) : 0}
        current={inInbox}
        disabled={!plans.signedIn}
        onOpen={chosen(openInbox)}
      />
      {/* Chat's row stands only where a chat is read, which only a fixture run stages yet. */}
      {plans.signedIn && plans.chatView.chat !== undefined ? (
        <SidebarChatRow
          waiting={waitingMessages(plans)}
          current={inChat}
          onOpen={chosen(openChat)}
        />
      ) : null}
      {factoryOn ? (
        <SidebarFactoryRow
          current={inFactory}
          disabled={!plans.signedIn}
          onOpen={chosen(openFactory)}
        />
      ) : null}
      <hr className="sidebar-rule" />

      {/* One scroller for both sections, so the pinned plans scroll away
          with the rest rather than holding half the column. */}
      <div className="sidebar-section">
        {plans.signedIn && pinnedSection.length > 0 ? (
          <PinnedSection
            rows={pinnedSection}
            folds={folds}
            shown={pinnedShown}
            context={context}
            onOpenTab={chosen(openPinnedTab)}
          />
        ) : null}
        {/* The rule above heads the list, so it carries no heading of its
            own; its name is for a screen reader alone. */}
        <nav className="sidebar-group" aria-label="Plans">
          {plans.listFailed ? (
            <div className="sidebar-note">
              <ReadFailure line="Your plans could not be read." onRetry={plans.onRetryList} />
            </div>
          ) : null}
          {/* The list is empty before its first read lands, so that it
              holds none says nothing until the service has answered. */}
          {plans.signedIn && unlisted && !plans.listRead && !plans.listFailed ? (
            <ListSkeleton />
          ) : null}
          {plans.signedIn && unlisted && plans.listRead && !plans.listFailed ? (
            <p className="sidebar-note">No plans yet.</p>
          ) : null}
          {plans.signedIn ? null : <p className="sidebar-note">Sign in to plan a feature.</p>}
          {groups.map((group) => (
            <RepositorySection
              key={group.repository ?? NO_REPOSITORY}
              group={group}
              label={
                group.repository === null
                  ? NO_REPOSITORY
                  : repositoryLabel(group.repository, groups)
              }
              folds={folds}
              onNewPlanIn={chosen(newPlanIn)}
              context={context}
            />
          ))}
          {plans.signedIn ? <ArchivedPlans context={context} /> : null}
        </nav>
      </div>

      <div className="sidebar-foot">
        <CallCardDock call={call} surface={CALL_CARD_SURFACE.SIDEBAR} />
        <SidebarFoot
          account={account}
          updates={updates}
          shown={overlay.inSight}
          settingsOpen={tab === PANEL_TAB.SETTINGS}
          onSettings={chosen(() => onTabChange(PANEL_TAB.SETTINGS))}
          onSignOut={onSignOut}
        />
      </div>
      {/* Last, so the drag strip above Luke does not take the edge's top from it. */}
      {sidebar.collapsed ? null : <SidebarResizeEdge edge={edge} />}
    </aside>
  );
}
