import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { PRODUCT_SURFACE_EVENT } from "@luke/features/analytics";
import { FEEDBACK_KIND, type FeedbackKind } from "@luke/features/feedback";
import { MENTION_KIND, type PlanMention } from "@luke/features/mention-link";
import { IDLE_PLANNING_VIEW } from "@luke/features/planning-view";
import { ACT_KIND } from "@luke/host/acts";
import {
  type AppInboxPlan,
  type AppInboxPlanHolding,
  RUN_PROFILE,
  sessionReplayBootstrap,
} from "@luke/host/app-state";
import { APP_SETTING_SCHEMA, type Experiment, VOICE_HOTKEY_NONE } from "@luke/settings";
import { SETTINGS_VIEW, type SettingsLink, type SettingsView } from "@luke/settings/settings-views";
import { fixtureUpdate } from "@luke/settings/update-row";
import { appSettingsView } from "@luke/settings/wire";
import { cssCustomProperties } from "@luke/ui";
import { callBarPlanId, callCard, callCardShown } from "@luke/ui/call-card-model";
import { useLinkOpener } from "@luke/ui/held-link";
import { PLANS_PAGE } from "@luke/ui/planning-model";
import { useStateWithRef } from "@luke/ui/use-state-with-ref";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import type {
  MicrophoneControl,
  ShortcutControl,
  UpdateControl,
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
import { APP_COMMAND } from "#shared/shortcuts";
import { useAct } from "./act";
import { runAppCommand, useAppCommand, useAppKeymap, useMenuCommands } from "./app-commands";
import { type CallCardInput, callControls } from "./call/call-card";
import { useWindowFocused } from "./call/use-window-focused";
import { CommandPalette } from "./desktop/command-palette";
import { DesktopShell } from "./desktop/desktop-shell";
import { useSidebarCollapse } from "./desktop/sidebar-collapse";
import { prefetchEditorBundle } from "./editor-bundle";
import { FeedbackDialog } from "./feedback-dialog";
import { GitHubConnectProvider } from "./github-connect";
import { useKeyboardModality } from "./keyboard-modality";
import { useLastSignIn } from "./last-sign-in";
import { prefetchMarkdownHtmlParser } from "./markdown-html-parser";
import { useHistoryMouseButtons, useWindowHistory } from "./navigation-history";
import { OpenFeedbackProvider } from "./open-feedback";
import { OpenSettingsProvider } from "./open-settings";
import { PANEL_TAB, type PanelTab } from "./panel-tabs";
import { useAgentEndToasts } from "./planning/agent-end-toast";
import { useInboxToasts } from "./planning/inbox-toast";
import { type RepositoryRemedyDoors, RepositoryRemedyProvider } from "./planning/repository-remedy";
import { OpenPlanProvider } from "./planning/use-open-link";
import { usePlansTab } from "./planning/use-plans-tab";
import { applySessionReplay } from "./session-replay";
import { settingsRowsInput } from "./settings/settings-panel";
import { followSettingsLink } from "./settings-link";
import { useSignInFaceCycle } from "./sign-in-gate";
import { ToastHost } from "./toast";
import { useUpdatedToast } from "./update-toast";
import { useAppState } from "./use-app-state";
import { useCaptionPresentation } from "./use-caption-presentation";
import { usePrefersReducedMotion } from "./use-reduced-motion";
import { useSignIn } from "./use-sign-in";
import { FIXTURE_SPEAKING_CAPTIONS, fixtureVoice, useVoiceView } from "./use-voice-view";
import { useWindowFullScreen } from "./window-full-screen";
import { useWindowZoom } from "./window-zoom";

/** No agent ended unseen, as the document reads before main has answered. */
const NO_UNSEEN_AGENTS: readonly string[] = [];

/** Nothing waits on the developer, as the document reads before main has answered. */
const NOTHING_WAITING: readonly AppInboxPlan[] = [];

/** No plan holds an inbox item, as the document reads before main has answered. */
const NO_PLANS_HOLDING: readonly AppInboxPlanHolding[] = [];

export function App(): React.JSX.Element {
  const { act, tell, updateSetting } = useAct();
  // Everything main holds, on the one channel it holds it on, and this
  // window's own facts beside it. There is no second reading to reconcile
  // against: what arrives is the whole document at a version that only rises.
  const state = useAppState();
  const account = state?.account;
  const outputAudio = state?.audio.outputAudio;
  const [tab, setTab] = useStateWithRef<PanelTab>(PANEL_TAB.PLANS);
  const [settingsView, setSettingsView] = useStateWithRef<SettingsView>(SETTINGS_VIEW.ACCOUNT);
  /** The workspace Settings' Workspace page shows, where a link or its picker named one; the sidebar's otherwise. */
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState<string>();
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
    applySessionReplay(sessionReplayBootstrap({ run, sessionReplay }));
  }, [run, sessionReplay]);
  // The editor bundle loads once the panel has painted, so an agent's message box and a plan's editor find it there.
  useEffect(prefetchEditorBundle, []);
  // So does the parser a reply's markdown is drawn through, so a transcript opened finds it there.
  useEffect(prefetchMarkdownHtmlParser, []);
  const changeTab = useCallback(
    (next: PanelTab) => {
      setTab(next);
      // Arriving at the tab is arriving at its first page, Account: a page
      // left open behind a tab switch would greet the next visit with a
      // corner of the settings rather than the settings. A flow that needs
      // another page sets it right after this reset.
      setSettingsView(SETTINGS_VIEW.ACCOUNT);
      // `PanelTab` and the counted tab are the same union: both are
      // `APP_PANEL_TAB`'s own set, which `PanelTab` aliases.
      window.luke.recordSurfaceEvent(PRODUCT_SURFACE_EVENT.PANEL_TAB_CHANGE, {
        panel_tab: next,
      });
    },
    [setSettingsView, setTab],
  );
  /**
   * Opens Settings at the place a link names: its page, the workspace the
   * Workspace page shows, and its section, which is looked for once drawn
   * and given up on by itself.
   */
  const openSettings = useCallback(
    (link: SettingsLink) => {
      followSettingsLink(link, {
        changeTab,
        changeView: setSettingsView,
        changeWorkspace: setSettingsWorkspaceId,
      });
    },
    [changeTab, setSettingsView],
  );

  /** True while sign-in stands between Luke and anything to watch: the gate is then what the window shows. */
  const accountGated =
    state?.run.accountRequired === true && account?.status !== ACCOUNT_STATUS.SIGNED_IN;

  /**
   * The one signed-out Luke's introduction cycle — sway, pirouette, double
   * blink, curious tilt, nod — walked over the sign-in gate. Still while
   * signed in, so the timer is not left running under the plans.
   */
  const signInFace = useSignInFaceCycle(usePrefersReducedMotion() || !accountGated);

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
    window.luke.setShortcutCapturing(capturing);
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
  // The Plans tab, drawn from the same voice report the strip reads, so a
  // planning call's words and levels are the shape's as any call's are.
  const plans = usePlansTab({
    acts: { act, tell },
    planning: state?.planning ?? IDLE_PLANNING_VIEW,
    run: state?.run ?? { fixtureMode: false, profile: RUN_PROFILE.IDLE },
    signedIn: account?.status === ACCOUNT_STATUS.SIGNED_IN,
    account: account?.status === ACCOUNT_STATUS.SIGNED_IN ? account.email : undefined,
    accountId: account?.status === ACCOUNT_STATUS.SIGNED_IN ? account.id : undefined,
    voiceAvailable: state?.settings?.status.voiceAvailable === true,
    microphoneStatus: state?.audio.microphoneStatus ?? MICROPHONE_STATUS.NOT_DETERMINED,
    shown: tab === PANEL_TAB.PLANS,
    unseenAgents: state?.codingAgents.unseen ?? NO_UNSEEN_AGENTS,
    inboxWaiting: state?.inbox.waiting ?? NOTHING_WAITING,
    inboxPlans: state?.inbox.plans ?? NO_PLANS_HOLDING,
    voice: { view: voiceView, listening, requestMicrophoneAccess },
    onOpenSettings: (link) => openSettings(link),
    // Through the one opener, so a workspace an earlier link chose is not left showing.
    onOpenIntegrations: () => openSettings({ page: SETTINGS_VIEW.INTEGRATIONS }),
    onOpenApiKeys: () => openSettings({ page: SETTINGS_VIEW.CODING_AGENTS }),
  });
  // A coding agent's notification clicked: the Plans tab, on that agent,
  // its plan's tab or its own page where it has no plan. Read through refs,
  // because the tab hands new closures each render and the subscription is
  // owed to the window, not to a render.
  const showAgent = useRef(plans.onShowAgent);
  showAgent.current = plans.onShowAgent;
  const showAgentPage = useRef(plans.agentView.onOpen);
  showAgentPage.current = plans.agentView.onOpen;
  useEffect(
    () =>
      window.luke.onShowAgent(({ planId, agentId }) => {
        changeTab(PANEL_TAB.PLANS);
        if (planId === null) showAgentPage.current(agentId);
        else showAgent.current(planId, agentId);
      }),
    [changeTab],
  );
  // A Luke link the system handed the app: the Plans tab, on its plan, scrolled to its section, once sign-in no longer stands in the way.
  const openLink = useLinkOpener(accountGated, (mention) => {
    changeTab(PANEL_TAB.PLANS);
    plans.onShowMention(mention);
  });
  useEffect(
    () =>
      window.luke.onShowLink(({ planId, anchor }) =>
        openLink(
          anchor === undefined
            ? { kind: MENTION_KIND.PLAN, planId }
            : { kind: MENTION_KIND.SECTION, planId, anchor },
        ),
      ),
    [openLink],
  );
  // The call card's way back: the Plans tab, on the call's plan's document,
  // opening it where another plan, or none, is open.
  const showPlan = useRef(plans.onShowPlan);
  showPlan.current = plans.onShowPlan;
  useEffect(
    () =>
      window.luke.onShowPlan(({ planId }) => {
        changeTab(PANEL_TAB.PLANS);
        showPlan.current(planId);
      }),
    [changeTab],
  );
  // The call card, while this window has the keyboard and its call bar is not
  // on screen: another plan, the home page, Settings, or the plan itself
  // under its version history, the Inbox, an agent's page, or a side panel filling the window.
  const focused = useWindowFocused();
  const planShown = callBarPlanId({
    plansTab: tab === PANEL_TAB.PLANS,
    documentPage: plans.page === PLANS_PAGE.DOCUMENT,
    historyOpen: plans.history.open,
    inboxOpen: plans.inboxView.open,
    agentPageOpen: plans.agentView.agentId !== undefined,
    sidePanelFullScreen: plans.sidePanel.fullScreen,
    activePlanId: state?.planning.activePlanId,
  });
  const call: CallCardInput | undefined =
    !accountGated && callCardShown({ view: voiceView, focused, planShown })
      ? {
          card: callCard({ view: voiceView, planning: state?.planning ?? IDLE_PLANNING_VIEW }),
          speakerMuted: voiceView.speakerMuted,
          controls: callControls(tell, voiceView.speakerMuted),
        }
      : undefined;
  // An agent's end said in the toast while the window was focused: its View
  // goes where the notification's click would, and it goes with the agent's
  // unseen dot.
  useAgentEndToasts((planId, agentId) => {
    changeTab(PANEL_TAB.PLANS);
    showAgent.current(planId, agentId);
  }, state?.codingAgents.unseen ?? NO_UNSEEN_AGENTS);
  // An inbox notification clicked, or an item's toast's View: the Plans tab, on that plan's Inbox.
  const showInbox = useRef(plans.onShowInbox);
  showInbox.current = plans.onShowInbox;
  const openInbox = useCallback(
    (planId: string) => {
      changeTab(PANEL_TAB.PLANS);
      showInbox.current(planId);
    },
    [changeTab],
  );
  useEffect(() => window.luke.onShowInbox(({ planId }) => openInbox(planId)), [openInbox]);
  useInboxToasts(
    openInbox,
    state?.inbox.waiting ?? NOTHING_WAITING,
    state?.version ?? 0,
    plans.inboxShown,
  );
  // Where the window has stood, for back and forward, from the moment it
  // knows where it stands.
  const history = useWindowHistory({
    known: state !== undefined && !accountGated,
    tab,
    onTabChange: changeTab,
    settingsView,
    onSettingsViewChange: setSettingsView,
    plans,
  });
  // The sidebar folds only where it is drawn: Settings keeps its page list,
  // and the sign-in gate draws no sidebar at all.
  const sidebar = useSidebarCollapse(state?.run.fixtureMode === true);

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

  /**
   * The report that the window has painted, made once, on the first snapshot
   * that carries settings.
   */
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !state?.settings) return;
    opened.current = true;
    window.luke.notifyReady();
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
      // time: Settings, a plan's version history, the Inbox, or Factory, back to wherever it was
      // opened from, then a side panel filling the window back beside its
      // plan, then an open plan back to the home page. A menu and the
      // settings search answer their own Escapes and keep them — the search
      // clearing, then letting go of the caret — so neither is a layer here.
      if (runAppCommand(APP_COMMAND.EXIT_SETTINGS)) return;
      if (runAppCommand(APP_COMMAND.EXIT_VERSION_HISTORY)) return;
      if (runAppCommand(APP_COMMAND.EXIT_INBOX)) return;
      if (runAppCommand(APP_COMMAND.EXIT_AGENT_PAGE)) return;
      if (runAppCommand(APP_COMMAND.EXIT_FACTORY)) return;
      // An open plan unwinds to the home page, which leaves it and ends
      // its call. That page is home, so a press there does nothing.
      plans.back();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [signIn.cancelSignIn, signIn.signInWait, listening, plans.back, speaking, stopSpeaking]);

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
  // The Workspace page shows the workspace a link or its picker chose, the sidebar's otherwise.
  const workspace = {
    workspaces: plans.workspaces,
    workspaceId: settingsWorkspaceId ?? plans.workspace?.id,
    onChooseWorkspace: setSettingsWorkspaceId,
    onLeft: (workspaceId: string) => {
      plans.onLeftWorkspace(workspaceId);
      setSettingsWorkspaceId(undefined);
    },
    listFailed: plans.listFailed,
    onRetryList: plans.onRetryList,
  };

  // A remedy under a refused start or message mends the plan's repository through the Plans tab's doors.
  const repositoryRemedies: RepositoryRemedyDoors = {
    openWorkspaceGitHub: plans.onOpenWorkspaceGitHub,
    openGitHub: plans.repositories.openGitHub,
    chooseRepository: plans.onChangeRepository,
    movePlan: plans.onMovePlan,
  };

  // A Luke link pressed anywhere in the window opens its plan on the Plans tab, scrolled to its section.
  const openPlan = (mention: PlanMention) => {
    changeTab(PANEL_TAB.PLANS);
    plans.onShowMention(mention);
  };

  return (
    <OpenSettingsProvider value={openSettings}>
      <OpenPlanProvider value={openPlan}>
        <OpenFeedbackProvider value={openFeedbackAbout}>
          <RepositoryRemedyProvider value={repositoryRemedies}>
            <GitHubConnectProvider
              value={{
                connection: plans.github,
                connect: plans.onConnectAccountGitHub,
                disconnect: plans.onDisconnectAccountGitHub,
              }}
            >
              <div
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
                  <DesktopShell
                    gates={{
                      accountRequired: state.run.accountRequired,
                      signInWait: signIn.signInWait,
                      signInFailure: signIn.signInFailure,
                      lastSignIn,
                      onBeginSignIn: signIn.beginSignIn,
                      onCancelSignIn: signIn.cancelSignIn,
                      signInFace,
                    }}
                    tab={tab}
                    onTabChange={changeTab}
                    plans={plans}
                    history={history}
                    sidebar={sidebar}
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
                            reason: "Luke could not delete the account. Try again in a moment.",
                          };
                        }
                      },
                      view: settingsView,
                      onViewChange: setSettingsView,
                      microphone,
                      notifications: {
                        refused: state.notifications.refused,
                        onOpenSettings: () => tell(ACT_KIND.NOTIFICATIONS_OPEN_SETTINGS),
                      },
                      updates,
                      settings,
                      shortcuts,
                      workspace,
                    }}
                  />
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
                  plans={plans}
                  settings={{
                    rows: settingsRowsInput({
                      settings,
                      microphone,
                      account: state.account,
                      workspace,
                    }),
                    onViewChange: setSettingsView,
                  }}
                  readFiles={(planId) =>
                    act(ACT_KIND.PLANNING_TREE, { planId, path: "", recursive: true })
                  }
                />
              </div>
            </GitHubConnectProvider>
          </RepositoryRemedyProvider>
        </OpenFeedbackProvider>
      </OpenPlanProvider>
    </OpenSettingsProvider>
  );
}
