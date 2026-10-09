import { ACCOUNT_STATUS, type AccountProvider } from "@sidecar/credentials/snapshot";
import { ComposeIcon, SidebarIcon } from "@sidecar/panel";
import type { FaceMotion } from "@sidecar/surface";
import { useRef } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import type { NavigationHistory } from "../navigation-history";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { DOCUMENT_REGION, PLANS_PAGE } from "../planning/planning-model";
import type { PlansControl } from "../planning/use-plans-tab";
import type { SettingsPanelProps } from "../settings/settings-panel";
import { SETTINGS_VIEW } from "../settings-views";
import { SignInGate } from "../sign-in-gate";
import { Tooltip } from "../tooltip";
import { updateAvailable, updateRow } from "../update-row";
import { DesktopPlans } from "./desktop-plans";
import { DesktopSettings } from "./desktop-settings";
import { DesktopSidebar } from "./desktop-sidebar";
import type { LukeIdentityProps } from "./luke-identity";
import { PaneGlide } from "./pane-motion";
import { SidePanelToggle } from "./side-panel";
import type { SidebarCollapse } from "./sidebar-collapse";

/** What stands between the developer and the window's own content: the account sign-in. */
export interface DesktopGates {
  accountRequired: boolean;
  /** Whose sign-in the gate is waiting on in the browser. */
  signInWait?: AccountProvider | undefined;
  signInFailure?: string | undefined;
  onBeginSignIn: (provider: AccountProvider) => void;
  onCancelSignIn: () => void;
  /** The signed-out Luke's introduction cycle, walked over the sign-in. */
  signInFace: { play: number; motion?: FaceMotion };
}

/**
 * Folds the sidebar away and back. It stands beside the traffic lights rather
 * than in the sidebar, so it is in the same place whichever way the sidebar
 * is, and the plan's toolbar leaves it room while the sidebar is folded. It
 * stands only where there is a sidebar to fold, so it offers the chord too.
 */
function SidebarToggle({ sidebar }: { sidebar: SidebarCollapse }): React.JSX.Element {
  const label = sidebar.collapsed ? "Show sidebar" : "Hide sidebar";
  useAppCommand(APP_COMMAND.TOGGLE_SIDEBAR, sidebar.onToggle);
  return (
    <Tooltip label={label} command={APP_COMMAND.TOGGLE_SIDEBAR}>
      <button
        type="button"
        className="toolbar-button toolbar-icon-button"
        aria-label={label}
        onClick={sidebar.onToggle}
      >
        <SidebarIcon />
      </button>
    </Tooltip>
  );
}

/**
 * The shortcuts that reach a place from anywhere past the sign-in: a new
 * plan, Settings, the Keyboard shortcuts page that lists them all, and back
 * and forward, which answer whether or not their buttons are drawn.
 */
function usePlaceCommands(
  pastGate: boolean,
  tab: PanelTab,
  onTabChange: (tab: PanelTab) => void,
  plans: PlansControl,
  settings: SettingsPanelProps,
  history: NavigationHistory,
): void {
  useAppCommand(APP_COMMAND.BACK, pastGate && history.canGoBack ? history.onBack : undefined);
  useAppCommand(
    APP_COMMAND.FORWARD,
    pastGate && history.canGoForward ? history.onForward : undefined,
  );
  useAppCommand(
    APP_COMMAND.NEW_PLAN,
    pastGate && plans.signedIn
      ? () => {
          if (tab !== PANEL_TAB.PLANS) onTabChange(PANEL_TAB.PLANS);
          plans.onNewPlan();
        }
      : undefined,
  );
  useAppCommand(APP_COMMAND.SETTINGS, pastGate ? () => onTabChange(PANEL_TAB.SETTINGS) : undefined);
  useAppCommand(
    APP_COMMAND.KEYBOARD_SHORTCUTS,
    pastGate
      ? () => {
          // Arriving at Settings lands on its front page, so the page is
          // turned after.
          onTabChange(PANEL_TAB.SETTINGS);
          settings.onViewChange(SETTINGS_VIEW.SHORTCUTS);
        }
      : undefined,
  );
}

/**
 * The sidebar's New plan, kept in reach while the sidebar is folded: an icon
 * beside the toggle, the way a chat app keeps its compose button beside its
 * own. It asks for exactly what the sidebar's button asks for, so the shell
 * leaves it out on the new-plan page, where it would ask for the page it is on.
 */
