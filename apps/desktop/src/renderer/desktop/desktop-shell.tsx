import { ACCOUNT_STATUS, type AccountProvider } from "@luke/credentials/snapshot";
import type { Task } from "@luke/features/task-wire";
import { EXPERIMENT } from "@luke/settings";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { ComposeIcon, SidebarIcon } from "@luke/ui";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { TRANSCRIPT_REGION } from "@luke/voice/transcript-model";
import { lazy, Suspense, useEffect, useRef } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { CALL_CARD_SURFACE, CallCardDock, type CallCardInput } from "../call/call-card";
import { CaptionStrip, type CaptionStripProps } from "../caption-strip";
import { FIND_PAGE, PageFind } from "../find-in-tab";
import type { NavigationHistory, WindowHistory } from "../navigation-history";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { NewPlanDialog } from "../planning/new-plan-dialog";
import { usePlanLooks } from "../planning/use-plan-looks";
import {
  AUTOMATIONS_PAGE,
  type AutomationsPlace,
  type PlansControl,
} from "../planning/use-plans-tab";
import { SIDE_PANEL_TAB } from "../planning/use-side-panel";
import type { SettingsPanelProps } from "../settings/settings-panel";
import { SignInGate } from "../sign-in-gate";
import { Tooltip } from "../tooltip";
import { useExperiment } from "../use-app-state";
import { useColumnDock } from "./column-dock";
import { DesktopAgentPage } from "./desktop-agent-page";
import { DesktopFactory } from "./desktop-factory";
import { DesktopInbox } from "./desktop-inbox";
import { DesktopPlans } from "./desktop-plans";
import { DesktopSidebar } from "./desktop-sidebar";
import { DesktopVersionHistory, planVersionSubject } from "./desktop-version-history";
import { useFloatDismiss } from "./hover-pane";
import { PaneGlide } from "./pane-motion";
import { PersonPage } from "./person-page";
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

/**
 * The Automations pages, loaded as a chunk of their own the first time
 * they open, as Settings is and for the same reason: the renderer bundle is
 * parsed at every window open, and the pages, their editor and its triggers
 * among them, are opened seldom (`bundle-budget.json`). What stands while
 * the chunk loads is the pages' own empty frame, for a frame.
 */
const AutomationsPage = lazy(() =>
  import("./automations-page").then((loaded) => ({ default: loaded.AutomationsPage })),
);

/**
 * What stands while the Automations pages' chunk loads: their empty frame,
 * and their own way out, so Escape pressed in that frame closes Automations
 * as the list would rather than falling through to the plan behind it.
 */
function AutomationsLoading({ onExit }: { onExit: () => void }): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, onExit);
  return <section className="automations-view" aria-label="Automations" />;
}

/**
 * What stands while Settings' chunk loads: nothing drawn, but Settings' own
 * way out, so Escape pressed in that frame leaves Settings as it would once
 * drawn, rather than falling through to the plan behind it. It is gone as
 * Settings stands and offers the same command itself.
 */
