import { PRODUCT_SURFACE_EVENT } from "@sidecar/analytics";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { FEEDBACK_KIND, type FeedbackKind } from "@sidecar/feedback";
import { IDLE_PLANNING_VIEW } from "@sidecar/hosted/planning-view";
import { APP_SETTING_SCHEMA, VOICE_HOTKEY_NONE } from "@sidecar/settings";
import { appSettingsView } from "@sidecar/settings/wire";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { RUN_PROFILE, sessionReplayBootstrap } from "#shared/messages/app-state";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import type { VoiceSpeakers } from "#shared/messages/voice-view";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAct } from "./act";
import { runAppCommand, useAppCommand, useAppKeymap, useMenuCommands } from "./app-commands";
import { DesktopShell } from "./desktop/desktop-shell";
import { useSidebarCollapse } from "./desktop/sidebar-collapse";
import { FeedbackDialog } from "./feedback-dialog";
import { MarkdownMessage } from "./markdown-message";
import { useHistoryMouseButtons, useWindowHistory } from "./navigation-history";
import { PANEL_TAB, type PanelTab } from "./panel-tabs";
import { usePlansTab } from "./planning/use-plans-tab";
import { applySessionReplay } from "./session-replay";
import type { MicrophoneControl, ShortcutControl, UpdateControl } from "./settings/controls";
import { SETTINGS_VIEW, type SettingsView } from "./settings-views";
import { useSignInFaceCycle } from "./sign-in-gate";
import { CAPTION_TONE } from "./strip-hold";
import { useAppState } from "./use-app-state";
import { useCaptionPresentation } from "./use-caption-presentation";
import { usePrefersReducedMotion } from "./use-reduced-motion";
import { useSignIn } from "./use-sign-in";
import { useStateWithRef } from "./use-state-with-ref";
import { FIXTURE_SPEAKING_CAPTIONS, fixtureVoice, useVoiceView } from "./use-voice-view";
import {
  outputSilent,
  type VolumeHintDismissal,
  volumeHintDismissed,
  volumeHintText,
} from "./volume-hint";

/** No agent ended unseen, as the document reads before main has answered. */
const NO_UNSEEN_AGENTS: readonly string[] = [];

