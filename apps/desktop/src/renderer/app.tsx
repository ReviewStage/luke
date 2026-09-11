import {
  PRODUCT_PANEL_SOURCE,
  PRODUCT_SEARCH_SURFACE,
  PRODUCT_SURFACE_EVENT,
} from "@sidecar/analytics";
import { brainRequestPending } from "@sidecar/brain/requests-wire";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { CREDENTIAL_PROVIDER_LIST, CREDENTIAL_SOURCE } from "@sidecar/credentials/vocabulary";
import { FEEDBACK_KIND, feedbackKindForLifecycleEvent } from "@sidecar/feedback";
import { WingFace as LukeFace } from "@sidecar/panel";
import type { ObservedWorkspaceProject } from "@sidecar/session";
import { FIXTURE_EPOCH_MS, FIXTURE_SPEAKING_CAPTIONS } from "@sidecar/session/fixtures";
import { APP_SETTING_SCHEMA, VOICE_HOTKEY_NONE, voiceHotkeyLabel } from "@sidecar/settings";
import type { AppSettingsView, ObservedAccountCalendars } from "@sidecar/settings/wire";
import { appSettingsView } from "@sidecar/settings/wire";
import { MOTION_DURATION_MS } from "@sidecar/surface";
import {
  cssCustomProperties,
  SURFACE_PROPERTY,
  type SurfaceProperty,
} from "@sidecar/surface/react-css";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { type AppStateSnapshot, sessionReplayBootstrap } from "#shared/messages/app-state";
import type { DisplayDiagnostic, SupersetSignInSnapshot } from "#shared/messages/session";
import { SUPERSET_SIGN_IN_STAGE, SUPERSET_WORKSPACE_PROVIDER_ID } from "#shared/messages/session";
import { useAct } from "./act";
import { useAppActionCarrier } from "./app-action-carrier";
import type { CalendarGateControl } from "./calendar-gate";
import { ConsentConnectSlot } from "./consent-connect-slot";
import { FeedbackSlot } from "./feedback-slot";
import { LukeErrand } from "./luke-errand";
import { buildLukeGuide } from "./luke-guide";
import { MarkdownMessage } from "./markdown-message";
import { NotchWings } from "./notch-wings";
import { PanelBody } from "./panel-body";
import {
  collapseMarkAfter,
  HIT_REGION,
  PANEL_PRESENTATION,
  type PanelPresentation,
} from "./panel-state";
import { PANEL_TAB, type PanelTab } from "./panel-tabs";
import { applySessionReplay } from "./session-replay";
import { focusSearchField } from "./session-search";
import type { MicrophoneControl, ShortcutControl, UpdateControl } from "./settings/controls";
import { KeySlot } from "./settings/key-slot";
import { SETTINGS_SEARCH_INPUT_ID } from "./settings-search";
import {
  credentialSettingsPage,
  PANEL_STAND_DOWN,
  SETTINGS_VIEW,
  type SettingsView,
} from "./settings-views";
import { useSignInFaceCycle } from "./sign-in-gate";
import { SignInSlot } from "./sign-in-slot";
import { CAPTION_TONE } from "./strip-hold";
import { SupersetSignInSlot } from "./superset-sign-in-slot";
import { useAppState } from "./use-app-state";
import { useCaptionPresentation } from "./use-caption-presentation";
import { useConnections } from "./use-connections";
import { useErrandFlight } from "./use-errand-flight";
import { useFeedbackComposer } from "./use-feedback-composer";
import { useMeasuredHeight } from "./use-measured-height";
import type { PanelEntrySurface } from "./use-panel-entry";
import { usePanelPresentation } from "./use-panel-presentation";
import { usePrefersReducedMotion } from "./use-reduced-motion";
import { useSessionList } from "./use-session-list";
import { useStateWithRef } from "./use-state-with-ref";
import { useVoiceView } from "./use-voice-view";
import {
  outputSilent,
  type VolumeHintDismissal,
  volumeHintDismissed,
  volumeHintText,
} from "./volume-hint";

function notchStyle(display: DisplayDiagnostic): CSSProperties {
  return cssCustomProperties({
    [SURFACE_PROPERTY.NOTCH_TOP_INSET]: `${display.notch.topInset}px`,
    [SURFACE_PROPERTY.NOTCH_HOUSING_WIDTH]: `${display.notch.housingWidth}px`,
  });
}

function surfaceHeightStyle(
  panelHeight: number | undefined,
  slotHeight: number | undefined,
  feedbackHeight: number | undefined,
): CSSProperties {
  const properties: Partial<Record<SurfaceProperty, string>> = {};
  if (panelHeight !== undefined) properties[SURFACE_PROPERTY.PANEL_HEIGHT] = `${panelHeight}px`;
  if (slotHeight !== undefined) properties[SURFACE_PROPERTY.SLOT_HEIGHT] = `${slotHeight}px`;
  if (feedbackHeight !== undefined) {
    properties[SURFACE_PROPERTY.FEEDBACK_HEIGHT] = `${feedbackHeight}px`;
  }
  return cssCustomProperties(properties);
}

const COLLAPSE_ANIMATION_MS = MOTION_DURATION_MS.EXIT + MOTION_DURATION_MS.SURFACE;

/**
 * What each list-shaped slice reads as before the first snapshot lands. Held
 * as constants so a render before it redraws nothing that was already drawn.
 */