function SettingsLoading({ onExit }: { onExit: () => void }): null {
  useAppCommand(APP_COMMAND.EXIT_SETTINGS, onExit);
  return null;
}

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
          if (tab !== PANEL_TAB.TASKS) onTabChange(PANEL_TAB.TASKS);
          plans.onNewPlan();
        }
      : undefined,
  );
  useAppCommand(APP_COMMAND.SETTINGS, pastGate ? () => onTabChange(PANEL_TAB.SETTINGS) : undefined);
  useAppCommand(
    APP_COMMAND.HOME,
    pastGate && plans.signedIn
      ? () => {
          if (tab !== PANEL_TAB.TASKS) onTabChange(PANEL_TAB.TASKS);
          plans.onGoHome();
        }
      : undefined,
  );
  useAppCommand(
    APP_COMMAND.INBOX,
    pastGate && plans.signedIn
      ? () => {
          if (tab !== PANEL_TAB.TASKS) onTabChange(PANEL_TAB.TASKS);
          plans.inboxView.onOpen();
        }
      : undefined,
  );
  // Factory is an experiment: offered nowhere, ⌘K, its chord, or the menu, while it is off.
  const factoryOn = useExperiment(EXPERIMENT.FACTORY);
  useAppCommand(
    APP_COMMAND.FACTORY,
    pastGate && plans.signedIn && factoryOn
      ? () => {
          if (tab !== PANEL_TAB.TASKS) onTabChange(PANEL_TAB.TASKS);
          plans.factoryView.onOpen();
        }
      : undefined,
  );
  // The Automations page is an experiment on the same terms as Factory.
  const automationsOn = useExperiment(EXPERIMENT.AUTOMATIONS);
  useAppCommand(
    APP_COMMAND.AUTOMATIONS,
    pastGate && plans.signedIn && automationsOn
      ? () => {
          if (tab !== PANEL_TAB.TASKS) onTabChange(PANEL_TAB.TASKS);
          plans.automationsView.onOpen();
        }
      : undefined,
  );
  const { onReopenClosedTab } = plans;
  useAppCommand(
    APP_COMMAND.REOPEN_CLOSED_TAB,
    pastGate && plans.signedIn && onReopenClosedTab !== undefined
      ? () => {
          if (tab !== PANEL_TAB.TASKS) onTabChange(PANEL_TAB.TASKS);
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
    <Tooltip label="New task" command={APP_COMMAND.NEW_PLAN}>
      <button
        type="button"
        className="icon-button"
        aria-label="New task"
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
 * from; Factory and the Automations page in the listed workspace; the plan on screen in its own workspace, or alone while that is not
 * read; else the listed workspace.
 */
function titleSubject(
  tab: PanelTab,
  plans: PlansControl,
  shownPlan: Task | undefined,
): Parameters<typeof useWindowTitle>[0] {
  const { signedIn } = plans;
  if (tab === PANEL_TAB.SETTINGS) return { signedIn, subject: "Settings", workspace: undefined };
  if (plans.inboxView.open) return { signedIn, subject: "Inbox", workspace: plans.workspace };
  if (plans.agentView.agentId !== undefined) {
    return { signedIn, subject: "Agent", workspace: plans.workspace };
  }
  if (plans.personView.userId !== undefined) {
    return { signedIn, subject: "Profile", workspace: plans.workspace };
  }
  if (plans.factoryView.open) return { signedIn, subject: "Factory", workspace: plans.workspace };
  if (plans.automationsView.open) {
    return { signedIn, subject: "Automations", workspace: plans.workspace };
  }
  if (shownPlan === undefined) return { signedIn, subject: undefined, workspace: plans.workspace };
  // Note that a plan whose workspace is not read yet is named alone, because the listed one may not be its.
  const workspace = plans.workspaces.find((each) => each.id === shownPlan.workspaceId);
  return { signedIn, subject: shownPlan.name, workspace };
}

/** Where on the Automations page a find stands: its list, a new automation, or one automation's editor, each a place of its own. */
function automationsPlaceKey(place: AutomationsPlace): string {
  return place.kind === AUTOMATIONS_PAGE.EDIT ? place.automationId : place.kind;
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
  const keepOverlay = useFloatDismiss({ state: sidebar.overlay, onState: sidebar.onOverlay });
  // A fixture run keeps the summary's pin as it keeps the sidebar's fold: not at all.
  const summary = useSummaryPin(sidebar.staged);
  const gated = gates.accountRequired && account.status !== ACCOUNT_STATUS.SIGNED_IN;
  usePlaceCommands(!gated, tab, onTabChange, plans, settings, history);
  // Factory switched off while it stands, here or on another Mac, gives the plan's place back.
  const factoryOn = useExperiment(EXPERIMENT.FACTORY);
  const { open: factoryShown, onClose: closeFactory } = plans.factoryView;
  useEffect(() => {
    if (factoryShown && !factoryOn) closeFactory();
  }, [factoryShown, factoryOn, closeFactory]);
  const automationsOn = useExperiment(EXPERIMENT.AUTOMATIONS);
  const { open: automationsShown, onClose: closeAutomations } = plans.automationsView;
  useEffect(() => {
    if (automationsShown && !automationsOn) closeAutomations();
  }, [automationsShown, automationsOn, closeAutomations]);
  const { region } = plans;
  // The folded sidebar's call card stands over the column's foot, clear of its dock.
  useColumnDock(
    shell,
    plans.sidePanel.fullScreen,
    `${tab}:${plans.page}:${plans.history.open}:${plans.inboxView.open}:${plans.agentView.agentId}:${plans.personView.userId}:${plans.factoryView.open}:${plans.automationsView.open}:${sidebar.collapsed}`,
  );
  // The window's title names what stands in it, the plan only while it is on screen, and its workspace;
  // the Inbox, an agent's or a person's page, Factory, or the Automations page standing in its place is not the plan.
  const standingIn =
    plans.inboxView.open ||
    plans.agentView.agentId !== undefined ||
    plans.personView.userId !== undefined ||
    plans.factoryView.open ||
    plans.automationsView.open;
  const shownPlan =
    tab === PANEL_TAB.TASKS && !standingIn && region.kind === DOCUMENT_REGION.READY
      ? region.task
      : undefined;
  useWindowTitle(titleSubject(tab, plans, shownPlan));
  // The plan is looked at the moment it is on screen, whichever of its column's tabs is chosen.
  const looks = usePlanLooks(shownPlan, plans.me);
  if (gated) {
    return (
      <div className="desktop-onboarding">
        <div className="desktop-drag-strip" />
        <SignInGate
          account={account}
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
    const exitSettings = history.canGoBack ? history.onBack : () => onTabChange(PANEL_TAB.TASKS);
    return (
      <div className="desktop-shell">
        <Suspense fallback={<SettingsLoading onExit={exitSettings} />}>
          <DesktopSettings
            sidebar={sidebar}
            history={history}
            settings={settings}
            call={call}
            onExit={exitSettings}
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
          call={call}
          onExit={history.canGoBack ? history.onBack : plans.history.onClose}
          onRestored={history.onLeaveVersionHistory}
        />
        <CaptionStrip {...captions} />
        {newPlanDialog}
      </div>
    );
  }
  // Note that the shell says whether the panel's toggle stands, because the
  // toolbar beneath it leaves the toggle room then and only then. The Inbox,
  // Factory, and the Automations page stand in the plan's place, so they draw
  // no panel to toggle; an agent's page draws the agent's own.
  const inboxOpen = plans.inboxView.open;
  const pageAgent = plans.agentView.agentId;
  const pagePerson = plans.personView.userId;
  const factoryOpen = plans.factoryView.open && factoryOn;
  const automationsOpen = plans.automationsView.open && automationsOn;
  const planToggle = plans.page === TASKS_PAGE.DOCUMENT && !standingIn;
  const panelToggle = planToggle || pageAgent !== undefined;
  const planDrawn = planToggle && plans.region.kind === DOCUMENT_REGION.READY;
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
          <PageFind page={FIND_PAGE.INBOX} active={plans.shown}>
            <DesktopInbox plans={plans} />
          </PageFind>
        ) : pageAgent !== undefined ? (
          // Keyed by the agent, so another agent's page is a page of its own, holding nothing of the last.
          <DesktopAgentPage key={pageAgent} plans={plans} agentId={pageAgent} />
        ) : pagePerson !== undefined ? (
          // Keyed by the person, so another person's page holds nothing of the last, its find among it.
          <PageFind key={pagePerson} page={FIND_PAGE.PERSON} at={pagePerson} active={plans.shown}>
            <PersonPage
              plans={plans}
              userId={pagePerson}
              name={plans.personView.name}
              staged={sidebar.staged}
            />
          </PageFind>
        ) : factoryOpen ? (
          <PageFind page={FIND_PAGE.FACTORY} active={plans.shown}>
            <DesktopFactory plans={plans} />
          </PageFind>
        ) : automationsOpen ? (
          <PageFind
            page={FIND_PAGE.AUTOMATIONS}
            at={automationsPlaceKey(plans.automationsView.place)}
            active={plans.shown}
          >
            <Suspense fallback={<AutomationsLoading onExit={plans.automationsView.onClose} />}>
              <AutomationsPage plans={plans} />
            </Suspense>
          </PageFind>
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
            disabled={planToggle && plans.region.kind !== DOCUMENT_REGION.READY}
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
