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
import {
  APP_SETTING_SCHEMA,
  EXPERIMENT,
  type Experiment,
  type HostCapability,
} from "@luke/settings";
import { SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { cssCustomProperties } from "@luke/ui";
import { callBarAgentId, callCard, callCardShown } from "@luke/ui/call-card-model";
import { useLinkOpener } from "@luke/ui/held-link";
import { EXPERIMENT_OFF_LINK, LINK_ROUTE, linkRoute } from "@luke/ui/link-route";
import { forgetPictures } from "@luke/ui/picture-cache";
import { isAgentTab } from "@luke/ui/tab-strip-model";
import { TASKS_PAGE } from "@luke/ui/tasks-model";
import { useStateWithRef } from "@luke/ui/use-state-with-ref";
import { MICROPHONE_STATUS, type MicrophoneStatus } from "@luke/voice/audio";
import type { VoiceSpeakers } from "@luke/voice/voice-view";
import {
  outputSilent,
  type VolumeHintDismissal,
  volumeHintDismissed,
  volumeHintText,
} from "@luke/voice/volume-hint";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import * as Atom from "effect/reactivity/Atom";
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "./act.js";
import { appBridge } from "./app-bridge.js";
import { runAppCommand, useAppCommand, useAppKeymap, useMenuCommands } from "./app-commands.js";
import { appPlatform } from "./app-platform.js";
import { type SettingsDoors, useSettingsPanel, useShownUpdate } from "./app-settings.js";
import { type CallCardInput, callControls } from "./call/call-card.js";
import { useCallCardVideo } from "./call/panel-avatar.js";
import { useWindowFocused } from "./call/use-window-focused.js";
import { useDraftsOwner } from "./composer-drafts.js";
import { CommandPalette } from "./desktop/command-palette.js";
import { DesktopShell } from "./desktop/desktop-shell.js";
import { type FailedRunPlace, useFailedRunToasts } from "./desktop/failed-runs.js";
import { ListedAutomations } from "./desktop/listed-automations.js";
import { useSidebarCollapse } from "./desktop/sidebar-collapse.js";
import { FeedbackDialog } from "./feedback-dialog.js";
import { GitHubConnectProvider } from "./github-connect.js";
import { stepTitle } from "./history-titles.js";
import { useKeyboardModality } from "./keyboard-modality.js";
import { useLastSignIn } from "./last-sign-in.js";
import { LinkMenu } from "./link-menu.js";
import { PageWorkspaceProvider, useCopyLink } from "./links-at-hand.js";
import { throughHistory, useHistoryMouseButtons, useWindowHistory } from "./navigation-history.js";
import { OpenFeedbackProvider } from "./open-feedback.js";
import { OpenSettingsProvider } from "./open-settings.js";
import { PANEL_TAB, type PanelTab } from "./panel-tabs.js";
import { OpenPersonProvider } from "./person-door.js";
import { settingsRowsInput, shownSettingsView } from "./settings/settings-rows.js";
import { followSettingsLink, useSettingsPlace, useSettingsWorkspace } from "./settings-link.js";
import { useStageRoom } from "./stage-room.js";
import { type AgentPlace, useAgentEndToasts } from "./tasks/agent-end-toast.js";
import { useChatOn } from "./tasks/chat-gate.js";
import { useChatToasts } from "./tasks/chat-toast.js";
import { useInboxSettlingOwner } from "./tasks/inbox-settling.js";
import { useInboxToasts } from "./tasks/inbox-toast.js";
import { MessageRevealProvider } from "./tasks/message-links.js";
import { type RepositoryRemedyDoors, RepositoryRemedyProvider } from "./tasks/repository-remedy.js";
import { useTasksFixtureLanded } from "./tasks/tasks-fixture-loader.js";
import { ThreadRevealProvider } from "./tasks/thread-reveal.js";
import { ListedPullRequestsProvider, OpenLinkProvider } from "./tasks/use-open-link.js";
import { type LeaveAsk, useLeaveGuard, useTasksTab } from "./tasks/use-tasks-tab.js";
import { TOAST_HOLD, TOAST_TONE, ToastHost, useToast } from "./toast.js";
import { useUpdatedToast } from "./update-toast.js";
import {
  APP_SETTINGS_VIEW,
  APP_SLICE,
  appStateDerivedAtom,
  SETTINGS_HELD,
  useAppSlice,
  useExperiment,
  VOICE_AVAILABLE,
} from "./use-app-state.js";
import { useSignIn } from "./use-sign-in.js";
import { usePrefetchBundles, useSessionReplay } from "./use-startup-work.js";
import { useVisualViewport } from "./use-visual-viewport.js";
import { useVoiceNotice } from "./use-voice-notice.js";
import { fixtureVoice, useCallTranscript, useVoiceView } from "./use-voice-view.js";
import { useWindowFullScreen } from "./window-full-screen.js";
import { useWindowZoom } from "./window-zoom.js";

/** No agent ended unseen, as the document reads before main has answered. */
const NO_UNSEEN_AGENTS: readonly string[] = [];

/** Nothing waits on the developer, as the document reads before main has answered. */
const NOTHING_WAITING: readonly AppInboxTask[] = [];

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

/** The Mac's output as last read, which the volume hint answers. */
const OUTPUT_AUDIO = Atom.map(APP_SLICE.AUDIO, (audio) => audio?.outputAudio);

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

/**
 * The window, drawn once a fixture run's synthetic tasks have landed. They are
 * imported apart from the bundle every launch parses, and drawn from the first
 * frame so that a capture, and the history entry the window's first place
 * writes, never see the tasks arrive after the rest.
 */
export function App(): React.JSX.Element {
  const fixtureMode = useAppSlice(FIXTURE_MODE);
  const landed = useTasksFixtureLanded(fixtureMode);
  return landed ? <AppWindow /> : <></>;
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
  const outputAudio = useAppSlice(OUTPUT_AUDIO);
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
  /**
   * Which stretch of unbroken silence is on screen, advanced each time one
   * begins. A "Got it" is remembered against the stretch it answered, so it
   * holds for that whole mute and lapses naturally with it.
   */
  const [silenceStretch, setSilenceStretch] = useState(0);
  const wasSilent = useRef(false);
  const [hintDismissal, setHintDismissal] = useState<VolumeHintDismissal>();

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

  // A capture run stages its conversation from the launch profile, since no
  // voice window stands in one: who is heard, and for the muted run the hint
  // drawn over Luke's words, which a capture has no system output to read.
  const fixture = fixtureVoice(run?.profile ?? RUN_PROFILE.IDLE);
  const fixtureSpeaking = fixture !== undefined;
  const fixtureMuted = fixture?.muted ?? false;
  const {
    view: voiceView,
    speaking,
    listening,
    stopSpeaking,
    requestMicrophoneAccess,
  } = useVoiceView();
  const callTranscript = useCallTranscript();
  const { voiceError, voiceNotice } = voiceView;
  // Who the wings, the face, and the strip answer to: the staged pair in a
  // capture run, the voice window's report otherwise.
  const speakers: VoiceSpeakers = fixture?.speakers ?? { listening, lukeSpeaking: speaking };
  // The hint asks while Luke speaks, and only over a silence the helper
  // actually reported. "Got it" quiets it for this stretch of silence and any
  // that follows too soon.
  const volumeHintWanted =
    fixtureMuted ||
    (outputSilent(outputAudio) && !volumeHintDismissed(hintDismissal, silenceStretch, Date.now()));
  // The room the stage's width gives, on the desktop the window's: whether
  // the panel stands as one pane (`shell-room.ts`), and whether the sidebar
  // folds. Only crossing a line draws the shell again, never a pixel's drag.
  const stage = useStageRoom();
  const room = stage.room;
  // The Tasks tab, drawn from the same voice report the strip reads, so a
  // task call's words and levels are the shape's as any call's are.
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
    voice: { view: voiceView, callTranscript, listening, requestMicrophoneAccess },
    onOpenSettings: (link) => openSettings(link),
    onOpenIntegrations: () => openSettings({ page: SETTINGS_VIEW.INTEGRATIONS }),
    onOpenApiKeys: () => openSettings({ page: SETTINGS_VIEW.CODING_AGENTS }),
    leaveGuard,
    room,
  });
  // A Browser tab left open as its experiment goes off closes, its page with
  // it, on whatever plan and whatever the window shows, Settings included.
  const browsing = useExperiment(EXPERIMENT.BROWSER);
  const { onCloseBrowsers } = tasks.sidePanel;
  useEffect(() => {
    if (!browsing) onCloseBrowsers();
  }, [browsing, onCloseBrowsers]);
  // The workspace Settings shows: the sidebar's, or one a link named while Settings stays open.
  const settingsWorkspace = useSettingsWorkspace({
    listedId: tasks.workspace?.id,
    workspaces: tasks.workspaces,
    settingsShown: tab === PANEL_TAB.SETTINGS,
  });
  linkWorkspace.current = settingsWorkspace.link;
  // The page Settings shows, which a link to one the platform does not offer leaves on Profile.
  const shownView = shownSettingsView(settingsPlace.view, run?.capabilities ?? NO_CAPABILITIES);
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
  const factoryOn = useExperiment(EXPERIMENT.FACTORY);
  const chatOn = useChatOn();
  const toast = useToast();
  // A pull request a listed task's agent opened opens in that agent's Pull request tab wherever it is pressed (`use-open-link.ts`).
  const listedTasks = useMemo(
    () => [...tasks.tasks, ...tasks.archived],
    [tasks.tasks, tasks.archived],
  );
  const openLukeLink = (link: ReadLink) => {
    const route = linkRoute(link, {
      workspaces: tasks.workspaces,
      factoryOn,
      chatOn,
    });
    if (route.kind === LINK_ROUTE.SETTINGS) {
      openSettings(route.settings);
    } else if (route.kind === LINK_ROUTE.EXPERIMENT_OFF) {
      toast({ words: EXPERIMENT_OFF_LINK, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
    } else {
      guardLeave(() => {
        changeTab(PANEL_TAB.TASKS);
        tasks.onOpenLink(link);
      })();
    }
  };
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
  // The call card, while this window has the keyboard and its call bar is not
  // on screen: another agent's tab or none, the home page, Settings, or the
  // agent's own task under its version history, the Inbox, an agent's page,
  // or a side panel filling the window.
  const focused = useWindowFocused();
  const columnTab = tasks.mainTabs.tab;
  const agentShown = callBarAgentId({
    tasksTab: tab === PANEL_TAB.TASKS,
    documentPage: tasks.page === TASKS_PAGE.DOCUMENT,
    historyOpen: tasks.history.open,
    inboxOpen: tasks.inboxView.open || tasks.chatView.open,
    agentPageOpen: tasks.agentView.agentId !== undefined,
    sidePanelFullScreen: tasks.sidePanel.fullScreen,
    columnAgentId: columnTab !== undefined && isAgentTab(columnTab) ? columnTab.agent : undefined,
  });
  const callVideo = useCallCardVideo();
  const call: CallCardInput | undefined =
    !accountGated && callCardShown({ view: voiceView, focused, agentShown })
      ? {
          card: callCard({ view: voiceView, tasks: planning ?? IDLE_TASKS_VIEW }),
          speakerMuted: voiceView.speakerMuted,
          controls: callControls(tell, voiceView.speakerMuted),
          video: callVideo,
        }
      : undefined;
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
  // the workspace the message waits in, listing that workspace first where another is listed.
  const openChat = useCallback(
    (workspaceId: string) =>
      guardLeave(() => {
        const doors = inboxDoors.current;
        changeTab(PANEL_TAB.TASKS);
        if (doors.workspace?.id !== workspaceId) doors.onChooseWorkspace(workspaceId);
        doors.chatView.onOpen();
      })(),
    [changeTab, guardLeave],
  );
  useEffect(() => appBridge().onShowChat(({ workspaceId }) => openChat(workspaceId)), [openChat]);
  useChatToasts(openChat, tasks.chatShown);
  // Where the window has stood, for back and forward, from the moment it
  // knows where it stands.
  const history = useWindowHistory({
    known: run !== undefined && !accountGated,
    link: copyLink.standing,
    title: stepTitle(tab, tasks),
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
  const shellTasks = throughHistory(tasks, history.lists);
  // Escape reads the latest of them as it lands, so its listener stays the same across renders.
  const shellDoors = useRef(shellTasks);
  shellDoors.current = shellTasks;
  // The sidebar folds only where it is drawn: Settings keeps its page list,
  // and the sign-in gate draws no sidebar at all. It folds by the room the
  // stage has, which on the desktop is the window's.
  const sidebar = useSidebarCollapse(run?.fixtureMode === true, stage.compact);

  const notice = useVoiceNotice({
    voiceError,
    voiceNotice,
    speakers,
    fixtureSpeaking,
    volumeHint: { wanted: volumeHintWanted, text: volumeHintText(outputAudio) },
  });

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

  // Silence is counted in stretches — one per unbroken run of muted-or-zero —
  // because that is the unit a "Got it" answers. The edge into silence is the
  // only thing counted; every reading inside one stretch leaves it alone.
  useEffect(() => {
    const silent = outputSilent(outputAudio);
    if (silent && !wasSilent.current) setSilenceStretch((stretch) => stretch + 1);
    wasSilent.current = silent;
  }, [outputAudio]);

  /**
   * The hint's own button. It quiets the hint for this stretch of silence;
   * Luke's words go on streaming into the transcript, which is what "got
   * it" leaves the user reading him by.
   */
  const dismissVolumeHint = useCallback(() => {
    setHintDismissal({ at: Date.now(), stretch: silenceStretch });
  }, [silenceStretch]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Muting an open microphone comes before any of it. Closing the panel
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
      if (listening || speaking) {
        stopSpeaking();
        return;
      }
      // Escape on a gate waiting for the browser withdraws the sign-in, as
      // its Cancel does: the wait is the only thing on screen.
      if (signIn.signInWait) {
        signIn.cancelSignIn();
        return;
      }
      // A dialog that took the press for itself is the nearest layer of all.
      if (event.defaultPrevented) return;
      // Otherwise it closes the nearest thing that is open, one layer at a
      // time: Settings, a plan's version history, an agent's or a person's page, Factory, the Automations page, or the Board, back to wherever it was
      // opened from, then a side panel filling the window back beside its
      // task, then an open task back to the home page. A menu and the
      // settings search answer their own Escapes and keep them — the search
      // clearing, then letting go of the caret — so neither is a layer here,
      // bar the caret Settings opens with, whose untouched Escape leaves it.
      // The Inbox is the one page Escape never leaves: a narrow one's item
      // steps back to its list, and there the press stops, rather than
      // reaching the plan the Inbox stands over.
      if (runAppCommand(APP_COMMAND.EXIT_SETTINGS)) return;
      if (runAppCommand(APP_COMMAND.EXIT_VERSION_HISTORY)) return;
      if (runAppCommand(APP_COMMAND.INBOX_LIST) || tasks.inboxView.open) return;
      // Chat is the Inbox's like: Escape stops at it rather than reaching the plan beneath.
      if (tasks.chatView.open) return;
      if (runAppCommand(APP_COMMAND.EXIT_AGENT_PAGE)) return;
      if (runAppCommand(APP_COMMAND.EXIT_PERSON_PAGE)) return;
      if (runAppCommand(APP_COMMAND.EXIT_FACTORY)) return;
      if (runAppCommand(APP_COMMAND.EXIT_AUTOMATIONS)) return;
      if (runAppCommand(APP_COMMAND.EXIT_BOARD)) return;
      // An open task unwinds to the home page, which leaves it and ends
      // its call. That page is home, so a press there does nothing. A side
      // panel standing only full screen shuts through the history, as its
      // Close does.
      shellDoors.current.back();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    signIn.cancelSignIn,
    signIn.signInWait,
    listening,
    tasks.inboxView.open,
    tasks.chatView.open,
    speaking,
    stopSpeaking,
  ]);

  // The window's shortcuts, from the keys and from the menu bar alike.
  useAppKeymap(true);
  useMenuCommands(true);
  useHistoryMouseButtons(history, true);

  // Nothing is drawn over a state the window has not been told, nor over a
  // runtime that could not answer for the settings every row reads.
  if (run === undefined || !settingsHeld) return <div />;

  // The Workspace page shows the workspace the sidebar lists, or one a link named.
  const workspace = {
    workspaces: tasks.workspaces,
    workspaceId: settingsWorkspace.shownId,
    // A leave closes Settings onto the Tasks tab, whose Home the tab turns to.
    onLeft: (workspaceId: string) => {
      tasks.onLeftWorkspace(workspaceId);
      changeTab(PANEL_TAB.TASKS);
    },
    listFailed: tasks.listFailed,
    onRetryList: tasks.onRetryList,
  };
  // What Settings and ⌘K answer through; the settings themselves they read where they draw them.
  const settingsDoors: SettingsDoors = {
    view: shownView,
    onViewChange: chooseSettingsView,
    onSignOut: signOut,
    onDeleteAccount: deleteAccount,
    onRequestMicrophone: requestMicrophoneAccess,
    workspace,
  };

  // A remedy under a refused start or message mends the task's repository through the Tasks tab's doors.
  const repositoryRemedies: RepositoryRemedyDoors = {
    openWorkspaceGitHub: tasks.onOpenWorkspaceGitHub,
    openGitHub: tasks.repositories.openGitHub,
    chooseRepository: tasks.onChangeRepository,
    moveTask: tasks.onMoveTask,
  };

  // A person pressed anywhere in the window opens their page on the Plans tab, in the workspace the place named them in.
  const openPerson = (userId: string, name?: string, workspaceId?: string) => {
    changeTab(PANEL_TAB.TASKS);
    tasks.personView.onOpen(userId, name, workspaceId);
  };

  return (
    <OpenSettingsProvider value={openSettings}>
      <OpenLinkProvider value={openLukeLink}>
        <ListedPullRequestsProvider value={listedTasks}>
          <PageWorkspaceProvider value={copyLink.onPageWorkspace}>
            <OpenPersonProvider value={openPerson}>
              <OpenFeedbackProvider value={openFeedbackAbout}>
                <RepositoryRemedyProvider value={repositoryRemedies}>
                  <GitHubConnectProvider
                    value={{
                      connection: tasks.github,
                      connect: tasks.onConnectAccountGitHub,
                      disconnect: tasks.onDisconnectAccountGitHub,
                    }}
                  >
                    <ListedAutomations tasks={tasks}>
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
                        <div className="desktop-stage">
                          <MessageRevealProvider
                            value={{
                              reveal: tasks.messageReveal,
                              onRevealed: tasks.onMessageRevealed,
                            }}
                          >
                            <ThreadRevealProvider
                              value={{
                                reveal: tasks.threadReveal,
                                onRevealed: tasks.onThreadRevealed,
                              }}
                            >
                              <SettingsShell
                                gates={{
                                  accountRequired: run.accountRequired,
                                  signInWait: signIn.signInWait,
                                  signInFailure: signIn.signInFailure,
                                  lastSignIn,
                                  onBeginSignIn: signIn.beginSignIn,
                                  onCancelSignIn: signIn.cancelSignIn,
                                }}
                                tab={tab}
                                onTabChange={changeTab}
                                tasks={shellTasks}
                                history={history}
                                sidebar={sidebar}
                                room={room}
                                settingsStep={{
                                  listed: settingsPlace.listed,
                                  onList: history.lists.settings,
                                }}
                                call={call}
                                notice={{ notice, onDismissHint: dismissVolumeHint }}
                                doors={settingsDoors}
                              />
                            </ThreadRevealProvider>
                          </MessageRevealProvider>
                        </div>
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
                        {/* The menu a right-click on any link in the window hangs. */}
                        <LinkMenu />
                        <UpdatedToast />
                        <InboxToasts onView={openInbox} shownInbox={tasks.inboxShown} />
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
                            act(ACT_KIND.TASKS_TREE, { planId: taskId, path: "", recursive: true })
                          }
                        />
                      </div>
                    </ListedAutomations>
                  </GitHubConnectProvider>
                </RepositoryRemedyProvider>
              </OpenFeedbackProvider>
            </OpenPersonProvider>
          </PageWorkspaceProvider>
        </ListedPullRequestsProvider>
      </OpenLinkProvider>
    </OpenSettingsProvider>
  );
}
