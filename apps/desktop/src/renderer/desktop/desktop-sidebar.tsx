import type { AccountSnapshot } from "@sidecar/credentials/snapshot";
import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  ComposeIcon,
  EllipsisIcon,
  FolderIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  UnpinIcon,
} from "@sidecar/panel";
import { InboxIcon } from "lucide-react";
import { useRef, useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { GitHubMark } from "../account-marks";
import { runAppCommand, useAppCommand } from "../app-commands";
import { CALL_CARD_SURFACE, CallCardDock, type CallCardInput } from "../call/call-card";
import type { NavigationHistory } from "../navigation-history";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { useMinute } from "../planning/plan-time";
import {
  PLANS_PAGE,
  type RepositoryGroup,
  repositoryGroups,
  repositoryLabel,
  repositoryPageUrl,
} from "../planning/planning-model";
import { isAgentTab, sameTab } from "../planning/tab-strip-model";
import { useUnreadPlans } from "../planning/use-plan-looks";
import type { PlansControl } from "../planning/use-plans-tab";
import type { PinnedTab } from "../planning/use-side-panel";
import { RepositoryPicture } from "../repository-picture";
import { RetryButton } from "../retry-button";
import type { UpdateControl } from "../settings/controls";
import { Skeleton, SkeletonRegion } from "../skeleton";
import { commandKeyshortcuts, ShortcutGlyphs, Tooltip } from "../tooltip";
import { ActionMenu, atPointer, dropBelow, type MenuAction, useActionMenu } from "./action-menu";
import { type FoldedGroups, useFoldedGroups } from "./folded-groups";
import { LukeIdentity } from "./luke-identity";
import { SidebarPlan } from "./plan-actions";
import { SIDEBAR_WIDTH, type SidebarCollapse } from "./sidebar-collapse";
import { SidebarFoot } from "./sidebar-foot";
import { SidebarPinnedTab } from "./sidebar-pinned-tab";
import { EDGE_SIDE, type ResizableEdgeProps, useResizableEdge } from "./use-resizable-edge";

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
  // biome-ignore lint/a11y/useSemanticElements: a resize edge is a focusable separator that takes keys, which an <hr> cannot be.
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
    const plan = plans.plans.find((each) => each.id === pin.plan);
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
      <div className="sidebar-repository-header">
        <button
          type="button"
          className="sidebar-repository-toggle sidebar-pinned-row"
          aria-expanded={!folded}
          onClick={folds.togglePinned}
        >
          <span className="sidebar-repository-glyph">
            <PinIcon />
            <ChevronRightIcon />
          </span>
          <span className="sidebar-repository-name">Pinned</span>
          {folded ? <FoldedCount count={rows.length} noun={PIN_NOUN} /> : null}
        </button>
      </div>
      {drawn.length === 0 ? null : (
        <PinnedRows rows={drawn} context={context} onOpenTab={onOpenTab} />
      )}
    </nav>
  );
}

/** One plan under the Inbox: the plan, and how many of its items wait. */
interface InboxRow {
  readonly plan: PlanSummary;
  readonly open: number;
}

/**
 * The Inbox's rows, in main's order, the plan whose item changed latest
 * first: each plan the list holds with items waiting on the developer. A
 * plan out of the list, archived or not yet read, is drawn nowhere, as a
 * pinned tab of one is not.
 */
function inboxRows(plans: PlansControl): InboxRow[] {
  return plans.inbox.flatMap((waiting): InboxRow[] => {
    const plan = plans.plans.find((each) => each.id === waiting.planId);
    return plan === undefined ? [] : [{ plan, open: waiting.items.length }];
  });
}

/**
 * One plan under the Inbox, in a plan row's shape: its name, cut short
 * where it must, with how many of its items wait at the row's end, muted
 * in even figures as a row's time is. A press
 * opens the plan on its Inbox tab, and the row is current while that tab
 * is on screen.
 */
