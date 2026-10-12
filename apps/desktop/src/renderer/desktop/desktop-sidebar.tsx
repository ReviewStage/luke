import { ACCOUNT_STATUS, type AccountSnapshot } from "@sidecar/credentials/snapshot";
import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  ComposeIcon,
  EllipsisIcon,
  FolderIcon,
  GearIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  UnpinIcon,
  UpdateIcon,
  UserIcon,
} from "@sidecar/panel";
import { useRef, useState } from "react";
import { UPDATE_STATUS } from "#shared/messages/update";
import { APP_COMMAND } from "#shared/shortcuts";
import { GitHubMark } from "../account-marks";
import { runAppCommand, useAppCommand } from "../app-commands";
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
import { useUnreadPlans } from "../planning/use-plan-looks";
import type { PlansControl } from "../planning/use-plans-tab";
import { RepositoryPicture } from "../repository-picture";
import type { UpdateControl } from "../settings/controls";
import { commandKeyshortcuts, ShortcutGlyphs, Tooltip } from "../tooltip";
import { updateAvailable, updateInSidebar, updateRow } from "../update-row";
import { ActionMenu, atPointer, dropBelow, type MenuAction, useActionMenu } from "./action-menu";
import { type FoldedGroups, useFoldedGroups } from "./folded-groups";
import { LukeIdentity, type LukeIdentityProps } from "./luke-identity";
import { SidebarPlan } from "./plan-actions";
import { SIDEBAR_WIDTH, type SidebarCollapse } from "./sidebar-collapse";
import { EDGE_SIDE, type ResizableEdgeProps, useResizableEdge } from "./use-resizable-edge";

/**
 * What the sidebar leaves the work column beside it, in CSS pixels: the
 * sidebar is dragged no wider than the window less this.
 */
const WORK_RESERVE = 360;

/** What the header over the plans with no repository says. */
const NO_REPOSITORY = "No repository";

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

/**
 * The account's face: the provider's photo when one travelled and loads,
 * otherwise the first letter of who it is, otherwise a person glyph while no
 * one is signed in. A photo that fails is remembered by its address for as
 * long as the sidebar stands, so a new address gets its own chance. Note that
 * we let a remount try the address again, because a failure is as often a
 * launch with no network as a dead link, and the empty `alt` means a retry
 * that fails again draws no broken-image glyph.
 */
