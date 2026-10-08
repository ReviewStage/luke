import { ACCOUNT_STATUS, type AccountSnapshot } from "@sidecar/credentials/snapshot";
import { GearIcon, PlusIcon, UserIcon } from "@sidecar/panel";
import { useState } from "react";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { PLANS_PAGE } from "../planning/planning-model";
import type { PlansControl } from "../planning/use-plans-tab";
import { LukeIdentity, type LukeIdentityProps } from "./luke-identity";
import { SidebarPlan } from "./plan-actions";

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
    <button
      type="button"
      className="sidebar-item sidebar-account"
      aria-current={current ? "page" : undefined}
      title="Settings"
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
  );
}

/**
 * The window's left column: Luke, the way to a new plan, every plan the
 * account owns, and the account's row that leads to Settings. It is where the
 * developer moves between things; what they work on is the column beside it.
 * A plan's actions are a right-click on it away, whether or not it is open.
 * The strip above Luke is the window's drag handle and the traffic lights'
 * room. Folded away, it is inert as well as out of sight, so no key reaches
 * a row nobody can see.
 */
export function DesktopSidebar({
  collapsed,
  identity,
  plans,
  tab,
  onTabChange,
  account,
  settingsNote,
}: {
  collapsed: boolean;
  identity: LukeIdentityProps;
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

  return (
    <aside className="desktop-sidebar" inert={collapsed}>
      <div className="desktop-drag-strip" />
      <LukeIdentity {...identity} />

      <button
        type="button"
        className="sidebar-new-plan"
        aria-current={composing ? "page" : undefined}
        disabled={!plans.signedIn}
        onClick={newPlan}
      >
        <PlusIcon />
        New plan
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
    </aside>
  );
}
