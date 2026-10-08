import { PRODUCT_SEARCH_SURFACE, PRODUCT_SURFACE_EVENT } from "@sidecar/analytics";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { IDLE_PLANNING_VIEW } from "@sidecar/hosted/planning-view";
import { APP_SETTING_SCHEMA, VOICE_HOTKEY_NONE } from "@sidecar/settings";
import { appSettingsView } from "@sidecar/settings/wire";
import {
  cssCustomProperties,
  SURFACE_PROPERTY,
  type SurfaceProperty,
} from "@sidecar/surface/react-css";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { RUN_PROFILE, sessionReplayBootstrap } from "#shared/messages/app-state";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import type { VoiceSpeakers } from "#shared/messages/voice-view";
import { useAct } from "./act";
import { DesktopShell } from "./desktop/desktop-shell";
import { FeedbackSlot } from "./feedback-slot";
import { MarkdownMessage } from "./markdown-message";
import { HIT_REGION, PANEL_PRESENTATION } from "./panel-state";
import { PANEL_TAB, type PanelTab } from "./panel-tabs";
import { PLANS_PAGE, planningCallHoldsPanel } from "./planning/planning-model";
import { usePlansTab } from "./planning/use-plans-tab";
import { isSidePanelChord } from "./planning/use-side-panel";
import { focusSearchField } from "./search-field";
import { applySessionReplay } from "./session-replay";
import type { MicrophoneControl, ShortcutControl, UpdateControl } from "./settings/controls";
import { SETTINGS_SEARCH_INPUT_ID } from "./settings-search";
import { SETTINGS_VIEW, type SettingsView } from "./settings-views";
import { useSignInFaceCycle } from "./sign-in-gate";
import { SignInSlot } from "./sign-in-slot";
import { CAPTION_TONE } from "./strip-hold";
import { useAppState } from "./use-app-state";
import { useCaptionPresentation } from "./use-caption-presentation";
import { useFeedbackComposer } from "./use-feedback-composer";
import { useMeasuredHeight } from "./use-measured-height";
import type { PanelEntrySurface } from "./use-panel-entry";
import { usePanelPresentation } from "./use-panel-presentation";
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

