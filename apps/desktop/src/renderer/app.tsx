import {
  FEEDBACK_COMPOSER_KIND,
  type FeedbackComposerKind,
  FIXTURE_EPOCH_MS,
  type NormalizedSession,
  type ObservedWorkspaceProject,
  type PanelFormFactor,
  type ProviderId,
  REALTIME_STATUS,
  type RealtimeVoice,
  type RealtimeVoiceSpeed,
  type SessionIdentity,
  VOICE_CAPTION_MAX_HEIGHT,
  type WorkspaceAgentSelection,
} from "@sidecar/core";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppBootstrap,
  AppSettings,
  DisplayDiagnostic,
  OutputAudioState,
  SessionOpenResult,
  SettingsUpdateResult,
  WindowMode,
} from "../shared/contracts";
import { CREDENTIAL_SOURCE, SESSION_OPEN_RESULT_STATUS } from "../shared/contracts";
import type { CredentialProviderId } from "../shared/credential-providers";
import {
  CREDENTIAL_PROVIDER_LIST,
  CREDENTIAL_PROVIDERS,
  isCredentialProviderId,
} from "../shared/credential-providers";
import type { FeedbackImage, FeedbackKind } from "../shared/feedback";
import { FEEDBACK_KIND, FEEDBACK_LIMITS, feedbackKindForLifecycleEvent } from "../shared/feedback";
import { voiceHotkeyLabel, voiceHotkeyToShow } from "../shared/voice-hotkey";
import { ASK_LUKE_INPUT_ID, focusAskField } from "./ask-luke";
import type { CredentialEntry, CredentialEntryControl } from "./credential-entry";
import { isSubmittable, removalEndsEntry } from "./credential-entry";
import {
  type FeedbackEntry,
  type FeedbackEntryControl,
  IMAGE_REFUSAL,
  isSendable,
  openedFeedbackEntry,
} from "./feedback-entry";
import { encodeFeedbackImage } from "./feedback-images";
import { FeedbackSlot } from "./feedback-slot";
import { KeySlot } from "./key-slot";
import {
  ERRAND_WAIT,
  type Errand,
  type ErrandTarget,
  type ErrandWait,
  errandTargets,
  LukeErrand,
} from "./luke-errand";
import { applySpokenSetting, buildLukeGuide, isAppSettingId } from "./luke-guide";
import { NotchWings } from "./notch-wings";
import { PanelBody, type SessionWriteHandlers } from "./panel-body";
import {
  HIT_REGION,
  HIT_REGION_ATTRIBUTE,
  LEAVE_DELAY_MS,
  PANEL_PRESENTATION,
  type PanelPresentation,
  PEEK_ENTER_DELAY_MS,
  presentationForMode,
  SETTLE_DELAY_MS,
} from "./panel-state";
import { PANEL_TAB, type PanelTab } from "./panel-tabs";
import type { AppActionCarrier } from "./realtime-session";
import {
  arrangeSessions,
  DEFAULT_SESSION_VIEW,
  type DisplaySession,
  displaySessions,
  SESSION_FILTER,
  type SessionView,
  sessionFilterFromSpoken,
  sessionTally,
  tallySummary,
} from "./session-model";
import { SESSION_OPTIONS_BUTTON_ID, SESSION_OPTIONS_ID } from "./session-parts";
import { SETTING_PAGE, SETTINGS_VIEW, type SettingsView } from "./settings-views";
import { panelEntryOpen, usePanelEntry } from "./use-panel-entry";
import { useVoiceConversation } from "./use-voice-conversation";
import {
  outputSilent,
  VOLUME_HINT_HEIGHT,
  type VolumeHintDismissal,
  volumeHintDismissed,
  volumeHintText,
} from "./volume-hint";

/**
 * How long the settings tab keeps saying a note to the founders was sent. Long
 * enough to be read on the way back from the Send button, short enough that
 * the line is gone before anyone wonders whether it is stuck.
 */
const FEEDBACK_NOTICE_MS = 6_000;

/**
 * The composer kind a spoken open names, matched to the composer's own. The
 * two vocabularies are defined apart — the tool's in brand-neutral core, the
 * composer's beside the endpoint that reads a submission — so the seam between
 * them is written down once, here, rather than assumed at a call site.
 */
const FEEDBACK_KIND_FOR_COMPOSER: Record<FeedbackComposerKind, FeedbackKind> = {
  [FEEDBACK_COMPOSER_KIND.FEEDBACK]: FEEDBACK_KIND.FEEDBACK,
  [FEEDBACK_COMPOSER_KIND.PROMPT]: FEEDBACK_KIND.PROMPT,
};

/**
 * The caption block's vertical padding — 5px above the text and 9px keeping
 * it clear of the shape's bottom edge. Mirrors `.voice-caption`'s padding in
 * the stylesheet: the measured text plus this is what the surface grows by.
 */
const CAPTION_PADDING = 14;

/**
 * Sizes the caption block to the words it currently holds. The text wraps, so
 * only a measurement can say how tall it is; the size drives the surface's
 * growth and the clip that reveals the text, and past the reserved maximum
 * the remainder becomes scroll, rolling the oldest lines up under the shape.
 * The volume hint shares the block's reserved room: while it is drawn, its
 * row is added to the size and taken from the words' budget, so the block
 * never asks for more height than the window holds.
 */
function captionSizeStyle(textHeight: number | undefined, volumeHint: boolean): CSSProperties {
  if (!textHeight) return {};
  const hintHeight = volumeHint ? VOLUME_HINT_HEIGHT : 0;
  return {
    "--caption-size": `${Math.min(VOICE_CAPTION_MAX_HEIGHT, textHeight + hintHeight + CAPTION_PADDING)}px`,
    "--caption-scroll": `${Math.max(0, textHeight - (VOICE_CAPTION_MAX_HEIGHT - CAPTION_PADDING - hintHeight))}px`,
  } as CSSProperties;
}

function usePointerPassthrough(
  onHitRegionEnter: () => void,
  onHitRegionLeave: () => void,
  presentation: PanelPresentation,
): void {
  const lastValue = useRef<boolean | undefined>(undefined);
  const lastPoint = useRef<{ x: number; y: number } | undefined>(undefined);

  const update = useCallback(
    (interceptsPointer: boolean) => {
      if (lastValue.current === interceptsPointer) return;
      lastValue.current = interceptsPointer;
      window.sidecar.setPointerInterception(interceptsPointer);
      if (interceptsPointer) onHitRegionEnter();
      else onHitRegionLeave();
    },
    [onHitRegionEnter, onHitRegionLeave],
  );

  const testLastPoint = useCallback(
    (drawn: PanelPresentation) => {
      const point = lastPoint.current;
      if (!point) return;
      // `elementFromPoint` answers null for a point outside the viewport, which a
      // forwarded move can carry. Comparing that against null read as "still
      // inside", so leaving by the edge left the panel open until some other
      // event closed it.
      const region = document
        .elementFromPoint(point.x, point.y)
        ?.closest(`[${HIT_REGION_ATTRIBUTE}]`);
      const kind = region?.getAttribute(HIT_REGION_ATTRIBUTE);
      // The shape takes the pointer wherever it is drawn, which is the whole
      // rule: the capsule strip and the panel's body are what sit on top of it
      // and answer first. The surface is what answers in between — the panel's
      // body is not a target for the first `--expand-delay` of an opening, and
      // by then the strip has already narrowed from the peek's width back to
      // the capsule's, so a press out where the marks unfold would otherwise
      // land on nothing and read as the pointer leaving.
      update(
        kind === HIT_REGION.SURFACE ||
          kind === HIT_REGION.CAPSULE ||
          (kind === HIT_REGION.PANEL && drawn === PANEL_PRESENTATION.PANEL) ||
          (kind === HIT_REGION.SLOT && drawn === PANEL_PRESENTATION.SLOT) ||
          (kind === HIT_REGION.FEEDBACK && drawn === PANEL_PRESENTATION.FEEDBACK),
      );
    },
    [update],
  );

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      lastPoint.current = { x: event.clientX, y: event.clientY };
      testLastPoint(presentation);
    };
    const handleLeave = () => {
      lastPoint.current = undefined;
      update(false);
    };
    window.addEventListener("mousemove", handleMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", handleLeave);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      document.documentElement.removeEventListener("mouseleave", handleLeave);
    };
  }, [presentation, testLastPoint, update]);

  // The shape can change under a pointer that never moves — Escape closes the
  // panel, and the tray opens it — and what the pointer is over changes with it.
  // Without this the window keeps intercepting clicks for a shape that is no
  // longer drawn, and the window is always larger than the shape.
  useEffect(() => {
    testLastPoint(presentation);
  }, [presentation, testLastPoint]);
}

function notchStyle(display: DisplayDiagnostic): CSSProperties {
  return {
    "--notch-top-inset": `${display.notch.topInset}px`,
    "--notch-housing-width": `${display.notch.housingWidth}px`,
  } as CSSProperties;
}

