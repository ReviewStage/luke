import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import type { AccountFailedRun } from "@repo/features/account-inbox-wire";
import { PRODUCT_SURFACE_EVENT } from "@repo/features/analytics";
import { FEEDBACK_KIND, type FeedbackKind } from "@repo/features/feedback";
import { type AccountLink, LINK_PLACE, type ReadLink } from "@repo/features/link-grammar";
import type { ModelProvider } from "@repo/features/models-wire";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import {
  type AppInboxAgentHolding,
  type AppInboxTask,
  type AppInboxTaskHolding,
  type AppInboxTasklessItem,
  RUN_PROFILE,
} from "@repo/host/app-state";
import {
  APP_SETTING_SCHEMA,
  EXPERIMENT,
  type Experiment,
  type HostCapability,
  NO_EXPERIMENTS,
} from "@repo/settings";
import {
  agentKeyLink,
  SETTINGS_SECTION,
  SETTINGS_VIEW,
  type SettingsLink,
  type SettingsView,
} from "@repo/settings/settings-views";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { cssCustomProperties, RetryOffered } from "@repo/ui";
import { isComposingKey } from "@repo/ui/composing-key";
import { useLinkOpener } from "@repo/ui/held-link";
import { LINK_ROUTE, linkRoute } from "@repo/ui/link-route";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Atom from "effect/reactivity/Atom";
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "./act.js";
import { actMutation } from "./act-mutations.js";
import { useAdminRoute } from "./admin/admin-route.js";
import { adminViewOfLink } from "./admin/routing.js";
import { appBridge } from "./app-bridge.js";
import {
  runAppCommand,
  useAppCommand,
  useAppKeymap,
  useMenuCommands,
  useMenuOffers,
} from "./app-commands.js";
import { appPlatform } from "./app-platform.js";
import { type SettingsDoors, useSettingsPanel, useShownUpdate } from "./app-settings.js";
import { useDraftsOwner } from "./composer-drafts.js";
import { useConnected } from "./connection.js";
import { CommandPalette } from "./desktop/command-palette.js";
import { DesktopShell } from "./desktop/desktop-shell.js";
import { ListedAutomations } from "./desktop/listed-automations.js";
import { useSidebarCollapse } from "./desktop/sidebar-collapse.js";
import { TabSwitcher } from "./desktop/tab-switcher.js";
import { useExpiredServerToasts } from "./expired-server-toasts.js";
import { FeedbackDialog } from "./feedback-dialog.js";
import { GitHubConnectProvider } from "./github-connect.js";
import { stepTitle } from "./history-titles.js";
import { useKeyboardModality } from "./keyboard-modality.js";
import { useLastSignIn } from "./last-sign-in.js";
import { LinkMenu } from "./link-menu.js";
import { PageWorkspaceProvider, useCopyLink } from "./links-at-hand.js";
import { MacCommandAskDialog } from "./mac-command-ask.js";
import {
  throughHistory,
  useHistoryMouseButtons,
  useRoutedStanding,
  useWindowHistory,
} from "./navigation-history.js";
import { useOfflineRefusedToast } from "./offline-refused-toast.js";
import { OpenFeedbackProvider } from "./open-feedback.js";
import { OpenSettingsProvider } from "./open-settings.js";
import { OpenAiKeyProvider } from "./openai-key.js";
import { PANEL_TAB, type PanelTab } from "./panel-tabs.js";
import { OpenPersonProvider, PreloadPersonProvider } from "./person-door.js";
import { forgetPictures } from "./picture-query.js";
import { ROUTED_PLACE } from "./route-gates.js";
import { useOpenHostConnect } from "./settings/host-connect-dialog.js";
import { settingsRowsInput, shownSettingsView } from "./settings/settings-rows.js";
import { type SettingsRoute, useSettingsRoute } from "./settings-link.js";
import { SHELL_ROOM } from "./shell-room.js";
import { ShellRoomContext, useStageRoom } from "./stage-room.js";
import { useSteadyDoor, useSteadyDoors } from "./steady-door.js";
import { MessageRevealProvider } from "./tasks/message-links.js";
import { type RepositoryRemedyDoors, RepositoryRemedyProvider } from "./tasks/repository-remedy.js";
import { loadedTasksFixture, useTasksFixtureLanded } from "./tasks/tasks-fixture-loader.js";
import { ThreadRevealProvider } from "./tasks/thread-reveal.js";
import { ListedPullRequests, OpenLinkProvider } from "./tasks/use-open-link.js";
import { usePlanWordsUnsaved } from "./tasks/use-plan-editing.js";
import { type LeaveAsk, useLeaveGuard, useTasksTab } from "./tasks/use-tasks-tab.js";
import { ToastHost } from "./toast.js";
import { forgetUndo, redoLast, undoLast, useUndoWaits } from "./undo-stack.js";
import { useUpdatedToast } from "./update-toast.js";
import {
  APP_SETTINGS_VIEW,
  APP_SLICE,
  appStateQuery,
  SETTINGS_HELD,
  selectAdminAccess,
  selectAdminAccessPending,
  selectExperiment,
  selectExperimentChoices,
  useAppSlice,
} from "./use-app-state.js";
import { useSignIn } from "./use-sign-in.js";
import { usePrefetchBundles, useSessionReplay } from "./use-startup-work.js";
import { useVisualViewport } from "./use-visual-viewport.js";
import { ViewingAs } from "./viewing-as.js";
import { useWindowFullScreen } from "./window-full-screen.js";
import { useWindowZoom } from "./window-zoom.js";
import { useBoardRoute, usePersonRoute } from "./workspace-routes.js";