function surfaceHeightStyle(
  slotHeight: number | undefined,
  feedbackHeight: number | undefined,
): CSSProperties {
  const properties: Partial<Record<SurfaceProperty, string>> = {};
  if (slotHeight !== undefined) properties[SURFACE_PROPERTY.SLOT_HEIGHT] = `${slotHeight}px`;
  if (feedbackHeight !== undefined) {
    properties[SURFACE_PROPERTY.FEEDBACK_HEIGHT] = `${feedbackHeight}px`;
  }
  return cssCustomProperties(properties);
}

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
  // Whether the Plans tab is on its new-plan form; an open plan is the host's
  // and outlasts the tab, but a half-filled form is this panel's alone.
  const [plansComposing, setPlansComposing] = useState(false);
  // The settings search's field: the magnifier in the settings header answers
  // for it, and its query lives with the field in the settings panel —
  // closing here is what lets that query go.
  const [settingsSearchOpen, setSettingsSearchOpen] = useState(false);
  /** The settings the panel is drawing: the document's own. */
  const settings = useMemo(
    () => (state?.settings ? appSettingsView(state.settings) : undefined),
    [state?.settings],
  );
  const [signInSlotElement, signInSlotHeight] = useMeasuredHeight();
  const [feedbackElement, feedbackHeight] = useMeasuredHeight();
  /**
   * Which stretch of unbroken silence is on screen, advanced each time one
   * begins. A "Got it" is remembered against the stretch it answered, so it
   * holds for that whole mute and lapses naturally with it.
   */
  const [silenceStretch, setSilenceStretch] = useState(0);
  const wasSilent = useRef(false);
  const [hintDismissal, setHintDismissal] = useState<VolumeHintDismissal>();
  const feedbackHeld = useRef(false);
  /** Whether a planning call is in progress, mirrored from the voice view below. */
  const planningHeld = useRef(false);

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
      // settings rather than the settings. The flows that need a deeper page —
      // a credential entry returning from the key slot, the evidence run that
      // starts in it — set their page right after this reset.
      setSettingsView(SETTINGS_VIEW.ROOT);
      setPlansComposing(false);
      // `PanelTab` and the counted tab are the same union: both are the
      // guide's own set, which `PanelTab` aliases.
      window.sidecar.recordSurfaceEvent(PRODUCT_SURFACE_EVENT.PANEL_TAB_CHANGE, {
        panel_tab: next,
      });
    },
    [setSettingsView, setTab],
  );

  /** True while sign-in stands between Luke and anything to watch: the gate is then what the window shows. */
  const accountGated =
    state?.run.accountRequired === true && account?.status !== ACCOUNT_STATUS.SIGNED_IN;

  /** Whether this window has already opened its one sign-in greeting. */
  const greeted = useRef(false);

  /**
   * The one signed-out Luke's introduction cycle — sway, pirouette, double
   * blink, curious tilt, nod — walked over the sign-in gate. Still while
   * signed in, so the timer is not left running under the plans.
   */
  const signInFace = useSignInFaceCycle(usePrefersReducedMotion() || !accountGated);

  const {
    presentation,
    current: presentationOf,
    pointerInside: pointerIsInside,
    applyPresentation,
    applyAuthoritativeMode,
    changeMode,
    cancelHover,
    onHitRegionLeave,
    changeAskEngagement,
    settle,
    leave,
    expand,
  } = usePanelPresentation({
    planningHeld: () => planningHeld.current,
    // The settings search closes with the shape it was opened on, taking its
    // query with it: no search survives the panel closing.
    onNotPanel: () => setSettingsSearchOpen(false),
  });

  /**
   * Brings the panel back around the Feedback section a note was begun from —
   * the settings front page, which changing to the tab lands on — and leaves
   * it open the way every other way of opening it does.
   */
  const restorePanel = useCallback(() => {
    changeTab(PANEL_TAB.SETTINGS);
    expand();
  }, [changeTab, expand]);

  /**
   * The panel every composer stands down from and comes back to, gathered
   * once so each composer's hook is handed the same one.
   */
  const panelEntrySurface: PanelEntrySurface = {
    pointerInside: pointerIsInside,
    presentation: presentationOf,
    onReleasedWhileAway: onHitRegionLeave,
    cancelHover,
    applyPresentation,
    restorePanel,
    leave,
    settle,
    heldRef: feedbackHeld,
  };

  const signIn = useSignIn({ surface: panelEntrySurface, expand });

  const stillMotion = usePrefersReducedMotion();

  const feedback = useFeedbackComposer({
    surface: panelEntrySurface,
    presentation,
    stillMotion,
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

  /**
   * The settings search summons, from its magnifier in the settings header.
   * The field opens at the head of whichever settings page is showing — the
   * search reads across every page wherever it is opened from, so there is
   * no reason to take anyone away from the page they were on — and the caret
   * follows a frame-by-frame seek, since the field mounts on the same press.
   */
  const openSettingsSearch = useCallback(() => {
    setSettingsSearchOpen(true);
    focusSearchField(SETTINGS_SEARCH_INPUT_ID);
    window.sidecar.recordSurfaceEvent(PRODUCT_SURFACE_EVENT.SEARCH_OPEN, {
      search_surface: PRODUCT_SEARCH_SURFACE.SETTINGS,
    });
  }, []);

  /**
   * Closing the settings search lets go of its query: the query lives with
   * the field in the settings panel, which clears it the render it finds the
   * field closed.
   */
  const closeSettingsSearch = useCallback(() => setSettingsSearchOpen(false), []);

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
  const planningCallHeld = planningCallHoldsPanel(voiceView);
  planningHeld.current = planningCallHeld;
  // A call ending while the pointer is already away releases its hold the
  // way letting go of the ask field does: the pointer cannot leave twice.
  const wasPlanningCallHeld = useRef(false);
  useEffect(() => {
    const released = wasPlanningCallHeld.current && !planningCallHeld;
    wasPlanningCallHeld.current = planningCallHeld;
    if (released && !pointerIsInside()) onHitRegionLeave();
  }, [planningCallHeld, pointerIsInside, onHitRegionLeave]);
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
    shown: presentation === PANEL_PRESENTATION.PANEL && tab === PANEL_TAB.PLANS,
    composing: plansComposing,
    onComposingChange: setPlansComposing,
    voice: { view: voiceView, listening, requestMicrophoneAccess },
  });

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
  // wrong: the panel takes focus programmatically when it opens, which the
  // engine can read as keyboard modality and ring the capsule after a plain
  // press — most reliably the first time the window is ever focused. Modality
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
   * What the panel performs once with the state it opened on: the mode main
   * decided and the report that it has painted. Once, on the first snapshot
   * that carries settings. The mode needs no guard against a developer who
   * moved it meanwhile: the snapshot carries the mode main holds as it
   * publishes, so it is the same word the lifecycle relay would carry for
   * whatever moved it.
   */
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !state?.settings) return;
    opened.current = true;
    applyAuthoritativeMode(state.window.mode);
    window.sidecar.notifyReady();
  }, [state, applyAuthoritativeMode]);

  // The mode and the tab main decided for this window.
  useEffect(() => {
    const removeLifecycle = window.sidecar.onLifecycle((eventName) => {
      if (eventName === "mode:expanded") applyAuthoritativeMode("expanded");
      if (eventName === "tab:settings") changeTab(PANEL_TAB.SETTINGS);
    });
    return () => {
      cancelHover();
      removeLifecycle();
    };
  }, [applyAuthoritativeMode, cancelHover, changeTab]);

  // The one greeting an unauthed launch gets: the panel opens on the sign-in
  // gate exactly once, then behaves like any panel — Escape, the pointer, and
  // the window's own close all close it. Signing out later opens no new
  // greeting — the panel is already forward, showing the gate the sign-out
  // left behind.
  useEffect(() => {
    if (!accountGated || greeted.current) return;
    greeted.current = true;
    void changeMode(true);
  }, [accountGated, changeMode]);

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
      // Command-comma is claimed here rather than globally, because it belongs
      // to whichever app is frontmost and Luke is only that while its panel has
      // the keyboard.
      if (event.key === "," && (event.metaKey || event.ctrlKey)) {
        if (presentation !== PANEL_PRESENTATION.PANEL) return;
        event.preventDefault();
        changeTab(PANEL_TAB.SETTINGS);
        return;
      }
      // Find, the way every macOS list answers it. Claimed on the same terms
      // as Command-comma: only while the panel has the keyboard. The lowercase
      // key is deliberate — with Shift held this is some other app's chord.
      // Only Settings has a search, so the chord answers there alone rather
      // than turning the tab under the press.
      if (event.key === "f" && (event.metaKey || event.ctrlKey)) {
        if (presentation !== PANEL_PRESENTATION.PANEL) return;
        if (tab !== PANEL_TAB.SETTINGS) return;
        event.preventDefault();
        openSettingsSearch();
        return;
      }
      // The side panel's chord, claimed on the same terms, and only where
      // there is a panel to show: beside an open plan.
      if (isSidePanelChord(event)) {
        if (presentation !== PANEL_PRESENTATION.PANEL) return;
        if (tab !== PANEL_TAB.PLANS || plans.page !== PLANS_PAGE.DOCUMENT) return;
        event.preventDefault();
        plans.sidePanel.onToggle();
        return;
      }
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
      // Escape out of the slot withdraws the sign-in it waits on: the slot is
      // the only thing on screen, so there is nothing else it could mean.
      if (presentation === PANEL_PRESENTATION.SLOT) {
        signIn.cancelSignIn();
        return;
      }
      // Escape out of the composer leaves the shape and keeps the draft.
      if (presentation === PANEL_PRESENTATION.FEEDBACK) {
        feedback.control.dismiss();
        return;
      }
      if (presentation !== PANEL_PRESENTATION.PANEL) return;
      // Otherwise it closes the nearest thing that is open, one layer at a
      // time: the search field, then a settings page back to the front page,
      // then the settings tab back to Plans, then an open plan back to the
      // list, then the panel itself.
      // The search field answers its own Escapes while the caret is in it —
      // clearing before closing — so the press that lands here is one made
      // from elsewhere in the panel, and it closes the field outright. It
      // stands on whichever page it was opened over, so it is the nearer
      // layer than the page itself.
      if (tab === PANEL_TAB.SETTINGS && settingsSearchOpen) closeSettingsSearch();
      else if (tab === PANEL_TAB.SETTINGS && settingsView !== SETTINGS_VIEW.ROOT) {
        setSettingsView(SETTINGS_VIEW.ROOT);
      } else if (tab === PANEL_TAB.SETTINGS) changeTab(PANEL_TAB.PLANS);
      // An open plan unwinds to the list, which leaves it and ends its call,
      // and the form to the list too. The list is the home tab, so the press
      // past it closes the panel.
      else if (!plans.back()) void changeMode(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    changeMode,
    changeTab,
    closeSettingsSearch,
    feedback.control.dismiss,
    openSettingsSearch,
    presentation,
    settingsSearchOpen,
    setSettingsView,
    settingsView,
    signIn.cancelSignIn,
    listening,
    plans.back,
    plans.page,
    plans.sidePanel.onToggle,
    speaking,
    stopSpeaking,
    tab,
  ]);

  // Nothing is drawn over a state the window has not been told, nor over a
  // runtime that could not answer for the settings every row reads.
  if (!state || !settings) return <div />;

  const shownStopHotkey = state.hotkeys.stop;
  const panelOpen = presentation === PANEL_PRESENTATION.PANEL;
  const slotOpen = presentation === PANEL_PRESENTATION.SLOT;
  const feedbackOpen = presentation === PANEL_PRESENTATION.FEEDBACK;

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
      // Who is being heard.
      data-luke-speaking={String(speakers.lukeSpeaking)}
      data-listening={String(speakers.listening)}
      // Whether there are words to draw under the shape — a caption or a
      // failure borrowing its strip — so the surface can grow the room they
      // are drawn in.
      data-caption={String(Boolean(caption.texts))}
      // Whether those words need the volume hint under them, which stands in
      // a band of its own below the caption block.
      data-volume-hint={String(volumeHint)}
      data-presentation={presentation}
      // Whether sign-in still stands between Luke and the plans, so the
      // stylesheet knows the strip holds nothing while a popup is drawn.
      data-gated={String(accountGated)}
      data-capture={String(state.run.captureMode)}
      // The panel is drawn as an ordinary app window's content; desktop.css
      // lays it out.
      data-surface="desktop"
      style={{
        // The slot follows the height of the sign-in wait drawn in it.
        ...surfaceHeightStyle(signInSlotHeight, feedbackHeight),
        ...caption.style,
      }}
    >
      <span className="panel-surface" data-hit-region={HIT_REGION.SURFACE} aria-hidden="true" />

      {/* The window's content. Inert while the panel stands down to a sign-in
          wait or a note, which are drawn as a sheet over it. */}
      <div className="desktop-stage" aria-hidden={!panelOpen} inert={!panelOpen}>
        <DesktopShell
          gates={{
            accountRequired: state.run.accountRequired,
            signInFailure: signIn.signInFailure,
            onBeginSignIn: signIn.beginSignIn,
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
          settingsSearchOpen={settingsSearchOpen}
          onSettingsSearchToggle={() =>
            settingsSearchOpen ? closeSettingsSearch() : openSettingsSearch()
          }
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
            feedback: feedback.control,
            panelOpen,
            onQuit: () => tell(ACT_KIND.WINDOW_QUIT),
            shortcuts,
            searchOpen: settingsSearchOpen,
            onSearchClose: closeSettingsSearch,
            // One caret anywhere in the panel is hands being here.
            onSearchEngaged: changeAskEngagement,
          }}
        />
      </div>
      <span className="desktop-scrim" aria-hidden="true" />

      {/* The panel stood down to the account sign-in it is waiting on, drawn
          as a sheet in the same window. */}
      <SignInSlot
        {...(signIn.signInWait ? { provider: signIn.signInWait } : undefined)}
        drawn={slotOpen}
        onCancel={signIn.cancelSignIn}
        measure={signInSlotElement}
      />
      {/* The panel stood down to the composer, on the same terms. */}
      <FeedbackSlot
        control={feedback.control}
        drawn={feedbackOpen}
        measure={feedbackElement}
        confirming={feedback.confirming}
        still={stillMotion}
      />

      {/* Luke's words while he says them: one element in every state, always
          mounted so both edges of its fade can run. The inner stack is what is
          measured —
          responses spoken back-to-back are one block each in it, oldest
          first, the settled words above the ones still arriving — and its
          wrapped height is the only honest answer to how much room the words
          need; past the room the window reserved it rolls up rather than
          growing, as `caption-layout.ts` says. The newest block is always
          mounted like the stack itself; a settled one mounts only while it
          has words, so a lone reply pays no gap for a block that is not
          there, and the blocks keep their order as keys so a segment that
          settles stays the element it streamed into. Hidden from readers
          while it captions speech — it
          duplicates what is already audible — and announced as a status line
          when it carries a failure or a notice, which was never audible at
          all. */}
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
          arriving: the Mac's own output is off. It stands in a band of its
          own directly below the caption block — the block's clip ends where
          the band begins, so the words above can never be drawn over it —
          and is drawn only while Luke speaks into a silence the helper
          reported. Always
          mounted, like the caption, so both edges of its fade can run, and
          inert while hidden so its button cannot be tabbed to. It carries a
          hit region of its own and sits above the hover strip, so Got it
          answers the press instead of the panel opening under it. */}
      <span className="volume-hint" role="status" inert={!volumeHint}>
        <span className="volume-hint-text">{volumeHintText(outputAudio)}</span>
        <button type="button" className="volume-hint-dismiss" onClick={dismissVolumeHint}>
          Got it
        </button>
      </span>
    </div>
  );
}