function TitleBarNewPlan({ plans }: { plans: PlansControl }): React.JSX.Element {
  return (
    <Tooltip label="New plan" command={APP_COMMAND.NEW_PLAN}>
      <button
        type="button"
        className="toolbar-button toolbar-icon-button"
        aria-label="New plan"
        disabled={!plans.signedIn}
        onClick={plans.onNewPlan}
      >
        <ComposeIcon />
      </button>
    </Tooltip>
  );
}

/**
 * Luke's window: the sidebar on the left and the chosen work on the right,
 * or the sign-in over the whole window while no account stands. Every
 * press is the control's it came from; this only lays them out. Settings
 * keeps its page list whatever the sidebar's collapse says, and hands the
 * plans back folded or not as it found them. The side panel's toggle is the
 * mirror of the sidebar's, at the window's top right on a plan's page, so
 * neither pane carries the button that moves it. Folding the sidebar, or
 * opening, shutting, or growing the side panel, glides the work beside them
 * (pane-motion.tsx). Back and forward ride the left column's title-bar row,
 * the plans' sidebar or Settings' page list alike, and leaving Settings is
 * going back to wherever it was opened from, or to the plans when nothing
 * stands behind it.
 */
export function DesktopShell({
  gates,
  identity,
  tab,
  onTabChange,
  plans,
  history,
  sidebar,
  settings,
  onSettingsSearchEngaged,
}: {
  gates: DesktopGates;
  identity: LukeIdentityProps;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  plans: PlansControl;
  history: NavigationHistory;
  sidebar: SidebarCollapse;
  settings: SettingsPanelProps;
  /** The caret entering or leaving the settings search, which holds the panel open. */
  onSettingsSearchEngaged: (engaged: boolean) => void;
}): React.JSX.Element {
  const { account } = settings;
  const shell = useRef<HTMLDivElement>(null);
  const gated = gates.accountRequired && account.status !== ACCOUNT_STATUS.SIGNED_IN;
  usePlaceCommands(!gated, tab, onTabChange, plans, settings, history);
  if (gated) {
    return (
      <div className="desktop-onboarding">
        <div className="desktop-drag-strip" />
        <SignInGate
          account={account}
          face={gates.signInFace}
          {...(gates.signInWait ? { waiting: gates.signInWait } : undefined)}
          {...(gates.signInFailure ? { failure: gates.signInFailure } : undefined)}
          onBegin={gates.onBeginSignIn}
          onCancel={gates.onCancelSignIn}
        />
      </div>
    );
  }
  // Settings wears the update row's own words, so the dot's hover and the
  // row it leads to tell one story about the same release.
  const settingsNote = updateAvailable(settings.updates.update)
    ? updateRow(settings.updates.update).detail
    : undefined;
  // Settings takes the whole window, its pages listed where the plans were.
  if (tab === PANEL_TAB.SETTINGS) {
    return (
      <div className="desktop-shell">
        <DesktopSettings
          sidebar={sidebar}
          history={history}
          settings={settings}
          onSearchEngaged={onSettingsSearchEngaged}
          onExit={history.canGoBack ? history.onBack : () => onTabChange(PANEL_TAB.PLANS)}
        />
      </div>
    );
  }
  // Note that the shell says whether the panel's toggle stands, because the
  // toolbar beneath it leaves the toggle room then and only then.
  const panelToggle = plans.page === PLANS_PAGE.DOCUMENT;
  return (
    <div
      ref={shell}
      className="desktop-shell"
      data-sidebar-collapsed={String(sidebar.collapsed)}
      data-panel-toggle={String(panelToggle)}
    >
      <DesktopSidebar
        sidebar={sidebar}
        identity={identity}
        history={history}
        plans={plans}
        tab={tab}
        onTabChange={onTabChange}
        account={account}
        settingsNote={settingsNote}
      />
      <main className="desktop-main">
        <DesktopPlans plans={plans} />
      </main>
      {/* Note that they follow the drag strips they cover, because a later drag region wins. */}
      <div className="title-bar-controls">
        <SidebarToggle sidebar={sidebar} />
        {sidebar.collapsed && plans.page !== PLANS_PAGE.NEW ? (
          <TitleBarNewPlan plans={plans} />
        ) : null}
      </div>
      {panelToggle ? (
        <div className="title-bar-controls" data-edge="end">
          <SidePanelToggle
            panel={plans.sidePanel}
            disabled={plans.region.kind !== DOCUMENT_REGION.READY}
          />
        </div>
      ) : null}
      <PaneGlide
        root={shell}
        layout={{
          sidebarCollapsed: sidebar.collapsed,
          panelOpen: plans.sidePanel.open,
          panelFullScreen: plans.sidePanel.fullScreen,
        }}
      />
    </div>
  );
}