function shapeHeightStyle(
  panelHeight: number | undefined,
  slotHeight: number | undefined,
  feedbackHeight: number | undefined,
): CSSProperties {
  return {
    ...(panelHeight === undefined ? {} : { "--panel-height": `${panelHeight}px` }),
    ...(slotHeight === undefined ? {} : { "--slot-height": `${slotHeight}px` }),
    ...(feedbackHeight === undefined ? {} : { "--feedback-height": `${feedbackHeight}px` }),
  } as CSSProperties;
}

/**
 * Reports a shape's own content height so the black surface can end where the
 * content does. The window stays one size; only the shape inside it follows
 * what it holds — the number of sessions in the panel, a refusal appearing
 * under the slot's field — which is what makes either one feel like a resize
 * rather than a redraw.
 */
function useShapeHeight(): [(element: HTMLElement | null) => void, number | undefined] {
  const observer = useRef<ResizeObserver | undefined>(undefined);
  const [height, setHeight] = useState<number>();

  // A callback ref rather than an effect: the panel mounts only once bootstrap
  // has resolved, and the slot only once a key is being entered — both after
  // the first render.
  const measured = useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = undefined;
    if (!element) return;
    const measure = () => setHeight(Math.ceil(element.getBoundingClientRect().height));
    const nextObserver = new ResizeObserver(measure);
    nextObserver.observe(element);
    observer.current = nextObserver;
    measure();
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return [measured, height];
}

