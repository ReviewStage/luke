import type { FaceMotion } from "@luke/brand";
import { ACCOUNT_STATUS, type AccountProvider } from "@luke/credentials/snapshot";
import type { Plan } from "@luke/features/plan-wire";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { ComposeIcon, SidebarIcon } from "@luke/ui";
import { TRANSCRIPT_REGION } from "@luke/voice/transcript-model";
import { lazy, Suspense, useEffect, useRef } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { CALL_CARD_SURFACE, CallCardDock, type CallCardInput } from "../call/call-card";
import { CaptionStrip, type CaptionStripProps } from "../caption-strip";
import type { NavigationHistory, WindowHistory } from "../navigation-history";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { NewPlanDialog } from "../planning/new-plan-dialog";
import { DOCUMENT_REGION, PLANS_PAGE } from "../planning/planning-model";
import { usePlanLooks } from "../planning/use-plan-looks";
import type { PlansControl } from "../planning/use-plans-tab";
import { SIDE_PANEL_TAB } from "../planning/use-side-panel";
import type { SettingsPanelProps } from "../settings/settings-panel";
import { SignInGate } from "../sign-in-gate";
import { Tooltip } from "../tooltip";
import { useColumnDock } from "./column-dock";
import { DesktopInbox } from "./desktop-inbox";
import { DesktopPlans } from "./desktop-plans";
import { DesktopSidebar } from "./desktop-sidebar";
import { DesktopVersionHistory, planVersionSubject } from "./desktop-version-history";
import { PaneGlide } from "./pane-motion";
import { useSummaryPin } from "./plan-summary";
import { SidePanelToggle } from "./side-panel";
import { SIDEBAR_OVERLAY, type SidebarCollapse } from "./sidebar-collapse";
import { useWindowTitle } from "./window-title";

/**
 * Settings, loaded as a chunk of its own the first time it opens rather than
 * with the window, because the renderer bundle is parsed at every window
 * open, the voice window's included, and Settings is opened seldom
 * (`bundle-budget.json`). The chunk is a local file, so it stands a frame
 * later, over nothing in the meantime.
 */
const DesktopSettings = lazy(() =>
  import("./desktop-settings").then((loaded) => ({ default: loaded.DesktopSettings })),
);

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
 * Folds the sidebar away and back, or in a window too narrow to pin it,
 * floats it open over the work and puts it away. It stands beside the
 * traffic lights rather than in the sidebar, so it is in the same place
 * whichever way the sidebar is, and the plan's toolbar leaves it room while
 * the sidebar is folded; in full screen, where macOS hides the lights, it
 * takes their place at the window's edge (`window-full-screen.ts`). It
 * stands only where there is a sidebar to fold, so it offers the chord too.
 * A peek is not yet open, so over one it still offers to show the sidebar.
 */
function SidebarToggle({ sidebar }: { sidebar: SidebarCollapse }): React.JSX.Element {
  const shown = !sidebar.collapsed || sidebar.overlay === SIDEBAR_OVERLAY.OPEN;
  const label = shown ? "Hide sidebar" : "Show sidebar";
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
 * plan, Settings, the home page, the Inbox, the tab closed latest, opened again on its
 * plan, the Keyboard shortcuts page that lists them all, and back and
 * forward, which answer whether or not their buttons are drawn.
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
    APP_COMMAND.HOME,
    pastGate && plans.signedIn
      ? () => {
          if (tab !== PANEL_TAB.PLANS) onTabChange(PANEL_TAB.PLANS);
          plans.onGoHome();
        }
      : undefined,
  );
  useAppCommand(
    APP_COMMAND.INBOX,
    pastGate && plans.signedIn
      ? () => {
          if (tab !== PANEL_TAB.PLANS) onTabChange(PANEL_TAB.PLANS);
          plans.inboxView.onOpen();
        }
      : undefined,
  );
  const { onReopenClosedTab } = plans;
  useAppCommand(
    APP_COMMAND.REOPEN_CLOSED_TAB,
    pastGate && plans.signedIn && onReopenClosedTab !== undefined
      ? () => {
          if (tab !== PANEL_TAB.PLANS) onTabChange(PANEL_TAB.PLANS);
          onReopenClosedTab();
        }
      : undefined,
  );
  useAppCommand(
    APP_COMMAND.KEYBOARD_SHORTCUTS,
    pastGate
      ? () => {
          // Arriving at Settings lands on Account, so the page is turned
          // after.
          onTabChange(PANEL_TAB.SETTINGS);
          settings.onViewChange(SETTINGS_VIEW.SHORTCUTS);
        }
      : undefined,
  );
}

/**
 * The sidebar's New plan, kept in reach while the sidebar is folded: an icon
 * beside the toggle, the way a chat app keeps its compose button beside its
 * own. It asks for exactly what the sidebar's button asks for: the New plan
 * dialog, over whatever stands.
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
 * Puts the floating sidebar away at a press anywhere outside it and its
 * toggle, answering the handler they take the press with. Note that the
 * press is heard at the document as it bubbles, after the sidebar's own
 * handlers, so one inside it, a menu or a dialog it opened included, since
 * React carries their presses through the sidebar, is marked before the
 * document asks.
 */
