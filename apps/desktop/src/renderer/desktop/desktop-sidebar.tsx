import { ACCOUNT_STATUS, type AccountSnapshot } from "@sidecar/credentials/snapshot";
import { OptionsIcon, PlusIcon } from "@sidecar/panel";
import { PANEL_TAB, type PanelTab, type ShownPanelTab } from "../panel-tabs";
import { folderLine, PLANS_PAGE } from "../planning/planning-model";
import type { PlansControl } from "../planning/use-plans-tab";
import { LukeIdentity, type LukeIdentityProps } from "./luke-identity";

/**
 * The window's left column: Luke, the way to a new plan, every plan the
 * account owns, and Settings with the account under it. It is where the
 * developer moves between things; what they work on is the column beside it.
 * The strip above Luke is the window's drag handle and the traffic lights'
 * room.
 */
export function DesktopSidebar({
  identity,
  plans,
  tab,
  onTabChange,
  account,
  settingsNote,
}: {
  identity: LukeIdentityProps;
  plans: PlansControl;
  tab: PanelTab;
  onTabChange: (tab: ShownPanelTab) => void;
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
  // An open plan holds the page over the form, so starting another leaves it.
  const newPlan = () => {
    if (!onPlans) onTabChange(PANEL_TAB.PLANS);
    if (plans.page === PLANS_PAGE.DOCUMENT) plans.onLeavePlan();
    plans.onNewPlan();
  };

  return (
    <aside className="desktop-sidebar">
      <div className="desktop-drag-strip" />
      <LukeIdentity {...identity} />

      <button
        type="button"
        className="sidebar-new-plan"
        data-active={String(composing)}
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
            <li key={plan.id}>
              <button
                type="button"
                className="sidebar-plan"
                aria-current={
                  onPlans && !composing && plan.id === plans.activePlanId ? "page" : undefined
                }
                onClick={() => openPlan(plan.id)}
              >
                <span className="sidebar-plan-name">{plan.name}</span>
                {plans.folders[plan.id] !== undefined ? (
                  <span className="sidebar-plan-repository">
                    {folderLine(plans.folders[plan.id] ?? "")}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="sidebar-foot">
        <button
          type="button"
          className="sidebar-item"
          aria-current={tab === PANEL_TAB.SETTINGS ? "page" : undefined}
          onClick={() => onTabChange(PANEL_TAB.SETTINGS)}
        >
          <OptionsIcon />
          Settings
          {settingsNote ? (
            <span className="tab-note" title={settingsNote}>
              <span className="visually-hidden">({settingsNote})</span>
            </span>
          ) : null}
        </button>
        {account.status === ACCOUNT_STATUS.SIGNED_IN ? (
          <div className="sidebar-account">
            <span className="sidebar-avatar" aria-hidden="true">
              {(account.name ?? account.email).slice(0, 1).toUpperCase()}
            </span>
            <span className="sidebar-account-copy">
              <span className="sidebar-account-name">{account.name ?? account.email}</span>
              {account.name ? <span className="sidebar-account-email">{account.email}</span> : null}
            </span>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
