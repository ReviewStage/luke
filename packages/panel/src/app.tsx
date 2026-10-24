import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import type { AccountFailedRun } from "@luke/features/account-inbox-wire";
import { PRODUCT_SURFACE_EVENT } from "@luke/features/analytics";
import { FEEDBACK_KIND, type FeedbackKind } from "@luke/features/feedback";
import { LINK_PLACE, type ReadLink } from "@luke/features/luke-link";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import {
  type AppInboxTask,
  type AppInboxTaskHolding,
  type AppInboxTasklessItem,
  RUN_PROFILE,
} from "@luke/host/app-state";
import type { ChatShown } from "@luke/host/contract";
import { APP_SETTING_SCHEMA, type Experiment, type HostCapability } from "@luke/settings";
import { SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { cssCustomProperties, STATUS_TONE } from "@luke/ui";
import { callBarAgentId } from "@luke/ui/call-card-model";
import { isComposingKey } from "@luke/ui/composing-key";
import { useLinkOpener } from "@luke/ui/held-link";
import { EXPERIMENT_OFF_LINK, LINK_ROUTE, linkRoute } from "@luke/ui/link-route";
import { forgetPictures } from "@luke/ui/picture-cache";
import { isAgentTab } from "@luke/ui/tab-strip-model";
import { TASKS_PAGE } from "@luke/ui/tasks-model";
import { useStateWithRef } from "@luke/ui/use-state-with-ref";
import { MICROPHONE_STATUS, type MicrophoneStatus } from "@luke/voice/audio";
import { VOICE_COMMAND } from "@luke/voice/voice-view";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import * as Atom from "effect/reactivity/Atom";
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "./act.js";
import { appBridge } from "./app-bridge.js";
import { runAppCommand, useAppCommand, useAppKeymap, useMenuCommands } from "./app-commands.js";
import { appPlatform } from "./app-platform.js";
import { type SettingsDoors, useSettingsPanel, useShownUpdate } from "./app-settings.js";
import { useDraftsOwner } from "./composer-drafts.js";
import { CommandPalette } from "./desktop/command-palette.js";
import { DesktopShell } from "./desktop/desktop-shell.js";
import { type FailedRunPlace, useFailedRunToasts } from "./desktop/failed-runs.js";
import { ListedAutomations } from "./desktop/listed-automations.js";
import { useSidebarCollapse } from "./desktop/sidebar-collapse.js";
import { TabSwitcher } from "./desktop/tab-switcher.js";
import { FeedbackDialog } from "./feedback-dialog.js";
import { GitHubConnectProvider } from "./github-connect.js";
import { stepTitle } from "./history-titles.js";
import { useKeyboardModality } from "./keyboard-modality.js";
import { useLastSignIn } from "./last-sign-in.js";
import { LinkMenu } from "./link-menu.js";
import { PageWorkspaceProvider, useCopyLink } from "./links-at-hand.js";
import { MacCommandAskDialog } from "./mac-command-ask.js";
import { throughHistory, useHistoryMouseButtons, useWindowHistory } from "./navigation-history.js";
import { OpenFeedbackProvider } from "./open-feedback.js";
import { OpenSettingsProvider } from "./open-settings.js";
import { OpenAiKeyProvider } from "./openai-key.js";
import { PANEL_TAB, type PanelTab } from "./panel-tabs.js";
import { OpenPersonProvider } from "./person-door.js";
import { installPressIntent } from "./press-intent.js";
import { settingsRowsInput, shownSettingsView } from "./settings/settings-rows.js";
import { followSettingsLink, useSettingsPlace, useSettingsWorkspace } from "./settings-link.js";
import { SHELL_ROOM } from "./shell-room.js";
import { ShellRoomContext, useStageRoom } from "./stage-room.js";
import { useSteadyDoor, useSteadyDoors } from "./steady-door.js";
import { type AgentPlace, useAgentEndToasts } from "./tasks/agent-end-toast.js";
import { useChatOn } from "./tasks/chat-gate.js";
import { useChatToasts } from "./tasks/chat-toast.js";
import { useInboxSettlingOwner } from "./tasks/inbox-settling.js";
import { useInboxToasts } from "./tasks/inbox-toast.js";
import { MessageRevealProvider } from "./tasks/message-links.js";
import { type RepositoryRemedyDoors, RepositoryRemedyProvider } from "./tasks/repository-remedy.js";
import { useTasksFixtureLanded } from "./tasks/tasks-fixture-loader.js";
import { ThreadRevealProvider } from "./tasks/thread-reveal.js";
import { ListedPullRequests, OpenLinkProvider } from "./tasks/use-open-link.js";
import { type LeaveAsk, useLeaveGuard, useTasksTab } from "./tasks/use-tasks-tab.js";
import { TOAST_HOLD, ToastHost, useToast } from "./toast.js";
import { useUpdatedToast } from "./update-toast.js";
import {
  APP_SETTINGS_VIEW,
  APP_SLICE,
  appStateDerivedAtom,
  SETTINGS_HELD,
  useAdminAccess,
  useAdminAccessPending,
  useAppSlice,
  useExperimentChoices,
  VOICE_AVAILABLE,
} from "./use-app-state.js";
import { useSignIn } from "./use-sign-in.js";
import { usePrefetchBundles, useSessionReplay } from "./use-startup-work.js";
import { useVisualViewport } from "./use-visual-viewport.js";
import { voiceViewNow } from "./use-voice-view.js";
import { useWindowFullScreen } from "./window-full-screen.js";
import { CallChords, WindowVoice } from "./window-voice.js";
import { useWindowZoom } from "./window-zoom.js";

/** No agent ended unseen, as the document reads before main has answered. */
const NO_UNSEEN_AGENTS: readonly string[] = [];

/** Nothing waits on the developer, as the document reads before main has answered. */
const NOTHING_WAITING: readonly AppInboxTask[] = [];
const NO_CHAT_WAITING: readonly string[] = [];

/** No task holds an inbox item, as the document reads before main has answered. */
const NO_TASKS_HOLDING: readonly AppInboxTaskHolding[] = [];
/** Nothing waiting from agents with no task, as one value across renders. */
const NOTHING_TASKLESS: readonly AppInboxTasklessItem[] = [];
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
  APP_SLICE.CODING_AGENTS,
  (codingAgents) => codingAgents?.unseen ?? NO_UNSEEN_AGENTS,
);

