import { ACCOUNT_STATUS, type AccountSnapshot } from "@sidecar/credentials/snapshot";
import { ArrowLeftIcon, ArrowRightIcon, ComposeIcon, GearIcon, UserIcon } from "@sidecar/panel";
import { useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import type { NavigationHistory } from "../navigation-history";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { PLANS_PAGE } from "../planning/planning-model";
import type { PlansControl } from "../planning/use-plans-tab";
import { commandKeyshortcuts, ShortcutGlyphs, Tooltip } from "../tooltip";
import { LukeIdentity, type LukeIdentityProps } from "./luke-identity";
import { SidebarPlan } from "./plan-actions";
import { SIDEBAR_WIDTH, type SidebarCollapse } from "./sidebar-collapse";
import { EDGE_SIDE, type ResizableEdgeProps, useResizableEdge } from "./use-resizable-edge";

/**
 * What the sidebar leaves the work column beside it, in CSS pixels: the
 * sidebar is dragged no wider than the window less this.
 */
const WORK_RESERVE = 360;

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
    reserve: WORK_RESERVE,
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
          className="toolbar-button toolbar-icon-button"
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
          className="toolbar-button toolbar-icon-button"
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
 * The foot of the column: one row that is who is signed in and the way to
 * Settings at once, the way every desktop devtool keeps it. Signed out it
 * names where it leads instead. The update dot rides on the gear, since
 * Settings is where the waiting release is installed.
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

/**
 * The window's left column: Luke, the way to a new plan, every plan the
 * account owns, and the account's row that leads to Settings. It is where the
 * developer moves between things; what they work on is the column beside it.
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
  settingsNote,
}: {
  sidebar: SidebarCollapse;
  identity: LukeIdentityProps;
  history: NavigationHistory;
  plans: PlansControl;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  account: AccountSnapshot;
  /** News Settings wears as a dot: a newer release waiting. */
  settingsNote: string | undefined;
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
  const edge = useSidebarEdge(sidebar, sidebar.onToggle);
  // Moving up and down the list as it reads, New plan at its head: up from
  // the first plan is the new-plan page, and down from that page is the
  // first plan. The ends go no further.
  const at = composing ? -1 : plans.plans.findIndex((plan) => plan.id === plans.activePlanId);
  const step = (by: number) => {
    const next = at + by;
    if (next === -1) newPlan();
    const plan = plans.plans[next];
    if (plan !== undefined) openPlan(plan.id);
  };
  const listed = plans.signedIn && plans.plans.length > 0;
  useAppCommand(APP_COMMAND.PREVIOUS_PLAN, listed && at >= 0 ? () => step(-1) : undefined);
  useAppCommand(
    APP_COMMAND.NEXT_PLAN,
    listed && at < plans.plans.length - 1 ? () => step(1) : undefined,
  );

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

      <nav className="sidebar-section" aria-label="Plans">
        <h2 className="sidebar-heading">Plans</h2>
        {plans.listFailed ? (
          <p className="sidebar-note" role="alert">
            Your plans could not be read.{" "}
            <button type="button" className="link-button" onClick={plans.onRetryList}>
              Try again
            </button>
          </p>
        ) : null}
        {plans.signedIn && plans.plans.length === 0 && !plans.listFailed ? (
          <p className="sidebar-note">No plans yet.</p>
        ) : null}
        {plans.signedIn ? null : <p className="sidebar-note">Sign in to plan a feature.</p>}
        <ul className="sidebar-plans">
          {plans.plans.map((plan) => (
            <SidebarPlan
              key={plan.id}
              plans={plans}
              plan={plan}
              current={onPlans && !composing && plan.id === plans.activePlanId}
              onOpen={() => openPlan(plan.id)}
            />
          ))}
        </ul>
      </nav>

      <div className="sidebar-foot">
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