const EMPTY_WORKSPACE_PROJECTS: readonly ObservedWorkspaceProject[] = [];
const EMPTY_CALENDARS: readonly ObservedAccountCalendars[] = [];

/** No Superset sign-in under way, which is every moment but a wait's own. */
const IDLE_SUPERSET_SIGN_IN: SupersetSignInSnapshot = {
  stage: SUPERSET_SIGN_IN_STAGE.IDLE,
  organizations: [],
};

/**
 * True from the render that leaves the panel for a compact shape until the
 * collapse has settled — the window's own collapse clock, exit plus shape.
 * The stylesheet spends it to hold the surface behind the content it is
 * still carrying: the panel's rows fading out, and a caption block riding
 * down from the panel's foot. Derived during render
 * rather than in an effect, because the surface's transition reads its
 * delay on the same style change that retargets it — an attribute landing
 * one commit later finds the shape already moving.
 */
function useLeavingPanel(presentation: PanelPresentation): boolean {
  const [leaving, setLeaving] = useState(false);
  const [previous, setPrevious] = useState(presentation);
  if (previous !== presentation) {
    setPrevious(presentation);
    setLeaving(collapseMarkAfter(previous, presentation, leaving));
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(false), COLLAPSE_ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  return leaving;
}

export function App(): React.JSX.Element {
  const { act, tell, updateSetting } = useAct();
  // Everything main holds, on the one channel it holds it on, and this
  // window's own facts beside it. There is no second reading to reconcile
  // against: what arrives is the whole document at a version that only rises.
  const state = useAppState();
  const account = state?.account;
  const sessionsSettled = state?.sessions.settled === true;
  const workspaceProjects = state?.sessions.workspaceProjects ?? EMPTY_WORKSPACE_PROJECTS;
  const calendars = state?.calendars ?? EMPTY_CALENDARS;
  const announcementsHeld = state?.announcements.held === true;
  const calendarOnboardingOwed = state?.onboarding.calendarOwed === true;
  const outputAudio = state?.audio.outputAudio;
  const display = state?.window.display;
  const supersetSignIn = state?.superset.signIn ?? IDLE_SUPERSET_SIGN_IN;
  const supersetConnected = state?.superset.connected === true;
  const [tab, setTab, tabNow] = useStateWithRef<PanelTab>(PANEL_TAB.SESSIONS);
  const [settingsView, setSettingsView, settingsViewNow] = useStateWithRef<SettingsView>(
    SETTINGS_VIEW.ROOT,
  );
  // The settings search's field, on the sessions search's own terms: the
  // magnifier beside the tab bar answers for it, and its query lives with the
  // field in the settings panel — closing here is what lets that query go.
  const [settingsSearchOpen, setSettingsSearchOpen] = useState(false);
  /**
   * The settings the panel is drawing, which is the document's own unless an
   * errand is holding one back: a switch Luke is on his way to move has to
   * still read as it did when he set off, and the document moves the moment
   * the store answers. Released when the run is over, so the newest word —
   * including a change another window made mid-flight — is the document's.
   */
  const [heldSettings, setHeldSettings] = useState<AppSettingsView>();
  const liveSettings = useMemo(
    () => (state?.settings ? appSettingsView(state.settings) : undefined),
    [state?.settings],
  );
  const settings = heldSettings ?? liveSettings;
  const sessions = useSessionList({
    state,
    liveSettings,
    settings,
    tab,
    // The panel's own two acts, declared below: the list only ever reaches
    // them from a press, which is long after this render has closed.
    dismissPanel: () => {
      cancelHover();
      void changeMode(false);
    },
    showSessionsTab: () => changeTab(PANEL_TAB.SESSIONS),
  });
  // Counts for nothing except having changed: each tick re-renders the rows so
  // their "how long ago" labels stay honest while they are on screen.
  const [, setClock] = useState(0);
  const [panelElement, panelHeight] = useMeasuredHeight();
  const [slotElement, slotHeight] = useMeasuredHeight();
  const [signInSlotElement, signInSlotHeight] = useMeasuredHeight();
  const [connectElement, connectHeight] = useMeasuredHeight();
  const [feedbackElement, feedbackHeight] = useMeasuredHeight();
  /**
   * Which stretch of unbroken silence is on screen, advanced each time one
   * begins. A "Got it" is remembered against the stretch it answered, so it
   * holds for that whole mute and lapses naturally with it.
   */
  const [silenceStretch, setSilenceStretch] = useState(0);
  const wasSilent = useRef(false);
  const [hintDismissal, setHintDismissal] = useState<VolumeHintDismissal>();
  /**
   * Whether a composer is held, mirrored for the presentation cluster: a
   * capsule close keeps the settings tab for a half-written key or note, and
   * the pointer holds the panel open for a credential still on screen.
   */
  const credentialHeld = useRef(false);
  /**
   * The settings page whatever is standing in the panel's place was begun
   * from — a key's provider row, the calendar's block under Integrations, or
   * the Feedback section on the front page — so leaving that shape ends back
   * on the page it began on. Written by each begin, because the return is a
   * fact about what was begun rather than about what was begun last: one page
   * remembered for all three landed a cancelled note on Connections, wherever
   * the note had actually been started. A ref rather than state: it is read
   * only when the panel is restored, by a callback that has to stay stable.
   */
  const standDownPage = useRef<SettingsView>(SETTINGS_VIEW.ROOT);
  const feedbackHeld = useRef(false);
  /** Whether a calendar sign-in holds the slot, mirrored like the other two. */
  const consentConnectHeld = useRef(false);
  const supersetSignInHeld = useRef(false);

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
  /**
   * The guide as last reported, serialized, so an identical one is not sent
   * again. The panel rebuilds it on every version of the document — the
   * cheapest honest trigger, since the guide reads five of its slices — and
   * most versions move the roster and nothing the guide describes.
   */
  const reportedGuide = useRef<string | undefined>(undefined);

  // Keep the conversation's view of Luke himself current, so a spoken question
  // about a setting is answered from the value the store actually holds, and a
  // change made in the panel is known to the conversation the moment it lands.
  const publishGuide = useCallback((held: AppStateSnapshot, current: AppSettingsView) => {
    // All three keys reach the guide labelled: it is spoken and read, so a
    // chord belongs there as the one word macOS writes it as rather than as
    // the keys the panel draws apart.
    const guide = buildLukeGuide({
      account: held.account,
      settings: current,
      update: held.update,
      voiceAvailable: current.voiceAvailable,
      microphoneStatus: held.audio.microphoneStatus,
      // A removed key reaches the guide as the removal rather than a bare
      // absence, so Luke says the developer deleted it instead of blaming
      // another app for a chord nobody is contesting.
      hotkey: {
        ...(held.hotkeys.talk ? { hotkey: voiceHotkeyLabel(held.hotkeys.talk) } : undefined),
        removed: current.voiceHotkey === VOICE_HOTKEY_NONE,
        held: held.hotkeys.talkHeld,
      },
      ...(held.hotkeys.stop ? { stopKey: voiceHotkeyLabel(held.hotkeys.stop) } : undefined),
      stopKeyRemoved: current.stopHotkey === VOICE_HOTKEY_NONE,
    });
    const wire = JSON.stringify(guide);
    if (wire === reportedGuide.current) return;
    reportedGuide.current = wire;
    // The guide goes to the main process, where the brain reads it and an
    // app act the brain asks for is validated against it; the voice itself
    // is told nothing about the app.
    window.sidecar.reportAppGuide(guide);
  }, []);

  const changeTab = useCallback(
    (next: PanelTab) => {
      setTab(next);
      // The sheet belongs to the session list, and it is drawn over the list it
      // belongs to, so leaving for Settings has to take it along.
      sessions.closeOptions();
      // Arriving at the tab is arriving at its front page: a page left open
      // behind a tab switch would greet the next visit with a corner of the
      // settings rather than the settings. The flows that need a deeper page —
      // a credential entry returning from the key slot, the evidence run that
      // starts in it — set their page right after this reset.
      setSettingsView(SETTINGS_VIEW.ROOT);
      // `PanelTab` and the counted tab are the same union: the vocabulary
      // derives its set from the guide's, which is what `PANEL_TAB` aliases.
      window.sidecar.recordSurfaceEvent(PRODUCT_SURFACE_EVENT.PANEL_TAB_CHANGE, {
        panel_tab: next,
      });
    },
    [sessions.closeOptions, setSettingsView, setTab],
  );

  /**
   * True while sign-in stands between Luke and anything to watch. The gate is
   * then what the panel shows, the wings hide the face and the count, and the
   * badge's place wears a quiet "Sign in" instead — the honest word for why
   * Luke is idle, at capsule scale.
   */
  const accountGated =
    state?.run.accountRequired === true && account?.status !== ACCOUNT_STATUS.SIGNED_IN;

  /** Whether this window has already opened its one sign-in greeting. */
  const greeted = useRef(false);

  /**
   * The one signed-out Luke's introduction cycle — sway, pirouette, double
   * blink, curious tilt, nod — walking whichever pose the face is drawn at:
   * large over the gate, small in the peek's strip. Still while signed in, so
   * the timer is not left running under the roster.
   */
  const signInFace = useSignInFaceCycle(usePrefersReducedMotion() || !accountGated);

  const {
    presentation,
    current: presentationOf,
    pointerInside: pointerIsInside,
    heldAgainstPointer,
    applyPresentation,
    applyAuthoritativeMode,
    changeMode,
    cancelHover,
    onHitRegionLeave,
    panelReceded,
    changeAskEngagement,
    settle,
    leave,
    expand,
  } = usePanelPresentation({
    // True while a field someone could be part-way through is actually on
    // screen. An entry outlives the tab it was started on, so holding the
    // panel open for one that is not drawn would leave the pointer unable to
    // close a panel showing nothing but sessions.
    entryDrawn: () => credentialHeld.current && tabNow() === PANEL_TAB.SETTINGS,
    composerHeld: () =>
      credentialHeld.current ||
      feedbackHeld.current ||
      consentConnectHeld.current ||
      supersetSignInHeld.current,
    onNotPanel: () => {
      sessions.closeOptions();
      // The settings search closes with the shape it was opened on, taking
      // its query with it: no search survives the panel closing.
      setSettingsSearchOpen(false);
    },
    onCapsuleList: () => {
      // The order goes back when the panel does, so the top row keeps
      // matching the mark the capsule kept. The filter chips and the search
      // stay: each is a standing way of viewing the list, and the capsule
      // stays honest over both because its tally is taken before the list is
      // narrowed. The search field stays open with its query — a session the
      // query hides is admitted by the field on screen and the count it
      // carries — waiting where the developer left it, like a search held
      // while Settings shows.
      sessions.resetSort();
    },
    onCapsuleTab: () => changeTab(PANEL_TAB.SESSIONS),
  });

  const leavingPanel = useLeavingPanel(presentation);

  /**
   * The panel following its content down is the one move that can take the
   * shape out from under a resting pointer — a settings page opening shorter
   * than the page it replaces. The mark lands here, on the measure that
   * retargets the surface, so it is standing before the spring can pass the
   * pointer and manufacture a leave nobody performed.
   */
  const previousPanelHeight = useRef<number | undefined>(undefined);
  useEffect(() => {
    const previous = previousPanelHeight.current;
    previousPanelHeight.current = panelHeight;
    if (previous !== undefined && panelHeight !== undefined && panelHeight < previous) {
      panelReceded();
    }
  }, [panelHeight, panelReceded]);

  /**
   * Brings the panel back around the line the entry belongs to, and leaves it
   * open the way every other way of opening it does — the pointer closes it by
   * visiting and leaving.
   */
  const restorePanel = useCallback(() => {
    changeTab(PANEL_TAB.SETTINGS);
    // The row this shape was begun from lives on one page, and changeTab has
    // just reset the tab to its front page: without this, the answer to what
    // was just done — the check beside a provider, the thank-you where the
    // note was written — would land on a page nobody is looking at.
    setSettingsView(standDownPage.current);
    expand();
  }, [changeTab, expand, setSettingsView]);

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

  const connections = useConnections({
    surface: panelEntrySurface,
    credentialHeld,
    consentConnectHeld,
    supersetSignInHeld,
    standDownPage,
    expand,
    calendars,
    superset: {
      installed: state?.superset.installed === true,
      connected: supersetConnected,
      signIn: supersetSignIn,
      defaultAgent: settings?.workspaceAgentDefaults?.[SUPERSET_WORKSPACE_PROVIDER_ID]?.agent,
    },
    workspaceProjects,
  });
  const slotOccupant = connections.slotOccupant;

  const stillMotion = usePrefersReducedMotion();

  const feedback = useFeedbackComposer({
    surface: panelEntrySurface,
    presentation,
    stillMotion,
    standDownPage,
  });

  /**
   * The composer a thumbs down offers, opened only at the offer's own press:
   * the panel asking, so leaving returns to it, on a draft of words the thread
   * already drew, which lands only in a note with nothing written yet.
   */
  const offerRatingFeedback = useCallback(
    (draft: string) => {
      feedback.begin(FEEDBACK_KIND.FEEDBACK, true, draft);
    },
    [feedback.begin],
  );

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
   * The settings search summons, from its magnifier beside the tab bar. The
   * field opens at the head of whichever settings page is showing — the
   * search reads across every page wherever it is opened from, so there is
   * no reason to take anyone away from the page they were on — and the
   * caret follows the same frame-by-frame seek the session search needs.
   */
  const openSettingsSearch = useCallback(() => {
    setSettingsSearchOpen(true);
    focusSearchField(SETTINGS_SEARCH_INPUT_ID);
    window.sidecar.recordSurfaceEvent(PRODUCT_SURFACE_EVENT.SEARCH_OPEN, {
      search_surface: PRODUCT_SEARCH_SURFACE.SETTINGS,
    });
  }, []);

  /**
   * Closing the settings search lets go of its query on the session search's
   * own terms: the query lives with the field in the settings panel, which
   * clears it the render it finds the field closed.
   */
  const closeSettingsSearch = useCallback(() => setSettingsSearchOpen(false), []);

  const errands = useErrandFlight({
    holdSettings: setHeldSettings,
    applyView: sessions.applyView,
    openSearchField: sessions.openSearchField,
    changeTab,
    setSettingsView,
    tabNow,
    settingsViewNow,
    presentationOf,
    pointerInside: pointerIsInside,
    heldAgainstPointer,
    cancelHover,
    settle,
  });

  useAppActionCarrier({
    presentationOf,
    changeMode,
    errands,
    feedback,
    sessionView: sessions.view,
    publishGuide,
  });

  // The muted evidence run is the speaking run with the hint drawn over it: a
  // capture has no system output to read, so the state is asked for directly.
  const fixtureMuted = state?.run.profile === "muted";
  const fixtureSpeaking = state?.run.profile === "speaking" || fixtureMuted;
  const {
    view: voiceView,
    speaking,
    listening,
    voiceTurn,
    level: voiceLevel,
    voiceActive,
    brainRequests,
    stopSpeaking,
    requestMicrophoneAccess,
    clearConversationLines,
  } = useVoiceView();
  const { voiceError, voiceNotice, talkOpening, liveConversationEntries, spokenAskPending } =
    voiceView;
  // Whether a run of Luke's is still going, from the same records Conversation
  // draws its wait from: the strip's face, the stage's growth for the dots
  // beside it, and the thread's wait all read one answer.
  const thinking = brainRequests.some(brainRequestPending);
  // A capture run always draws the fixture's words: the voice window that
  // otherwise decides the captions does not stand in one.
  const lukeCaptions = fixtureSpeaking ? FIXTURE_SPEAKING_CAPTIONS : voiceView.lukeCaptions;

  // The hint rides the caption it explains, and only over a silence the
  // helper actually reported. "Got it" quiets it for this stretch of silence
  // and any that follows too soon; the captions above it stay either way.
  const volumeHint =
    fixtureMuted ||
    (outputSilent(outputAudio) &&
      lukeCaptions !== undefined &&
      !volumeHintDismissed(hintDismissal, silenceStretch, Date.now()));
  const caption = useCaptionPresentation({
    lukeCaptions,
    voiceError,
    voiceNotice,
    voiceTurn,
    fixtureSpeaking,
    volumeHint,
    leavingPanel,
  });

  /** The capsule is a button: pressing it opens the panel, or closes it again. */
  const handleCapsulePress = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      // A press is a gesture, not a focus change, so the pointer hands focus
      // back. `detail` is 0 when the keyboard activated the button, and there
      // the focus is the point and stays where the keyboard put it.
      if (event.detail > 0) event.currentTarget.blur();
      cancelHover();
      const opening = presentationOf() !== PANEL_PRESENTATION.PANEL;
      // The press closes as often as it opens, and a close is not an open.
      if (opening) {
        window.sidecar.recordSurfaceEvent(PRODUCT_SURFACE_EVENT.PANEL_OPEN, {
          panel_source: PRODUCT_PANEL_SOURCE.CAPSULE,
        });
      }
      void changeMode(opening);
    },
    [cancelHover, changeMode, presentationOf],
  );

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
   * decided, the two shapes an evidence run has no press to reach, and the
   * report that it has painted. Once, on the first snapshot that carries
   * settings. The mode needs no guard against a developer who moved it
   * meanwhile: the snapshot carries the mode main holds as it publishes, so
   * it is the same word the lifecycle relay would carry for whatever moved
   * it. The stored way of viewing the list is not here — restoring it is a
   * state derivation and happens in the render above.
   */
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !state?.settings) return;
    opened.current = true;
    const { run, window: pane } = state;
    applyAuthoritativeMode(pane.mode);
    if (run.startPeeked && pane.mode === "compact") {
      applyPresentation(PANEL_PRESENTATION.PEEK);
    }
    // Evidence only, and the same trick the peek uses: the slot is reached
    // by pressing Connect, which a capture run has no way to do, so the
    // entry the press would have begun is asked for directly. It carries
    // the shape with it, as it does anywhere else.
    const [firstProvider] = CREDENTIAL_PROVIDER_LIST;
    if (run.startInSlot && pane.mode === "expanded" && firstProvider) {
      // The tab and page an entry begins on, so pressing the capsule from
      // here lands where it would have in the flow this is standing in for.
      changeTab(PANEL_TAB.SETTINGS);
      setSettingsView(credentialSettingsPage(firstProvider.id));
      connections.beginEntry(firstProvider.id);
    }
    window.sidecar.notifyReady();
  }, [
    state,
    applyAuthoritativeMode,
    applyPresentation,
    connections.beginEntry,
    changeTab,
    setSettingsView,
  ]);

  // The mode main decided, and the one event only a window can be told: the
  // feedback composer a spoken request opens.
  useEffect(() => {
    const removeLifecycle = window.sidecar.onLifecycle((eventName) => {
      if (eventName === "mode:compact") applyAuthoritativeMode("compact");
      if (eventName === "mode:expanded") applyAuthoritativeMode("expanded");
      if (eventName === "tab:settings") changeTab(PANEL_TAB.SETTINGS);
      // A spoken feedback request stands the surface straight down to
      // the composer's shape, on the kind that was asked for. The window was
      // expanded before this event was sent; this is the renderer's half. The
      // tab still moves to settings so that coming back to the panel later
      // lands beside the section the shape belongs to, and a draft a spoken
      // open left waiting is taken up here, then forgotten.
      const feedbackKind = feedbackKindForLifecycleEvent(eventName);
      if (feedbackKind) {
        changeTab(PANEL_TAB.SETTINGS);
        feedback.begin(feedbackKind, false, feedback.takeSpokenDraft());
      }
    });
    return () => {
      cancelHover();
      removeLifecycle();
    };
  }, [applyAuthoritativeMode, cancelHover, changeTab, feedback.begin, feedback.takeSpokenDraft]);

  // The one greeting an unauthed launch gets: the panel opens on the sign-in
  // gate exactly once, then behaves like any panel — Escape, the pointer, and
  // the capsule all close it, and it stays a hover away. Locking it open would
  // fight what a sidecar is; after the greeting leaves, the peek's face and
  // "Sign in" label are what keep the reason Luke is idle on screen. Signing
  // out later opens no new greeting — the panel is already forward, showing
  // the gate the sign-out left behind.
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

  // Rebuilt on every version of the document and sent only where it moved: a
  // version that touched the roster alone says nothing about Luke himself.
  useEffect(() => {
    if (state && settings) publishGuide(state, settings);
  }, [state, settings, publishGuide]);

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
      // The key answers for whichever tab is showing: each tab has a search
      // of its own, and a chord that turned the tab under the press would
      // search something other than what was being looked at.
      if (event.key === "f" && (event.metaKey || event.ctrlKey)) {
        if (presentation !== PANEL_PRESENTATION.PANEL) return;
        event.preventDefault();
        if (tab === PANEL_TAB.SETTINGS) openSettingsSearch();
        else if (tab === PANEL_TAB.SESSIONS) sessions.openSearch();
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
      // Escape out of the slot is the entry's own way out, wherever the caret
      // happens to be: the slot is the only thing on screen, so there is nothing
      // else it could mean. The sign-in wait and the consent connect borrow
      // the same shape, so the same key withdraws whichever is holding it.
      if (presentation === PANEL_PRESENTATION.SLOT) {
        if (connections.signInWaitNow() !== undefined) connections.cancelSignIn();
        else if (connections.consentWaiting()) connections.cancelConsentSignIn();
        else connections.cancelEntry();
        return;
      }
      // Escape out of the composer leaves the shape and keeps the draft: a
      // note is longer than a key, and a key is the only thing Escape is
      // allowed to discard.
      if (presentation === PANEL_PRESENTATION.FEEDBACK) {
        feedback.control.dismiss();
        return;
      }
      if (presentation !== PANEL_PRESENTATION.PANEL) return;
      // Otherwise it closes the nearest thing that is open, one layer at a
      // time: the options sheet, then the search field, then a settings page
      // back to the front page, then the settings tab, then the panel itself.
      // The search field answers its own Escapes while the caret is in it —
      // clearing before closing — so the press that lands here is one made
      // from elsewhere in the panel, and it closes the field outright.
      if (sessions.optionsOpen) sessions.closeOptions();
      else if (tab === PANEL_TAB.SESSIONS && sessions.searchOpen) sessions.closeSearch();
      // The search field stands on whichever page it was opened over, so it
      // is the nearer layer than the page itself.
      else if (tab === PANEL_TAB.SETTINGS && settingsSearchOpen) closeSettingsSearch();
      else if (tab === PANEL_TAB.SETTINGS && settingsView !== SETTINGS_VIEW.ROOT) {
        setSettingsView(SETTINGS_VIEW.ROOT);
      } else if (tab === PANEL_TAB.SETTINGS) changeTab(PANEL_TAB.SESSIONS);
      else if (tab === PANEL_TAB.CONVERSATION) changeTab(PANEL_TAB.SESSIONS);
      else void changeMode(false);
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
    sessions.closeOptions,
    sessions.closeSearch,
    sessions.openSearch,
    sessions.optionsOpen,
    sessions.searchOpen,
    settingsSearchOpen,
    setSettingsView,
    settingsView,
    connections.cancelConsentSignIn,
    connections.cancelEntry,
    connections.cancelSignIn,
    connections.consentWaiting,
    connections.signInWaitNow,
    listening,
    speaking,
    stopSpeaking,
    tab,
  ]);

  // The rows say how long ago each session was seen, and a label left alone
  // goes stale the moment a minute passes with no session changing — the very
  // sessions worth noticing are the ones nothing is updating. A slow tick keeps
  // the labels honest, and only while they are on screen: the labels are
  // minute-grained, so half a minute is as fine as the answer gets. Fixture
  // rows are read against a fixed epoch, so for them a tick could only change
  // nothing — and a capture run must not risk a re-render mid-shutter.
  useEffect(() => {
    if (presentation !== PANEL_PRESENTATION.PANEL) return;
    if (state?.run.fixtureMode !== false) return;
    const timer = window.setInterval(() => setClock((tick) => tick + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [presentation, state?.run.fixtureMode]);

  // Nothing is drawn over a state the window has not been told, nor over a
  // runtime that could not answer for the settings every row reads.
  if (!state || !settings || !display) return <div />;

  // Which clock the rows' ages are honest against. Fixture observations are
  // measured back from the fixture's own epoch precisely so that no capture
  // run reads them against the time it happened to run at.
  const now = state.run.fixtureMode ? FIXTURE_EPOCH_MS : Date.now();
  const shownStopHotkey = state.hotkeys.stop;
  const hasAudioSignal = fixtureSpeaking || voiceTurn !== undefined;
  const panelOpen = presentation === PANEL_PRESENTATION.PANEL;
  const slotOpen = presentation === PANEL_PRESENTATION.SLOT;
  const feedbackOpen = presentation === PANEL_PRESENTATION.FEEDBACK;

  // What the slot's field is for depends on what answers for that provider now,
  // and settings resolve after the first render.
  const slotSource =
    connections.credentialEntry && settings
      ? settings.credentialSources[connections.credentialEntry.providerId]
      : CREDENTIAL_SOURCE.NONE;
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

  // The calendar step of onboarding, assembled only while it stands: still
  // owed by the main process's record, and with at least one source this
  // build can offer — a gate with no way through is never drawn. A connection
  // does not lower it: the panel body hands the gate the Connections page's
  // own calendar block to review, until Done or the skip answers the step and
  // the record's broadcast takes it down.
  const gateSettings = settings;
  const calendarGate: CalendarGateControl | undefined =
    calendarOnboardingOwed &&
    (gateSettings.appleCalendarAvailable || gateSettings.calendarSignInAvailable)
      ? {
          ...(gateSettings.appleCalendarAvailable
            ? {
                apple: {
                  connecting: connections.appleCalendar.connecting,
                  onConnect: connections.appleCalendar.onSignIn,
                },
              }
            : undefined),
          ...(gateSettings.calendarSignInAvailable
            ? {
                google: {
                  connecting: connections.calendar.connecting,
                  onConnect: connections.calendar.onSignIn,
                },
              }
            : undefined),
          // A consent flow run from the gate parks the panel's tab on the
          // Connections page for its slot to come back to, and the gate masks
          // that while it stands — so answering the step also brings the tab
          // home, or onboarding would end on Integrations instead of the
          // roster the arrival beat is about to call all set.
          onSkip: () => {
            changeTab(PANEL_TAB.SESSIONS);
            tell(ACT_KIND.ONBOARDING_SKIP_CALENDAR);
          },
          onDone: () => {
            changeTab(PANEL_TAB.SESSIONS);
            tell(ACT_KIND.ONBOARDING_COMPLETE_CALENDAR);
          },
        }
      : undefined;

  return (
    <div
      className="app-stage"
      // Whose turn it is, so the capsule can make room for a meter it has to
      // draw beside the face rather than in place of it.
      data-voice={voiceTurn}
      // Whether a run of Luke's is still going, so the capsule can make room
      // for the wait's dots the same way; a live turn's own growth wins, and
      // the wing draws no dots there either.
      data-thinking={String(thinking)}
      // Whether there are words to draw under the shape — a caption or a
      // failure borrowing its strip — so the surface can grow the room they
      // are drawn in.
      data-caption={String(Boolean(caption.texts))}
      // Whether those words need the volume hint under them, which stands in
      // a band of its own below the caption block.
      data-volume-hint={String(volumeHint)}
      data-presentation={presentation}
      // Whether the shape is still on its way down from the panel, so the
      // surface waits for the content it is carrying instead of leading it.
      data-leaving-panel={String(leavingPanel)}
      data-notch={String(display.notch.hasNotch)}
      // Whether sign-in still stands between Luke and anything to watch, so the
      // stylesheet knows the strip holds nothing while a popup is drawn.
      data-gated={String(accountGated)}
      data-capture={String(state.run.captureMode)}
      style={{
        ...notchStyle(display),
        // One slot shape, three possible occupants: the surface follows the
        // height of whichever is actually drawn.
        ...surfaceHeightStyle(
          panelHeight,
          connections.signInWait !== undefined
            ? signInSlotHeight
            : slotOccupant.current === PANEL_STAND_DOWN.CONSENT ||
                slotOccupant.current === PANEL_STAND_DOWN.SUPERSET
              ? connectHeight
              : slotHeight,
          feedbackHeight,
        ),
        ...caption.style,
      }}
    >
      {/* Capsule, peek, slot and panel are all this one shape at different
          sizes, so the surface is never cross-faded — it is only ever resized. */}
      <span className="panel-surface" data-hit-region={HIT_REGION.SURFACE} aria-hidden="true" />

      {/* Inert while hidden: the panel keeps its full layout box behind
          `opacity: 0`, so its buttons stay focusable and the browser will scroll
          them into view, pushing the compact capsule off screen. */}
      <div className="expanded-stage" aria-hidden={!panelOpen} inert={!panelOpen}>
        <section className="expanded-panel" ref={panelElement} data-hit-region={HIT_REGION.PANEL}>
          <PanelBody
            accountRequired={state.run.accountRequired}
            account={state.account}
            onBeginSignIn={connections.beginSignIn}
            {...(connections.signInFailure
              ? { signInFailure: connections.signInFailure }
              : undefined)}
            {...(calendarGate ? { calendarGate } : undefined)}
            list={sessions.list}
            sessionsSettled={sessionsSettled}
            view={sessions.view}
            onViewChange={sessions.onViewChange}
            onFiltersChange={sessions.onFiltersChange}
            now={now}
            onOpenSession={sessions.onOpenSession}
            onOpenSessionApplication={sessions.onOpenSessionApplication}
            writes={sessions.writes}
            conversation={state.conversation}
            roster={sessions.roster}
            onOpenChat={sessions.onOpenChat}
            onOfferRatingFeedback={offerRatingFeedback}
            liveConversationEntries={liveConversationEntries}
            spokenAskPending={spokenAskPending}
            onClearConversationConversation={clearConversationLines}
            brainRequests={brainRequests}
            onFieldEngaged={changeAskEngagement}
            offerOptions={sessions.offerOptions}
            optionsOpen={sessions.optionsOpen}
            onOptionsToggle={sessions.toggleOptions}
            offerSearch={sessions.offerSearch}
            searchOpen={sessions.searchOpen}
            onSearchToggle={() =>
              sessions.searchOpen ? sessions.closeSearch() : sessions.openSearch()
            }
            onSearchClose={sessions.closeSearch}
            settingsSearchOpen={settingsSearchOpen}
            onSettingsSearchToggle={() =>
              settingsSearchOpen ? closeSettingsSearch() : openSettingsSearch()
            }
            tab={tab}
            onTabChange={changeTab}
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
              credentials: connections.credentials,
              feedback: feedback.control,
              panelOpen,
              workspaceProviders: sessions.workspaceProviders,
              calendar: connections.calendar,
              appleCalendar: connections.appleCalendar,
              linear: connections.linear,
              superset: connections.supersetControl,
              onQuit: () => tell(ACT_KIND.WINDOW_QUIT),
              shortcuts,
              searchOpen: settingsSearchOpen,
              onSearchClose: closeSettingsSearch,
              // The same hold the ask field and the session search report
              // through: one caret anywhere in the panel is hands being here.
              onSearchEngaged: changeAskEngagement,
            }}
          />
        </section>
      </div>

      {/* The panel stood down to its field. It shares the expanded window, so
          standing down to it costs no more than the peek does. */}
      {/* The three shapes that borrow the slot never draw together: the
          gate's sign-in wait suppresses the settings tab's two entries
          outright — the two are never on screen at once — and the key and
          consent-connect pills split the remaining case by which entry
          holds the slot. A pill held through an old exit must not resurface
          under another's wait. */}
      {connections.signInWait === undefined ? (
        <>
          <KeySlot
            control={connections.credentials}
            source={slotSource}
            drawn={slotOpen && slotOccupant.current === PANEL_STAND_DOWN.KEY}
            measure={slotElement}
          />
          {/* The panel stood down while a consent sign-in waits on the
              browser, on the key slot's exact terms. */}
          <ConsentConnectSlot
            entry={connections.consentEntry}
            drawn={slotOpen && slotOccupant.current === PANEL_STAND_DOWN.CONSENT}
            onCancel={connections.cancelConsentSignIn}
            onReopen={connections.reopenConsentPage}
            onOpenSystemSettings={() => tell(ACT_KIND.CALENDAR_OPEN_SETTINGS)}
            measure={connectElement}
          />
          {supersetSignInHeld.current ? (
            <SupersetSignInSlot
              state={supersetSignIn}
              drawn={slotOpen && slotOccupant.current === PANEL_STAND_DOWN.SUPERSET}
              onSubmit={(code) => tell(ACT_KIND.SUPERSET_SUBMIT_CODE, { code })}
              onReopen={() => tell(ACT_KIND.SUPERSET_REOPEN_SIGN_IN)}
              onCancel={connections.cancelSupersetSignIn}
              onRetry={connections.beginSupersetSignIn}
              onChooseOrganization={(slug) => tell(ACT_KIND.SUPERSET_CHOOSE_ORGANIZATION, { slug })}
              measure={connectElement}
            />
          ) : null}
        </>
      ) : null}
      {connections.credentialEntry === undefined && connections.consentEntry === undefined ? (
        /* The panel stood down to the account sign-in it is waiting on. */
        <SignInSlot
          {...(connections.signInWait ? { provider: connections.signInWait } : undefined)}
          drawn={slotOpen}
          onCancel={connections.cancelSignIn}
          measure={signInSlotElement}
        />
      ) : null}
      {/* The panel stood down to the composer, on the same terms. */}
      <FeedbackSlot
        control={feedback.control}
        drawn={feedbackOpen}
        measure={feedbackElement}
        confirming={feedback.confirming}
        still={stillMotion}
      />
      <NotchWings
        tally={sessions.tally}
        level={voiceLevel}
        voiceActive={voiceActive}
        {...(voiceTurn ? { voice: voiceTurn } : undefined)}
        fixtureSpeaking={fixtureSpeaking}
        hasAudioSignal={hasAudioSignal}
        voiceOpening={talkOpening}
        thinking={thinking}
        announcementsHeld={announcementsHeld}
        sessionsSettled={sessionsSettled}
        presentation={presentation}
        housingWidth={display.notch.housingWidth}
        accountGated={accountGated}
      />

      {/* The one signed-out Luke. Like the caption, he is a single element in
          every state so the morph carries him instead of trading two copies:
          over the gate's reserved box while the panel is up, and down to the
          peek's strip — the wing spot the authed face holds — when it closes.
          Keyed on the play so each gesture of the introduction cycle is a
          fresh drawing, exactly as the wing remounts its own. */}
      {accountGated ? (
        <span className="sign-in-luke" aria-hidden="true">
          <LukeFace
            key={signInFace.play}
            {...(signInFace.motion ? { motion: signInFace.motion } : undefined)}
          />
        </span>
      ) : null}

      {/* Luke crossing his own panel to sign a control he moved. Drawn over
          everything, because it passes over the panel it is crossing, and
          answering no pointer at all — the strip's one button and the control
          it lands on both keep every press. The tap is what lets the switch
          be seen to move, and the way home is what lets a panel stood up for
          the errand stand back down. */}
      <LukeErrand
        {...(errands.errand ? { errand: errands.errand } : undefined)}
        onLanded={errands.onLanded}
        onReturned={errands.onReturned}
      />

      {/* Luke's words while he says them: one element in every state, under
          the housing while the shape is compact and carried to the panel's
          foot when it opens, so the words travel with the morph instead of
          jumping between two copies. Not in a wing — the wings clip at the
          capsule's height — and always mounted, like the count's caption, so
          both edges of its fade can run. The inner stack is what is measured —
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
        {...(caption.tone !== CAPTION_TONE.WORDS ? { role: "status" } : { "aria-hidden": true })}
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
      <span
        className="volume-hint"
        role="status"
        inert={!volumeHint}
        data-hit-region={HIT_REGION.CAPSULE}
      >
        <span className="volume-hint-text">{volumeHintText(outputAudio)}</span>
        <button type="button" className="volume-hint-dismiss" onClick={dismissVolumeHint}>
          Got it
        </button>
      </span>

      <div className="compact-stage">
        {/* A button, not a hover target: hovering only peeks, pressing commits.
            It stays live over an open panel so pressing it closes again. */}
        <button
          type="button"
          className="compact-hover-target"
          data-hit-region={HIT_REGION.CAPSULE}
          aria-expanded={panelOpen}
          aria-label={panelOpen ? "Close the panel" : "Open the panel"}
          // Keeps the press from moving focus here at all, so nothing is drawn
          // around the notch strip and a focused settings field keeps the caret.
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleCapsulePress}
        />
      </div>
    </div>
  );
}