/** The microphone's grant, which the Tasks tab's microphone answers. */
const MICROPHONE_GRANT: Atom.Atom<MicrophoneStatus> = Atom.map(
  APP_SLICE.AUDIO,
  (audio) => audio?.microphoneStatus ?? MICROPHONE_STATUS.NOT_DETERMINED,
);

/** Whether this window stands in full screen. */
const FULL_SCREEN = Atom.map(APP_SLICE.WINDOW, (facts) => facts?.fullScreen);

/** The stored zoom, which the zoom keys step from. */
const ZOOM = Atom.map(APP_SETTINGS_VIEW, (settings) => settings?.zoom);

/** What waits on the developer across the account's tasks. */
const INBOX_WAITING: Atom.Atom<readonly AppInboxTask[]> = Atom.map(
  APP_SLICE.INBOX,
  (inbox) => inbox?.waiting ?? NOTHING_WAITING,
);

/** The chat messages that wait on the developer across the account's workspaces, by id. */
const CHAT_WAITING: Atom.Atom<readonly string[]> = Atom.map(
  APP_SLICE.INBOX,
  (inbox) => inbox?.chat ?? NO_CHAT_WAITING,
);

/** The version of main's document the window holds, which moves with every delivery. */
const APP_STATE_VERSION: Atom.Atom<number> = appStateDerivedAtom((state) => state?.version ?? 0);

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

/**
 * The toasts of what waits on the developer, withdrawn as it stops waiting.
 * Note that it reads the document's version where nothing else is drawn for
 * it, because the version moves with every delivery.
 */
function InboxToasts({
  onView,
  shownInbox,
}: {
  onView: (taskId: string) => void;
  shownInbox: string | null;
}): null {
  useInboxToasts(onView, useAppSlice(INBOX_WAITING), useAppSlice(APP_STATE_VERSION), shownInbox);
  return null;
}

/** The toasts of chat messages that wait on the developer, withdrawn as they stop waiting, on the same terms as {@link InboxToasts}. */
function ChatToasts({
  onView,
  shown,
}: {
  onView: (workspaceId: string, messageId: string) => void;
  shown: ChatShown | null;
}): null {
  useChatToasts(onView, useAppSlice(CHAT_WAITING), useAppSlice(APP_STATE_VERSION), shown);
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
  // Note that the account's key is read above the window, because the window's own call press reads it too.
  return (
    <OpenAiKeyProvider
      account={
        account?.status === ACCOUNT_STATUS.SIGNED_IN ? (account.id ?? account.email) : undefined
      }
    >
      {landed ? <AppWindow /> : null}
    </OpenAiKeyProvider>
  );
}

