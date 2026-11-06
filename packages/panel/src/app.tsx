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
  type AppStateSnapshot,
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useAutomationsRoute } from "./automations-route.js";
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
import { forgetAccountReads } from "./query-keys.js";
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
import {
  useDescriptionWordsOwner,
  useDescriptionWordsUnsaved,
} from "./tasks/use-description-editing.js";
import { ListedPullRequests, OpenLinkProvider } from "./tasks/use-open-link.js";
import { type LeaveAsk, useLeaveGuard, useTasksTab } from "./tasks/use-tasks-tab.js";
import { ToastHost } from "./toast.js";
import { forgetUndo, redoLast, undoLast, useUndoWaits } from "./undo-stack.js";
import { useUpdatedToast } from "./update-toast.js";
import {
  appStateQuery,
  selectAccount,
  selectAdminAccess,
  selectAdminAccessPending,
  selectAppSettingsView,
  selectExperiment,
  selectExperimentChoices,
  selectInbox,
  selectRun,
  selectSessionReplay,
  selectSettingsHeld,
  selectTasks,
} from "./use-app-state.js";
import { useSignIn } from "./use-sign-in.js";
import { usePrefetchBundles, useSessionReplay } from "./use-startup-work.js";
import { useVisualViewport } from "./use-visual-viewport.js";
import { ViewingAs } from "./viewing-as.js";
import { useWindowFullScreen } from "./window-full-screen.js";
import { useWindowZoom } from "./window-zoom.js";
import { useBoardRoute, usePersonRoute } from "./workspace-routes.js";

const NO_UNSEEN_AGENTS: readonly string[] = [];

const NOTHING_WAITING: readonly AppInboxTask[] = [];

const NO_TASKS_HOLDING: readonly AppInboxTaskHolding[] = [];
const NOTHING_TASKLESS: readonly AppInboxTasklessItem[] = [];
const NO_AGENTS_HOLDING: readonly AppInboxAgentHolding[] = [];
const NO_FAILED_RUNS: readonly AccountFailedRun[] = [];

const NO_CAPABILITIES: readonly HostCapability[] = [];

const IDLE_RUN = { fixtureMode: false, profile: RUN_PROFILE.IDLE } as const;

const selectFixtureMode = (state: AppStateSnapshot): boolean => state.run.fixtureMode === true;

const selectUnseenAgents = (state: AppStateSnapshot): readonly string[] => state.agents.unseen;

const selectFullScreen = (state: AppStateSnapshot): boolean => state.window.fullScreen;

const selectZoom = (state: AppStateSnapshot) => selectAppSettingsView(state)?.zoom;

const tellShellUnsavedWork = (ask: LeaveAsk | undefined): void => {
  appPlatform().unsavedWork?.(ask);
};

function SettingsShell({
  doors,
  ...shell
}: Omit<ComponentProps<typeof DesktopShell>, "settings"> & {
  doors: SettingsDoors;
}): React.JSX.Element | null {
  const settings = useSettingsPanel(doors);
  if (settings === undefined) return null;
  return <DesktopShell {...shell} settings={settings} />;
}

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

function UpdatedToast(): null {
  useUpdatedToast(useShownUpdate());
  return null;
}

function OfflineRefusedToast(): null {
  useOfflineRefusedToast();
  return null;
}

function ExpiredServerToasts(): null {
  useExpiredServerToasts();
  return null;
}

export function App(): React.JSX.Element {
  const fixtureMode = useQuery({ ...appStateQuery, select: selectFixtureMode }).data === true;
  const landed = useTasksFixtureLanded(fixtureMode);
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
  const accountKey =
    account?.status === ACCOUNT_STATUS.SIGNED_IN ? (account.id ?? account.email) : undefined;
  return (
    <OpenAiKeyProvider account={accountKey}>{landed ? <AppWindow /> : null}</OpenAiKeyProvider>
  );
}

