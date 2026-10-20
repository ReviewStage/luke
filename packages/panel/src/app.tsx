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
  sessionReplayBootstrap,
} from "@luke/host/app-state";
import { APP_SETTING_SCHEMA, EXPERIMENT, type Experiment, VOICE_HOTKEY_NONE } from "@luke/settings";
import { SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { fixtureUpdate } from "@luke/settings/update-row";
import { appSettingsView } from "@luke/settings/wire";
import { cssCustomProperties } from "@luke/ui";
import { callBarTaskId, callCard, callCardShown } from "@luke/ui/call-card-model";
import { useLinkOpener } from "@luke/ui/held-link";
import { EXPERIMENT_OFF_LINK, LINK_ROUTE, linkRoute } from "@luke/ui/link-route";
import { forgetPictures } from "@luke/ui/picture-cache";
import { TASKS_PAGE } from "@luke/ui/tasks-model";
import { useStateWithRef } from "@luke/ui/use-state-with-ref";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import {
  type MicrophoneControl,
  NOTIFICATIONS_GRANTOR,
  type ShortcutControl,
  type UpdateControl,
} from "@luke/voice/settings-controls";
import type { VoiceSpeakers } from "@luke/voice/voice-view";
import {
  outputSilent,
  type VolumeHintDismissal,
  volumeHintDismissed,
  volumeHintText,
} from "@luke/voice/volume-hint";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "./act.js";
import { appBridge } from "./app-bridge.js";
import { runAppCommand, useAppCommand, useAppKeymap, useMenuCommands } from "./app-commands.js";
import { appPlatform } from "./app-platform.js";
import { usePrefetchEditorBundle } from "./bundle-loader.js";
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
import { useKeyboardModality } from "./keyboard-modality.js";
import { useLastSignIn } from "./last-sign-in.js";
import { PageWorkspaceProvider, useCopyLink } from "./links-at-hand.js";
import { prefetchMarkdownHtmlParser } from "./markdown-html-parser.js";
import { throughHistory, useHistoryMouseButtons, useWindowHistory } from "./navigation-history.js";
import { OpenFeedbackProvider } from "./open-feedback.js";
import { OpenSettingsProvider } from "./open-settings.js";
import { PANEL_TAB, type PanelTab } from "./panel-tabs.js";
import { OpenPersonProvider } from "./person-door.js";
import { testNotifications } from "./settings/notifications-press.js";
import { shownSettingsView } from "./settings/pages.js";
import { settingsRowsInput } from "./settings/settings-panel.js";
import { followSettingsLink, useSettingsPlace, useSettingsWorkspace } from "./settings-link.js";
import { useStageRoom } from "./stage-room.js";
import { type AgentPlace, useAgentEndToasts } from "./tasks/agent-end-toast.js";
import { useChatToasts } from "./tasks/chat-toast.js";
import { useInboxSettlingOwner } from "./tasks/inbox-settling.js";
import { useInboxToasts } from "./tasks/inbox-toast.js";
import { MessageRevealProvider } from "./tasks/message-links.js";
import { type RepositoryRemedyDoors, RepositoryRemedyProvider } from "./tasks/repository-remedy.js";
import { ThreadRevealProvider } from "./tasks/thread-reveal.js";
import { ListedPullRequestsProvider, OpenLinkProvider } from "./tasks/use-open-link.js";
import { useLeaveGuard, useTasksTab } from "./tasks/use-tasks-tab.js";
import { TOAST_HOLD, TOAST_TONE, ToastHost, useToast } from "./toast.js";
import { useUpdatedToast } from "./update-toast.js";
import { useAppState, useExperiment } from "./use-app-state.js";
import { useCaptionPresentation } from "./use-caption-presentation.js";
import { useSignIn } from "./use-sign-in.js";
import { useVisualViewport } from "./use-visual-viewport.js";
import { FIXTURE_SPEAKING_CAPTIONS, fixtureVoice, useVoiceView } from "./use-voice-view.js";
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

export function App(): React.JSX.Element {
  const { act, tell, updateSetting } = useAct();
  // Everything main holds, on the one channel it holds it on, and this
  // window's own facts beside it. There is no second reading to reconcile
  // against: what arrives is the whole document at a version that only rises.
  const state = useAppState();
  const account = state?.account;
  // A picture is read as the account signed in, so the window lets go of every one it read once that account changes.
  const accountKey =
    account?.status === ACCOUNT_STATUS.SIGNED_IN ? (account.id ?? account.email) : undefined;
  useEffect(() => {
    forgetPictures();
  }, [accountKey]);
  // A draft is its account's: the window reads the unsent words of the one signed in alone.
  useDraftsOwner(account?.status === ACCOUNT_STATUS.SIGNED_IN ? account : undefined);
  useInboxSettlingOwner(account?.status === ACCOUNT_STATUS.SIGNED_IN ? account : undefined);
  const outputAudio = state?.audio.outputAudio;
  const [tab, setTab] = useStateWithRef<PanelTab>(PANEL_TAB.TASKS);
  const settingsPlace = useSettingsPlace();
  const { onEnter: enterSettings, onChoose: chooseSettingsView } = settingsPlace;
  /** The settings the panel is drawing: the document's own. */
  const settings = useMemo(
    () => (state?.settings ? appSettingsView(state.settings) : undefined),
    [state?.settings],
  );
  /** The note being written to the people who make Luke, while its dialog stands. */
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>();
  /** The experiment that note is about, where an experiment's row opened it. */
  const [feedbackAbout, setFeedbackAbout] = useState<Experiment>();
  const openFeedbackAbout = useCallback((about: Experiment) => {
    setFeedbackAbout(about);
    setFeedbackKind(FEEDBACK_KIND.FEEDBACK);
  }, []);
  useUpdatedToast(state ? fixtureUpdate(state.run, state.update) : undefined);
  /**
   * Which stretch of unbroken silence is on screen, advanced each time one
   * begins. A "Got it" is remembered against the stretch it answered, so it
   * holds for that whole mute and lapses naturally with it.
   */
  const [silenceStretch, setSilenceStretch] = useState(0);
  const wasSilent = useRef(false);
  const [hintDismissal, setHintDismissal] = useState<VolumeHintDismissal>();

  /**
   * Recording follows the account: a sign-out ends it rather than leaving it
   * filed under the person who just left, and a sign-in can start one without
   * waiting for a relaunch. The document is the whole of what decides it, so
   * a halt raised before the account was cleared can never be undone by an
   * older reading arriving behind it.
   */
  const sessionReplay = state?.sessionReplay;
  const run = state?.run;
  useEffect(() => {
    if (!sessionReplay || !run) return;
    appPlatform().applySessionReplay(sessionReplayBootstrap({ run, sessionReplay }));
  }, [run, sessionReplay]);
  // The editor bundle loads once the panel has painted, so an agent's message box and a plan's editor find it there.
  const prefetchEditorBundle = usePrefetchEditorBundle();
  useEffect(prefetchEditorBundle, [prefetchEditorBundle]);
  // So does the parser a reply's markdown is drawn through, so a transcript opened finds it there.
  useEffect(prefetchMarkdownHtmlParser, []);
  // Note that the tab switch asks first while a page holds unsaved work, because Settings takes the window and the page with it.
  const leaveGuard = useLeaveGuard();
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
    state?.run.accountRequired === true && account?.status !== ACCOUNT_STATUS.SIGNED_IN;

  const signIn = useSignIn();
  const lastSignIn = useLastSignIn(account, state?.run.fixtureMode === true);

  // The menu bar's Help items open the same dialog Settings' buttons do.
  useAppCommand(APP_COMMAND.SEND_FEEDBACK, () => {
    setFeedbackAbout(undefined);
    setFeedbackKind(FEEDBACK_KIND.FEEDBACK);
  });
  useAppCommand(APP_COMMAND.SUGGEST_FEATURE, () => {
    setFeedbackAbout(undefined);
    setFeedbackKind(FEEDBACK_KIND.PROMPT);
  });

  /**
   * Moves the talk key, or resets it when no chord is named. The key the row
   * shows is not taken from this reply — the main process announces the one
   * that actually registered, the same way it always has — so the reply
   * carries only the stored choice and any refusal.
   */
  const changeVoiceHotkey = useCallback(
    (accelerator: string | undefined) =>
      updateSetting(APP_SETTING_SCHEMA.voiceHotkey.field, accelerator),
    [],
  );

  // ⌘+, ⌘−, and ⌘0 write the same setting Settings' Zoom pop-up does.
  useWindowZoom(settings?.zoom, (zoom) => updateSetting(APP_SETTING_SCHEMA.zoom.field, zoom));
  // In full screen the sidebar's toggle stands where the hidden traffic lights were.
  useWindowFullScreen(state?.window.fullScreen);

  // The stop key, under the same rule: the key the row shows follows the main
  // process's own announcement of what actually registered.
  const changeStopHotkey = useCallback(
    (accelerator: string | undefined) =>
      updateSetting(APP_SETTING_SCHEMA.stopHotkey.field, accelerator),
    [],
  );

  // True while a settings row is recording a chord. Both Luke keys stay
  // registered through a recording — the recording is how one gets replaced —
  // so a press of a current chord landing then is held here rather than
  // opening the microphone under the field being typed into.
  const shortcutCapture = useRef(false);
  const changeShortcutCapture = useCallback((capturing: boolean) => {
    shortcutCapture.current = capturing;
    // The talk and stop keys are routed by the main process to a window that
    // is not this one, so the recording is reported there to be honored.
    appPlatform().setShortcutCapturing(capturing);
  }, []);

  // A capture run stages its conversation from the launch profile, since no
  // voice window stands in one: who is heard, and for the muted run the hint
  // drawn over Luke's words, which a capture has no system output to read.
  const fixture = fixtureVoice(state?.run.profile ?? RUN_PROFILE.IDLE);
  const fixtureSpeaking = fixture !== undefined;
  const fixtureMuted = fixture?.muted ?? false;
  const {
    view: voiceView,
    speaking,
    listening,
    stopSpeaking,
    requestMicrophoneAccess,
  } = useVoiceView();
  const { voiceError, voiceNotice } = voiceView;
  // Who the wings, the face, and the strip answer to: the staged pair in a
  // capture run, the voice window's report otherwise.
  const speakers: VoiceSpeakers = fixture?.speakers ?? { listening, lukeSpeaking: speaking };
  // A capture run always draws the fixture's words: the voice window that
  // otherwise decides the captions does not stand in one.
  const lukeCaptions = fixtureSpeaking ? FIXTURE_SPEAKING_CAPTIONS : voiceView.lukeCaptions;
  const developerCaptions = fixtureSpeaking ? undefined : voiceView.developerCaptions;

  // The hint rides Luke's caption, and only over a silence the helper
  // actually reported. "Got it" quiets it for this stretch of silence and any
  // that follows too soon; the captions above it stay either way.
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
    tasks: state?.tasks ?? IDLE_TASKS_VIEW,
    run: state?.run ?? { fixtureMode: false, profile: RUN_PROFILE.IDLE },
    signedIn: account?.status === ACCOUNT_STATUS.SIGNED_IN,
    account: account?.status === ACCOUNT_STATUS.SIGNED_IN ? account.email : undefined,
    accountId: account?.status === ACCOUNT_STATUS.SIGNED_IN ? account.id : undefined,
    voiceAvailable: state?.settings?.status.voiceAvailable === true,
    microphoneStatus: state?.audio.microphoneStatus ?? MICROPHONE_STATUS.NOT_DETERMINED,
    shown: tab === PANEL_TAB.TASKS,
    unseenAgents: state?.codingAgents.unseen ?? NO_UNSEEN_AGENTS,
    inboxWaiting: state?.inbox.waiting ?? NOTHING_WAITING,
    inboxTasks: state?.inbox.tasks ?? NO_TASKS_HOLDING,
    inboxTaskless: state?.inbox.taskless ?? NOTHING_TASKLESS,
    failedRuns: state?.inbox.failedRuns ?? NO_FAILED_RUNS,
    voice: { view: voiceView, listening, requestMicrophoneAccess },
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
  const shownView = shownSettingsView(settingsPlace.view, state?.run.capabilities ?? []);
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
  // The call card's way back: the Tasks tab, on the call's task's document,
  // opening it where another task, or none, is open.
  const showTask = useRef(tasks.onShowTask);
  showTask.current = tasks.onShowTask;
  useEffect(
    () =>
      appBridge().onShowTask(({ taskId }) =>
        guardLeave(() => {
          changeTab(PANEL_TAB.TASKS);
          showTask.current(taskId);
        })(),
      ),
    [changeTab, guardLeave],
  );
  // The call card, while this window has the keyboard and its call bar is not
  // on screen: another task, the home page, Settings, or the task itself
  // under its version history, the Inbox, an agent's page, or a side panel filling the window.
  const focused = useWindowFocused();
  const taskShown = callBarTaskId({
    tasksTab: tab === PANEL_TAB.TASKS,
    documentPage: tasks.page === TASKS_PAGE.DOCUMENT,
    historyOpen: tasks.history.open,
    inboxOpen: tasks.inboxView.open || tasks.chatView.open,
    agentPageOpen: tasks.agentView.agentId !== undefined,
    sidePanelFullScreen: tasks.sidePanel.fullScreen,
    activeTaskId: state?.tasks.activeTaskId,
  });
  const callVideo = useCallCardVideo();
  const call: CallCardInput | undefined =
    !accountGated && callCardShown({ view: voiceView, focused, taskShown: taskShown })
      ? {
          card: callCard({ view: voiceView, tasks: state?.tasks ?? IDLE_TASKS_VIEW }),
          speakerMuted: voiceView.speakerMuted,
          controls: callControls(tell, voiceView.speakerMuted),
          video: callVideo,
        }
      : undefined;
  // An agent's end said in the toast while the window was focused: its View
  // goes where the notification's click would, and it goes with the agent's
  // unseen dot.
  useAgentEndToasts(openAgent, state?.codingAgents.unseen ?? NO_UNSEEN_AGENTS);
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
  useInboxToasts(
    openInbox,
    state?.inbox.waiting ?? NOTHING_WAITING,
    state?.version ?? 0,
    tasks.inboxShown,
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
    known: state !== undefined && !accountGated,
    link: copyLink.standing,
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
  // The sidebar folds only where it is drawn: Settings keeps its page list,
  // and the sign-in gate draws no sidebar at all. It folds by the room the
  // stage has, which on the desktop is the window's.
  const sidebar = useSidebarCollapse(state?.run.fixtureMode === true, stage.compact);

  const caption = useCaptionPresentation({
    lukeCaptions,
    developerCaptions,
    voiceError,
    voiceNotice,
    speakers,
    fixtureSpeaking,
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
    if (opened.current || !state?.settings) return;
    opened.current = true;
    appBridge().notifyReady();
  }, [state]);

  // Silence is counted in stretches — one per unbroken run of muted-or-zero —
  // because that is the unit a "Got it" answers. The edge into silence is the
  // only thing counted; every reading inside one stretch leaves it alone.
  useEffect(() => {
    const silent = outputSilent(outputAudio);
    if (silent && !wasSilent.current) setSilenceStretch((stretch) => stretch + 1);
    wasSilent.current = silent;
  }, [outputAudio]);

  /**
   * The hint's own button. It quiets the hint, never the captions: the words
   * stay for as long as the silence does, because they are what "got it"
   * leaves the user reading Luke by.
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
      // its call. That page is home, so a press there does nothing.
      tasks.back();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    signIn.cancelSignIn,
    signIn.signInWait,
    listening,
    tasks.back,
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
  if (!state || !settings) return <div />;

  const shownStopHotkey = state.hotkeys.stop;

  const microphone: MicrophoneControl = {
    status: state.audio.microphoneStatus,
    voiceAvailable: settings.voiceAvailable,
    onRequest: requestMicrophoneAccess,
    onOpenSettings: () => tell(ACT_KIND.MICROPHONE_OPEN_SETTINGS),
  };
  const updates: UpdateControl = {
    update: fixtureUpdate(state.run, state.update),
    build: {
      packaged: state.run.packaged,
      ...(state.run.commit ? { commit: state.run.commit } : undefined),
    },
    // Answered rather than fire-and-forget so the row that asked redraws from
    // the same snapshot the broadcast carries to every other window.
    onCheck: async () => {
      await act(ACT_KIND.UPDATE_CHECK);
    },
    onInstall: () => tell(ACT_KIND.UPDATE_INSTALL),
    onOpenLatest: () => tell(ACT_KIND.UPDATE_OPEN_RELEASE),
  };
  const shortcuts: ShortcutControl = {
    ...(state.hotkeys.talk ? { voiceHotkey: state.hotkeys.talk } : undefined),
    voiceHotkeyHeld: state.hotkeys.talkHeld,
    voiceChosen: settings?.voiceHotkey !== undefined,
    voiceOff: settings?.voiceHotkey === VOICE_HOTKEY_NONE,
    onVoiceHotkeyChange: changeVoiceHotkey,
    // Both rows take the accelerator: they draw the keys apart and
    // label the chord whole for the buttons beside them.
    ...(shownStopHotkey ? { stopHotkey: shownStopHotkey } : undefined),
    stopChosen: settings?.stopHotkey !== undefined,
    stopOff: settings?.stopHotkey === VOICE_HOTKEY_NONE,
    onStopHotkeyChange: changeStopHotkey,
    onCapture: changeShortcutCapture,
  };
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
                        data-capture={String(state.run.captureMode)}
                        // The panel is drawn as an ordinary app window's content; desktop.css
                        // lays it out.
                        data-surface="desktop"
                        // The sidebar's width lays out the shell and Settings' page list, and
                        // places the captions over the work column beside it.
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
                              <DesktopShell
                                gates={{
                                  accountRequired: state.run.accountRequired,
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
                                captions={{
                                  caption,
                                  volumeHint: {
                                    wanted: volumeHintWanted,
                                    text: volumeHintText(outputAudio),
                                    onDismiss: dismissVolumeHint,
                                  },
                                }}
                                settings={{
                                  account: state.account,
                                  onSignOut: async () => {
                                    await act(ACT_KIND.ACCOUNT_SIGN_OUT);
                                  },
                                  // The delete happens at the service before anything local moves,
                                  // so a failure resolves to why and the account is still standing.
                                  onDeleteAccount: async () => {
                                    try {
                                      await act(ACT_KIND.ACCOUNT_DELETE);
                                      return { status: ACTION_RESULT_STATUS.ACCEPTED };
                                    } catch {
                                      return {
                                        status: ACTION_RESULT_STATUS.REJECTED,
                                        reason:
                                          "Luke could not delete the account. Try again in a moment.",
                                      };
                                    }
                                  },
                                  view: shownView,
                                  onViewChange: chooseSettingsView,
                                  microphone,
                                  notifications: {
                                    status: state.notifications.status,
                                    grantor:
                                      appPlatform().notificationsGrantor?.() ??
                                      NOTIFICATIONS_GRANTOR.MACOS,
                                    packaged: state.run.packaged,
                                    onOpenSettings: () =>
                                      tell(ACT_KIND.NOTIFICATIONS_OPEN_SETTINGS),
                                    onTest: testNotifications,
                                  },
                                  updates,
                                  settings,
                                  shortcuts,
                                  workspace,
                                  capabilities: state.run.capabilities,
                                }}
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
                        {/* The plans, the open plan's agents and files, every command the
          window can run now, and the settings, behind ⌘K, past the sign-in
          alone. */}
                        <CommandPalette
                          available={!accountGated}
                          tab={tab}
                          onTabChange={changeTab}
                          tasks={tasks}
                          links={copyLink}
                          settings={{
                            rows: settingsRowsInput({
                              settings,
                              microphone,
                              account: state.account,
                              capabilities: state.run.capabilities,
                              workspace,
                            }),
                            capabilities: state.run.capabilities,
                            onViewChange: chooseSettingsView,
                          }}
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