function AppWindow(): React.JSX.Element {
  const { act, tell, updateSetting } = useAct();
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
  const voiceAvailable = useAppSlice(VOICE_AVAILABLE);
  const microphoneStatus = useAppSlice(MICROPHONE_GRANT);
  // A picture is read as the account signed in, so the window lets go of every one it read once that account changes.
  const accountKey =
    account?.status === ACCOUNT_STATUS.SIGNED_IN ? (account.id ?? account.email) : undefined;
  useEffect(() => {
    forgetPictures();
  }, [accountKey]);
  // A draft is its account's: the window reads the unsent words of the one signed in alone.
  useDraftsOwner(account?.status === ACCOUNT_STATUS.SIGNED_IN ? account : undefined);
  useInboxSettlingOwner(account?.status === ACCOUNT_STATUS.SIGNED_IN ? account : undefined);
  const [tab, setTab] = useStateWithRef<PanelTab>(PANEL_TAB.TASKS);
  const settingsPlace = useSettingsPlace();
  const { onEnter: enterSettings, onChoose: chooseSettingsView } = settingsPlace;
  /** The note being written to the people who make Luke, while its dialog stands. */
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>();
  /** The experiment that note is about, where an experiment's row opened it. */
  const [feedbackAbout, setFeedbackAbout] = useState<Experiment>();
  const openFeedbackAbout = useCallback((about: Experiment) => {
    setFeedbackAbout(about);
    setFeedbackKind(FEEDBACK_KIND.FEEDBACK);
  }, []);

  // Session replay and the editor and markdown-parser prefetches start once the renderer is idle, not beside the first interactions.
  useSessionReplay(run, useAppSlice(APP_SLICE.SESSION_REPLAY));
  usePrefetchBundles();
  // Note that the tab switch asks first while a page holds unsaved work, because Settings takes the window and the page with it.
  // The shell hears the ask too, so its own ways out of the page ask first.
  const leaveGuard = useLeaveGuard(tellShellUnsavedWork);
  const { guard: guardLeave } = leaveGuard;
  const changeTab = useCallback(
    (next: PanelTab) =>
      guardLeave((tab: PanelTab) => {
        setTab(tab);
        // Arriving at the tab is arriving at its page list and its first page, Profile: a page
        // left open behind a tab switch would greet the next visit with a
        // corner of the settings rather than the settings. A flow that needs
        // another page sets it right after this reset.
        enterSettings();
        // `PanelTab` and the counted tab are the same union: both are
        // `APP_PANEL_TAB`'s own set, which `PanelTab` aliases.
        appPlatform().recordSurfaceEvent(PRODUCT_SURFACE_EVENT.PANEL_TAB_CHANGE, {
          panel_tab: tab,
        });
      })(next),
    [guardLeave, enterSettings, setTab],
  );
  // Where a link's workspace is handed, read through a ref, because the
  // workspace Settings shows is held beside the Tasks tab, built after the opener.
  const linkWorkspace = useRef<(workspaceId: string) => void>(() => undefined);
  /**
   * Opens Settings at the place a link names: the workspace it names, which
   * the Workspace page shows while Settings stays open; its page; and its
   * section, which is looked for once drawn and given up on by itself.
   */
  // Note that the link asks once, as a whole, so its page, workspace, and section all wait on the ask with its tab.
  const openSettings = useCallback(
    (link: SettingsLink) =>
      guardLeave(() =>
        followSettingsLink(link, {
          changeTab,
          changeView: chooseSettingsView,
          chooseWorkspace: (workspaceId) => linkWorkspace.current(workspaceId),
        }),
      )(),
    [changeTab, guardLeave, chooseSettingsView],
  );

  const openIntegrations = useCallback(
    () => openSettings({ page: SETTINGS_VIEW.INTEGRATIONS }),
    [openSettings],
  );
  const openApiKeys = useCallback(
    () => openSettings({ page: SETTINGS_VIEW.CODING_AGENTS }),
    [openSettings],
  );

  /** True while sign-in stands between Luke and anything to watch: the gate is then what the window shows. */
  const accountGated =
    run?.accountRequired === true && account?.status !== ACCOUNT_STATUS.SIGNED_IN;

  const signIn = useSignIn();
  const lastSignIn = useLastSignIn(account, run?.fixtureMode === true);

  // The menu bar's Help items open the same dialog Settings' buttons do.
  useAppCommand(APP_COMMAND.SEND_FEEDBACK, () => {
    setFeedbackAbout(undefined);
    setFeedbackKind(FEEDBACK_KIND.FEEDBACK);
  });
  useAppCommand(APP_COMMAND.SUGGEST_FEATURE, () => {
    setFeedbackAbout(undefined);
    setFeedbackKind(FEEDBACK_KIND.PROMPT);
  });

  // ⌘+, ⌘−, and ⌘0 write the same setting Settings' Zoom pop-up does.
  useWindowZoom(useAppSlice(ZOOM), (zoom) => updateSetting(APP_SETTING_SCHEMA.zoom.field, zoom));
  // In full screen the sidebar's toggle stands where the hidden traffic lights were.
  useWindowFullScreen(useAppSlice(FULL_SCREEN));

  const signOut = useCallback(async () => {
    await act(ACT_KIND.ACCOUNT_SIGN_OUT);
  }, [act]);
  // The delete happens at the service before anything local moves,
  // so a failure resolves to why and the account is still standing.
  const deleteAccount = useCallback(async (): Promise<ActionResult> => {
    try {
      await act(ACT_KIND.ACCOUNT_DELETE);
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    } catch {
      return {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: "Luke could not delete the account. Try again in a moment.",
      };
    }
  }, [act]);

  // The room the stage's width gives, on the desktop the window's: whether
  // the panel stands as one pane (`shell-room.ts`), and whether the sidebar
  // folds. Only crossing a line draws the shell again, never a pixel's drag.
  // Note that the window reads nothing of the voice, which moves with every
  // word said on a call: what draws it reads it (`window-voice.tsx`).
  const stage = useStageRoom();
  const room = stage.room;
  // The Tasks tab, which reads the call standing where it draws it.
  const tasks = useTasksTab({
    acts: { act, tell },
    tasks: planning ?? IDLE_TASKS_VIEW,
    run: run ?? IDLE_RUN,
    signedIn: account?.status === ACCOUNT_STATUS.SIGNED_IN,
    account: account?.status === ACCOUNT_STATUS.SIGNED_IN ? account.email : undefined,
    accountId: account?.status === ACCOUNT_STATUS.SIGNED_IN ? account.id : undefined,
    voiceAvailable,
    microphoneStatus,
    shown: tab === PANEL_TAB.TASKS,
    unseenAgents,
    inboxWaiting: inbox?.waiting ?? NOTHING_WAITING,
    inboxTasks: inbox?.tasks ?? NO_TASKS_HOLDING,
    inboxTaskless: inbox?.taskless ?? NOTHING_TASKLESS,
    failedRuns: inbox?.failedRuns ?? NO_FAILED_RUNS,
    onOpenSettings: openSettings,
    onOpenIntegrations: openIntegrations,
    onOpenApiKeys: openApiKeys,
    leaveGuard,
    room,
  });
  // The workspace Settings shows: the sidebar's, or one a link named while Settings stays open.
  const settingsWorkspace = useSettingsWorkspace({
    listedId: tasks.workspace?.id,
    workspaces: tasks.workspaces,
    settingsShown: tab === PANEL_TAB.SETTINGS,
  });
  linkWorkspace.current = settingsWorkspace.link;
  // The page Settings shows, which a link to one the platform does not offer leaves on Profile.
  const experiments = useExperimentChoices();
  const shownView = shownSettingsView(
    settingsPlace.view,
    run?.capabilities ?? NO_CAPABILITIES,
    experiments,
  );
  // The links the window can copy now: ⌥⌘C copies the first, and ⌘K offers each (`links-at-hand.ts`).
  const copyLink = useCopyLink(
    tasks,
    tab === PANEL_TAB.SETTINGS
      ? {
          view: shownView,
          workspace: tasks.workspaces.find((each) => each.id === settingsWorkspace.shownId),
          listed: settingsPlace.listed,
        }
      : undefined,
    !accountGated,
    room,
  );
  // A coding agent's notification clicked: the Tasks tab, on that agent,
  // its task's tab or its own page where it has no task. Read through refs,
  // because the tab hands new closures each render and the subscription is
  // owed to the window, not to a render. Note that each way here the window
  // is moved by more than one step asks once, as a whole, while a page holds
  // unsaved work, so Leave takes every step and Cancel takes none.
  const showAgent = useRef(tasks.onShowAgent);
  showAgent.current = tasks.onShowAgent;
  const showAgentPage = useRef(tasks.agentView.onOpen);
  showAgentPage.current = tasks.agentView.onOpen;
  const openAgent = useCallback(
    ({ taskId, agentId }: AgentPlace) =>
      guardLeave(() => {
        changeTab(PANEL_TAB.TASKS);
        if (taskId === null) showAgentPage.current(agentId);
        else showAgent.current(taskId, agentId);
      })(),
    [changeTab, guardLeave],
  );
  useEffect(() => appBridge().onShowAgent(openAgent), [openAgent]);
  // A Luke link, handed by the system or pressed in the window, opens where its place stands (`@luke/ui/link-route`).
  const chatOn = useChatOn();
  const toast = useToast();
  // A pull request a listed task's agent opened opens in that agent's Pull request tab wherever it is pressed (`use-open-link.ts`).
  const listedTasks = tasks.tasks;
  // An Admin link opens while the account's access is still being read, the
  // place waiting on it, and never for an account that is no admin
  // (`link-route.ts`).
  const adminOn = useAdminAccess();
  const adminPending = useAdminAccessPending();
  // Note that the door stands across draws, so every part that reads it (`useOpenLink`), each section of the open plan among them, holds while the window is drawn again.
  const openLukeLink = useSteadyDoor((link: ReadLink) => {
    const route = linkRoute(link, {
      workspaces: tasks.workspaces,
      chatOn,
      adminOn: adminOn || adminPending,
    });
    if (route.kind === LINK_ROUTE.NOT_PERMITTED) return;
    if (route.kind === LINK_ROUTE.SETTINGS) {
      openSettings(route.settings);
    } else if (route.kind === LINK_ROUTE.EXPERIMENT_OFF) {
      toast({ words: EXPERIMENT_OFF_LINK, tone: STATUS_TONE.DANGER, hold: TOAST_HOLD.FAILED });
    } else {
      guardLeave(() => {
        changeTab(PANEL_TAB.TASKS);
        tasks.onOpenLink(link);
      })();
    }
  });
  // A Luke link the system handed the app opens once sign-in no longer stands in the way, and
  // the account's workspaces are read, since a link's slug is read against them (every account
  // holds its own workspace, so none read means none read yet).
  const workspacesUnread = tasks.workspaces.length === 0 && !tasks.listFailed;
  const openLink = useLinkOpener(accountGated || workspacesUnread, openLukeLink);
  useEffect(() => appBridge().onShowLink(openLink), [openLink]);
  // A failed run's notification clicked, or its toast's View: the run's own link, held as any link is until the workspaces are read, so it opens in its automation's workspace.
  const openRunLink = useRef(openLink);
  openRunLink.current = openLink;
  const openFailedRun = useCallback(
    ({ automationId, runId, workspaceId }: FailedRunPlace) =>
      openRunLink.current({
        workspace: workspaceId,
        place: { kind: LINK_PLACE.AUTOMATION_RUN, automationId, runId },
      }),
    [],
  );
  useEffect(() => appBridge().onShowFailedRun(openFailedRun), [openFailedRun]);
  // The agent whose call bar is on screen, which the call card gives way to
  // (`WindowVoice`): another agent's tab or page or none, the home page,
  // Settings, or the agent's own task under its version history, the Inbox,
  // another agent's page, or a side panel filling the window draw the card
  // instead.
  const columnTab = tasks.mainTabs.tab;
  const agentShown = callBarAgentId({
    tasksTab: tab === PANEL_TAB.TASKS,
    documentPage: tasks.page === TASKS_PAGE.DOCUMENT,
    historyOpen: tasks.history.open,
    inboxOpen: tasks.inboxView.open || tasks.chatView.open,
    pageAgentId: tasks.agentView.agentId,
    sidePanelFullScreen: tasks.sidePanel.fullScreen,
    columnAgentId: columnTab !== undefined && isAgentTab(columnTab) ? columnTab.agent : undefined,
  });
  // An agent's end said in the toast while the window was focused: its View
  // goes where the notification's click would, and it goes with the agent's
  // unseen dot.
  useAgentEndToasts(openAgent, unseenAgents);
  // A run that failed to start, said in the toast while the window was focused: its View opens the automation.
  useFailedRunToasts(openFailedRun);
  // An inbox notification clicked, or an item's toast's View: the Tasks tab, on that task's Inbox.
  const showInbox = useRef(tasks.onShowInbox);
  showInbox.current = tasks.onShowInbox;
  const openInbox = useCallback(
    (taskId: string) =>
      guardLeave(() => {
        changeTab(PANEL_TAB.TASKS);
        showInbox.current(taskId);
      })(),
    [changeTab, guardLeave],
  );
  useEffect(() => appBridge().onShowInbox(({ taskId }) => openInbox(taskId)), [openInbox]);
  // A notification of an item of an agent with no task clicked: the window's Inbox, on that item
  // in its own workspace's list, the item itself shown where the Inbox shows one column.
  const inboxDoors = useRef(tasks);
  inboxDoors.current = tasks;
  useEffect(
    () =>
      appBridge().onShowInboxItem(({ agentId, itemId, workspaceId }) =>
        guardLeave(() => {
          const doors = inboxDoors.current;
          changeTab(PANEL_TAB.TASKS);
          if (workspaceId !== undefined && doors.workspace?.id !== workspaceId) {
            doors.onChooseWorkspace(workspaceId);
          }
          doors.inboxView.onOpen();
          doors.inboxView.onChoose({ agentId, itemId, opened: true });
        })(),
      ),
    [changeTab, guardLeave],
  );
  // A chat notification clicked, or a waiting message's toast's View: the Tasks tab, on the Chat of
  // the workspace the message waits in, listing that workspace first where another is listed, and
  // from a toast on the channel the message stands in, as an inbox item's toast opens the item.
  const openChat = useCallback(
    (workspaceId: string, messageId?: string) =>
      guardLeave(() => {
        const doors = inboxDoors.current;
        changeTab(PANEL_TAB.TASKS);
        if (doors.workspace?.id !== workspaceId) doors.onChooseWorkspace(workspaceId);
        if (messageId === undefined) doors.chatView.onOpen();
        else doors.chatView.onShowMessage(messageId);
      })(),
    [changeTab, guardLeave],
  );
  useEffect(() => appBridge().onShowChat(({ workspaceId }) => openChat(workspaceId)), [openChat]);
  // Where the window has stood, for back and forward, from the moment it
  // knows where it stands.
  const history = useWindowHistory({
    known: run !== undefined && !accountGated,
    link: copyLink.standing,
    title: stepTitle(tab, tasks, room === SHELL_ROOM.NARROW),
    tab,
    onTabChange: changeTab,
    settingsView: shownView,
    onSettingsViewChange: chooseSettingsView,
    settingsListed: settingsPlace.listed,
    onSettingsList: settingsPlace.onList,
    room,
    tasks,
  });
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
      // of all, ahead of the call, the sign-in wait, and every page: an Escape
      // that clears a search or withdraws a question has been answered, and
      // an input method's own is never the window's.
      if (event.defaultPrevented) return;
      // Muting an open microphone comes before the layers below. Closing the panel
      // or a sheet mid-sentence would strand the microphone open, and the
      // same press asks Luke for quiet mid-sentence: a reply being spoken is
      // the most open thing there is, and Escape ends it without opening a
      // turn in its place. Which of the two the press does is the
      // orchestrator's own reading of the call it holds — a listening call is
      // muted and nothing is said to the model — so the panel asks for both
      // and predicts only whether the key is claimed at all. The snapshot it
      // predicts from can be one frame stale — a reply that ended, or began,
      // since the last report — and the cost is the press doing what it would
      // have done a frame earlier: a fall-through past a reply just begun
      // closes the layer below instead. Not worth a round trip on every
      // Escape.
      const voice = voiceViewNow();
      if (voice.listening || voice.lukeSpeaking) {
        tell(ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.STOP_SPEAKING });
        return;
      }
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
      // Chat is the Inbox's like: a place standing alone steps back to the rail, and there the press stops rather than reaching the plan beneath.
      if (runAppCommand(APP_COMMAND.CHAT_LIST) || tasks.chatView.open) return;
      if (runAppCommand(APP_COMMAND.EXIT_AGENT_PAGE)) return;
      if (runAppCommand(APP_COMMAND.EXIT_PERSON_PAGE)) return;
      if (runAppCommand(APP_COMMAND.EXIT_AUTOMATIONS)) return;
      if (runAppCommand(APP_COMMAND.EXIT_BOARD)) return;
      if (runAppCommand(APP_COMMAND.EXIT_ADMIN)) return;
      // An open task steps back through the history, as the toolbar's Back
      // does, to the page it was opened from, which leaves it and ends its
      // call; a task with no step behind it is left for the page the window
      // rests on (`resting-page.ts`), where a press does nothing. A side panel
      // standing only full screen shuts through the history, as its Close does.
      shellDoors.current.back();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [signIn.cancelSignIn, signIn.signInWait, tasks.inboxView.open, tasks.chatView.open, tell]);

  // The window's shortcuts, from the keys and from the menu bar alike.
  useAppKeymap(true);
  useMenuCommands(true);
  useHistoryMouseButtons(history, true);
  // A link pressed with ⌘ goes where it leads, rather than opening as a preview beside the reader.
  useEffect(() => installPressIntent(window), []);

  // The doors the window hands every page are held across draws, each part that reads one holding while it does.
  const requestMicrophone = useCallback(
    () => tell(ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.REQUEST_MICROPHONE_ACCESS }),
    [tell],
  );
  const leftWorkspace = useSteadyDoor((workspaceId: string) => {
    tasks.onLeftWorkspace(workspaceId);
    changeTab(PANEL_TAB.TASKS);
  });
  // The Workspace page shows the workspace the sidebar lists, or one a link named.
  const workspace = useMemo(
    () => ({
      workspaces: tasks.workspaces,
      workspaceId: settingsWorkspace.shownId,
      // A leave closes Settings onto the Tasks tab, which rests on its page with no task open.
      onLeft: leftWorkspace,
      listFailed: tasks.listFailed,
      onRetryList: tasks.onRetryList,
    }),
    [
      tasks.workspaces,
      settingsWorkspace.shownId,
      leftWorkspace,
      tasks.listFailed,
      tasks.onRetryList,
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
  const settingsStep = useMemo(
    () => ({ listed: settingsPlace.listed, onList: history.lists.settings }),
    [settingsPlace.listed, history.lists.settings],
  );

  // Nothing is drawn over a state the window has not been told, nor over a
  // runtime that could not answer for the settings every row reads.
  if (run === undefined || !settingsHeld) return <div />;

  return (
    <OpenSettingsProvider value={openSettings}>
      <OpenLinkProvider value={openLukeLink}>
        <ListedPullRequests tasks={listedTasks}>
          <PageWorkspaceProvider value={copyLink.onPageWorkspace}>
            <OpenPersonProvider value={openPerson}>
              <OpenFeedbackProvider value={openFeedbackAbout}>
                <RepositoryRemedyProvider value={repositoryRemedies}>
                  <GitHubConnectProvider value={gitHubConnect}>
                    <ListedAutomations tasks={tasks}>
                      <CallChords />
                      <WindowVoice available={!accountGated} agentShown={agentShown}>
                        <div
                          ref={stage.ref}
                          className="app-stage"
                          data-capture={String(run.captureMode)}
                          // The panel is drawn as an ordinary app window's content; desktop.css
                          // lays it out.
                          data-surface="desktop"
                          // The sidebar's width lays out the shell and Settings' page list, and
                          // places the voice's notice line over the work column beside it.
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
                          {/* A note to the people who make Luke, written in a dialog over the
          window. */}
                          <FeedbackDialog
                            kind={feedbackKind}
                            about={feedbackAbout}
                            account={account}
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
                          <InboxToasts onView={openInbox} shownInbox={tasks.inboxShown} />
                          <ChatToasts onView={openChat} shown={tasks.chatShown} />
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
                            readFiles={(taskId) =>
                              act(ACT_KIND.TASKS_TREE, {
                                planId: taskId,
                                path: "",
                                recursive: true,
                              })
                            }
                          />
                          {/* The tabs and places stood on last, across every task, behind ⌃Tab, on a desktop app past the sign-in. */}
                          <TabSwitcher
                            available={!accountGated}
                            tab={tab}
                            onTabChange={changeTab}
                            tasks={tasks}
                          />
                        </div>
                      </WindowVoice>
                    </ListedAutomations>
                  </GitHubConnectProvider>
                </RepositoryRemedyProvider>
              </OpenFeedbackProvider>
            </OpenPersonProvider>
          </PageWorkspaceProvider>
        </ListedPullRequests>
      </OpenLinkProvider>
    </OpenSettingsProvider>
  );
}
