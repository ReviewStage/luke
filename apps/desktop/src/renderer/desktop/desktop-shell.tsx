import { ACCOUNT_STATUS, type AccountProvider } from "@sidecar/credentials/snapshot";
import { ComposeIcon, SidebarIcon } from "@sidecar/panel";
import type { FaceMotion } from "@sidecar/surface";
import { useRef } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { CALL_CARD_SURFACE, CallCardDock, type CallCardInput } from "../call/call-card";
import { CaptionStrip, type CaptionStripProps } from "../caption-strip";
import type { NavigationHistory, WindowHistory } from "../navigation-history";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { DOCUMENT_REGION, PLANS_PAGE } from "../planning/planning-model";
import { TRANSCRIPT_REGION } from "../planning/transcript-model";
import { usePlanLooks } from "../planning/use-plan-looks";
import type { PlansControl } from "../planning/use-plans-tab";
import { SIDE_PANEL_TAB } from "../planning/use-side-panel";
import type { SettingsPanelProps } from "../settings/settings-panel";
import { SETTINGS_VIEW } from "../settings-views";
import { SignInGate } from "../sign-in-gate";
import { Tooltip } from "../tooltip";
import { useColumnDock } from "./column-dock";
import { DesktopInbox } from "./desktop-inbox";
import { DesktopPlans } from "./desktop-plans";
import { DesktopSettings } from "./desktop-settings";
import { DesktopSidebar } from "./desktop-sidebar";
import { DesktopVersionHistory, planVersionSubject } from "./desktop-version-history";
import { PaneGlide } from "./pane-motion";
import { useSummaryPin } from "./plan-summary";
import { SidePanelToggle } from "./side-panel";
import type { SidebarCollapse } from "./sidebar-collapse";

/** What stands between the developer and the window's own content: the account sign-in. */
export interface DesktopGates {
  accountRequired: boolean;
  /** Whose sign-in the gate is waiting on in the browser. */
  signInWait?: AccountProvider | undefined;
  signInFailure?: string | undefined;
  /** The provider this Mac last signed in with, which the gate marks. */
  lastSignIn?: AccountProvider | undefined;
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
      <button type="button" className="icon-button" aria-label={label} onClick={sidebar.onToggle}>
        <SidebarIcon />
      </button>
    </Tooltip>
  );
}

/**
 * The shortcuts that reach a place from anywhere past the sign-in: a new
 * plan, Settings, the Inbox, the Keyboard shortcuts page that lists them
 * all, and back and forward, which answer whether or not their buttons are
 * drawn.
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
    APP_COMMAND.INBOX,
    pastGate && plans.signedIn
      ? () => {
          if (tab !== PANEL_TAB.PLANS) onTabChange(PANEL_TAB.PLANS);
          plans.inboxView.onOpen();
        }
      : undefined,
  );
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
        className="icon-button"
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
 * Whether the open plan's Transcript is on screen with its words, streaming
 * a call's as they are said. A Transcript tab standing behind another chosen
 * tab is not on screen, and one still reading, or failed, shows no words.
 */
function transcriptStreaming(plans: PlansControl): boolean {
  const { sidePanel, transcript } = plans;
  return (
    sidePanel.open &&
    sidePanel.tab === SIDE_PANEL_TAB.TRANSCRIPT &&
    transcript.region.kind === TRANSCRIPT_REGION.READY
  );
}

/**
 * Luke's window: the sidebar on the left and the chosen work on the right,
 * or the sign-in over the whole window while no account stands. Every
 * press is the control's it came from; this only lays them out. Settings
 * keeps its page list whatever the sidebar's collapse says, and hands the
 * plans back folded or not as it found them. The side panel's toggle is the
 * mirror of the sidebar's, at the window's top right on a plan's page, so
 * neither pane carries the button that moves it. A plan's version history
 * takes the whole window as Settings does, its versions listed where the
 * sidebar was, and leaves the same way; the Inbox stands in the plan's
 * place beside the sidebar (`desktop-inbox.tsx`); it is still a stay on the plan, so
 * what changed since the developer last looked is held here, across it,
 * rather than by the plan's page (`use-plan-looks.ts`). Folding the sidebar,
 * opening, shutting, or growing the side panel, or the plan's summary pinned
 * or folded to its rail, by a press or by its column's room
 * (plan-summary.tsx), glides the work beside them (pane-motion.tsx). Back and forward ride the left column's title-bar row,
 * the plans' sidebar or Settings' page list alike, and leaving Settings is
 * going back to wherever it was opened from, or to the plans when nothing
 * stands behind it. The live captions ride the call bar while the plan's
 * column is drawn, and float at the window's foot wherever else a call can
 * still be heard; they hold back spoken words while the plan's Transcript
 * is on screen streaming the same ones.
 */