function SidebarInboxPlan({
  row,
  shown,
  onOpen,
}: {
  row: InboxRow;
  shown: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const { plan, open } = row;
  return (
    <li className="sidebar-plan-item sidebar-inbox-plan">
      <button
        type="button"
        className="sidebar-plan"
        aria-current={shown ? "page" : undefined}
        onClick={onOpen}
      >
        <span className="sidebar-plan-line">
          <span className="sidebar-plan-name">{plan.name}</span>
          <span className="sidebar-inbox-count">
            {open}
            <span className="visually-hidden"> {open === 1 ? ITEM_NOUN.one : ITEM_NOUN.many}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * The Inbox, at the head of the list while anything waits on the
 * developer: every plan with an inbox item open, whichever plan is open,
 * each counting its items, so where the developer is needed is seen
 * without opening each plan. Its header is drawn as Pinned's is: the
 * Inbox's tray in the picture's place, giving way to the fold's chevron
 * while hovered or reached from the keyboard, and folded, the count of
 * every waiting item after its name. The fold is kept across launches, and
 * folded, the plan whose Inbox is on show still stands under it. It draws
 * nothing while nothing waits.
 */
function InboxSection({
  rows,
  folds,
  shown,
  onOpen,
}: {
  rows: readonly InboxRow[];
  folds: FoldedGroups;
  /** Whether a plan's Inbox is on show, which a fold leaves standing. */
  shown: (planId: string) => boolean;
  onOpen: (planId: string) => void;
}): React.JSX.Element {
  const folded = folds.inboxFolded;
  const drawn = folded ? rows.filter((row) => shown(row.plan.id)) : rows;
  const total = rows.reduce((sum, row) => sum + row.open, 0);
  return (
    <nav className="sidebar-group" aria-label="Inbox">
      <div className="sidebar-repository-header">
        <button
          type="button"
          className="sidebar-repository-toggle"
          aria-expanded={!folded}
          onClick={folds.toggleInbox}
        >
          <span className="sidebar-repository-glyph">
            <InboxIcon />
            <ChevronRightIcon />
          </span>
          <span className="sidebar-repository-name">Inbox</span>
          {folded ? <FoldedCount count={total} noun={ITEM_NOUN} /> : null}
        </button>
      </div>
      {drawn.length === 0 ? null : (
        <ul className="sidebar-plans">
          {drawn.map((row) => (
            <SidebarInboxPlan
              key={row.plan.id}
              row={row}
              shown={shown(row.plan.id)}
              onOpen={() => onOpen(row.plan.id)}
            />
          ))}
        </ul>
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
    icon: <GitHubMark />,
    onSelect: () => plans.repositories.openGitHub(repositoryPageUrl(repository)),
  };
  return [[pin, archive], [github]];
}

/** What a folded group's count is read as, one and many. */
interface CountNoun {
  readonly one: string;
  readonly many: string;
}

const PLAN_NOUN: CountNoun = { one: "plan", many: "plans" };

/** Pinned holds tabs as well as plans, so its count is read as pins. */
const PIN_NOUN: CountNoun = { one: "pin", many: "pins" };

/** The Inbox counts what waits on the developer, so its counts are read as items. */
const ITEM_NOUN: CountNoun = { one: "item", many: "items" };

/**
 * A folded group's count of what it holds, shown after its name while the
 * header is hovered or reached from the keyboard, and read as "n plans".
 */
function FoldedCount({
  count,
  noun = PLAN_NOUN,
}: {
  count: number;
  noun?: CountNoun;
}): React.JSX.Element {
  return (
    <span className="sidebar-repository-count">
      {count}
      <span className="visually-hidden"> {count === 1 ? noun.one : noun.many}</span>
    </span>
  );
}

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
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the right-click is a second door to the ⋯ beside it, which is the keyboard's. */}
      <div
        className="sidebar-repository-header"
        data-menu-open={String(menu.open !== undefined)}
        onContextMenu={(event) => {
          event.preventDefault();
          menu.show(atPointer(event), ellipsis.current ?? event.currentTarget);
        }}
      >
        <Tooltip label={repository === null || label === repository ? undefined : repository}>
          <button
            type="button"
            className="sidebar-repository-toggle"
            aria-expanded={!folded}
            onClick={() => folds.toggle(repository)}
          >
            <span className="sidebar-repository-glyph">
              {repository === null ? (
                <FolderIcon />
              ) : (
                <RepositoryPicture
                  repository={repository}
                  pictures={context.plans.repositories.pictures}
                  fallback={<FolderIcon />}
                />
              )}
              <ChevronRightIcon />
            </span>
            <span className="sidebar-repository-name">{named}</span>
            {repository !== null && context.plans.pinnedRepositories.includes(repository) ? (
              <span className="sidebar-repository-pinned">
                <PinIcon />
                <span className="visually-hidden">(pinned)</span>
              </span>
            ) : null}
            {folded ? <FoldedCount count={group.plans.length} /> : null}
          </button>
        </Tooltip>
        <span className="sidebar-repository-actions">
          <Tooltip label="Repository actions">
            <button
              ref={ellipsis}
              type="button"
              className="sidebar-repository-action"
              aria-label={`Actions for ${named}`}
              aria-haspopup="menu"
              aria-expanded={menu.open !== undefined}
              onClick={(event) => {
                if (menu.open !== undefined) {
                  menu.close(true);
                  return;
                }
                menu.show(dropBelow(event.currentTarget), event.currentTarget);
              }}
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
        </span>
      </div>
      {menu.open === undefined ? null : (
        <ActionMenu
          label={`${named} actions`}
          menu={menu.open}
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
  const { archived } = context.plans;
  if (archived.length === 0) return null;
  return (
    <div className="sidebar-archived">
      <div className="sidebar-repository-header">
        <button
          type="button"
          className="sidebar-repository-toggle sidebar-archived-row"
          aria-expanded={unfolded}
          onClick={() => setUnfolded((was) => !was)}
        >
          <span className="sidebar-repository-glyph">
            <ArchiveIcon />
            <ChevronRightIcon />
          </span>
          <span className="sidebar-repository-name">Archived</span>
          {unfolded ? null : <FoldedCount count={archived.length} />}
        </button>
      </div>
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

/**
 * The window's left column: Luke, the way to a new plan, Search, which
 * opens the command palette, every plan the account owns, and the account's
 * row, whose menu and gear lead to Settings and the rest. While anything
 * waits on the developer, the Inbox heads the list, a row for each plan
 * with an inbox item open. The pinned plans, and the side panel tabs
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
 * reaches a row nobody can see.
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
}): React.JSX.Element {
  const onPlans = tab === PANEL_TAB.PLANS;
  const composing = onPlans && plans.page === PLANS_PAGE.NEW;
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
  const openInbox = (planId: string) => {
    if (!onPlans) onTabChange(PANEL_TAB.PLANS);
    plans.onShowInbox(planId);
  };
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
  const current = (planId: string) => onPlans && !composing && planId === plans.activePlanId;
  const waiting = inboxRows(plans);
  const unlisted = plans.plans.length === 0 && plans.archived.length === 0;
  // A plan's Inbox is on show where main is told it is: open and in sight, nothing over it.
  const inboxShown = (planId: string) => plans.inboxShown === planId;
  const pinned = plans.plans.filter((plan) => plan.pinnedAt !== undefined);
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
      sameTab(pin.tab, chosenPin.tab),
  )?.pin;
  const context: RowContext = {
    plans,
    current,
    marked: (planId, pin) =>
      pinMarked === undefined ? pin === undefined && current(planId) : pin === pinMarked,
    onOpen: openPlan,
    unread,
    now,
    inSight: !sidebar.collapsed,
  };
  // A pinned tab is on show where its plan is open and its column shows it:
  // an agent's in the plan's own column, any other in the side panel.
  const pinnedShown = ({ plan, pin }: PinnedRow) =>
    current(plan.id) &&
    (pin === undefined ||
      (isAgentTab(pin.tab)
        ? sameTab(plans.mainTabs.tab, pin.tab)
        : plans.sidePanel.open &&
          plans.sidePanel.tab !== undefined &&
          sameTab(plans.sidePanel.tab, pin.tab)));
  // The pinned repositories' groups stand above the rest, newest pinned
  // first, and the rest keep the groups' own order.
  const grouped = repositoryGroups(plans.plans.filter((plan) => plan.pinnedAt === undefined));
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
  // Moving up and down the list as it reads, New plan at its head: up from
  // the first plan is the new-plan page, and down from that page is the
  // first plan. The ends go no further.
  const at = composing ? -1 : drawn.findIndex((plan) => plan.id === plans.activePlanId);
  const step = (by: number) => {
    const next = at + by;
    if (next === -1) newPlan();
    const plan = drawn[next];
    if (plan !== undefined) openPlan(plan.id);
  };
  const listed = plans.signedIn && drawn.length > 0;
  useAppCommand(APP_COMMAND.PREVIOUS_PLAN, listed && at >= 0 ? () => step(-1) : undefined);
  useAppCommand(APP_COMMAND.NEXT_PLAN, listed && at < drawn.length - 1 ? () => step(1) : undefined);

  return (
    <aside className="desktop-sidebar" inert={sidebar.collapsed}>
      <div className="desktop-drag-strip" />
      <HistoryButtons history={history} />
      <LukeIdentity />

      <button
        type="button"
        className="sidebar-new-plan"
        aria-current={composing ? "page" : undefined}
        aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.NEW_PLAN)}
        disabled={!plans.signedIn}
        onClick={newPlan}
      >
        <ComposeIcon />
        New plan
        <ShortcutGlyphs command={APP_COMMAND.NEW_PLAN} className="row-shortcut" />
      </button>
      {/* Search is a second door to the command palette, drawn as New plan
          is, since it heads the list the same way. */}
      <button
        type="button"
        className="sidebar-search"
        aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.COMMAND_PALETTE)}
        onClick={() => runAppCommand(APP_COMMAND.COMMAND_PALETTE)}
      >
        <SearchIcon />
        Search
        <ShortcutGlyphs command={APP_COMMAND.COMMAND_PALETTE} className="row-shortcut" />
      </button>
      <hr className="sidebar-rule" />

      {/* One scroller for both sections, so the pinned plans scroll away
          with the rest rather than holding half the column. */}
      <div className="sidebar-section">
        {plans.signedIn && waiting.length > 0 ? (
          <InboxSection rows={waiting} folds={folds} shown={inboxShown} onOpen={openInbox} />
        ) : null}
        {plans.signedIn && pinnedSection.length > 0 ? (
          <PinnedSection
            rows={pinnedSection}
            folds={folds}
            shown={pinnedShown}
            context={context}
            onOpenTab={openPinnedTab}
          />
        ) : null}
        {/* The rule above heads the list, so it carries no heading of its
            own; its name is for a screen reader alone. */}
        <nav className="sidebar-group" aria-label="Plans">
          {plans.listFailed ? (
            <div className="sidebar-note sidebar-failure" role="alert">
              <p>Your plans couldn't be loaded.</p>
              <RetryButton onRetry={plans.onRetryList} />
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
              onNewPlanIn={newPlanIn}
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
          shown={!sidebar.collapsed}
          settingsOpen={tab === PANEL_TAB.SETTINGS}
          onSettings={() => onTabChange(PANEL_TAB.SETTINGS)}
          onSignOut={onSignOut}
        />
      </div>
      {/* Last, so the drag strip above Luke does not take the edge's top from it. */}
      <SidebarResizeEdge edge={edge} />
    </aside>
  );
}
