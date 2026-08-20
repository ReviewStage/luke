import {
  APP_TOOL_KIND,
  dispatchByKind,
  FEEDBACK_COMPOSER_KIND,
  FIXTURE_EPOCH_MS,
  type HostedUsageAnswer,
  type IssueIdentity,
  MOTION_DURATION_MS,
  type NormalizedSession,
  type ObservedWorkspaceProject,
  type PanelFormFactor,
  type ProviderId,
  REALTIME_STATUS,
  type RealtimeDiagnostics,
  type RealtimeVoice,
  type RealtimeVoiceSpeed,
  SESSION_MENTION_KIND,
  SESSION_NOTICE_HEIGHT,
  SESSION_NOTICE_MAX_ROWS,
  type SessionIdentity,
  type SessionNoticeAsk,
  VOICE_CAPTION_MAX_HEIGHT,
  type WorkspaceAgentSelection,
  workspaceProjectSelectionId,
} from "@sidecar/core";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CONSENT_SERVICE_ID, type ConsentServiceId } from "../shared/consent-services";
import type {
  AccountProvider,
  AccountSnapshot,
  AppBootstrap,
  AppSettings,
  DisplayDiagnostic,
  ObservedAccountCalendars,
  OutputAudioState,
  SessionOpenResult,
  SettingsResetScope,
  SettingsUpdateResult,
  SupersetSignInSnapshot,
  UpdateSnapshot,
  VoiceSource,
  WorkspaceProviderId,
} from "../shared/contracts";
import {
  ACCOUNT_STATUS,
  CREDENTIAL_SOURCE,
  isWorkspaceProviderId,
  SESSION_OPEN_RESULT_STATUS,
  SUPERSET_SIGN_IN_STAGE,
  SUPERSET_WORKSPACE_PROVIDER_ID,
  VOICE_SOURCE,
} from "../shared/contracts";
import type { CredentialProviderId } from "../shared/credential-providers";
import {
  CREDENTIAL_PROVIDER_LIST,
  CREDENTIAL_PROVIDERS,
  isCredentialProviderId,
} from "../shared/credential-providers";
import type { FeedbackImage, FeedbackKind } from "../shared/feedback";
import { FEEDBACK_KIND, FEEDBACK_LIMITS, feedbackKindForLifecycleEvent } from "../shared/feedback";
import { APP_SETTING_SCHEMA } from "../shared/settings-schema";
import { voiceHotkeyLabel, voiceHotkeyToShow } from "../shared/voice-hotkey";
import { ASK_LUKE_INPUT_ID, focusAskField } from "./ask-luke";
import { type ConsentConnectEntry, ConsentConnectSlot } from "./consent-connect-slot";
import type { CredentialEntry, CredentialEntryControl } from "./credential-entry";
import { isSubmittable, removalEndsEntry } from "./credential-entry";
import { cssCustomProperties } from "./css-custom-properties";
import {
  armErrand,
  EMPTY_ERRAND_RUN,
  type ErrandHold,
  type ErrandRun,
  errandBorrowedPanel,
  errandRunIdle,
  errandWait,
  finishErrand,
  flushErrands,
  landErrand,
  NOTHING_HELD,
  nextErrand,
  type PendingErrand,
  supersedeErrandSettings,
} from "./errand-queue";
import {
  confirmationHoldMs,
  type FeedbackConfirmation,
  feedbackConfirmation,
} from "./feedback-confirmation";
import {
  accountSignature,
  type FeedbackEntry,
  type FeedbackEntryControl,
  IMAGE_REFUSAL,
  isSendable,
  openedFeedbackEntry,
} from "./feedback-entry";
import { encodeFeedbackImage } from "./feedback-images";
import { FeedbackSlot } from "./feedback-slot";
import { KeySlot } from "./key-slot";
import { type Errand, errandTargets, LukeErrand } from "./luke-errand";
import { LukeFace } from "./luke-face";
import { usePrefersReducedMotion } from "./luke-face-mood";
import { applySpokenSetting, buildLukeGuide, isAppSettingId } from "./luke-guide";
import { hostedVoiceReading, hostedVoiceSpentNote, quotaResetsWhen } from "./microphone-access";
import { NotchWings } from "./notch-wings";
import { PanelBody, type SessionWriteHandlers } from "./panel-body";
import {
  collapseMarkAfter,
  HIT_REGION,
  PANEL_PRESENTATION,
  type PanelPresentation,
} from "./panel-state";
import { PANEL_TAB, type PanelTab } from "./panel-tabs";
import { ProviderMark } from "./provider-marks";
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
import { parsePixels } from "./session-motion";
import { SESSION_OPTIONS_BUTTON_ID, SESSION_OPTIONS_ID } from "./session-parts";
import { focusSearchField } from "./session-search";
import type {
  MicrophoneControl,
  PreferenceWrites,
  ShortcutControl,
  SupersetControl,
  UpdateControl,
} from "./settings-panel";
import {
  credentialSettingsPage,
  PANEL_STAND_DOWN,
  SETTING_PAGE,
  SETTINGS_VIEW,
  type SettingsView,
  type SlotOccupant,
  standDownReturnPage,
} from "./settings-views";
import { useSignInFaceCycle } from "./sign-in-gate";
import { SignInSlot } from "./sign-in-slot";
import {
  CAPTION_TONE,
  type CaptionTone,
  pointOverStrip,
  type SpokenStripContent,
  stripHoldNext,
} from "./strip-hold";
import { SupersetSignInSlot } from "./superset-sign-in-slot";
import { useBootstrapRacedChannel } from "./use-bootstrap-raced-channel";
import { panelEntryOpen, usePanelEntry } from "./use-panel-entry";
import { usePanelPresentation } from "./use-panel-presentation";
import { useStateWithRef } from "./use-state-with-ref";
import {
  useVoiceConversation,
  voiceErrorToShow,
  voiceNoticeToShow,
} from "./use-voice-conversation";
import {
  outputSilent,
  VOLUME_HINT_BAND_HEIGHT,
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
const FEEDBACK_KIND_FOR_COMPOSER = {
  [FEEDBACK_COMPOSER_KIND.FEEDBACK]: FEEDBACK_KIND.FEEDBACK,
  [FEEDBACK_COMPOSER_KIND.PROMPT]: FEEDBACK_KIND.PROMPT,
};

/**
 * Sizes the caption block to the words it currently holds. The text wraps, so
 * only a measurement can say how tall it is; the size drives the surface's
 * growth and the clip that reveals the text. The whole reply stays on screen —
 * the reserved maximum is sized past what a spoken reply wraps to, so the
 * clamp below is the window's physical bound rather than a working edge.
 * The volume hint stands in a band of its own below the block: while it is
 * drawn, the band comes off the block's maximum, so the block and the band
 * partition the reserved room instead of sharing it, and the stack never asks
 * for more height than the window holds.
 * Padding is the caption's own computed padding, not a restated number, so a
 * retune in the stylesheet grows the surface by exactly what the text is
 * inset — including the bottom inset the stylesheet hands to the band while
 * the hint stands.
 */
function captionSizeStyle(
  textHeight: number | undefined,
  volumeHint: boolean,
  padding: number,
): CSSProperties {
  if (!textHeight) return {};
  return cssCustomProperties({
    "--caption-size": `${captionBlockSize(textHeight, volumeHint, padding)}px`,
  });
}

/**
 * The caption block's visible height — the `--caption-size` the clip ends the
 * element at. The strip's hover test reads it too: the element's own box runs
 * to the reserved maximum, and only this much of it is words rather than
 * desktop.
 */
function captionBlockSize(textHeight: number, volumeHint: boolean, padding: number): number {
  const hintBand = volumeHint ? VOLUME_HINT_BAND_HEIGHT : 0;
  return Math.min(VOICE_CAPTION_MAX_HEIGHT - hintBand, textHeight + padding);
}

/**
 * Sizes the notice band's growth to the chips it currently holds — the
 * caption block's own pattern. The chips size to their names and wrap where
 * they wrap, so only a measurement can say how many rows they made. Measured
 * off the rows inside the band rather than the band itself: the band's box
 * holds every reserved row so the growth can be revealed by its clip, which
 * means only the inner stack's height says how many rows the chips actually
 * made. The clamp is the rows the window reserved — past it the chips scroll
 * inside the band instead of growing the shape. The 6px around the measured
 * chips is the band's 3px stand-off from the strip, top and bottom, which
 * one reserved row already accounts for. Unmeasured falls back to
 * `--notice-size`, one row, in the stylesheet.
 */
function noticeGrowthStyle(rowsHeight: number | undefined): CSSProperties {
  if (!rowsHeight) return {};
  const growth = Math.min(SESSION_NOTICE_HEIGHT * SESSION_NOTICE_MAX_ROWS, rowsHeight + 6);
  return cssCustomProperties({ "--notice-growth": `${growth}px` });
}

function notchStyle(display: DisplayDiagnostic): CSSProperties {
  return cssCustomProperties({
    "--notch-top-inset": `${display.notch.topInset}px`,
    "--notch-housing-width": `${display.notch.housingWidth}px`,
  });
}

/** The two rosters a mention chip can stand for, deciding what its press does. */
const MENTION_CHIP_KIND = {
  SESSION: "session",
  ISSUE: "issue",
} as const;

/**
 * One pressable chip of the notice band: the mark and words it draws, and the
 * identity its press hands to the main process — where it is validated
 * against the observed roster again before any address reaches the system.
 * Resolved onto the chip when its mention is, so the band held through its
 * fade-out keeps saying what it said.
 */
type MentionChip =
  | {
      kind: typeof MENTION_CHIP_KIND.SESSION;
      id: string;
      markId: string;
      title: string;
      identity: SessionIdentity;
    }
  | {
      kind: typeof MENTION_CHIP_KIND.ISSUE;
      id: string;
      markId: string;
      title: string;
      identity: IssueIdentity;
    };

function surfaceHeightStyle(
  panelHeight: number | undefined,
  slotHeight: number | undefined,
  feedbackHeight: number | undefined,
): CSSProperties {
  const properties: Record<string, string> = {};
  if (panelHeight !== undefined) properties["--panel-height"] = `${panelHeight}px`;
  if (slotHeight !== undefined) properties["--slot-height"] = `${slotHeight}px`;
  if (feedbackHeight !== undefined) properties["--feedback-height"] = `${feedbackHeight}px`;
  return cssCustomProperties(properties);
}

/**
 * Reports a shape's own content height so the black surface can end where the
 * content does. The window stays one size; only the shape inside it follows
 * what it holds — the number of sessions in the panel, a refusal appearing
 * under the slot's field — which is what makes either one feel like a resize
 * rather than a redraw.
 */
function useSurfaceHeight(): [(element: HTMLElement | null) => void, number | undefined] {
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
    // The border box, because that is the box the bounding rect reports: the
    // caption's room arrives as padding on the panel, which grows the shape
    // without ever touching the content box, and a content-box observer would
    // sleep through it — leaving the surface and the caption's rest position
    // sized to a height the panel no longer has.
    nextObserver.observe(element, { box: "border-box" });
    observer.current = nextObserver;
    measure();
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return [measured, height];
}

const COLLAPSE_ANIMATION_MS = MOTION_DURATION_MS.EXIT + MOTION_DURATION_MS.SURFACE;

/**
 * True from the render that leaves the panel for a compact shape until the
 * collapse has settled — the window's own collapse clock, exit plus shape.
 * The stylesheet spends it to hold the surface behind the content it is
 * still carrying: the panel's rows fading out, and a caption block or
 * notice band riding down from the panel's foot. Derived during render
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
  const [bootstrap, setBootstrap] = useState<AppBootstrap>();
  const [supersetConnected, setSupersetConnected] = useState<boolean>();
  const [supersetSignIn, setSupersetSignIn] = useState<SupersetSignInSnapshot>({
    stage: SUPERSET_SIGN_IN_STAGE.IDLE,
    organizations: [],
  });
  // Readable from a callback as well as rendered: opening the feedback
  // composer signs a fresh note from the account without re-wiring the
  // lifecycle subscription to every sign-in change.
  const [account, setAccount, accountNow] = useStateWithRef<AccountSnapshot | undefined>(undefined);
  const [sessions, setSessions] = useState<readonly NormalizedSession[]>([]);
  const [noticeAsks, setNoticeAsks] = useState<readonly SessionNoticeAsk[]>([]);
  const [workspaceProjects, setWorkspaceProjects] = useState<readonly ObservedWorkspaceProject[]>(
    [],
  );
  const [display, setDisplay] = useState<DisplayDiagnostic>();
  const [tab, setTab, tabNow] = useStateWithRef<PanelTab>(PANEL_TAB.SESSIONS);
  const [settingsView, setSettingsView, settingsViewNow] = useStateWithRef<SettingsView>(
    SETTINGS_VIEW.ROOT,
  );
  const [sessionView, setSessionView] = useState<SessionView>(DEFAULT_SESSION_VIEW);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // The latest is needed from the spoken-settings carrier, which cannot wait
  // a render: two changes asked for in one breath arrive as two calls in one
  // turn, and the second composes against whatever the first just stored.
  const [settings, setSettings, settingsNow] = useStateWithRef<AppSettings | undefined>(undefined);
  const [errand, setErrand] = useState<Errand>();
  const [feedbackNotice, setFeedbackNotice] = useState<string>();
  /**
   * The landing being played in the composer's shape after a send, keyed by
   * play so a second send restarts the swoop rather than reusing a finished
   // SAFETY: The preceding check establishes the asserted contract.
   * one. Undefined is the composer as it always was.
   */
  const [feedbackConfirming, setFeedbackConfirming] = useState<{
    confirmation: FeedbackConfirmation;
    play: number;
  }>();
  // Counts for nothing except having changed: each tick re-renders the rows so
  // their "how long ago" labels stay honest while they are on screen.
  const [, setClock] = useState(0);
  const [panelElement, panelHeight] = useSurfaceHeight();
  const [slotElement, slotHeight] = useSurfaceHeight();
  const [signInSlotElement, signInSlotHeight] = useSurfaceHeight();
  const [connectElement, connectHeight] = useSurfaceHeight();
  const [feedbackElement, feedbackHeight] = useSurfaceHeight();
  const [captionTextElement, captionTextHeight] = useSurfaceHeight();
  const captionElement = useRef<HTMLSpanElement>(null);
  const [captionPadding, setCaptionPadding] = useState(0);
  useLayoutEffect(() => {
    const element = captionElement.current;
    if (!element) return;
    const style = getComputedStyle(element);
    const next = parsePixels(style.paddingTop) + parsePixels(style.paddingBottom);
    setCaptionPadding((previous) => (previous === next ? previous : next));
  });
  /**
   // SAFETY: The preceding check establishes the asserted contract.
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
   // SAFETY: The preceding check establishes the asserted contract.
   * The Mac's output as last read — its mute switch and volume — absent
   // SAFETY: The preceding check establishes the asserted contract.
   * wherever it cannot be read, which is drawn as audible. While it says
   * Luke's voice would land on silence, his words are captioned whatever the
   * preference says, and a hint under them asks for volume.
   */
  const [outputAudio, setOutputAudio] = useState<OutputAudioState>();
  /** Each connected account's calendars, for the settings rows' checkboxes. */
  const [calendars, setCalendars] = useState<readonly ObservedAccountCalendars[]>([]);
  /** Whether the calendar's quiet is holding announcements — the face sleeps on it. */
  const [meetingQuiet, setMeetingQuiet] = useState(false);
  /**
   // SAFETY: The preceding check establishes the asserted contract.
   * Where the app stands against the latest release, as last pushed or
   * answered. Absent until bootstrap carries the main process's snapshot.
   */
  const [update, setUpdate] = useState<UpdateSnapshot>();
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
   * Which entry the slot shape is drawn around — a key being pasted or either
   * sign-in being waited out. One shape, three occupants, never together.
   */
  const slotOccupant = useRef<SlotOccupant>(PANEL_STAND_DOWN.KEY);
  const feedbackNoticeTimer = useRef<number | undefined>(undefined);
  /**
   * The landing the latest send drew, held so the confirmation's hold waits
   * out the same gesture the slot is playing. The initial flip is fixed
   * because it is never played: a landing is always drawn again on delivery.
   */
  const feedbackLanding = useRef(feedbackConfirmation(() => 0));
  /** Counts confirmations so each landing's swoop is replayed, not reused. */
  const feedbackConfirmPlays = useRef(0);
  const feedbackConfirmTimer = useRef<number | undefined>(undefined);
  /**
   // SAFETY: The preceding check establishes the asserted contract.
   * The panel's deferred return, held for as long as the confirmation plays.
   * Running it is the confirmation ending on time; dropping it is the shape
   * being asked for again — or left — before the celebration finished.
   */
  const feedbackFinish = useRef<(() => void) | undefined>(undefined);
  /**
   * The words a spoken open asked to start the note with, waiting for the
   * composer's lifecycle event to consume them. A ref rather than an event
   * payload because the lifecycle channel carries names alone — and only ever
   * the developer's own words, under the spoken tool's contract.
   */
  const spokenFeedbackDraft = useRef<string | undefined>(undefined);
  /**
   * How many errands Luke has run. Carried with each one so that asking for
   // SAFETY: The preceding check establishes the asserted contract.
   * the same control twice flies twice, exactly as a repeated face gesture is
   * replayed by counting its plays.
   */
  const errands = useRef(0);

  /**
   * The way to tell the conversation what the store now holds, for the spoken
   * carrier below. Only the drawing waits for Luke: the guide has to describe
   * the store's answer at once, because the next call in the same turn is
   // SAFETY: The preceding check establishes the asserted contract.
   * validated against it — an effort named in the same breath as a model only
   * exists in the guide the model change just made true. A ref because the
   * carrier is created before the conversation hook that owns the publisher.
   */
  const publishGuideRef = useRef<(next: AppSettings) => void>(() => {});
  /**
   * The newest snapshot this window has seen, drawn or still held back.
   *
   * What waits for Luke is the drawing alone. What the next call of the same
   * turn composes against has to be current, or a model and the effort named
   * in the same breath would compose the second against the selection the
   * first just replaced. So the spoken carrier writes this the moment the
   * store answers, before any of it is drawn.
   *
   * It cannot be only the spoken answers, though, or a switch pressed by hand
   * between two spoken changes would be shadowed by a snapshot older than it.
   * So every write goes through {@link applySettings} and this is always at
   // SAFETY: The preceding check establishes the asserted contract.
   * least as new as the drawn state, whichever path wrote it.
   */
  const answeredSettings = useRef<AppSettings | undefined>(undefined);
  /**
   * The one way settings are drawn. Every path travels it — a row's own press,
   * a key stored or removed, another window's push, and an errand's hold
   * coming down — so the snapshot the next spoken change composes against is
   * never older than the panel it is drawn on.
   */
  const applySettings = useCallback(
    (next: AppSettings) => {
      answeredSettings.current = next;
      setSettings(next);
    },
    [setSettings],
  );
  /**
   * Draws what the panel was not drawing yet, because Luke had not reached it.
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
   * A hold belongs to the act that caught it rather than to the app, because
   * one reply can ask for several acts and each has its own switch to move.
   * They ride the run in {@link errandRun}, which is a ref rather than state:
   * the callbacks that release them have to stay stable across the whole
   * flight they are timing, and an errand whose callbacks changed identity
   * would be torn down and rebuilt mid-air.
   */
  const drawErrandHold = useCallback(
    (hold: ErrandHold) => {
      if (hold.settings !== undefined) applySettings(hold.settings);
      // Folded into whatever the view is at the moment it lands rather than the
      // moment it was chosen: the list corrects its own filter during render
      // when one empties, and a snapshot taken at the ask would undo that.
      const view = hold.view;
      if (view !== undefined) setSessionView((current) => ({ ...current, ...view }));
    },
    [applySettings],
  );

  /**
   * Every act this reply asked Luke to sign, in the order he will sign them.
   * One flight at a time: a second act handed straight to the flight ends the
   * first one mid-air, which is both switches flipping at once with nobody
   * seen doing either.
   */
  const errandRun = useRef<ErrandRun>(EMPTY_ERRAND_RUN);

  /** The tap has landed, so the act in the air may finally be drawn. */
  const releaseErrandChange = useCallback(() => {
    const landed = landErrand(errandRun.current);
    errandRun.current = landed.run;
    drawErrandHold(landed.hold);
  }, [drawErrandHold]);

  /**
   * Whether the panel on screen is one an errand stood up. Only then is it the
   * errand's to put away again — a panel that was already open is somewhere
   * the developer had gone themselves, and closing it would be taking it from
   * them for having spoken.
   */
  const errandOpenedPanel = useRef(false);

  const changeTab = useCallback(
    (next: PanelTab) => {
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
    },
    [setSettingsView, setTab],
  );

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

  /**
   * True while sign-in stands between Luke and anything to watch. The gate is
   * then what the panel shows, the wings hide the face and the count, and the
   * badge's place wears a quiet "Sign in" instead — the honest word for why
   * Luke is idle, at capsule scale.
   */
  const accountGated =
    bootstrap?.accountRequired === true &&
    (account ?? bootstrap.account).status !== ACCOUNT_STATUS.SIGNED_IN;

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
    generation: modeGenerationOf,
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
    onNotPanel: () => setOptionsOpen(false),
    onCapsuleList: () => {
      // A search is a question about the list as it was, so it closes with
      // the panel on the same terms the filter does — a remembered query
      // could hide the very session the capsule is reporting.
      setSessionView(DEFAULT_SESSION_VIEW);
      setSearchOpen(false);
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
   * Sends Luke to sign the next act waiting on him, and puts the panel where
   * that act can be seen.
   *
   * Only the panel can hold a signature, so every caller stands it up first
   * and this is the backstop rather than the decision: a run whose panel never
   * opened has nobody to show anything to, so everything it was holding is
   * drawn at once and the run is over. An act that named a control this build
   * does not draw is over the moment it is taken up, in the same way — which
   * is why this loops rather than returning: the next act takes its turn
   * immediately instead of waiting for a flight that will never be made.
   *
   * The tab and the page are turned here rather than where the act was asked
   * for, because a page turned at the ask would take the previous act's
   * control off screen before Luke had reached it.
   */
  const flyNextErrand = useCallback(() => {
    while (errandRun.current.flying === undefined && errandRun.current.waiting.length > 0) {
      if (presentationOf() !== PANEL_PRESENTATION.PANEL) {
        const flushed = flushErrands(errandRun.current);
        errandRun.current = flushed.run;
        drawErrandHold(flushed.hold);
        return;
      }
      const { run, launch } = nextErrand(errandRun.current);
      errandRun.current = run;
      if (launch === undefined) return;
      const wait = errandWait({
        opening: launch.opening,
        surfaceChanging:
          launch.page !== undefined &&
          (tabNow() !== launch.tab || settingsViewNow() !== launch.page),
      });
      // The control has to be drawn to be flown to, and a settings page that is
      // not open is not drawn at all — so the tab comes forward and then the
      // page the setting lives on, in that order, because arriving at the tab
      // is arriving at its front page. This is the same move a credential entry
      // returning from the key slot makes.
      changeTab(launch.tab);
      if (launch.page !== undefined) setSettingsView(launch.page);
      if (launch.targets.length > 0) {
        errands.current += 1;
        setErrand({ targets: launch.targets, wait, run: errands.current });
        // Whether the panel is still the run's to put away, asked of the run
        // rather than of this act alone. A later act must not answer "no" on
        // the first one's behalf just for having found the panel already open:
        // a close the first act scheduled and the second disowned still fires,
        // into the middle of the second act's flight. But an act that asked for
        // the panel itself does disclaim it, whichever act stood it up.
        errandOpenedPanel.current = errandBorrowedPanel(errandOpenedPanel.current, launch);
        return;
      }
      // Nothing flew, so nothing is coming to release it.
      const finished = finishErrand(errandRun.current);
      errandRun.current = finished.run;
      drawErrandHold(finished.hold);
    }
  }, [changeTab, drawErrandHold, presentationOf, setSettingsView, settingsViewNow, tabNow]);

  /** Adds an act to the run, and sends Luke off if he is not already out. */
  const armErrandFlight = useCallback(
    (pending: PendingErrand) => {
      errandRun.current = armErrand(errandRun.current, pending);
      flyNextErrand();
    },
    [flyNextErrand],
  );

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
   * Applies a settings write's reply: the snapshot the store actually holds,
   * and any refusal for the row to show. Every settings row travels this
   * road so it redraws from what was stored rather than from the press.
   */
  const applySettingsReply = useCallback(
    (result: SettingsUpdateResult) => {
      applySettings(result.settings);
      return result.reason;
    },
    [applySettings],
  );

  const changeVoiceCaptions = useCallback(
    async (enabled: boolean) =>
      applySettingsReply(
        await window.sidecar.updateSetting(APP_SETTING_SCHEMA.voiceCaptions.field, enabled),
      ),
    [applySettingsReply],
  );

  const changeDuckOtherMedia = useCallback(
    async (enabled: boolean) =>
      applySettingsReply(
        await window.sidecar.updateSetting(APP_SETTING_SCHEMA.duckOtherMedia.field, enabled),
      ),
    [applySettingsReply],
  );

  const changeShareUsageData = useCallback(
    async (enabled: boolean) =>
      applySettingsReply(
        await window.sidecar.updateSetting(APP_SETTING_SCHEMA.shareUsageData.field, enabled),
      ),
    [applySettingsReply],
  );

  const changeVoiceSource = useCallback(
    async (source: VoiceSource) =>
      applySettingsReply(
        await window.sidecar.updateSetting(APP_SETTING_SCHEMA.voiceSource.field, source),
      ),
    [applySettingsReply],
  );

  const changePreferBuiltInMicrophone = useCallback(
    async (enabled: boolean) =>
      applySettingsReply(
        await window.sidecar.updateSetting(
          APP_SETTING_SCHEMA.preferBuiltInMicrophone.field,
          enabled,
        ),
      ),
    [applySettingsReply],
  );

  const changeQuietDuringMeetings = useCallback(
    async (enabled: boolean) =>
      applySettingsReply(
        await window.sidecar.updateSetting(APP_SETTING_SCHEMA.quietDuringMeetings.field, enabled),
      ),
    [applySettingsReply],
  );

  const removeCalendarAccount = useCallback(
    async (accountId: string) =>
      applySettingsReply(await window.sidecar.removeCalendarAccount(accountId)),
    [applySettingsReply],
  );

  const toggleCalendarSelected = useCallback(
    async (accountId: string, calendarId: string, selected: boolean) =>
      applySettingsReply(await window.sidecar.setCalendarSelected(accountId, calendarId, selected)),
    [applySettingsReply],
  );

  const disconnectLinear = useCallback(
    async () => applySettingsReply(await window.sidecar.disconnectLinear()),
    [applySettingsReply],
  );

  /**
   * A consent sign-in is asking for one thing too, so the panel gets out of
   * the way of it the same way it does for a key: the shape goes down to a
   * slot that says what it is waiting for. The flow itself runs in the
   * browser and the main process; when the grant lands, the panel comes back
   * around the newly connected service. One entry serves every such sign-in,
   * because only one consent page can be open at a time and there is only one
   * slot for it to stand in.
   */
  const consentConnect = usePanelEntry<ConsentConnectEntry>({
    aside: PANEL_PRESENTATION.SLOT,
    // Giving up mid-wait leaves — the consent page is where the user is — but
    // a sign-in that failed is read in the slot, so its Close restores the
    // panel to try again from the row.
    restoresPanel: (held) => held.rejection !== undefined,
    isSendable: (entry): entry is ConsentConnectEntry => entry !== undefined && !entry.busy,
    send: async (sending) => {
      // Which service is being connected decides which documented act runs,
      // and nothing else does: the entry names one of the two the build knows.
      const result =
        sending.serviceId === CONSENT_SERVICE_ID.LINEAR
          ? await window.sidecar.connectLinear()
          : await window.sidecar.connectGoogleCalendar();
      applySettings(result.settings);
      return result.reason ? { rejection: result.reason } : {};
    },
    pointerInside: pointerIsInside,
    presentation: presentationOf,
    onReleasedWhileAway: onHitRegionLeave,
    cancelHover,
    applyPresentation,
    restorePanel,
    leave,
    settle,
    heldRef: consentConnectHeld,
  });

  /** One press: stand down to the waiting slot and open the consent page. */
  const beginConsentSignIn = useCallback(
    (serviceId: ConsentServiceId) => {
      // One slot, one occupant: a key mid-paste is not disturbed by a
      // sign-in, and neither is another sign-in already waiting.
      if (credentialHeld.current || consentConnectHeld.current) return;
      slotOccupant.current = PANEL_STAND_DOWN.CONSENT;
      // Every consent block stands under Integrations, so that is where a
      // cancelled or refused sign-in comes back to.
      standDownPage.current = standDownReturnPage({ kind: PANEL_STAND_DOWN.CONSENT });
      consentConnect.begin({ serviceId, busy: false });
      consentConnect.commit();
    },
    [consentConnect.begin, consentConnect.commit],
  );

  const cancelConsentSignIn = useCallback(() => {
    // Mid-wait, the loopback must stop listening too; after a failure there
    // is nothing left to stop.
    const waiting = consentConnect.latest();
    if (waiting?.busy) {
      if (waiting.serviceId === CONSENT_SERVICE_ID.LINEAR) window.sidecar.cancelLinearSignIn();
      else window.sidecar.cancelGoogleCalendarSignIn();
    }
    consentConnect.cancel();
  }, [consentConnect.cancel, consentConnect.latest]);

  const beginSupersetSignIn = useCallback(() => {
    if (supersetSignInHeld.current) {
      if (supersetSignIn.stage === SUPERSET_SIGN_IN_STAGE.FAILURE) {
        setSupersetSignIn({ stage: SUPERSET_SIGN_IN_STAGE.BROWSER_CODE, organizations: [] });
        void window.sidecar.beginSupersetSignIn().then(setSupersetSignIn);
      }
      return;
    }
    if (credentialHeld.current || consentConnectHeld.current) return;
    supersetSignInHeld.current = true;
    slotOccupant.current = PANEL_STAND_DOWN.SUPERSET;
    standDownPage.current = standDownReturnPage({ kind: PANEL_STAND_DOWN.SUPERSET });
    setSupersetSignIn({ stage: SUPERSET_SIGN_IN_STAGE.BROWSER_CODE, organizations: [] });
    cancelHover();
    applyPresentation(PANEL_PRESENTATION.SLOT);
    void window.sidecar.beginSupersetSignIn().then(setSupersetSignIn);
  }, [applyPresentation, cancelHover, supersetSignIn.stage]);

  const cancelSupersetSignIn = useCallback(() => {
    if (!supersetSignInHeld.current) return;
    window.sidecar.cancelSupersetSignIn();
    supersetSignInHeld.current = false;
    setSupersetSignIn({ stage: SUPERSET_SIGN_IN_STAGE.IDLE, organizations: [] });
    if (presentationOf() === PANEL_PRESENTATION.SLOT) restorePanel();
  }, [presentationOf, restorePanel]);

  const disconnectSuperset = useCallback(async () => {
    const rejection = await window.sidecar.disconnectSuperset();
    // The idle broadcast the sign-out fires says the same thing to every other
    // window; this window should not wait a round trip to agree with itself.
    if (rejection === undefined) setSupersetConnected(false);
    return rejection;
  }, []);

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
      applySettings(result.settings);
      return result.reason ? { rejection: result.reason } : {};
    },
    pointerInside: pointerIsInside,
    presentation: presentationOf,
    onReleasedWhileAway: onHitRegionLeave,
    cancelHover,
    applyPresentation,
    restorePanel,
    leave,
    settle,
    heldRef: credentialHeld,
  });

  const beginEntry = useCallback(
    (providerId: CredentialProviderId) => {
      // Where the entry's row is drawn, remembered before the trip to the
      // slot so coming back lands on the page the entry began on.
      standDownPage.current = standDownReturnPage({ kind: PANEL_STAND_DOWN.KEY, providerId });
      slotOccupant.current = PANEL_STAND_DOWN.KEY;
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
    if (presentationOf() === PANEL_PRESENTATION.SLOT) return;
    credentialsEntry.standDown();
  }, [credentialsEntry.apply, credentialsEntry.latest, credentialsEntry.standDown, presentationOf]);

  const removeProviderApiKey = useCallback(
    async (providerId: CredentialProviderId) => {
      const result = await window.sidecar.setProviderApiKey(providerId, undefined);
      applySettings(result.settings);
      // Delete and the field are on the row together once the panel has been
      // brought back around an entry, and a key that has been removed cannot be
      // replaced.
      if (removalEndsEntry(credentialsEntry.latest(), providerId, result.reason)) {
        credentialsEntry.apply(undefined);
      }
      return result.reason;
    },
    [applySettings, credentialsEntry.apply, credentialsEntry.latest],
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

  /**
   * Whose sign-in the surface is waiting on. Choosing a provider on the gate
   * sends the browser to it and stands the panel down to a small waiting
   * popup, the way fetching an API key stands it down to the slot: the real
   * work is in the browser, and Luke floats above the page it needs. Held as
   * app state with a ref because the attempt's own reply has to read whether
   * it is still the one being waited on.
   */
  const [signInWait, setSignInWait, signInWaitNow] = useStateWithRef<AccountProvider | undefined>(
    undefined,
  );
  /**
   * Which attempt any reply answers. Cancel advances it, so the outcome of a
   * sign-in already withdrawn is spent rather than moving the shape again.
   */
  const signInAttempt = useRef(0);
  const [signInFailure, setSignInFailure] = useState<string>();

  const beginSignIn = useCallback(
    (provider: AccountProvider) => {
      if (signInWaitNow() !== undefined) return;
      const attempt = ++signInAttempt.current;
      setSignInFailure(undefined);
      setSignInWait(provider);
      cancelHover();
      applyPresentation(PANEL_PRESENTATION.SLOT);
      window.sidecar.beginSignIn(provider).then(
        () => {
          if (signInAttempt.current !== attempt) return;
          setSignInWait(undefined);
          if (presentationOf() !== PANEL_PRESENTATION.SLOT) return;
          // The panel comes forward around what was just unlocked — the
          // session roster — and stays open like any other opened panel:
          // signing in is an arrival, not an errand to settle and leave.
          expand();
        },
        () => {
          if (signInAttempt.current !== attempt) return;
          setSignInWait(undefined);
          setSignInFailure("Sign-in did not finish. Try again when you’re ready.");
          if (presentationOf() === PANEL_PRESENTATION.SLOT) expand();
        },
      );
    },
    [applyPresentation, cancelHover, expand, presentationOf, setSignInWait, signInWaitNow],
  );

  /**
   * Takes the wait back. The main process withdraws the loopback and signs the
   * attempt back out; the panel returns to the gate at once rather than
   * waiting for that round trip, and the attempt's eventual rejection finds
   * itself already spent.
   */
  const cancelSignIn = useCallback(() => {
    if (signInWaitNow() === undefined) return;
    signInAttempt.current += 1;
    setSignInWait(undefined);
    void window.sidecar.cancelSignIn();
    if (presentationOf() === PANEL_PRESENTATION.SLOT) expand();
  }, [expand, presentationOf, setSignInWait, signInWaitNow]);

  const changeShowInDock = useCallback(
    async (show: boolean) =>
      applySettingsReply(
        await window.sidecar.updateSetting(APP_SETTING_SCHEMA.showInDock.field, show),
      ),
    [applySettingsReply],
  );

  const changeShowOnAllDisplays = useCallback(
    async (show: boolean) =>
      applySettingsReply(
        await window.sidecar.updateSetting(APP_SETTING_SCHEMA.showOnAllDisplays.field, show),
      ),
    [applySettingsReply],
  );

  const changeFormFactor = useCallback(
    async (formFactor: PanelFormFactor) =>
      applySettingsReply(
        await window.sidecar.updateSetting(APP_SETTING_SCHEMA.formFactor.field, formFactor),
      ),
    [applySettingsReply],
  );

  // Where a nameless creation ask goes — the same store write the first
  // creation makes on its own, offered by hand so the choice can be changed
  // or returned to asking each time.
  const changeDefaultWorkspaceProvider = useCallback(
    async (providerId: WorkspaceProviderId | undefined) =>
      applySettingsReply(
        await window.sidecar.updateSetting(
          APP_SETTING_SCHEMA.defaultWorkspaceProvider.field,
          providerId,
        ),
      ),
    [applySettingsReply],
  );

  const changeWorkspaceAgentDefault = useCallback(
    async (providerId: ProviderId, selection: WorkspaceAgentSelection | undefined) =>
      applySettingsReply(
        await window.sidecar.updateSettingEntry(
          APP_SETTING_SCHEMA.workspaceAgentDefaults.field,
          providerId,
          selection,
        ),
      ),
    [applySettingsReply],
  );

  // One group of settings back to its defaults — the same store forgetting
  // each row's own clear performs, done as one write so a page's reset is one
  // act rather than a race of four.
  const changeSettingsReset = useCallback(
    async (scope: SettingsResetScope) =>
      applySettingsReply(await window.sidecar.resetSettings(scope)),
    [applySettingsReply],
  );

  // Where a nameless creation ask lands within a provider — the same store
  // write the first creation there makes on its own, offered by hand so the
  // choice can be changed or returned to the first creation.
  const changeWorkspaceProjectDefault = useCallback(
    async (providerId: WorkspaceProviderId, providerProjectId: string | undefined) =>
      applySettingsReply(
        await window.sidecar.updateSettingEntry(
          APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
          providerId,
          providerProjectId,
        ),
      ),
    [applySettingsReply],
  );

  const changeSupersetAgentDefault = useCallback(
    async (agent: string | undefined) =>
      applySettingsReply(
        await window.sidecar.updateSetting(APP_SETTING_SCHEMA.supersetAgentDefault.field, agent),
      ),
    [applySettingsReply],
  );

  /**
   * The providers the default-workspace rows can offer: every provider
   * currently offering projects, named the way its adapter names itself, plus
   * one holding a stored default provider that is not offering right now — a
   * provider falls back to its own display name, so the row still shows a
   * choice it can name. A project has no such name to fall back to: its label
   * lived on the observed list that stopped listing it, and an option labelled
   * with the stored identity would offer a raw id for a default that already
   * steers nothing. So each option carries only the projects its provider is
   * offering, and a default the provider stops offering is cleared by the main
   * process rather than shown here.
   */
  const storedWorkspaceProvider = settings?.defaultWorkspaceProvider;
  const storedWorkspaceProjects = settings?.workspaceProjectDefaults;
  const workspaceProviderOptions = useMemo(() => {
    const fallbackName = (providerId: WorkspaceProviderId) =>
      isCredentialProviderId(providerId)
        ? CREDENTIAL_PROVIDERS[providerId].displayName
        : providerId;
    const names = new Map<WorkspaceProviderId, string>();
    for (const project of workspaceProjects) {
      if (isWorkspaceProviderId(project.providerId)) {
        names.set(project.providerId, project.providerName);
      }
    }
    if (storedWorkspaceProvider && !names.has(storedWorkspaceProvider)) {
      names.set(storedWorkspaceProvider, fallbackName(storedWorkspaceProvider));
    }
    for (const providerId of Object.keys(storedWorkspaceProjects ?? {})) {
      if (!isWorkspaceProviderId(providerId)) continue;
      if (!names.has(providerId)) names.set(providerId, fallbackName(providerId));
    }
    return [...names.entries()].map(([id, name]) => {
      const offered = workspaceProjects
        .filter((project) => project.providerId === id)
        .map((project) => ({
          id: workspaceProjectSelectionId(project),
          label: project.targetName
            ? `${project.repository} on ${project.targetName}`
            : project.repository,
        }));
      return { id, name, projects: offered };
    });
  }, [workspaceProjects, storedWorkspaceProvider, storedWorkspaceProjects]);

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

  /**
   * Ends the confirmation without restoring anything: the shape was asked for
   * again, or left, so the finish it held is dropped rather than run.
   */
  const dropFeedbackConfirmation = useCallback(() => {
    if (feedbackConfirmTimer.current !== undefined) {
      window.clearTimeout(feedbackConfirmTimer.current);
      feedbackConfirmTimer.current = undefined;
    }
    feedbackFinish.current = undefined;
    setFeedbackConfirming(undefined);
  }, []);

  useEffect(() => () => window.clearTimeout(feedbackConfirmTimer.current), []);

  // A confirmation lives exactly as long as the shape it is drawn in: the
  // presentation moving on ends it and drops the unrun finish it held.
  useEffect(() => {
    if (presentation === PANEL_PRESENTATION.FEEDBACK) return;
    dropFeedbackConfirmation();
  }, [presentation, dropFeedbackConfirmation]);

  const stillMotion = usePrefersReducedMotion();

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
          ...(name ? { name } : undefined),
          ...(email ? { email } : undefined),
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
    onDelivered: () => {
      showFeedbackNotice("Sent — thank you!");
      // The landing plays in the shape the note left from: Luke swoops down
      // beside the thank-you and plays this send's flip of the coin. The pick
      // is held on a ref so the hold below waits out the same gesture.
      const confirmation = feedbackConfirmation();
      feedbackLanding.current = confirmation;
      feedbackConfirmPlays.current += 1;
      setFeedbackConfirming({
        confirmation,
        play: feedbackConfirmPlays.current,
      });
    },
    afterDelivery: (finish) => {
      feedbackFinish.current = finish;
      const { motion } = feedbackLanding.current;
      if (feedbackConfirmTimer.current !== undefined) {
        window.clearTimeout(feedbackConfirmTimer.current);
      }
      feedbackConfirmTimer.current = window.setTimeout(
        () => {
          feedbackConfirmTimer.current = undefined;
          setFeedbackConfirming(undefined);
          const held = feedbackFinish.current;
          feedbackFinish.current = undefined;
          held?.();
        },
        confirmationHoldMs({ motion, still: stillMotion }),
      );
    },
    pointerInside: pointerIsInside,
    presentation: presentationOf,
    onReleasedWhileAway: onHitRegionLeave,
    cancelHover,
    applyPresentation,
    restorePanel,
    leave,
    settle,
    heldRef: feedbackHeld,
  });

  /**
   * Opens the composer for a kind — from the section's own buttons or asked of
   * Luke out loud — and stands the panel down to its shape,
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
      // The Feedback section is on the front page, so that is where leaving
      // the composer — or the thank-you the send lands in — comes back to.
      standDownPage.current = standDownReturnPage({ kind: PANEL_STAND_DOWN.FEEDBACK });
      // Asking to write again is the confirmation's end: the composer takes
      // the shape back, and the return the landing held is dropped unrun.
      dropFeedbackConfirmation();
      const opened = openedFeedbackEntry(feedbackEntry.latest(), {
        kind,
        fromPanel,
        ...(draft !== undefined ? { draft } : undefined),
        // A fresh note starts signed with the account; a note already there
        // keeps its fields as its author left them, cleared ones included.
        signature: accountSignature(accountNow()),
      });
      if (opened.entry) feedbackEntry.apply(opened.entry);
      feedbackEntry.standDown();
      return opened.drafted;
    },
    [
      accountNow,
      dropFeedbackConfirmation,
      feedbackEntry.apply,
      feedbackEntry.latest,
      feedbackEntry.standDown,
    ],
  );

  /**
   * Leaves the shape and keeps the draft — Escape's meaning here. A note is
   * longer than a key, and a key is the only thing Escape is allowed to
   * discard; the way back in is the same button, now reading "keep writing".
   * Where it returns you is where the composer was last asked for from: the
   * panel, or — from a spoken ask — nothing at all.
   */
  const dismissFeedback = useCallback(() => {
    if (presentationOf() !== PANEL_PRESENTATION.FEEDBACK) return;
    // Escape during the landing skips the celebration, never the return: the
    // finish the confirmation held runs now instead of later.
    if (feedbackFinish.current) {
      const finish = feedbackFinish.current;
      dropFeedbackConfirmation();
      finish();
      return;
    }
    if (feedbackEntry.latest()?.fromPanel === true) restorePanel();
    else leave();
  }, [dropFeedbackConfirmation, feedbackEntry.latest, leave, presentationOf, restorePanel]);

  /**
   * Takes picked or pasted files aboard. Encoding happens here on the user's
   * machine — scaled and re-written where a screenshot would not fit the
   // SAFETY: The preceding check establishes the asserted contract.
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
    ...(feedbackNotice ? { notice: feedbackNotice } : undefined),
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
      void window.sidecar
        .updateSetting(APP_SETTING_SCHEMA.voice.field, voice)
        .then(applySettingsReply);
    },
    [applySettingsReply],
  );

  // The pace, under the same rule as the voice above.
  const changeVoiceSpeed = useCallback(
    (speed: RealtimeVoiceSpeed) => {
      void window.sidecar
        .updateSetting(APP_SETTING_SCHEMA.voiceSpeed.field, speed)
        .then(applySettingsReply);
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
      applySettingsReply(
        await window.sidecar.updateSetting(APP_SETTING_SCHEMA.voiceHotkey.field, accelerator),
      ),
    [applySettingsReply],
  );

  // The ask key, under the same rule: the key the row shows follows the main
  // process's own announcement of what actually registered.
  const changeAskHotkey = useCallback(
    async (accelerator: string | undefined) =>
      applySettingsReply(
        await window.sidecar.updateSetting(APP_SETTING_SCHEMA.askHotkey.field, accelerator),
      ),
    [applySettingsReply],
  );

  // The stop key, under the same rule again.
  const changeStopHotkey = useCallback(
    async (accelerator: string | undefined) =>
      applySettingsReply(
        await window.sidecar.updateSetting(APP_SETTING_SCHEMA.stopHotkey.field, accelerator),
      ),
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
      cancelHover();
      void changeMode(false);
    },
    [cancelHover, changeMode],
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
        presentationOf() === PANEL_PRESENTATION.PANEL
      ) {
        cancelHover();
        void changeMode(false);
      }
      return result;
    },
    [cancelHover, changeMode, presentationOf],
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
      presentationOf() === PANEL_PRESENTATION.PANEL &&
      field !== null &&
      document.activeElement === field
    ) {
      cancelHover();
      void changeMode(false);
      return;
    }
    changeTab(PANEL_TAB.SESSIONS);
    focusAskField();
  }, [cancelHover, changeMode, changeTab, presentationOf]);

  /**
   * The search summons, from its button or Command-F. It lands on the Sessions
   * tab whatever is showing — the field it opens is that list's — and the
   * caret follows the same frame-by-frame seek the ask field needs, because
   * the field may not be drawn until React has answered.
   */
  const openSearch = useCallback(() => {
    changeTab(PANEL_TAB.SESSIONS);
    setSearchOpen(true);
    focusSearchField();
  }, [changeTab]);

  /**
   * Closing the search lets go of its query in the same act: a field that
   * left its narrowing in force behind no visible control would be hiding
   * sessions with nothing on screen admitting it.
   */
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSessionView((view) => (view.query === "" ? view : { ...view, query: "" }));
  }, []);

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
    if (pointerIsInside() || heldAgainstPointer()) return;
    cancelHover();
    settle();
  }, [cancelHover, heldAgainstPointer, pointerIsInside, settle]);

  /**
   * One flight over, and the next one away if the reply asked for more than one
   * act. The panel only stands back down once the whole run is signed: a close
   * scheduled between two flights would land in the middle of the second, and
   * a flight whose shape goes out from under it is cut short where it stands.
   *
   * Every beat is acted on, with no test for whether the flight reporting it is
   // SAFETY: The preceding check establishes the asserted contract.
   * still the current one. There is no such thing as a stale flight —
   * a second act waits its turn rather than overtaking the one in the air — and
   * a guard here would be worse than redundant: this is what advances the run,
   * so a beat it declined to act on would strand every act still waiting and
   * every hold they carry.
   */
  const finishErrandFlight = useCallback(() => {
    const finished = finishErrand(errandRun.current);
    errandRun.current = finished.run;
    drawErrandHold(finished.hold);
    flyNextErrand();
    if (!errandRunIdle(errandRun.current)) return;
    standDownAfterErrand();
  }, [drawErrandHold, flyNextErrand, standDownAfterErrand]);

  /**
   * The spoken asks about Luke himself. A settings change goes through the
   * same bridge calls the settings rows use, and the snapshot that comes back
   * redraws the panel's switches; showing the panel is the capsule's press
   * with a tab — or, already open, that tab's own press — and optionally a
   * narrowing, chosen out loud; opening the composer follows the spoken-ask
   * path. All were validated against their fixed
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
    async (action) =>
      dispatchByKind(action, {
        [APP_TOOL_KIND.SETTING]: async (action) => {
          // The store's answer is caught rather than drawn: the switch is what
          // Luke is on his way to move, so it waits for him to reach it. It is
          // caught in a local and handed to this act alone, because one reply
          // can change two settings and each switch waits for its own tap.
          // Every path out of here releases it, and the outcome the
          // conversation is told is the store's own either way — what is
          // delayed is the drawing, never the change or the report of it.
          //
          // Two things must not wait for Luke, and neither is the drawing. The
          // guide has to describe the store's answer at once, because the next
          // call in this same turn is validated against it — an effort named in
          // the same breath as a model only exists in the guide the model
          // change just made true. And the freshest answer this window has seen
          // is what that next call composes against, which is why it is
          // remembered outside the hold: the hold belongs to one act, and every
          // act after it has to read this.
          let caught: AppSettings | undefined;
          const outcome = await applySpokenSetting(
            window.sidecar,
            action,
            (next) => {
              caught = next;
              answeredSettings.current = next;
              publishGuideRef.current(next);
            },
            answeredSettings.current ?? settingsNow() ?? bootstrap?.settings,
          );
          const hold: ErrandHold = caught === undefined ? NOTHING_HELD : { settings: caught };
          // Nothing to show and nothing to sign: a refused change must not stand
          // the panel up in front of a switch that did not move.
          if (outcome.status !== "changed") {
            drawErrandHold(hold);
            return outcome;
          }
          const opening = presentationOf() !== PANEL_PRESENTATION.PANEL;
          // The guide's ids travel as plain text, so one that names no setting
          // of Luke's names no page either — and nothing will fly to it.
          const page = isAppSettingId(action.setting.id)
            ? SETTING_PAGE[action.setting.id]
            : undefined;
          try {
            await changeMode(true);
            // Queued rather than flown at once. The tab, the page and the wait
            // are all decided when this act comes up for its turn, because an
            // earlier act may still be out over the very page this one would
            // otherwise turn away.
            armErrandFlight({
              targets: errandTargets(action),
              tab: PANEL_TAB.SETTINGS,
              ...(page === undefined ? undefined : { page }),
              opening,
              borrowsPanel: true,
              hold,
            });
          } catch {
            // Showing the change is not what was asked for — making it is, and it
            // is already made. A window that refused to come forward must not be
            // reported back as a setting that refused to change, and the switch
            // must be drawn whether or not anyone was shown it moving.
            drawErrandHold(hold);
          }
          return outcome;
        },
        [APP_TOOL_KIND.FEEDBACK]: async (action) => {
          // The main process expands the window and sends the composer's
          // lifecycle event down the same ordered channel as the mode event,
          // so the composer's shape can never lose a race to the panel apply
          // the expansion causes. The draft
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
            ...(action.draft === undefined ? undefined : { draft: action.draft }),
            signature: accountSignature(accountNow()),
          }).drafted;
          spokenFeedbackDraft.current = action.draft;
          try {
            await window.sidecar.summonFeedback(kind);
          } catch (error) {
            // The composer is not coming, so the event that would consume the
            // draft is not coming either; a stale one must not season some
            // later spoken request.
            spokenFeedbackDraft.current = undefined;
            throw error;
          }
          return {
            status: "opened",
            kind: action.composer,
            ...(action.draft === undefined
              ? undefined
              : drafted
                ? {
                    note: "The ask is drafted in the composer; the developer edits and sends it by hand.",
                  }
                : {
                    note: "A note was already being written, so it was kept and nothing was drafted over it.",
                  }),
          };
        },
        [APP_TOOL_KIND.PANEL]: async (action) => {
          // Whether this ask is what opens the panel, read before it does: an
          // errand into a shape still growing has to trail the whole opening,
          // and one into a panel already up does not.
          const opening = presentationOf() !== PANEL_PRESENTATION.PANEL;
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
          const view =
            filter || action.sort
              ? {
                  ...(filter ? { filter } : undefined),
                  ...(action.sort ? { sort: action.sort } : undefined),
                }
              : undefined;
          await changeMode(true);
          // The tab bar and the options button are drawn outside the settings
          // pages, so this act names no page and waits for none. An act with
          // nowhere to land releases what it holds the moment it comes up: the
          // panel itself is what was asked for and it is already open, so the
          // list must show what the answer is about to claim it shows.
          armErrandFlight({
            targets: errandTargets(action),
            tab: action.tab,
            opening,
            // The panel is what was asked for, so it is nobody's to take away.
            borrowsPanel: false,
            hold: view === undefined ? NOTHING_HELD : { view },
          });
          return {
            status: "shown",
            tab: action.tab,
            ...(spoken ? { filter: action.filter } : undefined),
            ...(action.filter && !spoken
              ? { note: "That agent has no filter of its own here, so every session is shown." }
              : undefined),
            ...(action.sort ? { sort: action.sort } : undefined),
          };
        },
      }),
    [
      accountNow,
      armErrandFlight,
      changeMode,
      settingsNow,
      bootstrap,
      drawErrandHold,
      feedbackEntry.latest,
      presentationOf,
    ],
  );

  const defaultWorkspaceProvider = (settings ?? bootstrap?.settings)?.defaultWorkspaceProvider;
  const workspaceProjectDefaults = (settings ?? bootstrap?.settings)?.workspaceProjectDefaults;
  // The muted evidence run is the speaking run with the hint drawn over it: a
  // capture has no system output to read, so the state is asked for directly.
  const fixtureMuted = bootstrap?.profile === "muted";
  const fixtureSpeaking = bootstrap?.profile === "speaking" || fixtureMuted;
  const {
    analyser,
    microphoneStatus,
    setMicrophoneStatus,
    voiceError,
    voiceNotice,
    announceVoiceNotice,
    voiceStatus,
    talkOpening,
    voiceHotkey,
    handleVoiceActivity,
    requestMicrophoneAccess,
    startMicrophone,
    stopMicrophone,
    askLuke,
    voiceTurn,
    lukeCaptions,
    mentionedSessions,
    mentionedIssues,
    remoteAudio,
    discardListening,
    stopSpeaking,
    syncGuide,
    syncIssues,
  } = useVoiceConversation({
    preferBuiltInMicrophone: (settings ?? bootstrap?.settings)?.preferBuiltInMicrophone ?? true,
    sessions,
    noticeAsks,
    workspaceProjects,
    defaultWorkspaceProvider,
    workspaceProjectDefaults,
    voice: settings?.voice,
    voiceSpeed: settings?.voiceSpeed,
    voiceCaptions: settings?.voiceCaptions === true,
    voiceAvailable: settings?.voiceAvailable,
    outputSilent: outputSilent(outputAudio),
    meetingQuiet,
    fixtureSpeaking,
    capturingShortcut: () => shortcutCapture.current,
    openSession: openSessionAloud,
    carryAppAction,
  });

  // A failed call is reported where its reply would have landed: on the
  // caption strip, under the field or the key press that asked. It yields to
  // live words, so it can never be drawn over a reply being spoken.
  const voiceErrorNotice = voiceErrorToShow({
    fixtureSpeaking,
    voice: voiceTurn,
    error: voiceError,
  });
  // A state notice borrows the strip on the failure's own terms — leaving on
  // the same clock, in its quieter tone — but yields only to Luke's own turn:
  // the developer's open microphone draws nothing on the strip, and the one
  // refusal that happens during it belongs there. The failure outranks it: a
  // fault is the more urgent thing to read.
  const voiceNoticeShown = voiceNoticeToShow({
    fixtureSpeaking,
    voice: voiceTurn,
    notice: voiceNotice,
  });
  // What the caption block is being handed live this frame: Luke's words, a
  // failure borrowing their strip, or a notice borrowing it more quietly.
  const liveStripText = voiceErrorNotice ?? voiceNoticeShown;
  const liveCaptionTexts =
    lukeCaptions ?? (liveStripText === undefined ? undefined : [liveStripText]);
  // Words is the resting tone, kept even when nothing is drawn: a chips-only
  // frame still snapshots into the strip hold, and one that defaulted to a
  // coloured tone would paint the empty caption as a status line under a
  // pointer that is only holding chips.
  const captionLiveTone: CaptionTone =
    lukeCaptions !== undefined || liveStripText === undefined
      ? CAPTION_TONE.WORDS
      : voiceErrorNotice !== undefined
        ? CAPTION_TONE.ERROR
        : CAPTION_TONE.NOTICE;

  // The notices: the pressable faces of what the reply being spoken is about
  // — an announcement's one subject, or the several a conversation reply
  // names when "what are we working on?" is answered with a walk through the
  // roster: a chat by its title, a whole workspace by name fronted by its
  // freshest chat, or a tracked issue by identifier or title. Derived, not
  // queued — the subjects arrive with the captions and die with the reply,
  // outliving it only under the strip hold's pointer, so a chip can never
  // lag the words or stand for news Luke is not saying —
  // and each draws only for a session the roster still titles or an issue
  // the tracker still lists, because a press is a row press at one remove
  // and needs a row to stand for. A workspace chip wears the workspace's
  // name, read off the same roster row, so the chip says what the words
  // said; an issue chip wears its identifier and title, because the
  // identifier is what was mentioned. The issues follow the sessions rather
  // than interleaving, because each half keeps its own first-heard order and
  // one band cannot honestly claim an order across the two rosters. The
  // resting shapes draw the band under the housing, and the open panel keeps
  // it at its foot: the rows are up in the list, but the chips are what say
  // which of them Luke is talking about. Only the slot and the composer go
  // without — those are shapes someone asked for.
  const spokenOf: readonly MentionChip[] = [
    ...mentionedSessions.flatMap((mention): readonly MentionChip[] => {
      const session = sessions.find(
        (candidate) =>
          candidate.providerId === mention.providerId &&
          candidate.providerSessionId === mention.providerSessionId,
      );
      if (!session) return [];
      const title =
        mention.kind === SESSION_MENTION_KIND.WORKSPACE && session.workspace?.name !== undefined
          ? session.workspace.name
          : session.title;
      return [
        {
          kind: MENTION_CHIP_KIND.SESSION,
          id: session.providerSessionId,
          markId: session.providerId,
          title,
          identity: {
            providerId: session.providerId,
            providerSessionId: session.providerSessionId,
          },
        },
      ];
    }),
    ...mentionedIssues.map(
      (issue): MentionChip => ({
        kind: MENTION_CHIP_KIND.ISSUE,
        id: issue.identifier,
        markId: issue.trackerId,
        title: `${issue.identifier} — ${issue.title}`,
        identity: { trackerId: issue.trackerId, identifier: issue.identifier },
      }),
    ),
  ];
  const chipsDrawn = spokenOf.length > 0;

  /**
   * The pointer's hold on the strip. The words and the chips leave with the
   * reply that earned them, and a failure leaves on its own clock — but never
   * out from under a pointer resting on them, which is someone mid-read or
   * mid-press on a chip. The hold snapshots exactly what the strip was
   * showing and keeps it drawn until the pointer moves away; it can start
   * nothing, so nothing dismissed before the hover began is ever resurrected.
   */
  const [stripHovered, setStripHovered] = useState(false);
  // Derived in the render, never advanced after paint: the frame that brings
  // a new reply's content composes the hold against that same content, so a
  // held snapshot can never paint one frame beside live words it should have
  // yielded to. The ref carries the previous frame's answer, the way
  // `lastMentioned` carries the band's.
  const stripHoldRef = useRef<SpokenStripContent | undefined>(undefined);
  const stripHold = stripHoldNext({
    hovered: stripHovered,
    drawn:
      liveCaptionTexts === undefined && !chipsDrawn
        ? undefined
        : { texts: liveCaptionTexts, tone: captionLiveTone, chips: chipsDrawn },
    held: stripHoldRef.current,
  });
  stripHoldRef.current = stripHold;

  /**
   * The strip's hoverable boxes, kept current for the window's move listener:
   * the caption block's visible height — zero while no words are drawn, so an
   * invisible block holds nothing — and whether the chip band is drawn, on
   * the same terms. Refs rather than state, because the listener reads them
   * at each move and re-subscribing per frame would be work for nobody.
   */
  const captionHoverHeight = useRef(0);
  const noticeHoverable = useRef(false);
  useEffect(() => {
    // Forwarded moves arrive even while the window is click-through, which is
    // what lets a pointer resting on words that take no pointer be seen here
    // at all.
    const handleMove = (event: MouseEvent) => {
      const caption = captionElement.current;
      const band = noticeBand.current;
      setStripHovered(
        pointOverStrip({
          x: event.clientX,
          y: event.clientY,
          caption:
            caption && captionHoverHeight.current > 0
              ? {
                  box: caption.getBoundingClientRect(),
                  visibleHeight: captionHoverHeight.current,
                }
              : undefined,
          band: band && noticeHoverable.current ? band.getBoundingClientRect() : undefined,
        }),
      );
    };
    const handleLeave = () => setStripHovered(false);
    window.addEventListener("mousemove", handleMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", handleLeave);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      document.documentElement.removeEventListener("mouseleave", handleLeave);
    };
  }, []);

  const noticeShown =
    (chipsDrawn || stripHold?.chips === true) &&
    (presentation === PANEL_PRESENTATION.CAPSULE ||
      presentation === PANEL_PRESENTATION.PEEK ||
      presentation === PANEL_PRESENTATION.PANEL);
  // The last mentioned fields, held so the notices fade out still worded
  // rather than emptying on the frame the reply ends.
  const lastMentioned = useRef<readonly MentionChip[]>([]);
  if (spokenOf.length > 0) {
    lastMentioned.current = spokenOf;
  }
  const noticeChipCount = lastMentioned.current.length;

  /**
   * Which of the band's folds have chips beyond them. A band that scrolls
   * with no edge to say so hides its lower rows silently — the fades these
   * drive are what tell the developer there is more to see. Measured, not
   * derived from the count: the scroll position is the band's own, and only
   * the element can say where it stands. The rows' height is measured
   * beside it, because naturally wrapped chips make however many rows their
   * names need and the shape has to grow to the rows actually made.
   */
  const noticeBand = useRef<HTMLSpanElement | null>(null);
  // The growth is measured off the rows stack inside the band, not the band:
  // the band's box holds every reserved row in every state so its clip can
  // reveal the growth on the shape's own spring, which leaves the inner
  // stack's wrapped height as the only box that says how many rows the chips
  // made.
  const [noticeRowsElement, noticeBandHeight] = useSurfaceHeight();
  /**
   * The measured caption and band heights the shape spends, held through a
   * collapse out of the panel. The compact width lands at the flip and
   * re-wraps the words and the chips while they are still riding down at the
   * panel's foot, and a re-measure landing mid-ride would open the clips and
   * retarget the surface past room nothing has made yet. The collapse
   * travels on the panel's numbers; the compact re-measure lands when the
   * shape has settled, and grows it there the way words arriving at rest do.
   */
  const heldSurfaceSizes = useRef<{ caption?: number; band?: number }>({});
  useEffect(() => {
    if (leavingPanel) return;
    heldSurfaceSizes.current = { caption: captionTextHeight, band: noticeBandHeight };
  });
  const shownCaptionHeight = leavingPanel ? heldSurfaceSizes.current.caption : captionTextHeight;
  const shownBandHeight = leavingPanel ? heldSurfaceSizes.current.band : noticeBandHeight;
  const [noticeFold, setNoticeFold] = useState({ above: false, below: false });
  const measureNoticeFold = useCallback(() => {
    const band = noticeBand.current;
    if (!band) return;
    // Folds only on a band that genuinely scrolls. Subpixel rounding can
    // leave scrollHeight a pixel or two past clientHeight on a band whose
    // chips all fit, and a fold drawn for that fades a chip nobody can
    // scroll to. Real overflow is at least a row of chips; half of one
    // tells the two apart at any display scale.
    const scrollable = band.scrollHeight - band.clientHeight > SESSION_NOTICE_HEIGHT / 2;
    const above = scrollable && band.scrollTop > 1;
    const below = scrollable && band.scrollTop + band.clientHeight < band.scrollHeight - 1;
    setNoticeFold((held) =>
      held.above === above && held.below === below ? held : { above, below },
    );
  }, []);
  // Re-measured when the chips change, when their wrapped height moves, and
  // when the band comes or goes — a scroll left behind by one reply must not
  // start the next mid-list, so a band standing down rewinds to its first
  // row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the chip count and band height are not read here — either changing is the signal the fold moved, because content grows without any scroll event firing.
  useEffect(() => {
    const band = noticeBand.current;
    if (band && !noticeShown) band.scrollTop = 0;
    measureNoticeFold();
  }, [noticeShown, noticeChipCount, noticeBandHeight, measureNoticeFold]);

  /**
   * A notice's press: a row press at one remove. A session its provider
   // SAFETY: The preceding check establishes the asserted contract.
   * gave an address goes to the system, exactly as pressing the row would;
   * one with no address — a local session — has the panel opened instead,
   * where its row is already sorted near the top. Luke keeps talking: the
   * press acts on the session, not on the sentence. Resolved against the
   * roster at the press, because the chip may be one of several and only a
   * session still observed has anywhere to go.
   */
  const openMentionedSession = useCallback(
    (identity: SessionIdentity) => {
      const session = sessions.find(
        (candidate) =>
          candidate.providerId === identity.providerId &&
          candidate.providerSessionId === identity.providerSessionId,
      );
      if (!session) return;
      if (session.detail.link !== undefined) {
        void window.sidecar.openSession(identity);
        return;
      }
      expand();
    },
    [sessions, expand],
  );

  /**
   * A live push beats a bootstrap snapshot still in flight. The main process
   * will not repeat a list it believes it already announced, so the older
   * snapshot must not clobber one that raced past it.
   */
  const acceptProjectsBootstrap = useBootstrapRacedChannel(
    (onChange) => window.sidecar.onWorkspaceProjectsChanged(onChange),
    setWorkspaceProjects,
  );
  // Straight to the conversation rather than through state: no panel
  // surface draws the issue roster, so a re-render would be work for nobody.
  const acceptIssuesBootstrap = useBootstrapRacedChannel(
    (onChange) => window.sidecar.onIssuesChanged(onChange),
    syncIssues,
  );
  // Another window's settings change: this window's rows and guide redraw
  // from the same snapshot its reply carried, so no window describes a
  // state the store no longer holds.
  const acceptSettingsBootstrap = useBootstrapRacedChannel(
    (onChange) =>
      window.sidecar.onSettingsChanged((pushed) => {
        // A push is newer than anything the run is still carrying, so it takes
        // every held snapshot with it: released afterwards, one caught before
        // this arrived would draw the store as it was rather than as it is.
        errandRun.current = supersedeErrandSettings(errandRun.current);
        onChange(pushed);
      }),
    applySettings,
  );
  const acceptAccountBootstrap = useBootstrapRacedChannel(
    (onChange) => window.sidecar.onAccountChanged(onChange),
    setAccount,
  );
  // Where the app stands against the latest release: the timed check's
  // pushes beat a bootstrap snapshot still in flight, like the settings'.
  const acceptUpdateBootstrap = useBootstrapRacedChannel(
    (onChange) => window.sidecar.onUpdateChanged(onChange),
    setUpdate,
  );
  const acceptOutputAudioBootstrap = useBootstrapRacedChannel(
    (onChange) => window.sidecar.onOutputAudioChanged(onChange),
    setOutputAudio,
  );
  // Each connected account's calendars, for the checkboxes on its rows.
  const acceptCalendarsBootstrap = useBootstrapRacedChannel(
    (onChange) => window.sidecar.onCalendarsChanged(onChange),
    setCalendars,
  );
  // Whether the quiet is holding, for the face alone.
  const acceptMeetingQuietBootstrap = useBootstrapRacedChannel(
    (onChange) => window.sidecar.onMeetingQuietChanged(onChange),
    setMeetingQuiet,
  );

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
      openChange: (session) =>
        window.sidecar.openSessionChange({
          providerId: session.providerId,
          providerSessionId: session.id,
        }),
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
      cancelHover();
      void changeMode(presentationOf() !== PANEL_PRESENTATION.PANEL);
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

  useEffect(() => {
    const bootstrapGeneration = modeGenerationOf();
    void window.sidecar.getBootstrap().then((value) => {
      setBootstrap(value);
      setSessions(value.sessions);
      setNoticeAsks(value.noticeAsks);
      // Only fill in what no push has said yet: the bootstrap snapshot is
      // older than any change that raced past it, and the main process will
      // not repeat a list it believes it already announced.
      acceptProjectsBootstrap(value.workspaceProjects);
      acceptIssuesBootstrap(value.issues);
      acceptCalendarsBootstrap(value.calendars);
      acceptMeetingQuietBootstrap(value.meetingQuiet);
      acceptSettingsBootstrap(value.settings);
      acceptAccountBootstrap(value.account);
      acceptUpdateBootstrap(value.update);
      setDisplay(value.display);
      if (modeGenerationOf() === bootstrapGeneration) {
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
          setSettingsView(credentialSettingsPage(firstProvider.id));
          beginEntry(firstProvider.id);
        }
      }
      setMicrophoneStatus(value.microphoneStatus);
      // Only fill in what no push has said yet, like the issue roster: the
      // bootstrap snapshot is older than any change that raced past it.
      if (value.outputAudio) acceptOutputAudioBootstrap(value.outputAudio);
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
      // A spoken feedback request stands the surface straight down to
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
    const removeSessions = window.sidecar.onSessionsChanged(setSessions);
    const removeNoticeAsks = window.sidecar.onNoticeAsksChanged(setNoticeAsks);
    const removeSupersetSignIn = window.sidecar.onSupersetSignInChanged((next) => {
      setSupersetConnected(next.stage === SUPERSET_SIGN_IN_STAGE.CONNECTED);
      if (!supersetSignInHeld.current) return;
      setSupersetSignIn(next);
      if (next.stage !== SUPERSET_SIGN_IN_STAGE.CONNECTED) return;
      supersetSignInHeld.current = false;
      setSupersetConnected(true);
      if (presentationOf() === PANEL_PRESENTATION.SLOT) restorePanel();
    });
    return () => {
      cancelHover();
      removeLifecycle();
      removeDisplay();
      removeSessions();
      removeNoticeAsks();
      removeSupersetSignIn();
      void stopMicrophone();
    };
  }, [
    acceptAccountBootstrap,
    acceptCalendarsBootstrap,
    acceptIssuesBootstrap,
    acceptMeetingQuietBootstrap,
    acceptOutputAudioBootstrap,
    acceptProjectsBootstrap,
    acceptSettingsBootstrap,
    acceptUpdateBootstrap,
    applyAuthoritativeMode,
    applyPresentation,
    beginEntry,
    beginFeedback,
    cancelHover,
    changeTab,
    setMicrophoneStatus,
    setSettingsView,
    startMicrophone,
    stopMicrophone,
    summonAsk,
    modeGenerationOf,
    presentationOf,
    restorePanel,
  ]);

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
   // SAFETY: The preceding check establishes the asserted contract.
   * stay for as long as the silence does, because they are what "got it"
   * leaves the user reading Luke by.
   */
  const dismissVolumeHint = useCallback(() => {
    setHintDismissal({ at: Date.now(), stretch: silenceStretch });
  }, [silenceStretch]);

  // Keep the conversation's view of Luke himself current, so a spoken question
  // about a setting is answered from the value the store actually holds, and a
  // change made in the panel is known to the conversation the moment it lands.
  const publishGuide = useCallback(
    (current: AppSettings) => {
      if (!bootstrap) return;
      const askAccelerator = askHotkeyChange ? askHotkeyChange.accelerator : bootstrap.askHotkey;
      const stopAccelerator = stopHotkeyChange
        ? stopHotkeyChange.accelerator
        : bootstrap.stopHotkey;
      // All three keys reach the guide labelled: it is spoken and read, so a
      // chord belongs there as the one word macOS writes it as rather than as
      // the keys the panel draws apart.
      const talkKey = voiceHotkeyToShow(bootstrap, voiceHotkey);
      const guide = buildLukeGuide({
        account: account ?? bootstrap.account,
        settings: current,
        voiceAvailable: current.voiceAvailable,
        microphoneStatus,
        hotkey: {
          ...(talkKey.hotkey ? { hotkey: voiceHotkeyLabel(talkKey.hotkey) } : undefined),
          held: talkKey.held,
        },
        ...(askAccelerator ? { askKey: voiceHotkeyLabel(askAccelerator) } : undefined),
        ...(stopAccelerator ? { stopKey: voiceHotkeyLabel(stopAccelerator) } : undefined),
      });
      syncGuide(guide);
    },
    [
      bootstrap,
      account,
      microphoneStatus,
      voiceHotkey,
      askHotkeyChange,
      stopHotkeyChange,
      syncGuide,
    ],
  );
  useEffect(() => {
    if (!bootstrap) return;
    publishGuide(settings ?? bootstrap.settings);
  }, [bootstrap, settings, publishGuide]);
  // The spoken carrier publishes the store's answer through this ref the
  // moment the change is made, because the settings state above it is still
  // held for Luke's flight — and identical guides are not resent, so the
  // landing republishing the same snapshot costs nothing.
  useEffect(() => {
    publishGuideRef.current = publishGuide;
  }, [publishGuide]);

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
      if (event.key === "f" && (event.metaKey || event.ctrlKey)) {
        if (presentation !== PANEL_PRESENTATION.PANEL) return;
        event.preventDefault();
        openSearch();
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
      // else it could mean. The sign-in wait and the consent connect borrow
      // the same shape, so the same key withdraws whichever is holding it.
      if (presentation === PANEL_PRESENTATION.SLOT) {
        if (signInWaitNow() !== undefined) cancelSignIn();
        else if (consentConnect.latest()) cancelConsentSignIn();
        else credentialsEntry.cancel();
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
      // time: the options sheet, then the search field, then a settings page
      // back to the front page, then the settings tab, then the panel itself.
      // The search field answers its own Escapes while the caret is in it —
      // clearing before closing — so the press that lands here is one made
      // from elsewhere in the panel, and it closes the field outright.
      if (optionsOpen) setOptionsOpen(false);
      else if (tab === PANEL_TAB.SESSIONS && searchOpen) closeSearch();
      else if (tab === PANEL_TAB.SETTINGS && settingsView !== SETTINGS_VIEW.ROOT) {
        setSettingsView(SETTINGS_VIEW.ROOT);
      } else if (tab === PANEL_TAB.SETTINGS) changeTab(PANEL_TAB.SESSIONS);
      else void changeMode(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    cancelSignIn,
    consentConnect.latest,
    cancelConsentSignIn,
    credentialsEntry.cancel,
    changeMode,
    changeTab,
    closeSearch,
    dismissFeedback,
    discardListening,
    openSearch,
    optionsOpen,
    presentation,
    searchOpen,
    setSettingsView,
    settingsView,
    signInWaitNow,
    stopSpeaking,
    tab,
    voiceStatus,
  ]);

  useEffect(
    () =>
      window.sidecar.onAskHotkeyChanged((accelerator) =>
        setAskHotkeyChange(accelerator ? { accelerator } : undefined),
      ),
    [],
  );
  useEffect(
    () =>
      window.sidecar.onStopHotkeyChanged((accelerator) =>
        setStopHotkeyChange(accelerator ? { accelerator } : undefined),
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

  // How voice stands right now — whose credential it runs on and what remains
  // of a hosted day's allowance — asked while the Settings tab is up. Asked
  // again on every settings change because the answer moves with the key and
  // the account; a call spent while the tab was away is caught by the next
  // change or visit. Gated on the tab alone: the ask is one local IPC round
  // trip answering from memory, and the tab is what decides whether the
  // answer can be seen.
  const [voiceService, setVoiceService] = useState<RealtimeDiagnostics | undefined>();
  const [hostedUsage, setHostedUsage] = useState<HostedUsageAnswer | undefined>();
  // Asked as soon as the app knows itself and again on every settings change,
  // not on the first Settings visit: the answer is one cheap read, and the
  // meters must be standing when the tab opens rather than arriving a blink
  // after it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the settings snapshot is not read here — its arrival is the signal the held answers went stale, because the key or the account may have moved with it.
  useEffect(() => {
    if (!bootstrap) return;
    let stale = false;
    void window.sidecar
      .requestRealtimeDiagnostics()
      .then((report) => {
        if (!stale) setVoiceService(report);
      })
      .catch(() => undefined);
    // An empty answer means two different things, told apart by the settings
    // in hand: with no allowance in play — the key chosen, or voice off — it
    // clears the numbers, because an allowance no longer bought must not keep
    // being shown; while the account is still hosted it is a failed refresh,
    // and the meters keep the last read rather than collapsing to prose over
    // one dropped request. Hosted is the resolved source's answer, because a
    // stored key parked behind the account toggle is still a connected one.
    const snapshot = settings ?? bootstrap.settings;
    const hostedNow = snapshot.voiceAvailable && snapshot.voiceSource === VOICE_SOURCE.ACCOUNT;
    void window.sidecar
      .requestHostedUsage()
      .then((usage) => {
        if (stale) return;
        setHostedUsage((held) => usage ?? (hostedNow ? held : undefined));
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [tab, settings, bootstrap]);

  // The reading the calls move: a mint stores the service's own quota on
  // success and refusal alike, so the moment a call settles is the moment the
  // held diagnostics may be a day fresher than the panel's copy. One local
  // IPC round trip, answered from the main process's memory — the settled
  // statuses are exactly the ones a mint attempt can end on.
  useEffect(() => {
    if (
      voiceStatus !== REALTIME_STATUS.IDLE &&
      voiceStatus !== REALTIME_STATUS.FAILED &&
      voiceStatus !== REALTIME_STATUS.UNAVAILABLE
    ) {
      return;
    }
    let stale = false;
    void window.sidecar
      .requestRealtimeDiagnostics()
      .then((report) => {
        if (!stale) setVoiceService(report);
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [voiceStatus]);

  // Whether voice runs on the account's included allowance right now — the
  // gate every spent-day surface shares, so a key user or a signed-out launch
  // never wears a meter they do not have. Read off the resolved source, not
  // the key's absence: a stored key parked behind the account toggle is still
  // a connected credential, and the allowance is still what a press spends.
  const voiceSettings = settings ?? bootstrap?.settings;
  const hostedVoiceNow =
    voiceSettings?.voiceAvailable === true && voiceSettings.voiceSource === VOICE_SOURCE.ACCOUNT;
  const voiceReading = hostedVoiceReading({
    hosted: hostedVoiceNow,
    usage: hostedUsage?.voice,
    minted: voiceService?.quota,
    now: Date.now(),
  });
  // The spent state stands only while no call is up or opening: the day's
  // last call is still a working conversation, and neither the composer nor
  // the face may say "spent" over an ask that would still be answered. Past
  // the quota's own reset the reading is no reading, so the state lifts on
  // the next render of a fresh day without anyone asking.
  const voiceCallSettled =
    voiceStatus === REALTIME_STATUS.IDLE ||
    voiceStatus === REALTIME_STATUS.FAILED ||
    voiceStatus === REALTIME_STATUS.UNAVAILABLE;
  const voiceSpentNote =
    voiceCallSettled && voiceReading?.remaining === 0
      ? hostedVoiceSpentNote(quotaResetsWhen(voiceReading.resetsAt, Date.now()))
      : undefined;

  // A reset is a moment on a clock, not an event anything else is bound to
  // raise: an idle capsule may see no render between midnight and morning,
  // and a spent face left standing into the fresh day would be the very lie
  // this state exists to prevent. So the reading schedules its own rollover —
  // one timer at its own resetsAt — and the render it forces finds the
  // reading expired and lifts every surface at once.
  const [, forceQuotaRollover] = useState(0);
  const voiceResetsAt = voiceReading?.resetsAt;
  useEffect(() => {
    if (voiceResetsAt === undefined) return;
    // A slack second past the boundary, so a clock answering exactly at the
    // reset cannot re-arm a zero-length timer against the same reading.
    const timer = window.setTimeout(
      () => forceQuotaRollover((tick) => tick + 1),
      Math.max(0, voiceResetsAt - Date.now()) + 1_000,
    );
    return () => window.clearTimeout(timer);
  }, [voiceResetsAt]);

  // The run-out is told once, at the moment it happens: the meter was seen
  // running this session and now stands spent with no call open. A launch
  // into a day already spent announces nothing — the standing surfaces carry
  // it — and the latch re-arms when a fresh day's meter runs again.
  const voiceRanToday = useRef(false);
  useEffect(() => {
    if (voiceReading !== undefined && voiceReading.remaining > 0) {
      voiceRanToday.current = true;
      return;
    }
    if (voiceSpentNote === undefined || !voiceRanToday.current) return;
    voiceRanToday.current = false;
    announceVoiceNotice(voiceSpentNote);
  }, [voiceReading, voiceSpentNote, announceVoiceNotice]);

  if (!bootstrap || !display) return <div />;

  const visibleSessions = displaySessions(bootstrap, sessions, noticeAsks);
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
  // Search is offered on the options' own terms: one session leaves nothing
  // to find that is not already on screen. Its being open goes when its button
  // does — and the query goes with it, by the same rule the emptied filter
  // follows, because a narrowing left in force behind no visible control would
  // hide sessions with nothing admitting it. The tab is not part of this gate:
  // a search held while Settings shows is still the sessions tab's own state,
  // waiting where the developer left it.
  const offerSearch = tab === PANEL_TAB.SESSIONS && list.total > 1;
  if (searchOpen && list.total <= 1) {
    setSearchOpen(false);
    if (sessionView.query !== "") setSessionView({ ...sessionView, query: "" });
  }
  // Which clock the rows' ages are honest against. Fixture observations are
  // measured back from the fixture's own epoch precisely so that no capture
  // run reads them against the time it happened to run at.
  const now = bootstrap.fixtureMode ? FIXTURE_EPOCH_MS : Date.now();
  const shownHotkey = voiceHotkeyToShow(bootstrap, voiceHotkey);
  const shownAskHotkey = askHotkeyChange ? askHotkeyChange.accelerator : bootstrap.askHotkey;
  const shownStopHotkey = stopHotkeyChange ? stopHotkeyChange.accelerator : bootstrap.stopHotkey;
  const hasAudioSignal = fixtureSpeaking || analyser !== undefined;
  const outputIsSilent = outputSilent(outputAudio);
  // Live words win; the held snapshot only ever finishes being read. A held
  // caption is drawn exactly as it was, its tone included.
  const heldCaptionTexts = liveCaptionTexts === undefined ? stripHold?.texts : undefined;
  const captionTexts = liveCaptionTexts ?? heldCaptionTexts;
  const captionTone: CaptionTone =
    liveCaptionTexts !== undefined ? captionLiveTone : (stripHold?.tone ?? CAPTION_TONE.WORDS);
  // Two responses spoken back-to-back stack as two captions: the settled one
  // above, the one still arriving below, in the always-mounted slot the lone
  // caption also uses.
  const settledCaption = captionTexts && captionTexts.length > 1 ? captionTexts.at(-2) : undefined;
  const liveCaption = captionTexts?.at(-1);
  // The hint rides the caption it explains, and only over a silence the
  // helper actually reported. "Got it" quiets it for this stretch of silence
  // and any that follows too soon; the captions above it stay either way.
  const volumeHint =
    fixtureMuted ||
    (outputIsSilent &&
      lukeCaptions !== undefined &&
      !volumeHintDismissed(hintDismissal, silenceStretch, Date.now()));
  // What the hover test may match this frame, now that both are known.
  captionHoverHeight.current =
    captionTexts === undefined || captionTextHeight === undefined
      ? 0
      : captionBlockSize(captionTextHeight, volumeHint, captionPadding);
  noticeHoverable.current = noticeShown;
  const panelOpen = presentation === PANEL_PRESENTATION.PANEL;
  const slotOpen = presentation === PANEL_PRESENTATION.SLOT;
  const feedbackOpen = presentation === PANEL_PRESENTATION.FEEDBACK;

  // What the slot's field is for depends on what answers for that provider now,
  // and settings resolve after the first render.
  const slotSource =
    credentialsEntry.entry && settings
      ? settings.credentialSources[credentialsEntry.entry.providerId]
      : CREDENTIAL_SOURCE.NONE;
  const microphone: MicrophoneControl = {
    status: microphoneStatus,
    voiceAvailable: (settings ?? bootstrap.settings).voiceAvailable,
    onRequest: () => void requestMicrophoneAccess(),
    onOpenSettings: () => window.sidecar.openMicrophoneSettings(),
  };
  const updates: UpdateControl = {
    update: update ?? bootstrap.update,
    // Answered rather than fire-and-forget so the row that asked redraws from
    // the same snapshot the broadcast carries to every other window.
    onCheck: async () => {
      setUpdate(await window.sidecar.checkForUpdates());
    },
    onOpenLatest: () => window.sidecar.openLatestRelease(),
  };
  const preferences: PreferenceWrites = {
    onVoiceCaptionsChange: changeVoiceCaptions,
    onDuckOtherMediaChange: changeDuckOtherMedia,
    onShareUsageDataChange: changeShareUsageData,
    onVoiceSourceChange: changeVoiceSource,
    onPreferBuiltInMicrophoneChange: changePreferBuiltInMicrophone,
    onQuietDuringMeetingsChange: changeQuietDuringMeetings,
    onVoiceChange: changeVoice,
    onVoiceSpeedChange: changeVoiceSpeed,
    onShowInDockChange: changeShowInDock,
    onShowOnAllDisplaysChange: changeShowOnAllDisplays,
    onFormFactorChange: changeFormFactor,
    onDefaultWorkspaceProviderChange: changeDefaultWorkspaceProvider,
    onWorkspaceAgentDefaultChange: changeWorkspaceAgentDefault,
    onWorkspaceProjectDefaultChange: changeWorkspaceProjectDefault,
    onSettingsReset: changeSettingsReset,
  };
  const shortcuts: ShortcutControl = {
    ...(shownHotkey.hotkey ? { voiceHotkey: shownHotkey.hotkey } : undefined),
    voiceHotkeyHeld: shownHotkey.held,
    voiceChosen: settings?.voiceHotkey !== undefined,
    onVoiceHotkeyChange: changeVoiceHotkey,
    // Both rows take the accelerator: they draw the keys apart and
    // label the chord whole for the buttons beside them.
    ...(shownAskHotkey ? { askHotkey: shownAskHotkey } : undefined),
    askChosen: settings?.askHotkey !== undefined,
    onAskHotkeyChange: changeAskHotkey,
    ...(shownStopHotkey ? { stopHotkey: shownStopHotkey } : undefined),
    stopChosen: settings?.stopHotkey !== undefined,
    onStopHotkeyChange: changeStopHotkey,
    onCapture: changeShortcutCapture,
  };

  return (
    <div
      className="app-stage"
      // Whose turn it is, so the capsule can make room for a meter it has to
      // draw beside the face rather than in place of it.
      data-voice={voiceTurn}
      // Whether there are words to draw under the shape — a caption or a
      // failure borrowing its strip — so the surface can grow the room they
      // are drawn in.
      data-caption={String(Boolean(captionTexts))}
      // Whether those words need the volume hint under them, which stands in
      // a band of its own below the caption block.
      data-volume-hint={String(volumeHint)}
      // Whether the reply being spoken has its pressable notices under the
      // housing, and how many chip rows they need. Captioned words drop below
      // them; with captions off the band stands alone.
      data-notice={String(noticeShown)}
      data-presentation={presentation}
      // Whether the shape is still on its way down from the panel, so the
      // surface waits for the content it is carrying instead of leading it.
      data-leaving-panel={String(leavingPanel)}
      data-notch={String(display.notch.hasNotch)}
      data-capture={String(bootstrap.captureMode)}
      style={{
        ...notchStyle(display),
        // One slot shape, three possible occupants: the surface follows the
        // height of whichever is actually drawn.
        ...surfaceHeightStyle(
          panelHeight,
          signInWait !== undefined
            ? signInSlotHeight
            : slotOccupant.current === PANEL_STAND_DOWN.CONSENT ||
                slotOccupant.current === PANEL_STAND_DOWN.SUPERSET
              ? connectHeight
              : slotHeight,
          feedbackHeight,
        ),
        ...captionSizeStyle(shownCaptionHeight, volumeHint, captionPadding),
        ...noticeGrowthStyle(shownBandHeight),
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
            accountRequired={bootstrap.accountRequired}
            account={account ?? bootstrap.account}
            onBeginSignIn={beginSignIn}
            {...(signInFailure ? { signInFailure } : undefined)}
            list={list}
            view={sessionView}
            onViewChange={changeSessionView}
            now={now}
            onOpenSession={openSession}
            writes={sessionWrites}
            ask={askLuke}
            // Reaching for the composer during a spent day is answered before
            // a keystroke: the caret arriving re-announces the spent caption
            // on the strip below, the same sentence the run-out was told with,
            // so the state is read where the reply would land rather than
            // discovered by an ask being refused.
            onAskEngaged={(engaged) => {
              changeAskEngagement(engaged);
              if (engaged && voiceSpentNote) announceVoiceNotice(voiceSpentNote);
            }}
            {...(shownAskHotkey ? { askShortcut: shownAskHotkey } : undefined)}
            offerOptions={offerOptions}
            optionsOpen={optionsOpen}
            onOptionsToggle={() => setOptionsOpen((open) => !open)}
            offerSearch={offerSearch}
            searchOpen={searchOpen}
            onSearchToggle={() => (searchOpen ? closeSearch() : openSearch())}
            onSearchClose={closeSearch}
            tab={tab}
            onTabChange={changeTab}
            settings={{
              account: account ?? bootstrap.account,
              onSignOut: async () => {
                setAccount(await window.sidecar.signOut());
              },
              // The delete happens at the service before anything local moves,
              // so a failure resolves to why and the account is still standing.
              onDeleteAccount: async () => {
                try {
                  setAccount(await window.sidecar.deleteAccount());
                  return undefined;
                } catch {
                  return "Luke's service could not delete the account, so it still stands. Try again in a moment.";
                }
              },
              view: settingsView,
              onViewChange: setSettingsView,
              microphone,
              updates,
              settings,
              ...(voiceService ? { voiceService } : undefined),
              ...(hostedUsage ? { hostedUsage } : undefined),
              preferences,
              credentials,
              feedback: feedbackControl,
              panelOpen,
              workspaceProviders: workspaceProviderOptions,
              calendar: {
                choices: calendars,
                held:
                  credentialsEntry.entry !== undefined ||
                  consentConnect.entry?.serviceId === CONSENT_SERVICE_ID.LINEAR,
                connecting: consentConnect.entry?.serviceId === CONSENT_SERVICE_ID.GOOGLE_CALENDAR,
                onSignIn: () => beginConsentSignIn(CONSENT_SERVICE_ID.GOOGLE_CALENDAR),
                onRemoveAccount: removeCalendarAccount,
                onToggleCalendar: toggleCalendarSelected,
              },
              linear: {
                held:
                  credentialsEntry.entry !== undefined ||
                  consentConnect.entry?.serviceId === CONSENT_SERVICE_ID.GOOGLE_CALENDAR,
                connecting: consentConnect.entry?.serviceId === CONSENT_SERVICE_ID.LINEAR,
                onSignIn: () => beginConsentSignIn(CONSENT_SERVICE_ID.LINEAR),
                onDisconnect: disconnectLinear,
              },
              superset: (() => {
                const supersetAgentDefault = (settings ?? bootstrap.settings).supersetAgentDefault;
                const superset: SupersetControl = {
                  installed: bootstrap.supersetInstalled,
                  connected: supersetConnected ?? bootstrap.supersetConnected,
                  held: credentialHeld.current || consentConnectHeld.current,
                  connecting: supersetSignInHeld.current,
                  onConnect: beginSupersetSignIn,
                  onDisconnect: disconnectSuperset,
                  agents: [
                    ...new Set(
                      workspaceProjects
                        .filter((project) => project.providerId === SUPERSET_WORKSPACE_PROVIDER_ID)
                        .flatMap((project) => project.spawnableAgents ?? []),
                    ),
                  ],
                  onDefaultAgentChange: changeSupersetAgentDefault,
                };
                if (supersetAgentDefault) {
                  superset.defaultAgent = supersetAgentDefault;
                }
                return superset;
              })(),
              onQuit: () => window.sidecar.quit(),
              shortcuts,
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
      {signInWait === undefined ? (
        <>
          <KeySlot
            control={credentials}
            source={slotSource}
            drawn={slotOpen && slotOccupant.current === PANEL_STAND_DOWN.KEY}
            measure={slotElement}
          />
          {/* The panel stood down while a consent sign-in waits on the
              browser, on the key slot's exact terms. */}
          <ConsentConnectSlot
            entry={consentConnect.entry}
            drawn={slotOpen && slotOccupant.current === PANEL_STAND_DOWN.CONSENT}
            onCancel={cancelConsentSignIn}
            onReopen={() => {
              // The page reopened is the one the waiting flow built, named by
              // the service the entry says is waiting — no address from here.
              if (consentConnect.latest()?.serviceId === CONSENT_SERVICE_ID.LINEAR) {
                window.sidecar.reopenLinearSignIn();
              } else {
                window.sidecar.reopenGoogleCalendarSignIn();
              }
            }}
            measure={connectElement}
          />
          {supersetSignInHeld.current ? (
            <SupersetSignInSlot
              state={supersetSignIn}
              drawn={slotOpen && slotOccupant.current === PANEL_STAND_DOWN.SUPERSET}
              onSubmit={(code) => void window.sidecar.submitSupersetSignInCode(code)}
              onReopen={() => window.sidecar.reopenSupersetSignIn()}
              onCancel={cancelSupersetSignIn}
              onRetry={beginSupersetSignIn}
              onChooseOrganization={(slug) => void window.sidecar.chooseSupersetOrganization(slug)}
              measure={connectElement}
            />
          ) : null}
        </>
      ) : null}
      {credentialsEntry.entry === undefined && consentConnect.entry === undefined ? (
        /* The panel stood down to the account sign-in it is waiting on. */
        <SignInSlot
          {...(signInWait ? { provider: signInWait } : undefined)}
          drawn={slotOpen}
          onCancel={cancelSignIn}
          measure={signInSlotElement}
        />
      ) : null}
      {/* The panel stood down to the composer, on the same terms. */}
      <FeedbackSlot
        control={feedbackControl}
        drawn={feedbackOpen}
        measure={feedbackElement}
        confirming={feedbackConfirming}
        still={stillMotion}
      />
      {/* Luke's own voice. Muted playback would defeat the point, so this is
          the one element allowed to make sound. */}
      <audio ref={remoteAudio} autoPlay hidden>
        <track kind="captions" />
      </audio>

      <NotchWings
        tally={tally}
        analyser={analyser}
        onVoiceActivity={handleVoiceActivity}
        {...(voiceTurn ? { voice: voiceTurn } : undefined)}
        fixtureSpeaking={fixtureSpeaking}
        hasAudioSignal={hasAudioSignal}
        voiceOpening={talkOpening}
        meetingQuiet={meetingQuiet}
        voiceSpent={voiceSpentNote !== undefined}
        presentation={presentation}
        housingWidth={display.notch.housingWidth}
        accountGated={accountGated}
      />

      {/* The one signed-out Luke. Like the caption, he is a single element in
          every state so the morph carries him instead of trading two copies:
          over the gate's reserved box while the panel is up, and down to the
          peek's strip — the wing spot the authed face holds — when it closes.
          Keyed on the play so each gesture of the introduction cycle is a
          // SAFETY: The preceding check establishes the asserted contract.
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
        {...(errand ? { errand } : undefined)}
        onLanded={releaseErrandChange}
        onReturned={finishErrandFlight}
      />

      {/* Luke's words while he says them: one element in every state, under
          the housing while the shape is compact and carried to the panel's
          foot when it opens, so the words travel with the morph instead of
          jumping between two copies. Not in a wing — the wings clip at the
          capsule's height — and always mounted, like the count's caption, so
          both edges of its fade can run. The inner stack is what is measured —
          two responses spoken back-to-back are two blocks in it, the settled
          words above the ones still arriving — and its wrapped height is the
          only honest answer to how much room the words need. The newest block
          is always mounted like the stack itself; the settled one mounts only
          while it has words, so a lone reply pays no gap for a block that is
          not there. Hidden from readers while it captions speech — it
          // SAFETY: The preceding check establishes the asserted contract.
          duplicates what is already audible — and announced as a status line
          when it carries a failure or a notice, which was never audible at
          all. */}
      <span
        className="voice-caption"
        ref={captionElement}
        data-tone={captionTone}
        {...(captionTone !== CAPTION_TONE.WORDS ? { role: "status" } : { "aria-hidden": true })}
      >
        <span className="voice-caption-stack" ref={captionTextElement}>
          {settledCaption === undefined ? null : (
            <span className="voice-caption-text">{settledCaption}</span>
          )}
          <span className="voice-caption-text">{liveCaption}</span>
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

      {/* The sessions Luke is talking about, pressable while he says them: an
          announcement names one, and a conversation reply walking the roster
          names several, each with a chip of its own on the same band. One
          press, and it is a row press at one remove — the session opens where
          its provider keeps it, or the panel comes forward for one with no
          page of its own. The band is always mounted, like the caption, so
          both edges of its fade can run, and holds the last mentioned fields
          through its exit so the names leave in place. Inert while away so
          nothing hidden can be pressed or tabbed to; each chip's own hit
          // SAFETY: The preceding check establishes the asserted contract.
          region keeps the pointer resting on it from reading as leaving the
          shape. */}
      <span
        className="session-notices"
        ref={noticeBand}
        inert={!noticeShown}
        // The folds: which edges have chips beyond them, driving the fades
        // that say the band scrolls. Both settle to false while everything
        // fits, so a band of few chips wears no mask at all.
        data-fold-above={String(noticeFold.above)}
        data-fold-below={String(noticeFold.below)}
        onScroll={measureNoticeFold}
      >
        <span className="session-notice-rows" ref={noticeRowsElement}>
          {lastMentioned.current.map((mention) => (
            <button
              key={mention.id}
              type="button"
              className="session-notice"
              data-hit-region={HIT_REGION.CAPSULE}
              aria-label={`Open "${mention.title}"`}
              // Keeps the press from moving focus here, like the capsule strip's
              // own button, so a focused settings field keeps the caret.
              onMouseDown={(event) => event.preventDefault()}
              // An issue chip is the same press one roster over: the identity
              // goes to the main process, which reads the tracker's own address
              // back out of its observation and hands it to the system — and an
              // issue that reported none is taken nowhere, because no panel
              // surface holds a row to fall back to.
              onClick={() =>
                mention.kind === MENTION_CHIP_KIND.SESSION
                  ? openMentionedSession(mention.identity)
                  : void window.sidecar.openIssue(mention.identity)
              }
            >
              <ProviderMark providerId={mention.markId} />
              <span className="session-notice-name">{mention.title}</span>
            </button>
          ))}
        </span>
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