export function App(): React.JSX.Element {
  const [bootstrap, setBootstrap] = useState<AppBootstrap>();
  const [sessions, setSessions] = useState<readonly NormalizedSession[]>([]);
  const [workspaceProjects, setWorkspaceProjects] = useState<readonly ObservedWorkspaceProject[]>(
    [],
  );
  const [display, setDisplay] = useState<DisplayDiagnostic>();
  const [presentation, setPresentation] = useState<PanelPresentation>(PANEL_PRESENTATION.CAPSULE);
  const [tab, setTab] = useState<PanelTab>(PANEL_TAB.SESSIONS);
  const [settingsView, setSettingsView] = useState<SettingsView>(SETTINGS_VIEW.ROOT);
  const [sessionView, setSessionView] = useState<SessionView>(DEFAULT_SESSION_VIEW);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>();
  const [errand, setErrand] = useState<Errand>();
  const [feedbackNotice, setFeedbackNotice] = useState<string>();
  // Counts for nothing except having changed: each tick re-renders the rows so
  // their "how long ago" labels stay honest while they are on screen.
  const [, setClock] = useState(0);
  const [panelElement, panelHeight] = useShapeHeight();
  const [slotElement, slotHeight] = useShapeHeight();
  const [feedbackElement, feedbackHeight] = useShapeHeight();
  const [captionTextElement, captionTextHeight] = useShapeHeight();
  /**
   * The ask key as last re-taken, superseding bootstrap's once it has changed
   * at all: moving the talk key re-registers every global chord, and the ask
   * key can land somewhere new or nowhere. Wrapped so "changed to none" is
   * told apart from "never changed" — the same reading order the talk key's
   * own state follows.
   */
  const [askHotkeyChange, setAskHotkeyChange] = useState<{ accelerator?: string }>();
  /** The stop key on the ask key's exact terms, for the guide's sake. */
  const [stopHotkeyChange, setStopHotkeyChange] = useState<{ accelerator?: string }>();
  /**
   * The Mac's output as last read — its mute switch and volume — absent
   * wherever it cannot be read, which is drawn as audible. While it says
   * Luke's voice would land on silence, his words are captioned whatever the
   * preference says, and a hint under them asks for volume.
   */
  const [outputAudio, setOutputAudio] = useState<OutputAudioState>();
  /**
   * Whether a live push has arrived, so the bootstrap's older snapshot does
   * not clobber one that raced past it — the same reading order the issue
   * roster follows.
   */
  const outputAudioPushed = useRef(false);
  /**
   * Which stretch of unbroken silence is on screen, advanced each time one
   * begins. A "Got it" is remembered against the stretch it answered, so it
   * holds for that whole mute and lapses naturally with it.
   */
  const [silenceStretch, setSilenceStretch] = useState(0);
  const wasSilent = useRef(false);
  const [hintDismissal, setHintDismissal] = useState<VolumeHintDismissal>();
  const hoverTimer = useRef<number | undefined>(undefined);
  const presentationRef = useRef<PanelPresentation>(PANEL_PRESENTATION.CAPSULE);
  const tabRef = useRef<PanelTab>(PANEL_TAB.SESSIONS);
  /**
   * Whether a composer is held, mirrored for the presentation cluster: a
   * capsule close keeps the settings tab for a half-written key or note, and
   * the pointer holds the panel open for a credential still on screen.
   */
  const credentialHeld = useRef(false);
  const feedbackHeld = useRef(false);
  /**
   * Whether the caret is in the ask field. It holds the panel open against the
   * pointer the way a credential entry does, and for the same reason: the
   * pointer wandering off is not a decision about the thing someone is in the
   * middle of typing.
   */
  const askEngaged = useRef(false);
  const feedbackNoticeTimer = useRef<number | undefined>(undefined);
  /**
   * The words a spoken open asked to start the note with, waiting for the
   * composer's lifecycle event to consume them. A ref rather than an event
   * payload because the lifecycle channel carries names alone — and only ever
   * the developer's own words, under the spoken tool's contract.
   */
  const spokenFeedbackDraft = useRef<string | undefined>(undefined);
  const pointerInside = useRef(false);
  const modeGeneration = useRef(0);
  /**
   * Whether a live projects push has arrived. The bootstrap reply resolves
   * whenever the main process gets to it, so a push can land first — and the
   * bootstrap's older snapshot must then not clobber it, because the main
   * process will not repeat a list it believes it already announced.
   */
  const workspaceProjectsPushed = useRef(false);
  const issuesPushed = useRef(false);
  /**
   * Whether another window's settings change has arrived, under the same rule
   * as the roster above: a push that lands before the bootstrap reply is the
   * newer truth, and the bootstrap's older snapshot must not clobber it.
   */
  const settingsPushed = useRef(false);
  /**
   * How many errands Luke has run. Carried with each one so that asking for
   * the same control twice flies twice, exactly as a repeated face gesture is
   * replayed by counting its plays.
   */
  const errands = useRef(0);

  /**
   * What the panel is not drawing yet, because Luke has not reached it.
   *
   * The change itself is made the moment it is asked for — nothing here delays
   * a write, and the spoken answer reports what actually happened. What waits
   * is only the drawing of it: a switch that has already flipped, or a list
   * already narrowed, by the time Luke arrives makes the act look like
   * something he flew over to inspect, and the whole point of the errand is
   * that he is the one doing it. Both kinds wait, because both are the same
   * mistake — the settings snapshot the store answered with, and the narrowing
   * or re-ordering a spoken ask chose for the list.
   *
   * Refs rather than state: the release runs from a callback that has to stay
   * stable across the whole flight it is timing, and an errand carries one of
   * these or the other, never both.
   */
  const heldSettings = useRef<AppSettings | undefined>(undefined);
  const heldView = useRef<Partial<SessionView> | undefined>(undefined);
  const releaseErrandChange = useCallback(() => {
    const settings = heldSettings.current;
    const view = heldView.current;
    heldSettings.current = undefined;
    heldView.current = undefined;
    if (settings !== undefined) setSettings(settings);
    // Folded into whatever the view is at the moment it lands rather than the
    // moment it was chosen: the list corrects its own filter during render
    // when one empties, and a snapshot taken at the ask would undo that.
    if (view !== undefined) setSessionView((current) => ({ ...current, ...view }));
  }, []);

  /**
   * Whether the panel on screen is one an errand stood up. Only then is it the
   * errand's to put away again — a panel that was already open is somewhere
   * the developer had gone themselves, and closing it would be taking it from
   * them for having spoken.
   */
  const errandOpenedPanel = useRef(false);

  /**
   * Sends Luke to sign what he just did, if there is anywhere to sign it, and
   * answers whether he actually went.
   *
   * Only the panel can hold a signature, so both callers stand it up first and
   * this is the backstop rather than the decision: an act whose panel never
   * opened, or that named a control this build does not draw, flies nowhere
   * and the spoken answer reports it the way it always did. A caller holding
   * something for the flight reads the answer and lets go itself.
   */
  const runErrand = useCallback((targets: readonly ErrandTarget[], wait: ErrandWait): boolean => {
    if (targets.length === 0) return false;
    if (presentationRef.current !== PANEL_PRESENTATION.PANEL) return false;
    errands.current += 1;
    setErrand({ targets, wait, run: errands.current });
    return true;
  }, []);

  const changeTab = useCallback((next: PanelTab) => {
    tabRef.current = next;
    setTab(next);
    // The sheet belongs to the session list, and it is drawn over the list it
    // belongs to, so leaving for Settings has to take it along.
    setOptionsOpen(false);
    // Arriving at the tab is arriving at its front page: a page left open
    // behind a tab switch would greet the next visit with a corner of the
    // settings rather than the settings. The flows that need a deeper page —
    // a credential entry returning from the key slot, the evidence run that
    // starts in it — set their page right after this reset.
    setSettingsView(SETTINGS_VIEW.ROOT);
  }, []);

  // A choice made in the sheet puts the sheet away. It is drawn over the list
  // and is taller than a row, so a list narrowed to one or two sessions ends up
  // entirely behind it — the control would hide the very rows it was asked for,
  // which reads as a filter that shows nothing at all. The fallback the render
  // performs when a filter empties writes the view directly instead: that is the
  // list correcting itself, not somebody choosing.
  const changeSessionView = useCallback((next: SessionView) => {
    setSessionView(next);
    setOptionsOpen(false);
  }, []);

  const applyPresentation = useCallback(
    (next: PanelPresentation) => {
      presentationRef.current = next;
      setPresentation(next);
      // The sheet is only ever drawn inside the panel, so any other shape puts
      // it away. Left set behind a shape that cannot draw it, it would be over
      // the list again the next time the panel came forward with nothing having
      // been pressed — and a key half-entered is the one thing that survives a
      // close, which the sheet is not.
      if (next !== PANEL_PRESENTATION.PANEL) setOptionsOpen(false);
      // A panel that has closed reopens on the session list, showing every
      // session with whatever needs a person first: settings are somewhere you
      // go, not a state the capsule remembers, and a filter left in place would
      // let the panel hide a session the capsule is still counting.
      //
      // Something half-written is the one exception, and only to the tab — a
      // key being entered or a note to the founders alike: it is what someone
      // is in the middle of, so however the panel closed, it opens again where
      // they left it. The list is not something anyone is in the middle of, so
      // it resets either way.
      if (next === PANEL_PRESENTATION.CAPSULE) {
        setSessionView(DEFAULT_SESSION_VIEW);
        if (!credentialHeld.current && !feedbackHeld.current) {
          changeTab(PANEL_TAB.SESSIONS);
        }
      }
    },
    [changeTab],
  );

  const applyAuthoritativeMode = useCallback(
    (nextMode: WindowMode) => {
      // A lifecycle notification can originate outside this renderer (for
      // example from the tray). Ignore an older IPC result that arrives later.
      modeGeneration.current += 1;
      applyPresentation(presentationForMode(nextMode));
    },
    [applyPresentation],
  );

  /**
   * Applies a settings write's reply: the snapshot the store actually holds,
   * and any refusal for the row to show. Every settings row travels this
   * road so it redraws from what was stored rather than from the press.
   */
  const applySettingsReply = useCallback((result: SettingsUpdateResult) => {
    setSettings(result.settings);
    return result.reason;
  }, []);

  const changeVoiceCaptions = useCallback(
    async (enabled: boolean) => applySettingsReply(await window.sidecar.setVoiceCaptions(enabled)),
    [applySettingsReply],
  );

  const changeDuckOtherMedia = useCallback(
    async (enabled: boolean) => applySettingsReply(await window.sidecar.setDuckOtherMedia(enabled)),
    [applySettingsReply],
  );

  const changeSessionNotifications = useCallback(
    async (enabled: boolean) =>
      applySettingsReply(await window.sidecar.setSessionNotifications(enabled)),
    [applySettingsReply],
  );

  const cancelHoverTransition = useCallback(() => {
    if (hoverTimer.current === undefined) return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = undefined;
  }, []);

  /**
   * Only the panel needs the main process. The capsule and the peek share a
   * window, so hovering never leaves the renderer — which is what lets the peek
   * answer the pointer immediately.
   */

  const changeMode = useCallback(
    async (expanded: boolean) => {
      const previous = presentationRef.current;
      const generation = modeGeneration.current + 1;
      modeGeneration.current = generation;
      presentationRef.current = expanded ? PANEL_PRESENTATION.PANEL : PANEL_PRESENTATION.CAPSULE;
      try {
        // Asking for focus is what makes Escape reach the panel someone opened.
        const confirmedMode = await window.sidecar.setExpanded(expanded, expanded);
        if (modeGeneration.current === generation) {
          applyPresentation(presentationForMode(confirmedMode));
        }
      } catch (error) {
        if (modeGeneration.current === generation) presentationRef.current = previous;
        throw error;
      }
    },
    [applyPresentation],
  );

  const handleHitRegionEnter = useCallback(() => {
    cancelHoverTransition();
    pointerInside.current = true;
    if (presentationRef.current !== PANEL_PRESENTATION.CAPSULE) return;
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = undefined;
      if (presentationRef.current === PANEL_PRESENTATION.CAPSULE) {
        applyPresentation(PANEL_PRESENTATION.PEEK);
      }
    }, PEEK_ENTER_DELAY_MS);
  }, [applyPresentation, cancelHoverTransition]);

  /**
   * True while a field someone could be part-way through is actually on screen.
   * An entry outlives the tab it was started on now, so holding the panel open
   * for one that is not drawn would leave the pointer unable to close a panel
   * showing nothing but sessions.
   */
  const entryIsDrawn = useCallback(
    () => credentialHeld.current && tabRef.current === PANEL_TAB.SETTINGS,
    [],
  );

  const handleHitRegionLeave = useCallback(() => {
    cancelHoverTransition();
    pointerInside.current = false;
    const current = presentationRef.current;
    if (current === PANEL_PRESENTATION.CAPSULE) return;
    // The slot is drawn for someone who is somewhere else entirely — in a
    // browser, fetching the key it is waiting for — so the pointer being away
    // from it is the normal case rather than a dismissal.
    if (current === PANEL_PRESENTATION.SLOT) return;
    // The composer holds words someone is in the middle of, which the pointer
    // must not be allowed to discard: like the slot, it stays put until it is
    // dismissed, cancelled, or sent.
    if (current === PANEL_PRESENTATION.FEEDBACK) return;
    // A key half-typed is one thing the pointer must not be allowed to
    // discard; an ask being typed to Luke is the other. Everything else on
    // the settings tab closes like the sessions tab does.
    if (current === PANEL_PRESENTATION.PANEL && (entryIsDrawn() || askEngaged.current)) return;
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = undefined;
      if (presentationRef.current === PANEL_PRESENTATION.PEEK) {
        applyPresentation(PANEL_PRESENTATION.CAPSULE);
      } else if (presentationRef.current === PANEL_PRESENTATION.PANEL) {
        // Read again rather than trusting the answer from when this was
        // scheduled: an entry can begin inside the delay — pressing Connect and
        // reaching for the keyboard does exactly that — and a close decided
        // before it began would discard it.
        if (entryIsDrawn() || askEngaged.current) return;
        void changeMode(false);
      }
    }, LEAVE_DELAY_MS);
  }, [applyPresentation, cancelHoverTransition, changeMode, entryIsDrawn]);

  /**
   * The ask field taking or letting go of the caret. Letting go while the
   * pointer is already away has to release the hold the caret had on the
   * panel — the pointer cannot leave a second time — which is the same rule
   * ending a credential entry follows.
   */
  const changeAskEngagement = useCallback(
    (engaged: boolean) => {
      const released = askEngaged.current && !engaged;
      askEngaged.current = engaged;
      if (released && !pointerInside.current) handleHitRegionLeave();
    },
    [handleHitRegionLeave],
  );

  /**
   * Brings the panel back around the line the entry belongs to, and leaves it
   * open the way every other way of opening it does — the pointer closes it by
   * visiting and leaving.
   */
  const restorePanel = useCallback(() => {
    changeTab(PANEL_TAB.SETTINGS);
    // The line the entry belongs to lives on the Connections page, and
    // changeTab has just reset the tab to its front page: without this, the
    // check appearing beside the provider — the answer to what was just done
    // — would land on a page nobody is looking at.
    setSettingsView(SETTINGS_VIEW.CONNECTIONS);
    void changeMode(true);
  }, [changeMode, changeTab]);

  const settlePanel = useCallback(() => {
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = undefined;
      if (presentationRef.current === PANEL_PRESENTATION.PANEL) void changeMode(false);
    }, SETTLE_DELAY_MS);
  }, [changeMode]);

  const leavePanel = useCallback(() => {
    void changeMode(false);
  }, [changeMode]);

  /**
   * Asking to write a key is asking for one thing, so the panel gets out of the
   * way of it: the shape goes down to the slot, which is the field and nothing
   * else. It is the same wherever the key is coming from — a first connection, a
   * stored key being replaced, or one standing in front of the environment's —
   * because they are all the same act.
   */
  const credentialsEntry = usePanelEntry<CredentialEntry>({
    aside: PANEL_PRESENTATION.SLOT,
    restoresPanel: (held) => held.away !== true,
    isSendable: isSubmittable,
    send: async (sending) => {
      const result = await window.sidecar.setProviderApiKey(sending.providerId, sending.draft);
      setSettings(result.settings);
      return result.reason ? { rejection: result.reason } : {};
    },
    pointerInside: () => pointerInside.current,
    presentation: () => presentationRef.current,
    onReleasedWhileAway: handleHitRegionLeave,
    cancelHover: cancelHoverTransition,
    applyPresentation,
    restorePanel,
    leave: leavePanel,
    settle: settlePanel,
    heldRef: credentialHeld,
  });

  const beginEntry = useCallback(
    (providerId: CredentialProviderId) => {
      credentialsEntry.begin({ providerId, draft: "", busy: false, away: false });
    },
    [credentialsEntry.begin],
  );

  /**
   * Sends the browser to the provider's key page. The entry remembers that it
   * did: from here on, the person this slot is waiting for is reading a page
   * that Luke — which floats above every window — would otherwise be sitting on
   * top of. It is also what the slot is for, so the shape is already right; the
   * panel is only stood down if the link was pressed from inside it.
   */
  const fetchKey = useCallback(() => {
    const current = credentialsEntry.latest();
    // Same rule as typing: the key on its way to the store is what the entry is
    // for, and going to fetch another one is not a reason to disturb it. Both
    // views disable the link while it is in flight, so this is the floor rather
    // than the answer.
    if (!panelEntryOpen(current)) return;
    window.sidecar.openProviderApiKeys(current.providerId);
    credentialsEntry.apply({ ...current, away: true });
    if (presentationRef.current === PANEL_PRESENTATION.SLOT) return;
    credentialsEntry.standDown();
  }, [credentialsEntry.apply, credentialsEntry.latest, credentialsEntry.standDown]);

  const removeProviderApiKey = useCallback(
    async (providerId: CredentialProviderId) => {
      const result = await window.sidecar.setProviderApiKey(providerId, undefined);
      setSettings(result.settings);
      // Delete and the field are on the row together once the panel has been
      // brought back around an entry, and a key that has been removed cannot be
      // replaced.
      if (removalEndsEntry(credentialsEntry.latest(), providerId, result.reason)) {
        credentialsEntry.apply(undefined);
      }
      return result.reason;
    },
    [credentialsEntry.apply, credentialsEntry.latest],
  );

  const credentials: CredentialEntryControl = {
    entry: credentialsEntry.entry,
    begin: beginEntry,
    change: (draft) => credentialsEntry.patch({ draft }),
    fetchKey,
    cancel: credentialsEntry.cancel,
    commit: credentialsEntry.commit,
    remove: removeProviderApiKey,
  };

  /** Shows or hides the menu bar status item. */
  const changeShowInMenuBar = useCallback(
    async (show: boolean) => applySettingsReply(await window.sidecar.setShowInMenuBar(show)),
    [applySettingsReply],
  );

  const changeShowInDock = useCallback(
    async (show: boolean) => applySettingsReply(await window.sidecar.setShowInDock(show)),
    [applySettingsReply],
  );

  const changeShowOnAllDisplays = useCallback(
    async (show: boolean) => applySettingsReply(await window.sidecar.setShowOnAllDisplays(show)),
    [applySettingsReply],
  );

  const changeFormFactor = useCallback(
    async (formFactor: PanelFormFactor) =>
      applySettingsReply(await window.sidecar.setFormFactor(formFactor)),
    [applySettingsReply],
  );

  // Where a nameless creation ask goes — the same store write the first
  // creation makes on its own, offered by hand so the choice can be changed
  // or returned to asking each time.
  const changeDefaultWorkspaceProvider = useCallback(
    async (providerId: ProviderId | undefined) =>
      applySettingsReply(await window.sidecar.setDefaultWorkspaceProvider(providerId)),
    [applySettingsReply],
  );

  const changeWorkspaceAgentDefault = useCallback(
    async (providerId: ProviderId, selection: WorkspaceAgentSelection | undefined) =>
      applySettingsReply(await window.sidecar.setWorkspaceAgentDefault(providerId, selection)),
    [applySettingsReply],
  );

  /**
   * The providers the default-workspace row can offer: every provider
   * currently offering projects, named the way its adapter names itself, plus
   * a stored default that is not offering right now — the row must show the
   * choice it holds, or it could be neither seen nor cleared.
   */
  const storedWorkspaceProvider = settings?.defaultWorkspaceProvider;
  const workspaceProviderOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const project of workspaceProjects) names.set(project.providerId, project.providerName);
    if (storedWorkspaceProvider && !names.has(storedWorkspaceProvider)) {
      names.set(
        storedWorkspaceProvider,
        isCredentialProviderId(storedWorkspaceProvider)
          ? CREDENTIAL_PROVIDERS[storedWorkspaceProvider].displayName
          : storedWorkspaceProvider,
      );
    }
    return [...names.entries()].map(([id, name]) => ({ id, name }));
  }, [workspaceProjects, storedWorkspaceProvider]);

  /**
   * Says a send landed, and stops saying it once it has been readable. Long
   * enough to be read on the way back from the Send button, short enough that
   * the line is gone before anyone wonders whether it is stuck.
   */
  const showFeedbackNotice = useCallback((notice: string) => {
    if (feedbackNoticeTimer.current !== undefined) {
      window.clearTimeout(feedbackNoticeTimer.current);
    }
    setFeedbackNotice(notice);
    feedbackNoticeTimer.current = window.setTimeout(() => {
      feedbackNoticeTimer.current = undefined;
      setFeedbackNotice(undefined);
    }, FEEDBACK_NOTICE_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(feedbackNoticeTimer.current), []);

  const feedbackEntry = usePanelEntry<FeedbackEntry>({
    aside: PANEL_PRESENTATION.FEEDBACK,
    restoresPanel: (held) => held.fromPanel === true,
    isSendable,
    send: async (sending) => {
      const name = sending.name.trim();
      const email = sending.email.trim();
      try {
        const result = await window.sidecar.sendFeedback({
          kind: sending.kind,
          message: sending.message.trim(),
          ...(name ? { name } : {}),
          ...(email ? { email } : {}),
          images: sending.images,
        });
        if (!result.delivered) {
          return { rejection: result.reason ?? "Could not send that. Try again." };
        }
        return {};
      } catch {
        return { rejection: "Could not send that. Try again." };
      }
    },
    onDelivered: () => showFeedbackNotice("Sent — thank you."),
    pointerInside: () => pointerInside.current,
    presentation: () => presentationRef.current,
    onReleasedWhileAway: handleHitRegionLeave,
    cancelHover: cancelHoverTransition,
    applyPresentation,
    restorePanel,
    leave: leavePanel,
    settle: settlePanel,
    heldRef: feedbackHeld,
  });

  /**
   * Opens the composer for a kind — from the section's own buttons, from the
   * tray, or asked of Luke out loud — and stands the panel down to its shape,
   * the way beginning a key entry stands it down to the slot: writing one
   * note is one act. What opening does to a note already there is
   * {@link openedFeedbackEntry}'s to decide — a half-written note is brought
   * back rather than discarded, and a starting draft lands only in an empty
   * one. Reports whether the draft was placed, so the spoken path can say
   * what it found; where leaving returns you follows the latest ask, not the
   * first.
   */
  const beginFeedback = useCallback(
    (kind: FeedbackKind, fromPanel: boolean, draft?: string): boolean => {
      setFeedbackNotice(undefined);
      const opened = openedFeedbackEntry(feedbackEntry.latest(), {
        kind,
        fromPanel,
        ...(draft !== undefined ? { draft } : {}),
      });
      if (opened.entry) feedbackEntry.apply(opened.entry);
      feedbackEntry.standDown();
      return opened.drafted;
    },
    [feedbackEntry.apply, feedbackEntry.latest, feedbackEntry.standDown],
  );

  /**
   * Leaves the shape and keeps the draft — Escape's meaning here. A note is
   * longer than a key, and a key is the only thing Escape is allowed to
   * discard; the way back in is the same button, now reading "keep writing".
   * Where it returns you is where the composer was last asked for from: the
   * panel, or — from the tray — nothing at all.
   */
  const dismissFeedback = useCallback(() => {
    if (presentationRef.current !== PANEL_PRESENTATION.FEEDBACK) return;
    if (feedbackEntry.latest()?.fromPanel === true) restorePanel();
    else leavePanel();
  }, [feedbackEntry.latest, leavePanel, restorePanel]);

  /**
   * Takes picked or pasted files aboard. Encoding happens here on the user's
   * machine — scaled and re-written where a screenshot would not fit the
   * request a submission has to travel as — and what could not come is said
   * beside the field rather than dropped in silence.
   */
  const attachFeedbackImages = useCallback(
    async (files: readonly File[]) => {
      const current = feedbackEntry.latest();
      if (!panelEntryOpen(current)) return;
      const room = FEEDBACK_LIMITS.MAX_IMAGES - current.images.length;
      const taken = files.slice(0, Math.max(0, room));
      const encoded: FeedbackImage[] = [];
      let refused = false;
      for (const file of taken) {
        const image = await encodeFeedbackImage(file);
        if (image) encoded.push(image);
        else refused = true;
      }
      // Read again after the awaits: typing meanwhile replaced the entry
      // object, and Cancel or a send may have ended it altogether.
      const latest = feedbackEntry.latest();
      if (!panelEntryOpen(latest)) return;
      const rejection = refused
        ? IMAGE_REFUSAL.UNREADABLE
        : files.length > room
          ? IMAGE_REFUSAL.FULL
          : undefined;
      feedbackEntry.apply({
        ...latest,
        images: [...latest.images, ...encoded].slice(0, FEEDBACK_LIMITS.MAX_IMAGES),
        rejection,
      });
    },
    [feedbackEntry.apply, feedbackEntry.latest],
  );

  const feedbackControl: FeedbackEntryControl = {
    entry: feedbackEntry.entry,
    ...(feedbackNotice ? { notice: feedbackNotice } : {}),
    // The section's own buttons are the panel asking, so leaving returns there.
    begin: (kind) => beginFeedback(kind, true),
    changeMessage: (message) => feedbackEntry.patch({ message }),
    changeName: (name) => feedbackEntry.patch({ name }),
    changeEmail: (email) => feedbackEntry.patch({ email }),
    attach: (files) => void attachFeedbackImages(files),
    removeImage: (index) => {
      const current = feedbackEntry.latest();
      if (!panelEntryOpen(current)) return;
      feedbackEntry.apply({
        ...current,
        images: current.images.filter((_, held) => held !== index),
      });
    },
    dismiss: dismissFeedback,
    cancel: feedbackEntry.cancel,
    commit: feedbackEntry.commit,
  };

  // The row marks the voice the main process reports rather than the one just
  // pressed, so what is shown as chosen is always what was actually saved.
  const changeVoice = useCallback(
    (voice: RealtimeVoice) => {
      void window.sidecar.setVoice(voice).then(applySettingsReply);
    },
    [applySettingsReply],
  );

  // The pace, under the same rule as the voice above.
  const changeVoiceSpeed = useCallback(
    (speed: RealtimeVoiceSpeed) => {
      void window.sidecar.setVoiceSpeed(speed).then(applySettingsReply);
    },
    [applySettingsReply],
  );

  /**
   * Moves the talk key, or resets it when no chord is named. The key the row
   * shows is not taken from this reply — the main process announces the one
   * that actually registered, the same way it always has — so the reply
   * carries only the stored choice and any refusal.
   */
  const changeVoiceHotkey = useCallback(
    async (accelerator: string | undefined) =>
      applySettingsReply(await window.sidecar.setVoiceHotkey(accelerator)),
    [applySettingsReply],
  );

  // The ask key, under the same rule: the key the row shows follows the main
  // process's own announcement of what actually registered.
  const changeAskHotkey = useCallback(
    async (accelerator: string | undefined) =>
      applySettingsReply(await window.sidecar.setAskHotkey(accelerator)),
    [applySettingsReply],
  );

  // The stop key, under the same rule again.
  const changeStopHotkey = useCallback(
    async (accelerator: string | undefined) =>
      applySettingsReply(await window.sidecar.setStopHotkey(accelerator)),
    [applySettingsReply],
  );

  // True while a settings row is recording a chord. Both Luke keys stay
  // registered through a recording — the recording is how one gets replaced —
  // so a press of a current chord landing then is held here rather than
  // opening the microphone, or summoning the composer, under the field being
  // typed into.
  const shortcutCapture = useRef(false);
  const changeShortcutCapture = useCallback((capturing: boolean) => {
    shortcutCapture.current = capturing;
  }, []);

  /**
   * Sends a session to its provider and gets out of the way. Luke floats above
   * every window, so a panel left open would be sitting on top of the very chat
   * it was just asked to bring forward — the same reason fetching a key stands
   * the panel down. The pointer is on the row that was pressed and cannot leave
   * a shape that is no longer drawn, so the close is asked for here rather than
   * waited for.
   */
  const openSession = useCallback(
    (session: DisplaySession) => {
      void window.sidecar.openSession({
        providerId: session.providerId,
        providerSessionId: session.id,
      });
      cancelHoverTransition();
      void changeMode(false);
    },
    [cancelHoverTransition, changeMode],
  );

  /**
   * The same press asked for out loud. It stands the panel down for the same
   * reason the pressed row does — Luke floats above the very chat he was asked
   * to bring forward — but only once something actually opened, and only if the
   * panel is up at all: a spoken ask usually arrives with the panel away.
   */
  const openSessionAloud = useCallback(
    async (identity: SessionIdentity): Promise<SessionOpenResult> => {
      const result = await window.sidecar.openSession(identity);
      if (
        result.status === SESSION_OPEN_RESULT_STATUS.OPENED &&
        presentationRef.current === PANEL_PRESENTATION.PANEL
      ) {
        cancelHoverTransition();
        void changeMode(false);
      }
      return result;
    },
    [cancelHoverTransition, changeMode],
  );

  /**
   * The ask key, pressed anywhere on the system. The main process has already
   * stood the panel up focused; what is left is the caret — or the dismissal,
   * because a summons repeated over its own open field is someone asking the
   * launcher to go away, the same second press every launcher answers.
   */
  const summonAsk = useCallback(() => {
    const field = document.getElementById(ASK_LUKE_INPUT_ID);
    if (
      presentationRef.current === PANEL_PRESENTATION.PANEL &&
      field !== null &&
      document.activeElement === field
    ) {
      cancelHoverTransition();
      void changeMode(false);
      return;
    }
    changeTab(PANEL_TAB.SESSIONS);
    focusAskField();
  }, [cancelHoverTransition, changeMode, changeTab]);

  /**
   * The panel standing back down once an errand it stood up is over. The same
   * rule a saved key follows, for the same reason: the shape was brought
   * forward to show an answer, the answer has been shown, and nothing else
   * would ever ask it to close — the pointer is not on it, because the
   * developer was talking rather than reaching for it.
   *
   * Everything that holds a panel open against the pointer holds it open
   * against this too. A key half-typed and an ask half-written are both things
   * someone is in the middle of, and a panel someone's hands have arrived in
   * is theirs now rather than the errand's.
   */
  const standDownAfterErrand = useCallback(() => {
    if (!errandOpenedPanel.current) return;
    errandOpenedPanel.current = false;
    if (pointerInside.current || entryIsDrawn() || askEngaged.current) return;
    cancelHoverTransition();
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = undefined;
      if (presentationRef.current === PANEL_PRESENTATION.PANEL) void changeMode(false);
    }, SETTLE_DELAY_MS);
  }, [cancelHoverTransition, changeMode, entryIsDrawn]);

  /**
   * The spoken asks about Luke himself. A settings change goes through the
   * same bridge calls the settings rows use, and the snapshot that comes back
   * redraws the panel's switches; showing the panel is the capsule's press
   * with a tab — or, already open, that tab's own press — and optionally a
   * narrowing, chosen out loud; opening the composer is the tray item's press,
   * run through the tray's own path. All were validated against their fixed
   * vocabularies before they arrive here, so this only performs and reports.
   *
   * A settings change and a change of view are also the two acts nobody
   * watched anyone make, so both end by showing the control that moved and
   * sending Luke to it. A settings change stands the panel up on the Settings
   * tab to do it: the switch is the whole report, and a switch flipped behind
   * a closed panel is a change the developer is only ever told about. The
   * errand is drawing over what already happened — it runs after the change,
   * it carries nothing to the store, and a refusal takes both the showing and
   * the flight with it. The composer is neither: it is a shape of its own
   * standing where the panel was, so there is nothing for a mark to land on.
   */
  const carryAppAction = useCallback<AppActionCarrier>(
    async (action) => {
      if (action.kind === "setting") {
        // The store's answer is caught rather than drawn: the switch is what
        // Luke is on his way to move, so it waits for him to reach it. Every
        // path out of here releases it, and the outcome the conversation is
        // told is the store's own either way — what is delayed is the drawing,
        // never the change or the report of it. The settings as this window
        // holds them ride along so a spoken model or effort change composes
        // against the selection actually stored.
        const outcome = await applySpokenSetting(
          window.sidecar,
          action,
          (next) => {
            heldSettings.current = next;
          },
          settings ?? bootstrap?.settings,
        );
        // Nothing to show and nothing to sign: a refused change must not stand
        // the panel up in front of a switch that did not move.
        if (outcome.status !== "changed") {
          releaseErrandChange();
          return outcome;
        }
        const opening = presentationRef.current !== PANEL_PRESENTATION.PANEL;
        // The guide's ids travel as plain text, so one that names no setting
        // of Luke's names no page either — and nothing will fly to it.
        const page = isAppSettingId(action.setting.id)
          ? SETTING_PAGE[action.setting.id]
          : undefined;
        // What the flight has to wait out. A page already drawn under an open
        // panel costs nothing; anything else is a page of content arriving,
        // and a page turned under an open panel takes the leaving one's exit
        // first. Read before any of it is asked for, because all three of
        // these are about to stop being true.
        const wait =
          opening || page === undefined
            ? ERRAND_WAIT.CONTENT
            : tabRef.current === PANEL_TAB.SETTINGS && settingsView === page
              ? ERRAND_WAIT.AT_ONCE
              : ERRAND_WAIT.PAGE;
        try {
          // The control has to be drawn to be flown to, and a settings page
          // that is not open is not drawn at all — so the tab comes forward
          // and then the page the setting lives on, in that order, because
          // arriving at the tab is arriving at its front page. This is the
          // same move a credential entry returning from the key slot makes.
          changeTab(PANEL_TAB.SETTINGS);
          if (page !== undefined) setSettingsView(page);
          await changeMode(true);
          if (runErrand(errandTargets(action), wait)) {
            // Only a panel this errand stood up is the errand's to put away.
            errandOpenedPanel.current = opening;
          } else {
            releaseErrandChange();
          }
        } catch {
          // Showing the change is not what was asked for — making it is, and it
          // is already made. A window that refused to come forward must not be
          // reported back as a setting that refused to change, and the switch
          // must be drawn whether or not anyone was shown it moving.
          releaseErrandChange();
        }
        return outcome;
      }
      if (action.kind === "feedback") {
        // The main process expands the window and sends the composer's
        // lifecycle event down the same ordered channel as the mode event —
        // exactly the tray items' gesture — so the composer's shape can never
        // lose a race to the panel apply the expansion causes. The draft
        // rides this ref because the lifecycle channel carries event names,
        // not payloads: set before the ask, consumed when the event lands.
        // Whether it will be placed is decided here with the same pure
        // decision the open itself makes, on the same entry — the open lands
        // a beat later on the event, and nothing else writes the entry in
        // between — so the spoken outcome says what actually happens. And
        // nothing here sends: the note leaves only by the Send button's own
        // press.
        const kind = FEEDBACK_KIND_FOR_COMPOSER[action.composer];
        const drafted = openedFeedbackEntry(feedbackEntry.latest(), {
          kind,
          fromPanel: false,
          ...(action.draft === undefined ? {} : { draft: action.draft }),
        }).drafted;
        spokenFeedbackDraft.current = action.draft;
        try {
          await window.sidecar.summonFeedback(kind);
        } catch (error) {
          // The composer is not coming, so the event that would consume the
          // draft is not coming either; a stale one must not season some
          // later tray press.
          spokenFeedbackDraft.current = undefined;
          throw error;
        }
        return {
          status: "opened",
          kind: action.composer,
          ...(action.draft === undefined
            ? {}
            : drafted
              ? {
                  note: "The ask is drafted in the composer; the developer edits and sends it by hand.",
                }
              : {
                  note: "A note was already being written, so it was kept and nothing was drafted over it.",
                }),
        };
      }
      // Whether this ask is what opens the panel, read before it does: an
      // errand into a shape still growing has to trail the whole opening,
      // and one into a panel already up does not.
      const opening = presentationRef.current !== PANEL_PRESENTATION.PANEL;
      changeTab(action.tab);
      const spoken = action.filter ? sessionFilterFromSpoken(action.filter) : undefined;
      // An agent this build never registered cannot narrow the list, and Luke
      // must not claim it did. The list still has to match the sentence that
      // says every session is shown, so an unmappable ask widens the view to
      // All rather than leaving whatever narrowing was already in force.
      const filter = action.filter ? (spoken ?? SESSION_FILTER.ALL) : undefined;
      // Caught rather than applied, on the settings switch's terms: the
      // narrowing is what Luke is on his way to the options button to do, and
      // a list that has already re-sorted itself by the time he gets there
      // makes the flight a report rather than the act.
      if (filter || action.sort) {
        heldView.current = {
          ...(filter ? { filter } : {}),
          ...(action.sort ? { sort: action.sort } : {}),
        };
      }
      await changeMode(true);
      // Nothing flew, so nothing is coming to release it. The panel itself is
      // what was asked for and it is already up, so the list must show what
      // the answer is about to claim it shows.
      // The tab bar and the options button are outside the settings pages, so
      // a page reset behind this tab switch is nothing they wait for.
      if (!runErrand(errandTargets(action), opening ? ERRAND_WAIT.CONTENT : ERRAND_WAIT.AT_ONCE)) {
        releaseErrandChange();
      }
      return {
        status: "shown",
        tab: action.tab,
        ...(spoken ? { filter: action.filter } : {}),
        ...(action.filter && !spoken
          ? { note: "That agent has no filter of its own here, so every session is shown." }
          : {}),
        ...(action.sort ? { sort: action.sort } : {}),
      };
    },
    [
      changeMode,
      changeTab,
      settings,
      settingsView,
      bootstrap,
      releaseErrandChange,
      runErrand,
      feedbackEntry.latest,
    ],
  );

  const defaultWorkspaceProvider = (settings ?? bootstrap?.settings)?.defaultWorkspaceProvider;
  const {
    analyser,
    microphoneStatus,
    setMicrophoneStatus,
    microphoneError,
    voiceStatus,
    setVoiceStatus,
    talkOpening,
    voiceHotkey,
    handleVoiceActivity,
    requestMicrophoneAccess,
    startMicrophone,
    stopMicrophone,
    askLuke,
    voiceTurn,
    lukeCaption,
    remoteAudio,
    discardListening,
    stopSpeaking,
    syncGuide,
    syncIssues,
  } = useVoiceConversation({
    sessions,
    workspaceProjects,
    defaultWorkspaceProvider,
    voice: settings?.voice,
    voiceSpeed: settings?.voiceSpeed,
    voiceCaptions: settings?.voiceCaptions === true,
    outputSilent: outputSilent(outputAudio),
    fixtureSpeaking: bootstrap?.profile === "speaking" || bootstrap?.profile === "muted",
    capturingShortcut: () => shortcutCapture.current,
    openSession: openSessionAloud,
    carryAppAction,
  });

  /**
   * The two writes a row can ask for, handed to the main process by session
   * identity. Unlike opening, neither closes the panel: the answer lands back
   * on the row that asked, and the user is mid-conversation with it.
   */
  const sessionWrites: SessionWriteHandlers = useMemo(
    () => ({
      sendMessage: (session, text) =>
        window.sidecar.sendSessionMessage(
          { providerId: session.providerId, providerSessionId: session.id },
          text,
        ),
      runAction: (session, actionId) =>
        window.sidecar.executeSessionControl(
          { providerId: session.providerId, providerSessionId: session.id },
          actionId,
        ),
    }),
    [],
  );

  /** The capsule is a button: pressing it opens the panel, or closes it again. */
  const handleCapsulePress = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      // A press is a gesture, not a focus change, so the pointer hands focus
      // back. `detail` is 0 when the keyboard activated the button, and there
      // the focus is the point and stays where the keyboard put it.
      if (event.detail > 0) event.currentTarget.blur();
      cancelHoverTransition();
      void changeMode(presentationRef.current !== PANEL_PRESENTATION.PANEL);
    },
    [cancelHoverTransition, changeMode],
  );

  usePointerPassthrough(handleHitRegionEnter, handleHitRegionLeave, presentation);

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

  useEffect(() => {
    const bootstrapGeneration = modeGeneration.current;
    void window.sidecar.getBootstrap().then((value) => {
      setBootstrap(value);
      setSessions(value.sessions);
      // Only fill in what no push has said yet: the bootstrap snapshot is
      // older than any change that raced past it, and the main process will
      // not repeat a list it believes it already announced.
      if (!workspaceProjectsPushed.current) setWorkspaceProjects(value.workspaceProjects);
      if (!issuesPushed.current) syncIssues(value.issues);
      if (!settingsPushed.current) setSettings(value.settings);
      setDisplay(value.display);
      if (modeGeneration.current === bootstrapGeneration) {
        applyAuthoritativeMode(value.mode);
        if (value.startPeeked && value.mode === "compact") {
          applyPresentation(PANEL_PRESENTATION.PEEK);
        }
        // Evidence only, and the same trick the peek uses: the slot is reached
        // by pressing Connect, which a capture run has no way to do, so the
        // entry the press would have begun is asked for directly. It carries
        // the shape with it, as it does anywhere else.
        const [firstProvider] = CREDENTIAL_PROVIDER_LIST;
        if (value.startInSlot && value.mode === "expanded" && firstProvider) {
          // The tab and page an entry begins on, so pressing the capsule from
          // here lands where it would have in the flow this is standing in for.
          changeTab(PANEL_TAB.SETTINGS);
          setSettingsView(SETTINGS_VIEW.CONNECTIONS);
          beginEntry(firstProvider.id);
        }
      }
      setMicrophoneStatus(value.microphoneStatus);
      // Only fill in what no push has said yet, like the issue roster: the
      // bootstrap snapshot is older than any change that raced past it.
      if (!outputAudioPushed.current && value.outputAudio) setOutputAudio(value.outputAudio);
      if (!value.realtimeAvailable) setVoiceStatus(REALTIME_STATUS.UNAVAILABLE);
      if (value.profile === "microphone") {
        window.setTimeout(() => void startMicrophone(), 500);
      }
      window.sidecar.notifyReady();
    });
    const removeLifecycle = window.sidecar.onLifecycle((eventName) => {
      if (eventName === "mode:compact") applyAuthoritativeMode("compact");
      if (eventName === "mode:expanded") applyAuthoritativeMode("expanded");
      if (eventName === "tab:settings") changeTab(PANEL_TAB.SETTINGS);
      // Held while a shortcut row is recording, for the same reason the talk
      // key's press is: the chord just typed is an entry, not an ask.
      if (eventName === "ask:focus" && !shortcutCapture.current) summonAsk();
      // The tray's feedback items — and a spoken open, which rides the same
      // gesture through the main process — stand the surface straight down to
      // the composer's shape, on the kind that was asked for. The window was
      // expanded before this event was sent; this is the renderer's half. The
      // tab still moves to settings so that coming back to the panel later
      // lands beside the section the shape belongs to, and a draft a spoken
      // open left waiting is taken up here, then forgotten.
      const feedbackKind = feedbackKindForLifecycleEvent(eventName);
      if (feedbackKind) {
        const draft = spokenFeedbackDraft.current;
        spokenFeedbackDraft.current = undefined;
        changeTab(PANEL_TAB.SETTINGS);
        beginFeedback(feedbackKind, false, draft);
      }
    });
    const removeDisplay = window.sidecar.onDisplayChanged(setDisplay);
    // Another window's settings change: this window's rows and guide redraw
    // from the same snapshot its reply carried, so no window describes a
    // state the store no longer holds.
    const removeSettings = window.sidecar.onSettingsChanged((pushed) => {
      settingsPushed.current = true;
      // A push is newer than anything an errand is still carrying, so it takes
      // the hold with it: released afterwards, a snapshot caught before this
      // arrived would draw the store as it was rather than as it is.
      heldSettings.current = undefined;
      setSettings(pushed);
    });
    const removeSessions = window.sidecar.onSessionsChanged(setSessions);
    const removeWorkspaceProjects = window.sidecar.onWorkspaceProjectsChanged((projects) => {
      workspaceProjectsPushed.current = true;
      setWorkspaceProjects(projects);
    });
    const removeOutputAudio = window.sidecar.onOutputAudioChanged((state) => {
      outputAudioPushed.current = true;
      setOutputAudio(state);
    });
    // Straight to the conversation rather than through state: no panel
    // surface draws the issue roster, so a re-render would be work for nobody.
    const removeIssues = window.sidecar.onIssuesChanged((issues) => {
      issuesPushed.current = true;
      syncIssues(issues);
    });
    return () => {
      cancelHoverTransition();
      removeLifecycle();
      removeDisplay();
      removeSettings();
      removeSessions();
      removeWorkspaceProjects();
      removeOutputAudio();
      removeIssues();
      void stopMicrophone();
    };
  }, [
    applyAuthoritativeMode,
    applyPresentation,
    beginEntry,
    beginFeedback,
    cancelHoverTransition,
    changeTab,
    setMicrophoneStatus,
    setVoiceStatus,
    startMicrophone,
    stopMicrophone,
    summonAsk,
    syncIssues,
  ]);

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

  // Keep the conversation's view of Luke himself current, so a spoken question
  // about a setting is answered from the value the store actually holds, and a
  // change made in the panel is known to the conversation the moment it lands.
  useEffect(() => {
    if (!bootstrap) return;
    const askAccelerator = askHotkeyChange ? askHotkeyChange.accelerator : bootstrap.askHotkey;
    const stopAccelerator = stopHotkeyChange ? stopHotkeyChange.accelerator : bootstrap.stopHotkey;
    // All three keys reach the guide labelled: it is spoken and read, so a
    // chord belongs there as the one word macOS writes it as rather than as
    // the keys the panel draws apart.
    const talkKey = voiceHotkeyToShow(bootstrap, voiceHotkey);
    const guide = buildLukeGuide({
      settings: settings ?? bootstrap.settings,
      voiceAvailable: bootstrap.realtimeAvailable,
      microphoneStatus,
      hotkey: {
        ...(talkKey.hotkey ? { hotkey: voiceHotkeyLabel(talkKey.hotkey) } : {}),
        held: talkKey.held,
      },
      ...(askAccelerator ? { askKey: voiceHotkeyLabel(askAccelerator) } : {}),
      ...(stopAccelerator ? { stopKey: voiceHotkeyLabel(stopAccelerator) } : {}),
    });
    syncGuide(guide);
  }, [
    bootstrap,
    settings,
    microphoneStatus,
    voiceHotkey,
    askHotkeyChange,
    stopHotkeyChange,
    syncGuide,
  ]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      // The shortcut the tray menu advertises. It is claimed here rather than
      // globally, because Command-, belongs to whichever app is frontmost and
      // Luke is only that while its panel has the keyboard.
      if (event.key === "," && (event.metaKey || event.ctrlKey)) {
        if (presentation !== PANEL_PRESENTATION.PANEL) return;
        event.preventDefault();
        changeTab(PANEL_TAB.SETTINGS);
        return;
      }
      if (event.key !== "Escape") return;
      // Discarding an open turn comes before any of it. Closing the panel
      // or a sheet mid-sentence would strand the microphone open.
      if (voiceStatus === REALTIME_STATUS.LISTENING) {
        // The key may still be down. Forgetting the press as well as the latch
        // means its release lands on a turn that is already gone rather than
        // sending the one Escape just discarded.
        discardListening();
        return;
      }
      // Stopping Luke mid-sentence is the same shape one layer on: a reply
      // being spoken is the most open thing there is, and Escape asks for
      // quiet without opening a turn in its place. The session itself answers
      // whether there was a reply to stop, so a press that found none falls
      // through to the layers below rather than being swallowed by a reply
      // that had already ended.
      if (stopSpeaking()) return;
      // Escape out of the slot is the entry's own way out, wherever the caret
      // happens to be: the slot is the only thing on screen, so there is nothing
      // else it could mean.
      if (presentation === PANEL_PRESENTATION.SLOT) {
        credentialsEntry.cancel();
        return;
      }
      // Escape out of the composer leaves the shape and keeps the draft: a
      // note is longer than a key, and a key is the only thing Escape is
      // allowed to discard.
      if (presentation === PANEL_PRESENTATION.FEEDBACK) {
        dismissFeedback();
        return;
      }
      if (presentation !== PANEL_PRESENTATION.PANEL) return;
      // Otherwise it closes the nearest thing that is open, one layer at a
      // time: the options sheet, then a settings page back to the front page,
      // then the settings tab, then the panel itself.
      if (optionsOpen) setOptionsOpen(false);
      else if (tab === PANEL_TAB.SETTINGS && settingsView !== SETTINGS_VIEW.ROOT) {
        setSettingsView(SETTINGS_VIEW.ROOT);
      } else if (tab === PANEL_TAB.SETTINGS) changeTab(PANEL_TAB.SESSIONS);
      else void changeMode(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    credentialsEntry.cancel,
    changeMode,
    changeTab,
    dismissFeedback,
    discardListening,
    optionsOpen,
    presentation,
    settingsView,
    stopSpeaking,
    tab,
    voiceStatus,
  ]);

  useEffect(
    () =>
      window.sidecar.onAskHotkeyChanged((accelerator) =>
        setAskHotkeyChange(accelerator ? { accelerator } : {}),
      ),
    [],
  );
  useEffect(
    () =>
      window.sidecar.onStopHotkeyChanged((accelerator) =>
        setStopHotkeyChange(accelerator ? { accelerator } : {}),
      ),
    [],
  );

  // The rows say how long ago each session was seen, and a label left alone
  // goes stale the moment a minute passes with no session changing — the very
  // sessions worth noticing are the ones nothing is updating. A slow tick keeps
  // the labels honest, and only while they are on screen: the labels are
  // minute-grained, so half a minute is as fine as the answer gets. Fixture
  // rows are read against a fixed epoch, so for them a tick could only change
  // nothing — and a capture run must not risk a re-render mid-shutter.
  useEffect(() => {
    if (presentation !== PANEL_PRESENTATION.PANEL) return;
    if (bootstrap?.fixtureMode !== false) return;
    const timer = window.setInterval(() => setClock((tick) => tick + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [presentation, bootstrap?.fixtureMode]);

  // A press anywhere else is the same dismissal Escape is, and the one a sheet
  // over a list has to answer: what is behind it can only be reached by asking
  // it to move, so pressing there has to be what asks. The press is taken on the
  // way down, before whatever it lands on can act on it, and the button that
  // opened the sheet is left to its own toggle. Nothing outside the drawn shape
  // reaches this renderer at all — those presses belong to whatever is behind
  // Luke — so leaving the shape is what closes the panel, and closing the panel
  // is what puts the sheet away.
  useEffect(() => {
    if (!optionsOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : undefined;
      if (!target) return;
      const sheet = document.getElementById(SESSION_OPTIONS_ID);
      const button = document.getElementById(SESSION_OPTIONS_BUTTON_ID);
      if (sheet?.contains(target) || button?.contains(target)) return;
      setOptionsOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
  }, [optionsOpen]);

  if (!bootstrap || !display) return <div />;

  const visibleSessions = displaySessions(bootstrap, sessions);
  // The tally is taken before the list is narrowed — the capsule reports what
  // Luke is watching, not what the panel is currently showing — but it reads
  // in the list's own sort, so the wing's marks sit in the order the rows do.
  const tally = sessionTally(visibleSessions, sessionView.sort);
  const list = arrangeSessions(visibleSessions, sessionView);
  // Dropping an emptied filter is a change of view, not a way of drawing one.
  // Left in state it would lie dormant behind an All that only looks chosen,
  // and the next session to enter that state would narrow the list back down
  // to it with nothing having been pressed. Setting state here rather than from
  // an effect is what keeps that from being drawn first and corrected after.
  if (list.filter !== sessionView.filter) {
    setSessionView({ ...sessionView, filter: list.filter });
  }
  // The sheet exists only while there is something for it to decide, and its
  // being open has to go when its button does — by the same rule the emptied
  // filter follows. Left set behind a button nobody can see, Escape would spend
  // itself closing a sheet that is not drawn instead of closing the panel, and
  // the next session to arrive would open it again with nothing pressed.
  const offerOptions = tab === PANEL_TAB.SESSIONS && list.total > 1;
  if (optionsOpen && !offerOptions) setOptionsOpen(false);
  // Which clock the rows' ages are honest against. Fixture observations are
  // measured back from the fixture's own epoch precisely so that no capture
  // run reads them against the time it happened to run at.
  const now = bootstrap.fixtureMode ? FIXTURE_EPOCH_MS : Date.now();
  const shownHotkey = voiceHotkeyToShow(bootstrap, voiceHotkey);
  const shownAskHotkey = askHotkeyChange ? askHotkeyChange.accelerator : bootstrap.askHotkey;
  const shownStopHotkey = stopHotkeyChange ? stopHotkeyChange.accelerator : bootstrap.stopHotkey;
  // The muted evidence run is the speaking run with the hint drawn over it: a
  // capture has no system output to read, so the state is asked for directly.
  const fixtureMuted = bootstrap.profile === "muted";
  const fixtureSpeaking = bootstrap.profile === "speaking" || fixtureMuted;
  const hasAudioSignal = fixtureSpeaking || analyser !== undefined;
  const outputIsSilent = outputSilent(outputAudio);
  // The hint rides the caption it explains, and only over a silence the
  // helper actually reported. "Got it" quiets it for this stretch of silence
  // and any that follows too soon; the captions above it stay either way.
  const volumeHint =
    fixtureMuted ||
    (outputIsSilent &&
      lukeCaption !== undefined &&
      !volumeHintDismissed(hintDismissal, silenceStretch, Date.now()));
  const panelOpen = presentation === PANEL_PRESENTATION.PANEL;
  const slotOpen = presentation === PANEL_PRESENTATION.SLOT;
  const feedbackOpen = presentation === PANEL_PRESENTATION.FEEDBACK;
  // What the slot's field is for depends on what answers for that provider now,
  // and settings resolve after the first render.
  const slotSource =
    credentialsEntry.entry && settings
      ? settings.credentialSources[credentialsEntry.entry.providerId]
      : CREDENTIAL_SOURCE.NONE;

  return (
    <div
      className="app-stage"
      // Whose turn it is, so the capsule can make room for a meter it has to
      // draw beside the face rather than in place of it.
      data-voice={voiceTurn}
      // Whether there are words to draw under the shape, so the surface can
      // grow the room they are drawn in.
      data-caption={String(Boolean(lukeCaption))}
      // Whether those words need the volume hint under them, which shares the
      // caption block's room.
      data-volume-hint={String(volumeHint)}
      data-presentation={presentation}
      data-notch={String(display.notch.hasNotch)}
      data-capture={String(bootstrap.captureMode)}
      style={{
        ...notchStyle(display),
        ...shapeHeightStyle(panelHeight, slotHeight, feedbackHeight),
        ...captionSizeStyle(captionTextHeight, volumeHint),
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
            list={list}
            view={sessionView}
            onViewChange={changeSessionView}
            now={now}
            onOpenSession={openSession}
            writes={sessionWrites}
            ask={askLuke}
            onAskEngaged={changeAskEngagement}
            {...(shownAskHotkey ? { askShortcut: shownAskHotkey } : {})}
            offerOptions={offerOptions}
            optionsOpen={optionsOpen}
            onOptionsToggle={() => setOptionsOpen((open) => !open)}
            tab={tab}
            onTabChange={changeTab}
            settings={{
              view: settingsView,
              onViewChange: setSettingsView,
              microphoneStatus,
              microphoneError,
              onRequestMicrophone: () => void requestMicrophoneAccess(),
              onOpenMicrophoneSettings: () => window.sidecar.openMicrophoneSettings(),
              voiceAvailable: bootstrap.realtimeAvailable,
              settings,
              onVoiceCaptionsChange: changeVoiceCaptions,
              onDuckOtherMediaChange: changeDuckOtherMedia,
              onSessionNotificationsChange: changeSessionNotifications,
              credentials,
              feedback: feedbackControl,
              onVoiceChange: changeVoice,
              onVoiceSpeedChange: changeVoiceSpeed,
              panelOpen,
              ...(shownHotkey.hotkey ? { voiceHotkey: shownHotkey.hotkey } : {}),
              voiceHotkeyHeld: shownHotkey.held,
              onVoiceHotkeyChange: changeVoiceHotkey,
              // Both rows take the accelerator: they draw the keys apart and
              // label the chord whole for the buttons beside them.
              ...(shownAskHotkey ? { askHotkey: shownAskHotkey } : {}),
              onAskHotkeyChange: changeAskHotkey,
              ...(shownStopHotkey ? { stopHotkey: shownStopHotkey } : {}),
              onStopHotkeyChange: changeStopHotkey,
              onShortcutCapture: changeShortcutCapture,
              onShowInMenuBarChange: changeShowInMenuBar,
              onShowInDockChange: changeShowInDock,
              onShowOnAllDisplaysChange: changeShowOnAllDisplays,
              onFormFactorChange: changeFormFactor,
              workspaceProviders: workspaceProviderOptions,
              onDefaultWorkspaceProviderChange: changeDefaultWorkspaceProvider,
              onWorkspaceAgentDefaultChange: changeWorkspaceAgentDefault,
              onQuit: () => window.sidecar.quit(),
            }}
          />
        </section>
      </div>

      {/* The panel stood down to its field. It shares the expanded window, so
          standing down to it costs no more than the peek does. */}
      <KeySlot control={credentials} source={slotSource} drawn={slotOpen} measure={slotElement} />
      {/* The panel stood down to the composer, on the same terms. */}
      <FeedbackSlot control={feedbackControl} drawn={feedbackOpen} measure={feedbackElement} />
      {/* Luke's own voice. Muted playback would defeat the point, so this is
          the one element allowed to make sound. */}
      <audio ref={remoteAudio} autoPlay hidden>
        <track kind="captions" />
      </audio>

      <NotchWings
        tally={tally}
        analyser={analyser}
        onVoiceActivity={handleVoiceActivity}
        {...(voiceTurn ? { voice: voiceTurn } : {})}
        fixtureSpeaking={fixtureSpeaking}
        hasAudioSignal={hasAudioSignal}
        voiceOpening={talkOpening}
        presentation={presentation}
        housingWidth={display.notch.housingWidth}
      />

      {/* Luke crossing his own panel to sign a control he moved. Drawn over
          everything, because it passes over the panel it is crossing, and
          answering no pointer at all — the strip's one button and the control
          it lands on both keep every press. The tap is what lets the switch
          be seen to move, and the way home is what lets a panel stood up for
          the errand stand back down. */}
      <LukeErrand
        {...(errand ? { errand } : {})}
        onLanded={releaseErrandChange}
        onReturned={standDownAfterErrand}
      />

      {/* Luke's words while he says them: one element in every state, under
          the housing while the shape is compact and carried to the panel's
          foot when it opens, so the words travel with the morph instead of
          jumping between two copies. Not in a wing — the wings clip at the
          capsule's height — and always mounted, like the count's caption, so
          both edges of its fade can run. The inner text is what is measured:
          its wrapped height is the only honest answer to how much room the
          words need. Hidden from readers: it duplicates what is already
          audible. */}
      <span className="voice-caption" aria-hidden="true">
        <span className="voice-caption-text" ref={captionTextElement}>
          {lukeCaption}
        </span>
      </span>

      {/* The one reason the words above might be the only part of Luke
          arriving: the Mac's own output is off. It sits on the caption
          block's bottom edge, inside the same reserved room, and is drawn
          only while Luke speaks into a silence the helper reported. Always
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
          aria-label={`${tallySummary(tally)}. ${panelOpen ? "Close" : "Open"} the panel`}
          // Keeps the press from moving focus here at all, so nothing is drawn
          // around the notch strip and a focused settings field keeps the caret.
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleCapsulePress}
        />
      </div>
    </div>
  );
}