function AppWindow(): React.JSX.Element {
  const { mutateAsync: updateSetting } = useMutation(actMutation(ACT_KIND.SETTING_UPDATE));
  const { mutateAsync: sendSignOut } = useMutation(actMutation(ACT_KIND.ACCOUNT_SIGN_OUT));
  const { mutateAsync: requestMicrophoneAccess } = useMutation(
    actMutation(ACT_KIND.MICROPHONE_REQUEST),
  );
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
  const run = useQuery({ ...appStateQuery, select: selectRun }).data;
  const planning = useQuery({ ...appStateQuery, select: selectTasks }).data;
  const inbox = useQuery({ ...appStateQuery, select: selectInbox }).data;
  const unseenAgents =
    useQuery({ ...appStateQuery, select: selectUnseenAgents }).data ?? NO_UNSEEN_AGENTS;
  const settingsHeld = useQuery({ ...appStateQuery, select: selectSettingsHeld }).data === true;
  const accountKey =
    account?.status === ACCOUNT_STATUS.SIGNED_IN ? (account.id ?? account.email) : undefined;
  const queryClient = useQueryClient();
  useEffect(() => {
    void forgetPictures(queryClient);
    void forgetAccountReads(queryClient);
    forgetUndo();
  }, [queryClient, accountKey]);
  useDraftsOwner(account?.status === ACCOUNT_STATUS.SIGNED_IN ? account : undefined);
  useDescriptionWordsOwner();
  const [launched] = useState(() => loadedTasksFixture()?.fixturePlace(run ?? IDLE_RUN));
  const settingsRoute = useRef<SettingsRoute | undefined>(undefined);
  const routedHere = useRoutedStanding();
  const tab = routedHere?.place === ROUTED_PLACE.SETTINGS ? PANEL_TAB.SETTINGS : PANEL_TAB.TASKS;
  const leaveRouted = useRef<() => void>(() => undefined);
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>();
  const [feedbackAbout, setFeedbackAbout] = useState<Experiment>();
  const openFeedbackAbout = useCallback((about: Experiment) => {
    setFeedbackAbout(about);
    setFeedbackKind(FEEDBACK_KIND.FEEDBACK);
  }, []);

  usePrefetchBundles();
  const leaveGuard = useLeaveGuard(tellShellUnsavedWork);
  const descriptionWordsUnsaved = useDescriptionWordsUnsaved();
  useEffect(() => {
    appPlatform().unsavedDescriptionWords?.(descriptionWordsUnsaved);
  }, [descriptionWordsUnsaved]);
  const { guard: guardLeave } = leaveGuard;
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
  const openSettings = useCallback(
    (link: SettingsLink) => guardLeave(() => goSettings(link))(),
    [guardLeave, goSettings],
  );
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

  const accountGated =
    run?.accountRequired === true && account?.status !== ACCOUNT_STATUS.SIGNED_IN;

  const signIn = useSignIn();
  const lastSignIn = useLastSignIn(account, run?.fixtureMode === true);

  useAppCommand(APP_COMMAND.SEND_FEEDBACK, () => {
    setFeedbackAbout(undefined);
    setFeedbackKind(FEEDBACK_KIND.FEEDBACK);
  });

  const undo = useUndoWaits();
  useAppCommand(APP_COMMAND.UNDO, undo.undoes ? () => void undoLast() : undefined);
  useAppCommand(APP_COMMAND.REDO, undo.redoes ? () => void redoLast() : undefined);

  useWindowZoom(useQuery({ ...appStateQuery, select: selectZoom }).data, (zoom) =>
    updateSetting({ field: APP_SETTING_SCHEMA.zoom.field, value: zoom }),
  );
  useWindowFullScreen(useQuery({ ...appStateQuery, select: selectFullScreen }).data);

  const signOut = useCallback(async () => {
    await sendSignOut();
  }, [sendSignOut]);

  const stage = useStageRoom();
  const room = stage.room;
  const listedSlug = useRef<string | undefined>(undefined);
  const adminView = useAdminRoute({
    listedSlug: () => listedSlug.current,
    onClose: () => leaveRouted.current(),
  });
  const boardView = useBoardRoute({ onClose: () => leaveRouted.current() });
  const personView = usePersonRoute({ onClose: () => leaveRouted.current() });
  const automationsView = useAutomationsRoute({ onClose: () => leaveRouted.current() });
  const tasks = useTasksTab({
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
    automationsView,
  });
  listedSlug.current =
    tasks.workspace === undefined ? undefined : (tasks.workspace.slug ?? tasks.workspace.id);
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
  useSessionReplay(
    run,
    useQuery({ ...appStateQuery, select: selectSessionReplay }).data,
    tasks.workspace?.id,
  );
  const settingsPlace = useSettingsRoute({
    workspaces: tasks.workspaces,
    listedId: tasks.workspace?.id,
    narrow: room === SHELL_ROOM.NARROW,
  });
  settingsRoute.current = settingsPlace;
  const experiments =
    useQuery({ ...appStateQuery, select: selectExperimentChoices }).data ?? NO_EXPERIMENTS;
  const shownView = shownSettingsView(
    settingsPlace.view,
    run?.capabilities ?? NO_CAPABILITIES,
    experiments,
  );
  const chooseSettingsView = useSteadyDoor((view: SettingsView) => {
    if (settingsPlace.standing) goSettings({ page: view });
    else guardLeave(() => goSettings({ page: view }))();
  });
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
  const launchedOnce = useRef(false);
  const listedForLaunch = tasks.workspace !== undefined;
  const openAutomations = tasks.automationsView.onOpen;
  useEffect(() => {
    if (launchedOnce.current || launched === undefined) return;
    if ("automations" in launched && !listedForLaunch) return;
    launchedOnce.current = true;
    if ("settings" in launched) goSettings(launched.settings);
    else if ("admin" in launched) adminView.onOpen();
    else openAutomations(launched.automations);
  }, [launched, goSettings, adminView, listedForLaunch, openAutomations]);
  const listedTasks = tasks.tasks;
  const listedAgents = planning?.tasklessAgents;
  const adminOn = useQuery({ ...appStateQuery, select: selectAdminAccess }).data === true;
  const adminPending =
    useQuery({ ...appStateQuery, select: selectAdminAccessPending }).data ?? true;
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
      guardLeave(() => adminView.onOpen(adminViewOfLink(place)))();
    } else {
      guardLeave(() => {
        changeTab(PANEL_TAB.TASKS);
        tasks.onOpenLink(link);
      })();
    }
  });
  const workspacesUnread = tasks.workspaces.length === 0 && !tasks.listFailed;
  const openLink = useLinkOpener(accountGated || workspacesUnread, openAppLink);
  const openAccount = useLinkOpener(accountGated, openAccountLink);
  useEffect(
    () =>
      appBridge().onShowLink((link) => ("workspace" in link ? openLink(link) : openAccount(link))),
    [openLink, openAccount],
  );
  const history = useWindowHistory({
    known: run !== undefined && !accountGated,
    link: copyLink.placed,
    title: stepTitle(routedHere?.place, tasks),
    routed: routedHere,
    settingsList: settingsPlace.listAddress,
    onSettingsList: settingsPlace.list,
    automations: automationsView,
    room,
    tasks,
  });
  leaveRouted.current = history.onLeaveRouted;
  const shellTasks = useSteadyDoors(
    useMemo(() => throughHistory(tasks, history.lists), [tasks, history.lists]),
  );
  const shellDoors = useRef(shellTasks);
  shellDoors.current = shellTasks;
  const sidebar = useSidebarCollapse(run?.fixtureMode === true, stage.compact);

  useKeyboardModality();
  useVisualViewport();

  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !settingsHeld) return;
    opened.current = true;
    appBridge().notifyReady();
  }, [settingsHeld]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isComposingKey(event)) return;
      if (event.defaultPrevented) return;
      if (signIn.signInWait) {
        signIn.cancelSignIn();
        return;
      }
      if (runAppCommand(APP_COMMAND.EXIT_SETTINGS)) return;
      if (runAppCommand(APP_COMMAND.EXIT_VERSION_HISTORY)) return;
      if (runAppCommand(APP_COMMAND.INBOX_LIST) || tasks.inboxView.open) return;
      if (runAppCommand(APP_COMMAND.EXIT_AGENT_PAGE)) return;
      if (runAppCommand(APP_COMMAND.EXIT_PERSON_PAGE)) return;
      if (runAppCommand(APP_COMMAND.EXIT_AUTOMATIONS)) return;
      if (runAppCommand(APP_COMMAND.EXIT_BOARD)) return;
      if (runAppCommand(APP_COMMAND.EXIT_ADMIN)) return;
      shellDoors.current.back();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [signIn.cancelSignIn, signIn.signInWait, tasks.inboxView.open]);

  useAppKeymap(true);
  useMenuCommands(true);
  useMenuOffers();
  useHistoryMouseButtons(history, true);

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
  const workspace = useMemo(
    () => ({
      workspaces: tasks.workspaces,
      workspaceId: settingsPlace.workspaceId,
      onLeft: leftWorkspace,
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
  const settingsDoors = useMemo<SettingsDoors>(
    () => ({
      view: shownView,
      onViewChange: chooseSettingsView,
      onSignOut: signOut,
      onRequestMicrophone: requestMicrophone,
      workspace,
    }),
    [shownView, chooseSettingsView, signOut, requestMicrophone, workspace],
  );

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

  const openPerson = useSteadyDoor((userId: string, name?: string, workspaceId?: string) =>
    tasks.personView.onOpen(userId, name, workspaceId),
  );
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
                        <ViewingAs />
                        <RetryOffered.Provider value={connected}>
                          <div
                            ref={stage.ref}
                            className="app-stage"
                            data-capture={String(run.captureMode)}
                            data-surface="desktop"
                            style={cssCustomProperties({ "--sidebar-width": `${sidebar.width}px` })}
                          >
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
                            <FeedbackDialog
                              kind={feedbackKind}
                              about={feedbackAbout}
                              account={account}
                              onKind={setFeedbackKind}
                              onClose={() => setFeedbackKind(undefined)}
                            />
                            <ToastHost />
                            <MacCommandAskDialog />
                            <LinkMenu />
                            <UpdatedToast />
                            <OfflineRefusedToast />
                            <ExpiredServerToasts />
                            <SettingsPalette
                              available={!accountGated}
                              tab={tab}
                              onTabChange={changeTab}
                              tasks={tasks}
                              links={copyLink}
                              doors={settingsDoors}
                            />
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
