import { ACCOUNT_STATUS, type AccountSnapshot } from "@sidecar/credentials/snapshot";
import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  ComposeIcon,
  GearIcon,
  PlusIcon,
  UpdateIcon,
  UserIcon,
} from "@sidecar/panel";
import { useState } from "react";
import { UPDATE_STATUS } from "#shared/messages/update";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import type { NavigationHistory } from "../navigation-history";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { useMinute } from "../planning/plan-time";
import {
  PLANS_PAGE,
  type RepositoryGroup,
  repositoryGroups,
  repositoryLabel,
} from "../planning/planning-model";
import type { PlansControl } from "../planning/use-plans-tab";
import type { UpdateControl } from "../settings/controls";
import { commandKeyshortcuts, ShortcutGlyphs, Tooltip } from "../tooltip";
import { updateAvailable, updateInSidebar, updateRow } from "../update-row";
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
  /** The time each row's last update is counted back from. */
  readonly now: number;
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
          repositoryShown={repositoryShown}
          now={context.now}
          onOpen={() => context.onOpen(plan.id)}
        />
      ))}
    </ul>
  );
}

/**
 * One repository's plans under a quiet header in the headings' voice, which
 * folds and unfolds them, the fold kept across launches. A repository's
 * header also offers a + that starts a new plan with that repository
 * already chosen, shown while the header is hovered or holds focus, the way
 * Codex and Cursor reveal a row's actions; it stands beside the fold rather
 * than inside it, so pressing it folds nothing. The plans with no
 * repository stand under "No repository", with nothing to preset.
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
  const named = repository ?? NO_REPOSITORY;
  return (
    <div className="sidebar-repository">
      <div className="sidebar-repository-header">
        <Tooltip label={repository === null || label === repository ? undefined : repository}>
          <button
            type="button"
            className="sidebar-repository-toggle"
            aria-expanded={!folded}
            onClick={() => folds.toggle(repository)}
          >
            <ChevronRightIcon />
            <span className="sidebar-repository-name">{repository === null ? named : label}</span>
          </button>
        </Tooltip>
        {repository === null ? null : (
          <Tooltip label={`New plan in ${label}`}>
            <button
              type="button"
              className="icon-button sidebar-repository-new"
              aria-label={`New plan in ${label}`}
              onClick={() => onNewPlanIn(repository)}
            >
              <PlusIcon />
            </button>
          </Tooltip>
        )}
      </div>
      {folded ? null : <PlanRows rows={group.plans} repositoryShown={false} context={context} />}
    </div>
  );
}

/**
 * The plans under Archived, folded away behind one quiet row that counts
 * them, the way Codex and ChatGPT keep theirs: a press on the row unfolds
 * the list beneath it, and each archived plan opens and offers its actions
 * like any other, flat and naming its repository. It draws nothing while no
 * plan is archived, and it starts folded, because an archived plan is one
 * the developer put out of the way.
 */
function ArchivedPlans({ context }: { context: RowContext }): React.JSX.Element | null {
  const [unfolded, setUnfolded] = useState(false);
  const { archived, markNotes } = context.plans;
  // A refusal noted on an archived plan unfolds the list, so the note under
  // its row is seen even where the list was folded while the ask was out.
  const noted = archived.some((plan) => markNotes.has(plan.id));
  const [notedBefore, setNotedBefore] = useState(false);
  if (noted !== notedBefore) {
    setNotedBefore(noted);
    if (noted) setUnfolded(true);
  }
  if (archived.length === 0) return null;
  return (
    <div className="sidebar-archived">
      <button
        type="button"
        className="sidebar-archived-row"
        aria-expanded={unfolded}
        onClick={() => setUnfolded((was) => !was)}
      >
        <ChevronRightIcon />
        Archived ({archived.length})
      </button>
      {unfolded ? <PlanRows rows={archived} repositoryShown context={context} /> : null}
    </div>
  );
}

/**
 * The window's left column: Luke, the way to a new plan, every plan the
 * account owns, and the account's row that leads to Settings. The pinned
 * plans stand in a section of their own above the rest while any are pinned,
 * newest pinned first and each naming its repository; the rest are grouped
 * under their repositories' headers, the group updated most recently first;
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
  const now = useMinute();
  const edge = useSidebarEdge(sidebar, sidebar.onToggle);
  const current = (planId: string) => onPlans && !composing && planId === plans.activePlanId;
  const context: RowContext = { plans, current, onOpen: openPlan, now };
  const pinned = plans.plans.filter((plan) => plan.pinnedAt !== undefined);
  const groups = repositoryGroups(plans.plans.filter((plan) => plan.pinnedAt === undefined));
  // The rows as the list draws them: the pinned, then each group not folded
  // away, the open plan standing in its place even under a fold, so walking
  // the list still moves from it.
  const drawn = [
    ...pinned,
    ...groups.flatMap((group) =>
      folds.folded(group.repository)
        ? group.plans.filter((plan) => plan.id === plans.activePlanId)
        : group.plans,
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