export function DesktopShell({
  gates,
  tab,
  onTabChange,
  plans,
  history,
  sidebar,
  call,
  captions,
  settings,
}: {
  gates: DesktopGates;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  plans: PlansControl;
  history: WindowHistory;
  sidebar: SidebarCollapse;
  /** The call card, while this window is to draw one; docked by the shell wherever the window stands. */
  call: CallCardInput | undefined;
  captions: CaptionStripProps;
  settings: SettingsPanelProps;
}): React.JSX.Element {
  const { account } = settings;
  const shell = useRef<HTMLDivElement>(null);
  // A fixture run keeps the summary's pin as it keeps the sidebar's fold: not at all.
  const summary = useSummaryPin(sidebar.staged);
  const gated = gates.accountRequired && account.status !== ACCOUNT_STATUS.SIGNED_IN;
  usePlaceCommands(!gated, tab, onTabChange, plans, settings, history);
  const { region } = plans;
  // The folded sidebar's call card stands over the column's foot, clear of its dock.
  useColumnDock(
    shell,
    plans.sidePanel.fullScreen,
    `${tab}:${plans.page}:${plans.history.open}:${plans.inboxView.open}:${sidebar.collapsed}`,
  );
  // The plan is looked at only while it is on screen, which the Inbox standing in its place is not.
  const looks = usePlanLooks(
    tab === PANEL_TAB.PLANS && !plans.inboxView.open && region.kind === DOCUMENT_REGION.READY
      ? region.plan
      : undefined,
  );
  if (gated) {
    return (
      <div className="desktop-onboarding">
        <div className="desktop-drag-strip" />
        <SignInGate
          account={account}
          face={gates.signInFace}
          {...(gates.signInWait ? { waiting: gates.signInWait } : undefined)}
          {...(gates.signInFailure ? { failure: gates.signInFailure } : undefined)}
          {...(gates.lastSignIn ? { lastUsed: gates.lastSignIn } : undefined)}
          onBegin={gates.onBeginSignIn}
          onCancel={gates.onCancelSignIn}
        />
      </div>
    );
  }
  // Settings takes the whole window, its pages listed where the plans were.
  if (tab === PANEL_TAB.SETTINGS) {
    return (
      <div className="desktop-shell">
        <DesktopSettings
          sidebar={sidebar}
          history={history}
          settings={settings}
          call={call}
          onExit={history.canGoBack ? history.onBack : () => onTabChange(PANEL_TAB.PLANS)}
        />
        <CaptionStrip {...captions} />
      </div>
    );
  }
  // A plan's version history takes the whole window too, its versions listed
  // where the sidebar was, and hands the plan back as it found it.
  if (plans.history.open) {
    return (
      <div className="desktop-shell">
        <DesktopVersionHistory
          sidebar={sidebar}
          history={history}
          subject={planVersionSubject(plans)}
          account={account}
          onExit={history.canGoBack ? history.onBack : plans.history.onClose}
          onRestored={history.onLeaveVersionHistory}
        />
        <CallCardDock call={call} surface={CALL_CARD_SURFACE.FLOATING} />
        <CaptionStrip {...captions} />
      </div>
    );
  }
  // Note that the shell says whether the panel's toggle stands, because the
  // toolbar beneath it leaves the toggle room then and only then. The Inbox
  // stands in the plan's place, so it draws no panel to toggle.
  const inboxOpen = plans.inboxView.open;
  const panelToggle = plans.page === PLANS_PAGE.DOCUMENT && !inboxOpen;
  const planDrawn = panelToggle && plans.region.kind === DOCUMENT_REGION.READY;
  // Note that a panel filling the window hides the plan's column, call bar
  // and all, so the captions float in its place then.
  const captionsInColumn = planDrawn && !plans.sidePanel.fullScreen;
  const captionStrip = (
    <CaptionStrip {...captions} speechHidden={planDrawn && transcriptStreaming(plans)} />
  );
  return (
    <div
      ref={shell}
      className="desktop-shell"
      data-sidebar-collapsed={String(sidebar.collapsed)}
      data-panel-toggle={String(panelToggle)}
    >
      <DesktopSidebar
        sidebar={sidebar}
        history={history}
        plans={plans}
        tab={tab}
        onTabChange={onTabChange}
        account={account}
        updates={settings.updates}
        onSignOut={settings.onSignOut}
        call={sidebar.collapsed ? undefined : call}
      />
      <main className="desktop-main">
        {inboxOpen ? (
          <DesktopInbox plans={plans} />
        ) : (
          <DesktopPlans
            plans={plans}
            looks={looks}
            captions={captionsInColumn ? captionStrip : undefined}
            summary={summary}
          />
        )}
      </main>
      {captionsInColumn ? null : captionStrip}
      {/* Folded, the sidebar's card floats in the corner it would have stood over. */}
      <CallCardDock
        call={sidebar.collapsed ? call : undefined}
        surface={CALL_CARD_SURFACE.FLOATING}
      />
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
          summaryPinned: summary.pinned && summary.wide,
        }}
      />
    </div>
  );
}