export function App(): React.JSX.Element {
  const { act, tell, updateSetting } = useAct();
  // Everything main holds, on the one channel it holds it on, and this
  // window's own facts beside it. There is no second reading to reconcile
  // against: what arrives is the whole document at a version that only rises.
  const state = useAppState();
  const account = state?.account;
  const outputAudio = state?.audio.outputAudio;
  const [tab, setTab] = useStateWithRef<PanelTab>(PANEL_TAB.PLANS);
  const [settingsView, setSettingsView] = useStateWithRef<SettingsView>(SETTINGS_VIEW.ROOT);
  /** The settings the panel is drawing: the document's own. */
  const settings = useMemo(
    () => (state?.settings ? appSettingsView(state.settings) : undefined),
    [state?.settings],
  );
  /** The note being written to the people who make Luke, while its dialog stands. */
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>();
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
  const changeTab = useCallback(
    (next: PanelTab) => {
      setTab(next);
      // Arriving at the tab is arriving at its front page: a page left open
      // behind a tab switch would greet the next visit with a corner of the
      // settings rather than the settings. A flow that needs a deeper page
      // sets it right after this reset.
      setSettingsView(SETTINGS_VIEW.ROOT);
      // `PanelTab` and the counted tab are the same union: both are
      // `APP_PANEL_TAB`'s own set, which `PanelTab` aliases.
      window.sidecar.recordSurfaceEvent(PRODUCT_SURFACE_EVENT.PANEL_TAB_CHANGE, {
        panel_tab: next,
      });
    },
    [setSettingsView, setTab],
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

  // The menu bar's Help items open the same dialog Settings' buttons do.
  useAppCommand(APP_COMMAND.SEND_FEEDBACK, () => setFeedbackKind(FEEDBACK_KIND.FEEDBACK));
  useAppCommand(APP_COMMAND.SUGGEST_FEATURE, () => setFeedbackKind(FEEDBACK_KIND.PROMPT));

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
    window.sidecar.setShortcutCapturing(capturing);
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
    levels: voiceLevels,
    voiceActive,
    stopSpeaking,
    requestMicrophoneAccess,
  } = useVoiceView();
  const { voiceError, voiceNotice, talkOpening } = voiceView;
  // Who the wings, the face, and the strip answer to: the staged pair in a
  // capture run, the voice window's report otherwise.
  const speakers: VoiceSpeakers = fixture?.speakers ?? { listening, lukeSpeaking: speaking };
  // A capture run always draws the fixture's words: the voice window that
  // otherwise decides the captions does not stand in one.
  const lukeCaptions = fixtureSpeaking ? FIXTURE_SPEAKING_CAPTIONS : voiceView.lukeCaptions;
  const developerCaptions = fixtureSpeaking ? undefined : voiceView.developerCaptions;

  // The hint rides the caption it explains, and only over a silence the
  // helper actually reported. "Got it" quiets it for this stretch of silence
  // and any that follows too soon; the captions above it stay either way.
  const volumeHint =
    fixtureMuted ||
    (outputSilent(outputAudio) &&
      lukeCaptions !== undefined &&
      !volumeHintDismissed(hintDismissal, silenceStretch, Date.now()));
  // The Plans tab, drawn from the same voice report the strip reads, so a
  // planning call's words and levels are the shape's as any call's are.
  const plans = usePlansTab({
    acts: { act, tell },
    planning: state?.planning ?? IDLE_PLANNING_VIEW,
    run: state?.run ?? { fixtureMode: false, profile: RUN_PROFILE.IDLE },
    signedIn: account?.status === ACCOUNT_STATUS.SIGNED_IN,
    voiceAvailable: state?.settings?.status.voiceAvailable === true,
    microphoneStatus: state?.audio.microphoneStatus ?? MICROPHONE_STATUS.NOT_DETERMINED,
    shown: tab === PANEL_TAB.PLANS,
    unseenAgents: state?.codingAgents.unseen ?? NO_UNSEEN_AGENTS,
    voice: { view: voiceView, listening, requestMicrophoneAccess },
  });
  // A coding agent's notification clicked: the Plans tab, on that agent.
  // Read through a ref, because the tab hands a new closure each render and
  // the subscription is owed to the window, not to a render.
  const showAgent = useRef(plans.onShowAgent);
  showAgent.current = plans.onShowAgent;
  useEffect(
    () =>
      window.sidecar.onShowAgent(({ planId, agentId }) => {
        changeTab(PANEL_TAB.PLANS);
        showAgent.current(planId, agentId);
      }),
    [changeTab],
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
    volumeHint,
  });

  // `:focus-visible` is a heuristic about how focus arrived, and here it guesses
  // wrong: the window takes focus programmatically, which the engine can
  // read as keyboard modality and ring a control after a plain press — most reliably the first time the window is ever focused. Modality
  // is tracked outright instead, so a ring is drawn only once someone has
  // actually moved focus with the keyboard.
  useEffect(() => {
    const root = document.documentElement;
    const keyboardMoved = (event: KeyboardEvent) => {
      if (event.key === "Tab" || event.key.startsWith("Arrow")) root.dataset.keyboard = "true";
    };
    const pointerUsed = () => {
      delete root.dataset.keyboard;
    };
    // Capture: the flag has to be right before anything reacts to the event.
    window.addEventListener("keydown", keyboardMoved, true);
    window.addEventListener("pointerdown", pointerUsed, true);
    return () => {
      window.removeEventListener("keydown", keyboardMoved, true);
      window.removeEventListener("pointerdown", pointerUsed, true);
    };
  }, []);

  /**
   * The report that the window has painted, made once, on the first snapshot
   * that carries settings.
   */
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !state?.settings) return;
    opened.current = true;
    window.sidecar.notifyReady();
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
      // time: Settings back to wherever it was opened from, then a side panel
      // filling the window back beside its plan, then an open plan back to
      // the new-plan page. A menu and the settings search answer their own
      // Escapes and keep them — the search clearing, then letting go of the
      // caret — so neither is a layer here.
      if (runAppCommand(APP_COMMAND.EXIT_SETTINGS)) return;
      // An open plan unwinds to the new-plan page, which leaves it and ends
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
    update: state.update,
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

  return (
    <div
      className="app-stage"
      // Whether there are words in the caption bar — Luke's, or a failure
      // borrowing it — so the bar is drawn.
      data-caption={String(Boolean(caption.texts))}
      // Whether those words need the volume hint under them, in a row of its
      // own below the bar.
      data-volume-hint={String(volumeHint)}
      data-capture={String(state.run.captureMode)}
      // The panel is drawn as an ordinary app window's content; desktop.css
      // lays it out.
      data-surface="desktop"
      style={{
        ...caption.style,
        // The sidebar's width lays out the shell and Settings' page list, and
        // places the captions over the work column beside it.
        ...cssCustomProperties({ "--sidebar-width": `${sidebar.width}px` }),
      }}
    >
      {/* The window's content. */}
      <div className="desktop-stage">
        <DesktopShell
          gates={{
            accountRequired: state.run.accountRequired,
            signInWait: signIn.signInWait,
            signInFailure: signIn.signInFailure,
            onBeginSignIn: signIn.beginSignIn,
            onCancelSignIn: signIn.cancelSignIn,
            signInFace,
          }}
          identity={{
            levels: voiceLevels,
            speakers,
            voiceActive,
            fixtureSpeaking,
            voiceOpening: talkOpening,
          }}
          tab={tab}
          onTabChange={changeTab}
          plans={plans}
          history={history}
          sidebar={sidebar}
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
                    "Luke's service could not delete the account, so it still stands. Try again in a moment.",
                };
              }
            },
            view: settingsView,
            onViewChange: setSettingsView,
            microphone,
            updates,
            settings,
            onFeedback: setFeedbackKind,
            shortcuts,
          }}
        />
      </div>
      {/* A note to the people who make Luke, written in a dialog over the
          window, and the thank-you after it lands. */}
      <FeedbackDialog
        kind={feedbackKind}
        account={account}
        onClose={() => setFeedbackKind(undefined)}
      />

      {/* Luke's words while he says them: one element in every state, always
          mounted so both edges of its fade can run. The inner stack is what
          is measured — responses spoken back-to-back are one block each in
          it, oldest first, the settled words above the ones still arriving —
          and past the room the bar may take it rolls up rather than growing,
          as `caption-layout.ts` says. The newest block is always mounted like
          the stack itself; a settled one mounts only while it has words, and
          the blocks keep their order as keys so a segment that settles stays
          the element it streamed into. Hidden from readers while it captions
          speech — it duplicates what is already audible — and announced as a
          status line when it carries a failure or a notice, which was never
          audible at all. */}
      <span
        className="voice-caption"
        ref={caption.ref}
        data-tone={caption.tone}
        {...(caption.tone === CAPTION_TONE.WORDS || caption.tone === CAPTION_TONE.ASK
          ? { "aria-hidden": true }
          : { role: "status" })}
      >
        <span className="voice-caption-stack" ref={caption.textRef}>
          {caption.settled.map((words, index) => (
            <MarkdownMessage key={index} className="voice-caption-text" words={words} />
          ))}
          <MarkdownMessage
            key={caption.settled.length}
            className="voice-caption-text"
            words={caption.live ?? ""}
          />
        </span>
      </span>

      {/* The one reason the words above might be the only part of Luke
          arriving: the Mac's own output is off. It stands in a row of its own
          directly below the caption bar and is drawn only while Luke speaks
          into a silence the helper reported. Always mounted, like the
          caption, so both edges of its fade can run, and inert while hidden
          so its button cannot be tabbed to. */}
      <span className="volume-hint" role="status" inert={!volumeHint}>
        <span className="volume-hint-text">{volumeHintText(outputAudio)}</span>
        <button type="button" className="volume-hint-dismiss" onClick={dismissVolumeHint}>
          Got it
        </button>
      </span>
    </div>
  );
}