/** No agent ended unseen, as the document reads before main has answered. */
const NO_UNSEEN_AGENTS: readonly string[] = [];

/** Nothing waits on the developer, as the document reads before main has answered. */
const NOTHING_WAITING: readonly AppInboxTask[] = [];

/** No task holds an inbox item, as the document reads before main has answered. */
const NO_TASKS_HOLDING: readonly AppInboxTaskHolding[] = [];
/** Nothing waiting from agents with no task, as one value across renders. */
const NOTHING_TASKLESS: readonly AppInboxTasklessItem[] = [];
/** No agent with no task holds an inbox item, as one value across renders. */
const NO_AGENTS_HOLDING: readonly AppInboxAgentHolding[] = [];
/** No automation's run failed, as one value across renders. */
const NO_FAILED_RUNS: readonly AccountFailedRun[] = [];

/** No platform capability, as the document reads before main has answered. */
const NO_CAPABILITIES: readonly HostCapability[] = [];

/** The run the Tasks tab reads before main has answered: a plain one, no fixture staged. */
const IDLE_RUN = { fixtureMode: false, profile: RUN_PROFILE.IDLE } as const;

/** Whether this is a fixture run, which the window waits on its synthetic tasks for. */
const FIXTURE_MODE: Atom.Atom<boolean> = Atom.map(
  APP_SLICE.RUN,
  (run) => run?.fixtureMode === true,
);

/** The agents main says ended unseen. */
const UNSEEN_AGENTS: Atom.Atom<readonly string[]> = Atom.map(
  APP_SLICE.AGENTS,
  (agents) => agents?.unseen ?? NO_UNSEEN_AGENTS,
);

/** Whether this window stands in full screen. */
const FULL_SCREEN = Atom.map(APP_SLICE.WINDOW, (facts) => facts?.fullScreen);

/** The stored zoom, which the zoom keys step from. */
const ZOOM = Atom.map(APP_SETTINGS_VIEW, (settings) => settings?.zoom);

/** Tells the shell the ask standing while a page holds unsaved work, or nothing once none does. */
const tellShellUnsavedWork = (ask: LeaveAsk | undefined): void => {
  appPlatform().unsavedWork?.(ask);
};

/**
 * The shell, handed Settings as the document holds it. It is read here
 * rather than by the window, so a setting that moves draws the shell again
 * over the same tasks, whose columns hold (`DesktopSidebar`, `DesktopTasks`),
 * and leaves the window as it was.
 */
function SettingsShell({
  doors,
  ...shell
}: Omit<ComponentProps<typeof DesktopShell>, "settings"> & {
  doors: SettingsDoors;
}): React.JSX.Element | null {
  const settings = useSettingsPanel(doors);
  // Note that there is none only before the first read, which the window draws nothing over.
  if (settings === undefined) return null;
  return <DesktopShell {...shell} settings={settings} />;
}

/** ⌘K, handed the rows its search finds on the shell's terms. */
function SettingsPalette({
  doors,
  ...palette
}: Omit<ComponentProps<typeof CommandPalette>, "settings"> & {
  doors: SettingsDoors;
}): React.JSX.Element {
  const settings = useSettingsPanel(doors);
  return (
    <CommandPalette
      {...palette}
      settings={{
        rows: settings === undefined ? undefined : settingsRowsInput(settings),
        capabilities: settings?.capabilities ?? NO_CAPABILITIES,
        onViewChange: doors.onViewChange,
      }}
    />
  );
}

/**
 * The toast an update arrived with. Note that it reads the update where
 * nothing else is drawn for it, because the update moves with each step of
 * its download.
 */
function UpdatedToast(): null {
  useUpdatedToast(useShownUpdate());
  return null;
}

/** The toast that says the changes made offline the service refused once it answered again. */
function OfflineRefusedToast(): null {
  useOfflineRefusedToast();
  return null;
}

/** The toasts that say each MCP server whose sign-in expired, until it is reconnected. */
function ExpiredServerToasts(): null {
  useExpiredServerToasts();
  return null;
}