function AccountAvatar({ account }: { account: AccountSnapshot }): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined);
  if (account.status !== ACCOUNT_STATUS.SIGNED_IN) {
    return (
      <span className="sidebar-avatar sidebar-avatar-neutral" aria-hidden="true">
        <UserIcon />
      </span>
    );
  }
  const { pictureUrl } = account;
  if (pictureUrl !== undefined && pictureUrl !== failedUrl) {
    return (
      <img
        className="sidebar-avatar"
        src={pictureUrl}
        alt=""
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setFailedUrl(pictureUrl)}
      />
    );
  }
  return (
    <span className="sidebar-avatar" aria-hidden="true">
      {(account.name ?? account.email).slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * A newer release on its way in, just above the account row, where a desktop
 * devtool keeps it: a quiet line while it downloads, then the restart that
 * installs it, which is the very act Settings' Restart to update runs. It
 * draws nothing in any other state, so the column carries no control with
 * nothing to do.
 */
function SidebarUpdate({ updates }: { updates: UpdateControl }): React.JSX.Element | null {
  const { update } = updates;
  if (!updateInSidebar(update)) return null;
  switch (update.status) {
    case UPDATE_STATUS.READY:
      return (
        <Tooltip label={`Luke ${update.latestVersion} is ready`}>
          <button type="button" className="sidebar-item sidebar-update" onClick={updates.onInstall}>
            <UpdateIcon />
            Restart to update
          </button>
        </Tooltip>
      );
    case UPDATE_STATUS.DOWNLOADING:
      return (
        <p className="sidebar-item sidebar-update-progress" role="status">
          <UpdateIcon />
          Downloading update…
          {update.progress ? ` ${Math.round(update.progress.percent)}%` : null}
        </p>
      );
    default:
      return null;
  }
}

/**
 * The foot of the column: one row that is who is signed in and the way to
 * Settings at once, the way every desktop devtool keeps it. Signed out it
 * names where it leads instead. The update dot rides on the gear, since
 * Settings is where a release the sidebar does not carry is fetched.
 */
function AccountButton({
  account,
  current,
  settingsNote,
  onPress,
}: {
  account: AccountSnapshot;
  current: boolean;
  settingsNote: string | undefined;
  onPress: () => void;
}): React.JSX.Element {
  const signedIn = account.status === ACCOUNT_STATUS.SIGNED_IN;
  return (
    <Tooltip label="Settings" command={APP_COMMAND.SETTINGS}>
      <button
        type="button"
        className="sidebar-item sidebar-account"
        aria-current={current ? "page" : undefined}
        onClick={onPress}
      >
        <AccountAvatar account={account} />
        <span className="sidebar-account-name">
          {signedIn ? (account.name ?? account.email) : "Settings"}
        </span>
        <span className="sidebar-account-settings">
          <GearIcon />
          {settingsNote ? (
            <span className="tab-note" title={settingsNote}>
              <span className="visually-hidden">({settingsNote})</span>
            </span>
          ) : null}
        </span>
      </button>
    </Tooltip>
  );
}

/** What every row of the plans is drawn with, whichever section it stands in. */
interface RowContext {
  readonly plans: PlansControl;
  readonly current: (planId: string) => boolean;
  readonly onOpen: (planId: string) => void;
  /** Whether a plan was saved since the developer last looked at it on this Mac. */
  readonly unread: (plan: PlanSummary) => boolean;
  /** The time each row's last update is counted back from. */
  readonly now: number;
  /** Whether the sidebar is in sight: folded away, nothing it opened stands over the window. */
  readonly inSight: boolean;
}

/** One section's plans, each a row of the sidebar, naming its repository where nothing above it does. */
function PlanRows({
  rows,
  repositoryShown,
  context,
}: {
  rows: readonly PlanSummary[];
  repositoryShown: boolean;
  context: RowContext;
}): React.JSX.Element {
  return (
    <ul className="sidebar-plans">
      {rows.map((plan) => (
        <SidebarPlan
          key={plan.id}
          plans={context.plans}
          plan={plan}
          current={context.current(plan.id)}
          unread={context.unread(plan)}
          repositoryShown={repositoryShown}
          now={context.now}
          onOpen={() => context.onOpen(plan.id)}
        />
      ))}
    </ul>
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

/**
 * A folded group's count of its plans, shown after its name while the
 * header is hovered or reached from the keyboard, and read as "n plans".
 */
function FoldedCount({ count }: { count: number }): React.JSX.Element {
  return (
    <span className="sidebar-repository-count">
      {count}
      <span className="visually-hidden">{count === 1 ? " plan" : " plans"}</span>
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
      {rows.length === 0 ? null : (
        <PlanRows rows={rows} repositoryShown={false} context={context} />
      )}
    </div>
  );
}

/**
 * The plans under Archived, folded away behind a header drawn as a
 * repository's is, the way Codex and ChatGPT keep theirs: an archive box in
 * the picture's place, giving way to the fold's chevron while hovered or
 * reached from the keyboard, and folded, the count after its name. A press
 * unfolds the list beneath it, and each archived plan opens and offers its
 * actions like any other, flat and naming its repository. It draws nothing
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
      {unfolded ? <PlanRows rows={archived} repositoryShown context={context} /> : null}
    </div>
  );
}

/**
 * The window's left column: Luke, the way to a new plan, Search, which
 * opens the command palette, every plan the account owns, and the account's
 * row that leads to Settings. The pinned
 * plans stand in a section of their own above the rest while any are pinned,
 * newest pinned first and each naming its repository; the rest are grouped
 * under their repositories' headers, the pinned repositories first, newest
 * pinned first, then the group updated most recently first;
 * and the archived ones are folded away under them all.
 * It is where the developer moves between things; what they work on is the
 * column beside it.
 * A plan's actions are a right-click on it away, whether or not it is open.
 * The strip above Luke is the window's drag handle and the traffic lights'
 * room, with back and forward at its right. Its right edge resizes it, and a drag well past its least width
 * folds it away. Folded away, it is inert as well as out of sight, so no key
 * reaches a row nobody can see.
 */
export function DesktopSidebar({
  sidebar,
  identity,
  history,
  plans,
  tab,
  onTabChange,
  account,
  updates,
}: {
  sidebar: SidebarCollapse;
  identity: LukeIdentityProps;
  history: NavigationHistory;
  plans: PlansControl;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  account: AccountSnapshot;
  updates: UpdateControl;
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
  const context: RowContext = {
    plans,
    current,
    onOpen: openPlan,
    unread,
    now,
    inSight: !sidebar.collapsed,
  };
  const pinned = plans.plans.filter((plan) => plan.pinnedAt !== undefined);
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
    ...pinned,
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
  // Note that the gear's dot wears the update row's own words, so its hover
  // and the row it leads to tell one story, and that it stands down while the
  // release has its own control above it, so the news is said once.
  const { update } = updates;
  const settingsNote =
    updateAvailable(update) && !updateInSidebar(update) ? updateRow(update).detail : undefined;
  useAppCommand(APP_COMMAND.PREVIOUS_PLAN, listed && at >= 0 ? () => step(-1) : undefined);
  useAppCommand(APP_COMMAND.NEXT_PLAN, listed && at < drawn.length - 1 ? () => step(1) : undefined);

  return (
    <aside className="desktop-sidebar" inert={sidebar.collapsed}>
      <div className="desktop-drag-strip" />
      <HistoryButtons history={history} />
      <LukeIdentity {...identity} />

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

      {/* One scroller for both sections, so the pinned plans scroll away
          with the rest rather than holding half the column. */}
      <div className="sidebar-section">
        {plans.signedIn && pinned.length > 0 ? (
          <nav className="sidebar-group" aria-label="Pinned">
            <h2 className="sidebar-heading">Pinned</h2>
            <PlanRows rows={pinned} repositoryShown context={context} />
          </nav>
        ) : null}
        <nav className="sidebar-group" aria-label="Plans">
          <h2 className="sidebar-heading">Plans</h2>
          {plans.listFailed ? (
            <p className="sidebar-note" role="alert">
              Your plans could not be read.{" "}
              <button type="button" className="link-button" onClick={plans.onRetryList}>
                Try again
              </button>
            </p>
          ) : null}
          {plans.signedIn &&
          plans.plans.length === 0 &&
          plans.archived.length === 0 &&
          !plans.listFailed ? (
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
        <SidebarUpdate updates={updates} />
        <AccountButton
          account={account}
          current={tab === PANEL_TAB.SETTINGS}
          settingsNote={settingsNote}
          onPress={() => onTabChange(PANEL_TAB.SETTINGS)}
        />
      </div>
      {/* Last, so the drag strip above Luke does not take the edge's top from it. */}
      <SidebarResizeEdge edge={edge} />
    </aside>
  );
}