function useOverlayDismiss(sidebar: SidebarCollapse): () => void {
  const within = useRef(false);
  const floating = sidebar.overlay !== SIDEBAR_OVERLAY.CLOSED;
  const { onOverlay } = sidebar;
  useEffect(() => {
    if (!floating) return;
    const press = () => {
      if (!within.current) onOverlay(SIDEBAR_OVERLAY.CLOSED);
      within.current = false;
    };
    document.addEventListener("pointerdown", press);
    return () => document.removeEventListener("pointerdown", press);
  }, [floating, onOverlay]);
  return () => {
    within.current = true;
  };
}

/**
 * Whether the open plan's Transcript is on screen with its words, streaming
 * a call's as they are said. A Call tab standing behind another chosen
 * tab is not on screen, and one still reading, or failed, shows no words.
 */
function transcriptStreaming(plans: PlansControl): boolean {
  const { sidePanel, transcript } = plans;
  return (
    sidePanel.open &&
    sidePanel.tab === SIDE_PANEL_TAB.CALL &&
    transcript.region.kind === TRANSCRIPT_REGION.READY
  );
}

/**
 * What the window's title names: Settings alone, whose pages are not one
 * workspace's; the Inbox in the listed workspace, whatever plan its item is
 * from; the plan on screen in its own workspace, or alone while that is not
 * read; else the listed workspace.
 */
function titleSubject(
  tab: PanelTab,
  plans: PlansControl,
  shownPlan: Plan | undefined,
): Parameters<typeof useWindowTitle>[0] {
  const { signedIn } = plans;
  if (tab === PANEL_TAB.SETTINGS) return { signedIn, subject: "Settings", workspace: undefined };
  if (plans.inboxView.open) return { signedIn, subject: "Inbox", workspace: plans.workspace };
  if (shownPlan === undefined) return { signedIn, subject: undefined, workspace: plans.workspace };
  // Note that a plan whose workspace is not read yet is named alone, because the listed one may not be its.
  const workspace = plans.workspaces.find((each) => each.id === shownPlan.workspaceId);
  return { signedIn, subject: shownPlan.name, workspace };
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
 * (plan-summary.tsx), glides the work beside them (pane-motion.tsx). A
 * window too narrow to pin the sidebar folds it, and a folded sidebar floats
 * over the work rather than beside it (`sidebar-collapse.ts`), put away by a
 * press outside it and its toggle. Back and forward ride the left column's title-bar row,
 * the plans' sidebar or Settings' page list alike, and leaving Settings is
 * going back to wherever it was opened from, or to the plans when nothing
 * stands behind it. New plan's dialog stands over the plans or a version
 * history, whichever is drawn (`new-plan-dialog.tsx`). The live captions ride the call bar while the plan's
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
  const keepOverlay = useOverlayDismiss(sidebar);
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
  // The window's title names what stands in it, the plan only while it is on screen, and its workspace.
  const shownPlan =
    tab === PANEL_TAB.PLANS && !plans.inboxView.open && region.kind === DOCUMENT_REGION.READY
      ? region.plan
      : undefined;
  useWindowTitle(titleSubject(tab, plans, shownPlan));
  // The plan is looked at only while it is on screen, which the Inbox standing in its place is not.
  const looks = usePlanLooks(shownPlan, plans.me);
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
        <Suspense fallback={null}>
          <DesktopSettings
            sidebar={sidebar}
            history={history}
            settings={settings}
            call={call}
            onExit={history.canGoBack ? history.onBack : () => onTabChange(PANEL_TAB.PLANS)}
          />
        </Suspense>
        <CaptionStrip {...captions} />
      </div>
    );
  }
  // New plan asks over whatever stands, the plans or a version history.
  const newPlanDialog = <NewPlanDialog newPlan={plans.newPlan} />;
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
        {newPlanDialog}
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
      data-sidebar-overlay={sidebar.overlay}
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
        onPressWithin={keepOverlay}
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
            accountName={account.status === ACCOUNT_STATUS.SIGNED_IN ? account.name : undefined}
          />
        )}
      </main>
      {captionsInColumn ? null : captionStrip}
      {/* Folded, the sidebar's card floats in the corner it would have stood over. */}
      <CallCardDock
        call={sidebar.collapsed ? call : undefined}
        surface={CALL_CARD_SURFACE.FLOATING}
      />
      {/* The folded sidebar peeks out while the pointer rests at the window's left edge, as Linear's does. */}
      {sidebar.collapsed && sidebar.overlay === SIDEBAR_OVERLAY.CLOSED ? (
        <div
          className="sidebar-peek-edge"
          data-sidebar-peek-edge=""
          onPointerEnter={() => sidebar.onOverlay(SIDEBAR_OVERLAY.PEEK)}
        />
      ) : null}
      {/* Note that they follow the drag strips they cover, because a later drag region wins. */}
      <div className="title-bar-controls" onPointerDown={keepOverlay}>
        <SidebarToggle sidebar={sidebar} />
        {sidebar.collapsed ? <TitleBarNewPlan plans={plans} /> : null}
      </div>
      {panelToggle ? (
        <div className="title-bar-controls" data-edge="end">
          <SidePanelToggle
            panel={plans.sidePanel}
            disabled={plans.region.kind !== DOCUMENT_REGION.READY}
          />
        </div>
      ) : null}
      {newPlanDialog}
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