/**
 * The window, drawn once a fixture run's synthetic tasks have landed. They are
 * imported apart from the bundle every launch parses, and drawn from the first
 * frame so that a capture, and the history entry the window's first place
 * writes, never see the tasks arrive after the rest.
 */
export function App(): React.JSX.Element {
  const fixtureMode = useAppSlice(FIXTURE_MODE);
  const landed = useTasksFixtureLanded(fixtureMode);
  const account = useAppSlice(APP_SLICE.ACCOUNT);
  const accountKey =
    account?.status === ACCOUNT_STATUS.SIGNED_IN ? (account.id ?? account.email) : undefined;
  // Note that the account's key is read above the window, because every message box's Dictate reads it.
  return (
    <OpenAiKeyProvider account={accountKey}>{landed ? <AppWindow /> : null}</OpenAiKeyProvider>
  );
}

function AppWindow(): React.JSX.Element {
  // Note that `act` stays for the tasks' reads (`useTasksTab`) and the reads below, which the act-port reads leaf moves.
  const { act } = useAct();
  const { mutateAsync: updateSetting } = useMutation(actMutation(ACT_KIND.SETTING_UPDATE));
  const { mutateAsync: sendSignOut } = useMutation(actMutation(ACT_KIND.ACCOUNT_SIGN_OUT));
  const { mutateAsync: sendDeleteAccount } = useMutation(actMutation(ACT_KIND.ACCOUNT_DELETE));
  const { mutateAsync: requestMicrophoneAccess } = useMutation(
    actMutation(ACT_KIND.MICROPHONE_REQUEST),
  );
  // What main holds, each slice read on its own, so the window is drawn again
  // for a slice it draws from and for no other: a setting that moves draws
  // Settings and ⌘K, which read their own (`app-settings.ts`), and leaves the
  // window, and the tasks it holds, as they were.
  const account = useAppSlice(APP_SLICE.ACCOUNT);
  const run = useAppSlice(APP_SLICE.RUN);
  const planning = useAppSlice(APP_SLICE.TASKS);
  const inbox = useAppSlice(APP_SLICE.INBOX);
  const unseenAgents = useAppSlice(UNSEEN_AGENTS);
  const settingsHeld = useAppSlice(SETTINGS_HELD);
  // A picture is read as the account signed in, so the window lets go of every one it read once that account changes, and of every write it would undo, which is its presser's own.
  const accountKey =
    account?.status === ACCOUNT_STATUS.SIGNED_IN ? (account.id ?? account.email) : undefined;
  const queryClient = useQueryClient();
  useEffect(() => {
    void forgetPictures(queryClient);
    forgetUndo();
  }, [queryClient, accountKey]);
  // A draft is its account's: the window reads the unsent words of the one signed in alone.
  useDraftsOwner(account?.status === ACCOUNT_STATUS.SIGNED_IN ? account : undefined);
  // A fixture run's profile may open the window on a page of Settings, or on Admin, at launch (`tasks-fixture.ts`).
  const [launched] = useState(() => loadedTasksFixture()?.fixturePlace(run ?? IDLE_RUN));
  // Settings and Admin are the router's places (`panel-router.tsx`), read from where it stands and moved by navigation;
  // Settings is the tab the window stands on while it stands, the Tasks tab otherwise.
  const settingsRoute = useRef<SettingsRoute | undefined>(undefined);
  const routedHere = useRoutedStanding();
  const tab = routedHere?.place === ROUTED_PLACE.SETTINGS ? PANEL_TAB.SETTINGS : PANEL_TAB.TASKS;
  // Leaves the routed place standing for the place the window's state says, once the history is read below.
  const leaveRouted = useRef<() => void>(() => undefined);
  /** The note being written to the people who make the app, while its dialog stands. */
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>();
  /** The experiment that note is about, where an experiment's row opened it. */
  const [feedbackAbout, setFeedbackAbout] = useState<Experiment>();
  const openFeedbackAbout = useCallback((about: Experiment) => {
    setFeedbackAbout(about);
    setFeedbackKind(FEEDBACK_KIND.FEEDBACK);
  }, []);

  // The editor and markdown-parser prefetches start once the renderer is idle, not beside the first interactions; so does session replay, below.
  usePrefetchBundles();
  // Note that the tab switch asks first while a page holds unsaved work, because Settings takes the window and the page with it.
  // The shell hears the ask too, and whether a plan holds words not saved, which no page's ask
  // covers, so its own ways out of the page and the app ask first.
  const leaveGuard = useLeaveGuard(tellShellUnsavedWork);
  const planWordsUnsaved = usePlanWordsUnsaved();
  useEffect(() => {
    appPlatform().unsavedPlanWords?.(planWordsUnsaved);
  }, [planWordsUnsaved]);
  const { guard: guardLeave } = leaveGuard;
  // Opens Settings at the place a link names (`settings-link.ts`), counted as the tab changed where it was not standing.
  const goSettings = useCallback((link: SettingsLink) => {
    const route = settingsRoute.current;
    if (route === undefined) return;
    if (!route.standing) {
      appPlatform().recordSurfaceEvent(PRODUCT_SURFACE_EVENT.PANEL_TAB_CHANGE, {
        panel_tab: PANEL_TAB.SETTINGS,
      });
    }
    route.open(link);
  }, []);
  const routedStanding = routedHere !== undefined;
  // Arriving at Settings is arriving at its page list and its first page, Profile; the Tasks tab is the place the window's
  // state says, which a routed place standing is left for. Note that `PanelTab` and the counted tab are the same union:
  // both are `APP_PANEL_TAB`'s own set, which `PanelTab` aliases.
  const changeTab = useCallback(
    (next: PanelTab) => {
      if (next === PANEL_TAB.SETTINGS) {
        guardLeave(() => goSettings({ page: SETTINGS_VIEW.ACCOUNT, listed: true }))();
        return;
      }
      if (!routedStanding) return;
      guardLeave(() => {
        leaveRouted.current();
        appPlatform().recordSurfaceEvent(PRODUCT_SURFACE_EVENT.PANEL_TAB_CHANGE, {
          panel_tab: PANEL_TAB.TASKS,
        });
      })();
    },
    [guardLeave, goSettings, routedStanding],
  );
  /**
   * Opens Settings at the place a link names: the workspace it names, which
   * the Workspace page shows while Settings stays open; its page; and its
   * section, which is looked for once drawn and given up on by itself.
   */
  // Note that the link asks once, as a whole, so its page, workspace, and section all wait on the ask.
  const openSettings = useCallback(
    (link: SettingsLink) => guardLeave(() => goSettings(link))(),
    [guardLeave, goSettings],
  );
  // A pairing's link opens Settings › Hosts with its code, for the page to ask over itself; while
  // Bring your own host is off, which stands nowhere then, it lands on that experiment's row alone.
  const openHostConnect = useOpenHostConnect();
  const openAccountLink = useSteadyDoor(({ place }: AccountLink) => {
    const state = queryClient.getQueryData(appStateQuery.queryKey);
    if (state === undefined || !selectExperiment(EXPERIMENT.BRING_YOUR_OWN_HOST)(state)) {
      openSettings({
        page: SETTINGS_VIEW.EXPERIMENTAL,
        section: SETTINGS_SECTION.BRING_YOUR_OWN_HOST,
      });
      return;
    }
    // Note that the code is handed only once the leave is let go, so a page kept for a draft is not asked over later.
    guardLeave(() => {
      openHostConnect(place.code);
      goSettings({ page: SETTINGS_VIEW.HOSTS });
    })();
  });

  const openIntegrations = useCallback(
    () => openSettings({ page: SETTINGS_VIEW.INTEGRATIONS }),
    [openSettings],
  );
  const openApiKeys = useCallback(
    (provider: ModelProvider | undefined) => openSettings(agentKeyLink(provider)),
    [openSettings],
  );

  /** True while sign-in stands between the app and anything to watch: the gate is then what the window shows. */
  const accountGated =
    run?.accountRequired === true && account?.status !== ACCOUNT_STATUS.SIGNED_IN;

  const signIn = useSignIn();
  const lastSignIn = useLastSignIn(account, run?.fixtureMode === true);

  // The menu bar's Help item opens the same dialog Settings' buttons do; its head turns the note into a feature suggestion.
  useAppCommand(APP_COMMAND.SEND_FEEDBACK, () => {
    setFeedbackAbout(undefined);
    setFeedbackKind(FEEDBACK_KIND.FEEDBACK);
  });

  // ⌘Z and ⇧⌘Z take back and put back the reader's last row write, offered
  // only while one waits, so a field's typing, or nothing to undo, falls
  // through to the menu bar's Edit items.
  const undo = useUndoWaits();
  useAppCommand(APP_COMMAND.UNDO, undo.undoes ? () => void undoLast() : undefined);
  useAppCommand(APP_COMMAND.REDO, undo.redoes ? () => void redoLast() : undefined);

  // ⌘+, ⌘−, and ⌘0 write the same setting Settings' Zoom pop-up does.
  useWindowZoom(useAppSlice(ZOOM), (zoom) =>
    updateSetting({ field: APP_SETTING_SCHEMA.zoom.field, value: zoom }),
  );
  // In full screen the sidebar's toggle stands where the hidden traffic lights were.
  useWindowFullScreen(useAppSlice(FULL_SCREEN));

  const signOut = useCallback(async () => {
    await sendSignOut();
  }, [sendSignOut]);
  // The delete happens at the service before anything local moves,
  // so a failure resolves to why and the account is still standing.
  const deleteAccount = useCallback(async (): Promise<ActionResult> => {
    try {
      await sendDeleteAccount();
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    } catch {
      return {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: "The account could not be deleted. Try again.",
      };
    }
  }, [sendDeleteAccount]);

  // The room the stage's width gives, on the desktop the window's: whether
  // the panel stands as one pane (`shell-room.ts`), and whether the sidebar
  // folds. Only crossing a line draws the shell again, never a pixel's drag.
  const stage = useStageRoom();
  const room = stage.room;
  // The workspace the sidebar lists, by its address's slug, which Admin opens under; read as it is pressed, since the tasks are built below.
  const listedSlug = useRef<string | undefined>(undefined);
  const adminView = useAdminRoute({
    listedSlug: () => listedSlug.current,
    onClose: () => leaveRouted.current(),
  });
  const boardView = useBoardRoute({ onClose: () => leaveRouted.current() });
  const personView = usePersonRoute({ onClose: () => leaveRouted.current() });
  const tasks = useTasksTab({
    acts: { act },
    tasks: planning ?? IDLE_TASKS_VIEW,
    run: run ?? IDLE_RUN,
    signedIn: account?.status === ACCOUNT_STATUS.SIGNED_IN,
    account: account?.status === ACCOUNT_STATUS.SIGNED_IN ? account.email : undefined,
    accountId: account?.status === ACCOUNT_STATUS.SIGNED_IN ? account.id : undefined,
    shown: tab === PANEL_TAB.TASKS,
    unseenAgents,
    inboxWaiting: inbox?.waiting ?? NOTHING_WAITING,
    inboxTasks: inbox?.tasks ?? NO_TASKS_HOLDING,
    inboxTaskless: inbox?.taskless ?? NOTHING_TASKLESS,
    inboxAgents: inbox?.agents ?? NO_AGENTS_HOLDING,
    failedRuns: inbox?.failedRuns ?? NO_FAILED_RUNS,
    onOpenSettings: openSettings,
    onOpenIntegrations: openIntegrations,
    onOpenApiKeys: openApiKeys,
    leaveGuard,
    room,
    adminView,
    boardView,
    personView,
  });
  listedSlug.current = tasks.workspaces.find((each) => each.id === tasks.workspace?.id)?.slug;
  // An account leaving, signed out, deleted, or switched, takes the window's place with it, so the
  // next account lands on Home rather than on the Settings page the last one left from. Note that
  // the leave passes the guard, because the unsaved work it would ask about was the account's that left.
  const placeOwner = useRef(accountKey);
  const { pass: passLeave } = leaveGuard;
  const { onGoHome } = tasks;
  useEffect(() => {
    const owner = placeOwner.current;
    placeOwner.current = accountKey;
    if (owner === undefined || owner === accountKey) return;
    passLeave(() => {
      leaveRouted.current();
      onGoHome();
    });
  }, [accountKey, passLeave, onGoHome]);
  // Session replay starts once the renderer is idle, filed under the workspace the sidebar lists.
  useSessionReplay(run, useAppSlice(APP_SLICE.SESSION_REPLAY), tasks.workspace?.id);
  // Settings as the router stands it: its page, its list, and the workspace its address names, else the sidebar's.
  const settingsPlace = useSettingsRoute({
    workspaces: tasks.workspaces,
    listedId: tasks.workspace?.id,
    narrow: room === SHELL_ROOM.NARROW,
  });
  settingsRoute.current = settingsPlace;
  // The page Settings shows, which a link to one the platform does not offer leaves on Profile.
  const experiments =
    useQuery({ ...appStateQuery, select: selectExperimentChoices }).data ?? NO_EXPERIMENTS;
  const shownView = shownSettingsView(
    settingsPlace.view,
    run?.capabilities ?? NO_CAPABILITIES,
    experiments,
  );
  // A page chosen from outside Settings, as ⌘K chooses one, asks first while a page holds unsaved work, as entering Settings does; one turned within Settings asks nothing.
  const chooseSettingsView = useSteadyDoor((view: SettingsView) => {
    if (settingsPlace.standing) goSettings({ page: view });
    else guardLeave(() => goSettings({ page: view }))();
  });
  // The links the window can copy now: ⌥⌘C copies the first, and ⌘K offers each (`links-at-hand.ts`).
  const copyLink = useCopyLink(
    tasks,
    settingsPlace.standing
      ? {
          view: shownView,
          workspace: tasks.workspaces.find((each) => each.id === settingsPlace.workspaceId),
          listed: settingsPlace.listed,
        }
      : undefined,
    !accountGated,
    room,
    adminView.open ? adminView.view : undefined,
  );
  // A fixture run's profile opens the window on its place once, as a link to it would.
  const launchedOnce = useRef(false);
  useEffect(() => {
    if (launchedOnce.current || launched === undefined) return;
    launchedOnce.current = true;
    if ("settings" in launched) goSettings(launched.settings);
    else if ("admin" in launched) adminView.onOpen();
  }, [launched, goSettings, adminView]);
  // An app link, handed by the system or pressed in the window, opens where its place stands (`@repo/ui/link-route`).
  // A pull request a listed task's agent, or a listed agent on no task, opened opens in that agent's Pull request tab wherever it is pressed (`use-open-link.ts`).
  const listedTasks = tasks.tasks;
  const listedAgents = planning?.tasklessAgents;
  // An Admin link opens while the account's access is still being read, the
  // place waiting on it, and never for an account that is no admin
  // (`link-route.ts`).
  const adminOn = useQuery({ ...appStateQuery, select: selectAdminAccess }).data === true;
  const adminPending =
    useQuery({ ...appStateQuery, select: selectAdminAccessPending }).data ?? true;
  // Note that the door stands across draws, so every part that reads it (`useOpenLink`), each section of the open plan among them, holds while the window is drawn again.
  const openAppLink = useSteadyDoor((link: ReadLink) => {
    const route = linkRoute(link, {
      workspaces: tasks.workspaces,
      adminOn: adminOn || adminPending,
    });
    if (route.kind === LINK_ROUTE.NOT_PERMITTED) return;
    const { place } = link;
    if (route.kind === LINK_ROUTE.SETTINGS) {
      openSettings(route.settings);
    } else if (place.kind === LINK_PLACE.ADMIN) {
      // Admin is the router's place, which its link opens as a navigation from wherever the window stands.
      guardLeave(() => adminView.onOpen(adminViewOfLink(place)))();
    } else {
      guardLeave(() => {
        changeTab(PANEL_TAB.TASKS);
        tasks.onOpenLink(link);
      })();
    }
  });
  // An app link the system handed the app opens once sign-in no longer stands in the way, and
  // the account's workspaces are read, since a link's slug is read against them (every account
  // holds its own workspace, so none read means none read yet).
  const workspacesUnread = tasks.workspaces.length === 0 && !tasks.listFailed;
  const openLink = useLinkOpener(accountGated || workspacesUnread, openAppLink);
  // A link of the account's own names no workspace, so it waits on the sign-in alone.
  const openAccount = useLinkOpener(accountGated, openAccountLink);
  useEffect(
    () =>
      appBridge().onShowLink((link) => ("workspace" in link ? openLink(link) : openAccount(link))),
    [openLink, openAccount],
  );
  // Where the window has stood, for back and forward, from the moment it
  // knows where it stands.
  const history = useWindowHistory({
    known: run !== undefined && !accountGated,
    link: copyLink.placed,
    title: stepTitle(routedHere?.place, tasks),
    routed: routedHere,
    settingsList: settingsPlace.listAddress,
    onSettingsList: settingsPlace.list,
    room,
    tasks,
  });
  leaveRouted.current = history.onLeaveRouted;
  // The narrow screens' ways back to their lists go through the history, so the two never disagree.
  const shellTasks = useSteadyDoors(
    useMemo(() => throughHistory(tasks, history.lists), [tasks, history.lists]),
  );
  // Escape reads the latest of them as it lands, so its listener stays the same across renders.
  const shellDoors = useRef(shellTasks);
  shellDoors.current = shellTasks;
  // The sidebar folds only where it is drawn: Settings keeps its page list,
  // and the sign-in gate draws no sidebar at all. It folds by the room the
  // stage has, which on the desktop is the window's.
  const sidebar = useSidebarCollapse(run?.fixtureMode === true, stage.compact);

  // Rings and keyboard-only hints follow focus the keyboard actually moved.
  useKeyboardModality();
  // The stage, its dialogs, and its viewers fit what can be seen of the window,
  // above a phone's keyboard.
  useVisualViewport();

  /**
   * The report that the window has painted, made once, on the first snapshot
   * that carries settings.
   */
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !settingsHeld) return;
    opened.current = true;
    appBridge().notifyReady();
  }, [settingsHeld]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isComposingKey(event)) return;
      // A field or dialog that took the press for itself is the nearest layer
      // of all, ahead of the sign-in wait and every page: an Escape
      // that clears a search or withdraws a question has been answered, and
      // an input method's own is never the window's.
      if (event.defaultPrevented) return;
      // Escape on a gate waiting for the browser withdraws the sign-in, as
      // its Cancel does: the wait is the only thing on screen.
      if (signIn.signInWait) {
        signIn.cancelSignIn();
        return;
      }
      // Otherwise it closes the nearest thing that is open, one layer at a
      // time: Settings, a plan's version history, an agent's or a person's page, the Automations page, or the Board, back to wherever it was
      // opened from, then a side panel filling the window back beside its
      // task, then an open task back to the page it was opened from. A menu and the
      // settings search answer their own Escapes and keep them — the search
      // clearing, then letting go of the caret — so neither is a layer here,
      // bar the caret Settings opens with, whose untouched Escape leaves it.
      // The Inbox is the one page Escape never leaves: a narrow one's item
      // steps back to its list, and there the press stops, rather than
      // reaching the plan the Inbox stands over.
      if (runAppCommand(APP_COMMAND.EXIT_SETTINGS)) return;
      if (runAppCommand(APP_COMMAND.EXIT_VERSION_HISTORY)) return;
      if (runAppCommand(APP_COMMAND.INBOX_LIST) || tasks.inboxView.open) return;
      if (runAppCommand(APP_COMMAND.EXIT_AGENT_PAGE)) return;
      if (runAppCommand(APP_COMMAND.EXIT_PERSON_PAGE)) return;
      if (runAppCommand(APP_COMMAND.EXIT_AUTOMATIONS)) return;
      if (runAppCommand(APP_COMMAND.EXIT_BOARD)) return;
      if (runAppCommand(APP_COMMAND.EXIT_ADMIN)) return;
      // An open task steps back through the history, as the toolbar's Back
      // does, to the page it was opened from, which leaves it; a task with no step behind it is left for Home
      // (`desktop-home.tsx`), where a press does nothing. A side panel
      // standing only full screen shuts through the history, as its Close does.
      shellDoors.current.back();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [signIn.cancelSignIn, signIn.signInWait, tasks.inboxView.open]);

  // The window's shortcuts, from the keys and from the menu bar alike.
  useAppKeymap(true);
  useMenuCommands(true);
  useMenuOffers();
  useHistoryMouseButtons(history, true);

  // The doors the window hands every page are held across draws, each part that reads one holding while it does.
  // Note that the request is the one dictation makes, and answers once macOS has, which is how Allow knows to stop waiting; the answer also arrives as the microphone's status.
  const requestMicrophone = useCallback(
    () =>
      requestMicrophoneAccess().then(
        () => undefined,
        () => undefined,
      ),
    [requestMicrophoneAccess],
  );
  const leftWorkspace = useSteadyDoor((workspaceId: string) => {
    tasks.onLeftWorkspace(workspaceId);
    changeTab(PANEL_TAB.TASKS);
  });
  // The Workspace page shows the workspace the sidebar lists, or one a link named.
  const workspace = useMemo(
    () => ({
      workspaces: tasks.workspaces,
      workspaceId: settingsPlace.workspaceId,
      // A leave closes Settings onto the Tasks tab, whose Home the tab turns to.
      onLeft: leftWorkspace,
      // Note that the workspaces are followed apart from the tasks, so a task list that read says nothing of them.
      listFailed: tasks.workspacesFailed,
      onRetryList: tasks.onRetryWorkspaces,
    }),
    [
      tasks.workspaces,
      settingsPlace.workspaceId,
      leftWorkspace,
      tasks.workspacesFailed,
      tasks.onRetryWorkspaces,
    ],
  );
  // What Settings and ⌘K answer through; the settings themselves they read where they draw them.
  const settingsDoors = useMemo<SettingsDoors>(
    () => ({
      view: shownView,
      onViewChange: chooseSettingsView,
      onSignOut: signOut,
      onDeleteAccount: deleteAccount,
      onRequestMicrophone: requestMicrophone,
      workspace,
    }),
    [shownView, chooseSettingsView, signOut, deleteAccount, requestMicrophone, workspace],
  );

  // A remedy under a refused start or message mends the task's repository through the Tasks tab's doors.
  const repositoryRemedies = useMemo<RepositoryRemedyDoors>(
    () => ({
      openWorkspaceGitHub: tasks.onOpenWorkspaceGitHub,
      openGitHub: tasks.repositories.openGitHub,
      chooseRepository: tasks.onChangeRepository,
      moveTask: tasks.onMoveTask,
    }),
    [
      tasks.onOpenWorkspaceGitHub,
      tasks.repositories.openGitHub,
      tasks.onChangeRepository,
      tasks.onMoveTask,
    ],
  );
  const gitHubConnect = useMemo(
    () => ({
      connection: tasks.github,
      connect: tasks.onConnectAccountGitHub,
      disconnect: tasks.onDisconnectAccountGitHub,
    }),
    [tasks.github, tasks.onConnectAccountGitHub, tasks.onDisconnectAccountGitHub],
  );
  const messageReveal = useMemo(
    () => ({ reveal: tasks.messageReveal, onRevealed: tasks.onMessageRevealed }),
    [tasks.messageReveal, tasks.onMessageRevealed],
  );
  const threadReveal = useMemo(
    () => ({ reveal: tasks.threadReveal, onRevealed: tasks.onThreadRevealed }),
    [tasks.threadReveal, tasks.onThreadRevealed],
  );

  // A person pressed anywhere in the window opens their page on the Plans tab, in the workspace the place named them in.
  const openPerson = useSteadyDoor((userId: string, name?: string, workspaceId?: string) => {
    changeTab(PANEL_TAB.TASKS);
    tasks.personView.onOpen(userId, name, workspaceId);
  });
  const preloadPerson = useSteadyDoor((userId: string, workspaceId?: string) =>
    tasks.personView.onPreload(userId, workspaceId),
  );

  const gates = useMemo(
    () => ({
      accountRequired: run?.accountRequired === true,
      signInWait: signIn.signInWait,
      signInFailure: signIn.signInFailure,
      lastSignIn,
      onBeginSignIn: signIn.beginSignIn,
      onCancelSignIn: signIn.cancelSignIn,
    }),
    [
      run?.accountRequired,
      signIn.signInWait,
      signIn.signInFailure,
      lastSignIn,
      signIn.beginSignIn,
      signIn.cancelSignIn,
    ],
  );
  const connected = useConnected();
  const settingsStep = useMemo(
    () => ({ listed: settingsPlace.listed, onList: history.lists.settings }),
    [settingsPlace.listed, history.lists.settings],
  );

  // Nothing is drawn over a state the window has not been told, nor over a
  // runtime that could not answer for the settings every row reads.
  if (run === undefined || !settingsHeld) return <div />;

  return (
    <OpenSettingsProvider value={openSettings}>
      <OpenLinkProvider value={openAppLink}>
        <ListedPullRequests tasks={listedTasks} agents={listedAgents}>
          <PageWorkspaceProvider value={copyLink.onPageWorkspace}>
            <OpenPersonProvider value={openPerson}>
              <PreloadPersonProvider value={preloadPerson}>
                <OpenFeedbackProvider value={openFeedbackAbout}>
                  <RepositoryRemedyProvider value={repositoryRemedies}>
                    <GitHubConnectProvider value={gitHubConnect}>
                      <ListedAutomations tasks={tasks}>
                        {/* A maintainer's sign-in as the member, said above the stage on the web. */}
                        <ViewingAs />
                        {/* A failure offers no Retry while the app does not reach the service, whose reads start again once it does. */}
                        <RetryOffered.Provider value={connected}>
                          <div
                            ref={stage.ref}
                            className="app-stage"
                            data-capture={String(run.captureMode)}
                            // The panel is drawn as an ordinary app window's content; desktop.css
                            // lays it out.
                            data-surface="desktop"
                            // The sidebar's width lays out the shell and Settings' page list.
                            style={cssCustomProperties({ "--sidebar-width": `${sidebar.width}px` })}
                          >
                            {/* The window's content. */}
                            <ShellRoomContext.Provider value={room}>
                              <div className="desktop-stage">
                                <MessageRevealProvider value={messageReveal}>
                                  <ThreadRevealProvider value={threadReveal}>
                                    <SettingsShell
                                      gates={gates}
                                      tab={tab}
                                      onTabChange={changeTab}
                                      tasks={shellTasks}
                                      history={history}
                                      sidebar={sidebar}
                                      room={room}
                                      settingsStep={settingsStep}
                                      doors={settingsDoors}
                                    />
                                  </ThreadRevealProvider>
                                </MessageRevealProvider>
                              </div>
                            </ShellRoomContext.Provider>
                            {/* A note to the people who make the app, written in a dialog over the
          window. */}
                            <FeedbackDialog
                              kind={feedbackKind}
                              about={feedbackAbout}
                              account={account}
                              onKind={setFeedbackKind}
                              onClose={() => setFeedbackKind(undefined)}
                            />
                            {/* The window's passing notice: the thank-you after a note lands, what
          came of a change made from a menu, and an update arrived. */}
                            <ToastHost />
                            {/* A command an agent asks to run on this Mac, while main holds it for an answer. */}
                            <MacCommandAskDialog />
                            {/* The menu a right-click on any link in the window hangs. */}
                            <LinkMenu />
                            <UpdatedToast />
                            <OfflineRefusedToast />
                            <ExpiredServerToasts />
                            {/* The plans, the open plan's agents and files, every command the
          window can run now, and the settings, behind ⌘K, past the sign-in
          alone. */}
                            <SettingsPalette
                              available={!accountGated}
                              tab={tab}
                              onTabChange={changeTab}
                              tasks={tasks}
                              links={copyLink}
                              doors={settingsDoors}
                            />
                            {/* The tabs and places stood on last, across every task, behind ⌃Tab, on a desktop app past the sign-in; in the stage's room, which names a phone's places as it stands them. */}
                            <ShellRoomContext.Provider value={room}>
                              <TabSwitcher
                                available={!accountGated}
                                tab={tab}
                                onTabChange={changeTab}
                                tasks={tasks}
                              />
                            </ShellRoomContext.Provider>
                          </div>
                        </RetryOffered.Provider>
                      </ListedAutomations>
                    </GitHubConnectProvider>
                  </RepositoryRemedyProvider>
                </OpenFeedbackProvider>
              </PreloadPersonProvider>
            </OpenPersonProvider>
          </PageWorkspaceProvider>
        </ListedPullRequests>
      </OpenLinkProvider>
    </OpenSettingsProvider>
  );
}
