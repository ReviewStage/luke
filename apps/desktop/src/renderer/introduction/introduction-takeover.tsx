import { FIXTURE_EPOCH_MS } from "@sidecar/fixtures";
import { WingFace as LukeFace } from "@sidecar/panel";
import { introductionSessionConfig, REALTIME_STATUS, type RealtimeStatus } from "@sidecar/realtime";
import { DEFAULT_VOICE_HOTKEYS, TALK_KEY_RELEASE, talkKeyRelease } from "@sidecar/settings";
import {
  FACE_MOTION,
  FACE_MOTION_CYCLE_MS,
  type FaceMotion,
  SESSION_URGENCY,
  urgencyLabel,
  WORDMARK_ART,
} from "@sidecar/surface";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type { AppBootstrap } from "#shared/wire/session";
import { Keycaps } from "../keycaps";
import { usePrefersReducedMotion } from "../luke-face-mood";
import { openPreferredMicrophone } from "../microphone-choice";
import { NotchWings } from "../notch-wings";
import { SessionRow, type SessionWriteHandlers } from "../panel-body";
import { PANEL_PRESENTATION } from "../panel-state";
import { RealtimeVoiceSession } from "../realtime-session";
import { displaySessions, type SessionView, sessionTally, tallySummary } from "../session-model";
import { parseMilliseconds, useSessionReorderMotion } from "../session-motion";
import { MicrophoneIcon } from "../settings-icons";
import { useSignInFaceCycle } from "../sign-in-gate";
import { useMeasuredHeight } from "../use-measured-height";
import { activeVoiceStream } from "../use-voice-conversation";
import { outputSilent } from "../volume-hint";
import { WAVEFORM_VOICE, Waveform, type WaveformVoice } from "../waveform";
import { IntroductionAudio } from "./introduction-audio";
import {
  INTRODUCTION_BEAT,
  INTRODUCTION_EVENT,
  INTRODUCTION_SCRIPT,
  INTRODUCTION_SPOKEN_SESSION_LIMIT,
  type IntroductionBeat,
  type IntroductionEvent,
  nextIntroductionBeat,
} from "./introduction-beats";
import { capsuleFaceCenter, FLIGHT_LANDING_SIZE } from "./introduction-flight";

/** How many pretend rows stand in when the peek finds nothing. */
const PRETEND_ROW_COUNT = 4;
/** How long the practice beat waits for an ask before moving on. */
const PRACTICE_TIMEOUT_MS = 45_000;
/** How the takeover retries a line the call was not ready for. Patient on
 * purpose: the wake no longer waits for the call, so the first line may
 * arrive while the handshake is still running and must outwait it. */
const SPEAK_RETRY_MS = 350;
const SPEAK_RETRY_ATTEMPTS = 30;
/** How long the dark holds before the wake, voice ready or not. */
const DARK_HOLD_MS = 900;
/** How patiently the dark waits for the voice before standing the takeover down. */
const CONNECT_ATTEMPTS = 3;
const CONNECT_RETRY_MS = 1_500;
/** The bell leads the wake's end by the eyes' opening, not the head's settle. */
const WAKE_BELL_LEAD_MS = 600;

/**
 * The signature reveal's layout, as fractions of the drawn face's size: the
 * face element is the one sized thing on the dark stage, so the letters' box
 * and the lockup's centring shift both scale from it, in CSS, whatever the
 * viewport's clamp resolves to. The lockup units come from the same generated
 * table the face is drawn from.
 */
const WORDMARK_FRACTION = {
  left:
    (WORDMARK_ART.LETTERS_BOX.X - WORDMARK_ART.FACE_VIEW.CENTER_X) / WORDMARK_ART.FACE_VIEW.SIZE,
  top: (WORDMARK_ART.LETTERS_BOX.Y - WORDMARK_ART.FACE_VIEW.CENTER_Y) / WORDMARK_ART.FACE_VIEW.SIZE,
  width: WORDMARK_ART.LETTERS_BOX.WIDTH / WORDMARK_ART.FACE_VIEW.SIZE,
  height: WORDMARK_ART.LETTERS_BOX.HEIGHT / WORDMARK_ART.FACE_VIEW.SIZE,
  shift: (WORDMARK_ART.CENTER_X - WORDMARK_ART.FACE_VIEW.CENTER_X) / WORDMARK_ART.FACE_VIEW.SIZE,
} as const;

/**
 * The signature's pen clock, over the wake gesture (luke-wake, 2.8s cycle):
 * the pen touches down once the eyes are open, spends the write time across
 * the strokes — each taking its share of the written length, a constant-speed
 * pen — and lifts briefly between strokes, a little longer between letters,
 * finishing as the wake hands over to "Hi! I'm Luke."
 */
const SIGNATURE_CLOCK = {
  PEN_DOWN_S: 1.5,
  WRITE_S: 1.4,
  LIFT_S: 0.05,
  CARRY_S: 0.1,
} as const;

function signatureStrokes(): readonly { d: string; delayS: number; drawS: number }[] {
  const strokes: { d: string; delayS: number; drawS: number }[] = [];
  let at = SIGNATURE_CLOCK.PEN_DOWN_S;
  WORDMARK_ART.LETTERS.forEach((letter, index) => {
    if (index > 0) at += SIGNATURE_CLOCK.CARRY_S - SIGNATURE_CLOCK.LIFT_S;
    for (const stroke of letter) {
      const drawS = SIGNATURE_CLOCK.WRITE_S * stroke.WEIGHT;
      strokes.push({ d: stroke.D, delayS: at, drawS });
      at += drawS + SIGNATURE_CLOCK.LIFT_S;
    }
  });
  return strokes;
}

/** Every stroke of U-K-E in writing order, with its own delay and draw time. */
const SIGNATURE_STROKES = signatureStrokes();

/**
 * The rows the introduction stages are pictures of sessions, not handles to
 * them: nothing on them may open, message, or act. The stripping below is
 * what guarantees these handlers are never called; they answer anyway, with
 * a refusal, so a slip is a wrong sentence rather than a wrong act.
 */
const INTRODUCTION_REFUSAL = "The introduction takes no writes.";
const INERT_WRITES: SessionWriteHandlers = {
  sendMessage: async () => ({ status: ACT_RESULT_STATUS.REJECTED, reason: INTRODUCTION_REFUSAL }),
  runAction: async () => ({ status: ACT_RESULT_STATUS.REJECTED, reason: INTRODUCTION_REFUSAL }),
  openChange: async () => ({ status: ACT_RESULT_STATUS.REJECTED, reason: INTRODUCTION_REFUSAL }),
};

function inertRow(row: SessionView): SessionView {
  return {
    ...row,
    openable: false,
    canMessage: false,
    actions: [],
    hasChange: false,
    applications: row.applications.map((application) => ({ ...application, openable: false })),
  };
}

/** The beats after the flight has left the dark stage for the notch. */
const FLOWN_BEATS: ReadonlySet<IntroductionBeat> = new Set([
  INTRODUCTION_BEAT.FLIGHT,
  INTRODUCTION_BEAT.GLIDE,
  INTRODUCTION_BEAT.TOUR,
  INTRODUCTION_BEAT.MICROPHONE,
  INTRODUCTION_BEAT.MICROPHONE_DIALOG,
  INTRODUCTION_BEAT.MICROPHONE_DENIED,
  INTRODUCTION_BEAT.PRACTICE,
  INTRODUCTION_BEAT.SIGN_OFF,
  INTRODUCTION_BEAT.STAND_DOWN,
  INTRODUCTION_BEAT.DONE,
]);

/**
 * The beats the flight has settled through: the real wings take the strip —
 * face, meter, and count, the same component the app itself draws — and the
 * flight's own face stands down, having landed on the spot the wings' face
 * now holds.
 */
const LANDED_BEATS: ReadonlySet<IntroductionBeat> = new Set([
  INTRODUCTION_BEAT.TOUR,
  INTRODUCTION_BEAT.MICROPHONE,
  INTRODUCTION_BEAT.MICROPHONE_DIALOG,
  INTRODUCTION_BEAT.MICROPHONE_DENIED,
  INTRODUCTION_BEAT.PRACTICE,
  INTRODUCTION_BEAT.SIGN_OFF,
  INTRODUCTION_BEAT.STAND_DOWN,
  INTRODUCTION_BEAT.DONE,
]);

/**
 * The two closing beats: the panel stood down to the capsule — gated wings,
 * the real sign-in Luke at the wing spot — which is exactly the compact
 * signed-out panel the handoff swaps in beneath.
 */
const STANDING_DOWN_BEATS: ReadonlySet<IntroductionBeat> = new Set([
  INTRODUCTION_BEAT.STAND_DOWN,
  INTRODUCTION_BEAT.DONE,
]);

/**
 * The one-time fullscreen introduction. Entirely spoken: the script's lines
 * are directions to the voice, never text on screen, and the one text drawn
 * beside the sign-in controls is the caption strip, forced on exactly where
 * the app itself forces it — when the machine's output is silent, where the
 * caption is the speech. The voice call behind it is the introduction's own:
 * minted without an account, tool-free at the API, carrying nothing but the
 * script and the detected sessions' titles as data. What lands at the top of
 * the screen is the app's own furniture — the panel's session rows, the
 * wings, the sign-in gate — so the handoff to the real panel changes nothing
 * the developer can see.
 */
export function IntroductionTakeover({
  bootstrap,
}: {
  bootstrap: AppBootstrap;
}): React.JSX.Element {
  const [beat, setBeat] = useState<IntroductionBeat>(INTRODUCTION_BEAT.DARK);
  const beatRef = useRef<IntroductionBeat>(beat);
  const [voiceStatus, setVoiceStatus] = useState<RealtimeStatus>(REALTIME_STATUS.IDLE);
  const [localStream, setLocalStream] = useState<MediaStream | undefined>(undefined);
  const [remoteStream, setRemoteStream] = useState<MediaStream | undefined>(undefined);
  const [meterAnalyser, setMeterAnalyser] = useState<AnalyserNode | undefined>(undefined);
  const [rows, setRows] = useState<readonly SessionView[]>([]);
  const [rowsPretend, setRowsPretend] = useState(false);
  /**
   * The row the tour's staged moment is drawn on: one of the detected rows,
   * picked from the middle so the reorder is seen. The flip is a picture —
   * every staged row is inert by construction, so nothing of the session
   * behind it changes — and it is restored the moment the beat ends.
   */
  const [tourFlipId, setTourFlipId] = useState<string | undefined>(undefined);
  const [captions, setCaptions] = useState<readonly string[] | undefined>(undefined);
  const [flightStyle, setFlightStyle] = useState<CSSProperties>({});
  /** Whether the handoff's fade is running — the real panel is drawn beneath. */
  const [handoffFading, setHandoffFading] = useState(false);
  /** The drawn keycaps mirror the developer's own hands on the talk key. */
  const [talkHeld, setTalkHeld] = useState(false);

  const sessionRef = useRef<RealtimeVoiceSession | undefined>(undefined);
  const audioRef = useRef<IntroductionAudio | undefined>(undefined);
  /** The meter's own graph, reading levels only — nothing reaches a speaker. */
  const meterContextRef = useRef<AudioContext | undefined>(undefined);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const faceRef = useRef<HTMLSpanElement | null>(null);
  const panelGroupRef = useRef<HTMLDivElement | null>(null);
  /** The panel's own FLIP motion, so the tour's reorder travels like a re-sort. */
  const rowsListRef = useSessionReorderMotion();
  /**
   * The real surface's measured height, the same contract the app keeps:
   * content lands in the layout at once, the measure follows it, and the
   * surface takes one clean spring to the new number.
   */
  const [panelHeight, setPanelHeight] = useState(0);
  useEffect(() => {
    const group = panelGroupRef.current;
    if (!group) return;
    const observer = new ResizeObserver(() => {
      setPanelHeight(Math.ceil(group.getBoundingClientRect().height));
    });
    observer.observe(group);
    return () => observer.disconnect();
  }, []);
  /** The microphone wait's own pill, measured so the surface ends where it does. */
  const [slotElement, slotHeight] = useMeasuredHeight();
  /** The current beat's remaining lines, and what to do when the last one ends. */
  const lineQueueRef = useRef<readonly string[]>([]);
  const afterLinesRef = useRef<(() => void) | undefined>(undefined);
  /** Whether the practice beat has heard a real ask committed. */
  const practiceAskedRef = useRef(false);
  /**
   * Whether the introduction was actually given — the sign-off spoken to its
   * end. A glide past a voice that never stood up hands off the same way but
   * marks nothing, so the introduction still plays for real on a later launch.
   */
  const givenRef = useRef(false);
  /** The talk key's latch, the same tap-to-latch the app's own key keeps. */
  const latchedRef = useRef(false);
  const heldSinceRef = useRef(0);
  /** Whether the connect loop has delivered its verdict, ready or failed. */
  const connectSettledRef = useRef(false);

  const reducedMotion = usePrefersReducedMotion();

  const dispatch = useCallback((event: IntroductionEvent) => {
    setBeat((current) => {
      const next = nextIntroductionBeat(current, event);
      beatRef.current = next;
      return next;
    });
  }, []);

  const audio = useCallback((): IntroductionAudio => {
    // Built against the output as bootstrapped: playing a room tone into a
    // muted Mac serves nobody, and the captions are the speech there.
    audioRef.current ??= new IntroductionAudio(!outputSilent(bootstrap.outputAudio));
    return audioRef.current;
  }, [bootstrap]);

  /**
   * Speaks one direction, retrying briefly while the call settles between
   * turns. A line the call never takes fails the voice rather than hanging
   * the beat — the table decides what a failed voice means where. One pending
   * retry at a time: a new line supersedes the old chain, a beat change
   * orphans it (the beat captured at scheduling no longer stands), and the
   * unmount cleanup clears it, so no retry outlives what asked for it.
   */
  const speakRetryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const trySpeak = useCallback(
    (line: { direction: string; data?: readonly string[] }, attempts = SPEAK_RETRY_ATTEMPTS) => {
      if (speakRetryTimerRef.current !== undefined) {
        clearTimeout(speakRetryTimerRef.current);
        speakRetryTimerRef.current = undefined;
      }
      const session = sessionRef.current;
      if (session?.speakIntroduction(line)) return;
      if (attempts > 0) {
        const beatAtSchedule = beatRef.current;
        speakRetryTimerRef.current = setTimeout(() => {
          speakRetryTimerRef.current = undefined;
          if (beatRef.current !== beatAtSchedule) return;
          trySpeak(line, attempts - 1);
        }, SPEAK_RETRY_MS);
        return;
      }
      dispatch(INTRODUCTION_EVENT.VOICE_FAILED);
    },
    [dispatch],
  );

  const speakLines = useCallback(
    (lines: readonly string[], data: readonly string[] | undefined, after: () => void) => {
      const [first, ...rest] = lines;
      if (first === undefined) {
        after();
        return;
      }
      lineQueueRef.current = rest;
      afterLinesRef.current = after;
      trySpeak(data ? { direction: first, data } : { direction: first });
    },
    [trySpeak],
  );

  const ensureSession = useCallback((): RealtimeVoiceSession => {
    sessionRef.current ??= new RealtimeVoiceSession({
      requestConnection: () => window.sidecar.requestRealtimeCredential(),
      sessionConfig: (model) => introductionSessionConfig({ model }),
      audioElement: () => remoteAudioRef.current,
      requestMicrophoneStream: () =>
        openPreferredMicrophone({
          route: () => window.sidecar.getMicrophoneRoute(),
          enumerate: () => navigator.mediaDevices.enumerateDevices(),
          open: (audioConstraints) =>
            navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false }),
        }),
      onStatus: (status) => {
        setVoiceStatus(status);
        // While the connect loop runs it owns the verdict — it retries a
        // failed mint before giving up, and a failure dispatched here would
        // abandon the introduction on the first attempt.
        if (!connectSettledRef.current) return;
        if (status === REALTIME_STATUS.FAILED || status === REALTIME_STATUS.UNAVAILABLE) {
          dispatch(INTRODUCTION_EVENT.VOICE_FAILED);
        }
      },
      onLocalStream: (stream) => setLocalStream(stream),
      onRemoteStream: (stream) => {
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream ?? null;
        setRemoteStream(stream);
      },
      onError: () => undefined,
      onCaption: (texts) => setCaptions(texts),
      // Advancement rides the settled signal rather than the words: a reply
      // the server failed or answered without a transcript still concludes,
      // and a beat waiting on its words alone would wait forever.
      onReplySettled: () => {
        const [next, ...rest] = lineQueueRef.current;
        if (next !== undefined) {
          lineQueueRef.current = rest;
          trySpeak({ direction: next });
          return;
        }
        const after = afterLinesRef.current;
        afterLinesRef.current = undefined;
        if (after) {
          after();
          return;
        }
        // A reply with no line behind it is the practice exchange's answer,
        // and the answer ending is what moves the flow on — no waiting.
        if (beatRef.current === INTRODUCTION_BEAT.PRACTICE && practiceAskedRef.current) {
          dispatch(INTRODUCTION_EVENT.PRACTICE_DONE);
        }
      },
    });
    return sessionRef.current;
  }, [dispatch, trySpeak]);

  // The whole flow's standing wiring: the call opening in the background under
  // the dark, the account landing that completes it from anywhere, and the
  // talk key the main process routes here for the introduction's duration.
  useEffect(() => {
    // Tells the main process this surface mounted: the deadline that abandons
    // a takeover whose renderer never drew is measured against this report.
    window.sidecar.introductionMounted();
    const session = ensureSession();
    let gone = false;
    // The dark is the one moment with room to be patient: a mint that failed
    // on a network blip is retried before the whole introduction is given up,
    // while a service that genuinely cannot answer still fails in seconds.
    const connectUnderTheDark = async () => {
      for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
        const opened = await session.connect({ microphone: true });
        if (gone) return;
        if (opened) {
          connectSettledRef.current = true;
          dispatch(INTRODUCTION_EVENT.VOICE_READY);
          return;
        }
        if (attempt < CONNECT_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_MS));
          if (gone) return;
        }
      }
      connectSettledRef.current = true;
      dispatch(INTRODUCTION_EVENT.VOICE_FAILED);
    };
    void connectUnderTheDark();
    // The wake need not wait for the network: the dark holds a beat of its
    // own and Luke wakes into a call still connecting; the first spoken line
    // is what waits, retrying until the call stands.
    const darkTimer = setTimeout(() => dispatch(INTRODUCTION_EVENT.DARK_SETTLED), DARK_HOLD_MS);
    const unsubscribePress = window.sidecar.onVoiceHotkeyPress(() => {
      if (beatRef.current !== INTRODUCTION_BEAT.PRACTICE) return;
      // A latched turn is already open; this press says done — the release owns it.
      if (latchedRef.current) return;
      heldSinceRef.current = Date.now();
      setTalkHeld(true);
      ensureSession().beginTurn();
    });
    const unsubscribeRelease = window.sidecar.onVoiceHotkeyRelease(() => {
      if (beatRef.current !== INTRODUCTION_BEAT.PRACTICE) return;
      // A release with no press behind it — the key was already down when the
      // beat began — holds no turn to send.
      if (heldSinceRef.current === 0 && !latchedRef.current) return;
      const release = talkKeyRelease({
        heldMs: Date.now() - heldSinceRef.current,
        latched: latchedRef.current,
      });
      // A latched turn keeps the caps pressed: the floor is still theirs.
      if (release === TALK_KEY_RELEASE.LATCH) {
        latchedRef.current = true;
        return;
      }
      latchedRef.current = false;
      heldSinceRef.current = 0;
      practiceAskedRef.current = true;
      setTalkHeld(false);
      ensureSession().endTurn(true);
    });
    return () => {
      gone = true;
      clearTimeout(darkTimer);
      unsubscribePress();
      unsubscribeRelease();
      if (speakRetryTimerRef.current !== undefined) clearTimeout(speakRetryTimerRef.current);
      void session.close();
      audioRef.current?.dispose();
      void meterContextRef.current?.close().catch(() => undefined);
      meterContextRef.current = undefined;
    };
  }, [dispatch, ensureSession]);

  // The meter reads whoever holds the floor, exactly as the app's own does:
  // Luke's stream while he replies, the developer's while a practice turn is
  // held, and nothing between turns.
  const meterStream = activeVoiceStream({
    status: voiceStatus,
    local: localStream,
    remote: remoteStream,
  });
  useEffect(() => {
    if (!meterStream) {
      setMeterAnalyser(undefined);
      return;
    }
    const context = meterContextRef.current ?? new AudioContext({ latencyHint: "interactive" });
    meterContextRef.current = context;
    // A suspended context reads a flatline; resuming is a no-op when running.
    if (context.state === "suspended") void context.resume();
    const source = context.createMediaStreamSource(meterStream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    source.connect(analyser);
    setMeterAnalyser(analyser);
    return () => {
      source.disconnect();
      setMeterAnalyser(undefined);
    };
  }, [meterStream]);

  // What each beat does on arrival. The clocks live here; the order lives in
  // the transition table.
  useEffect(() => {
    switch (beat) {
      case INTRODUCTION_BEAT.WAKE: {
        const cycleMs = reducedMotion ? 500 : FACE_MOTION_CYCLE_MS.wake;
        const bellTimer = setTimeout(
          () => audio().bell(),
          Math.max(0, cycleMs - WAKE_BELL_LEAD_MS),
        );
        const doneTimer = setTimeout(() => dispatch(INTRODUCTION_EVENT.WAKE_DONE), cycleMs + 150);
        return () => {
          clearTimeout(bellTimer);
          clearTimeout(doneTimer);
        };
      }
      case INTRODUCTION_BEAT.HELLO: {
        speakLines(INTRODUCTION_SCRIPT.HELLO, undefined, () =>
          dispatch(INTRODUCTION_EVENT.LINES_DONE),
        );
        return;
      }
      case INTRODUCTION_BEAT.DETECT: {
        let stale = false;
        const stage = (detected: readonly Parameters<typeof displaySessions>[1][number][]) => {
          if (stale) return;
          const found = detected.length > 0;
          const mapped = found
            ? displaySessions({ ...bootstrap, fixtureMode: false }, detected)
            : displaySessions({ ...bootstrap, fixtureMode: true }, []).slice(0, PRETEND_ROW_COUNT);
          const staged = mapped.map(inertRow);
          setRows(staged);
          setRowsPretend(!found);
          // Titles alone travel — the one observed thing the introduction's
          // bounds allow on the wire; the providers stay on the screen, and
          // however long the drawn list scrolls, only the first few titles
          // leave the machine.
          speakLines(
            found ? INTRODUCTION_SCRIPT.DETECT_FOUND : INTRODUCTION_SCRIPT.DETECT_PRETEND,
            found
              ? staged.slice(0, INTRODUCTION_SPOKEN_SESSION_LIMIT).map((row) => row.title)
              : undefined,
            () => dispatch(INTRODUCTION_EVENT.LINES_DONE),
          );
        };
        window.sidecar.peekIntroductionSessions().then(stage, () => stage([]));
        return () => {
          stale = true;
        };
      }
      case INTRODUCTION_BEAT.GLIDE:
      case INTRODUCTION_BEAT.FLIGHT: {
        // The dark lifts under the sweep, and the landing chimes when the
        // wings take the strip. The panel travels on its own CSS spring; only
        // Luke's leap needs measuring, because he lands on the exact spot and
        // size of the capsule's wing face — the spot the real wings' face
        // takes over the moment the flight settles.
        audio().sweep();
        const root = rootRef.current;
        const target = capsuleFaceCenter({
          viewportWidth: window.innerWidth,
          housingWidth: bootstrap.display.notch.housingWidth,
          topInset: bootstrap.display.notch.topInset,
        });
        const faceRect = faceRef.current?.getBoundingClientRect();
        setFlightStyle(
          cssCustomProperties({
            "--flight-x": `${faceRect ? target.x - (faceRect.left + faceRect.width / 2) : 0}px`,
            "--flight-y": `${faceRect ? target.y - (faceRect.top + faceRect.height / 2) : 0}px`,
            "--flight-scale": faceRect ? FLIGHT_LANDING_SIZE / faceRect.width : 1,
          }),
        );
        const flightMs = root
          ? parseMilliseconds(getComputedStyle(root).getPropertyValue("--duration-shape"))
          : 0;
        const timer = setTimeout(() => {
          audio().arrive();
          dispatch(INTRODUCTION_EVENT.FLIGHT_SETTLED);
        }, flightMs + 160);
        return () => clearTimeout(timer);
      }
      case INTRODUCTION_BEAT.TOUR: {
        // The staged moment plays on one of the rows already standing — from
        // the middle of the list, so the ride to the top is seen. The rows
        // are inert pictures, so the flip changes nothing of the session
        // behind it, and the beat's cleanup restores the picture. Where Luke
        // lives is said first — now that he lives there — and the line's own
        // length is the beat the list holds before its flip.
        speakLines(INTRODUCTION_SCRIPT.TOUR_HOME, undefined, () => {
          if (beatRef.current !== INTRODUCTION_BEAT.TOUR) return;
          setRows((current) => {
            const middle = current[Math.floor((current.length - 1) / 2)];
            setTourFlipId(middle?.id);
            return current;
          });
          audio().ding();
          speakLines(INTRODUCTION_SCRIPT.TOUR, undefined, () =>
            dispatch(INTRODUCTION_EVENT.LINES_DONE),
          );
        });
        return () => setTourFlipId(undefined);
      }
      case INTRODUCTION_BEAT.MICROPHONE: {
        if (bootstrap.microphoneStatus === "granted") {
          dispatch(INTRODUCTION_EVENT.MICROPHONE_GRANTED);
          return;
        }
        if (bootstrap.microphoneStatus !== "not-determined") {
          // Denied before Luke ever asked: no dialog will appear, so there is
          // nothing to warn about; practice is skipped the same kind way.
          dispatch(INTRODUCTION_EVENT.MICROPHONE_DENIED_SAID);
          return;
        }
        speakLines(INTRODUCTION_SCRIPT.MICROPHONE, undefined, () =>
          dispatch(INTRODUCTION_EVENT.LINES_DONE),
        );
        return;
      }
      case INTRODUCTION_BEAT.MICROPHONE_DIALOG: {
        // The dialog is macOS's own window mid-screen; while it stands, the
        // panel is the waiting slot — the same pill a calendar consent
        // stands down to — and the answer is what brings it back.
        void window.sidecar.requestMicrophone().then((status) => {
          if (beatRef.current !== INTRODUCTION_BEAT.MICROPHONE_DIALOG) return;
          dispatch(
            status === "granted"
              ? INTRODUCTION_EVENT.MICROPHONE_GRANTED
              : INTRODUCTION_EVENT.MICROPHONE_DENIED,
          );
        });
        return;
      }
      case INTRODUCTION_BEAT.MICROPHONE_DENIED: {
        speakLines(INTRODUCTION_SCRIPT.MICROPHONE_DENIED, undefined, () =>
          dispatch(INTRODUCTION_EVENT.MICROPHONE_DENIED_SAID),
        );
        return;
      }
      case INTRODUCTION_BEAT.PRACTICE: {
        practiceAskedRef.current = false;
        speakLines(INTRODUCTION_SCRIPT.PRACTICE, undefined, () => undefined);
        // Unconditional: an ask whose turn was dropped mid-handshake (the
        // device never arrived, a release with nothing captured) would
        // otherwise disarm the only clock this beat has.
        const timer = setTimeout(
          () => dispatch(INTRODUCTION_EVENT.PRACTICE_DONE),
          PRACTICE_TIMEOUT_MS,
        );
        return () => clearTimeout(timer);
      }
      case INTRODUCTION_BEAT.SIGN_OFF: {
        speakLines(INTRODUCTION_SCRIPT.SIGN_OFF, undefined, () => {
          givenRef.current = true;
          dispatch(INTRODUCTION_EVENT.LINES_DONE);
        });
        return;
      }
      case INTRODUCTION_BEAT.STAND_DOWN: {
        // The collapse spends the panel's own clock — content leaves over the
        // exit, the shape follows on the spring — and only then does the
        // handoff run, so the capsule the takeover fades over is the capsule
        // the real panel draws.
        const root = rootRef.current;
        const standMs = root
          ? parseMilliseconds(getComputedStyle(root).getPropertyValue("--duration-exit")) +
            parseMilliseconds(getComputedStyle(root).getPropertyValue("--duration-shape"))
          : 0;
        const timer = setTimeout(() => dispatch(INTRODUCTION_EVENT.STOOD_DOWN), standMs + 120);
        return () => clearTimeout(timer);
      }
      case INTRODUCTION_BEAT.DONE: {
        void sessionRef.current?.close();
        audioRef.current?.dispose();
        // Everything stays drawn, frozen, while the real panel stands up
        // behind this window; the answer to this report is the moment the
        // gate is drawn beneath, and only then does the fade run — so the
        // sessions dissolve into the sign-in rather than vanishing first.
        let gone = false;
        void window.sidecar.completeIntroduction(givenRef.current).then(() => {
          if (!gone) setHandoffFading(true);
        });
        return () => {
          gone = true;
        };
      }
      default:
        return;
    }
  }, [audio, beat, bootstrap, dispatch, reducedMotion, speakLines]);

  // Once the flight lands, the desktop is the developer's again: the window
  // stops intercepting the pointer, and the landed panel and its strip are
  // the one island that reclaims it under a hovering pointer — the panel
  // window's own hit-region idiom, read off forwarded moves rather than
  // element handlers. Clicks land on the panel, never through it, and the
  // desktop around it stays the developer's.
  const flown = FLOWN_BEATS.has(beat);
  useEffect(() => {
    if (!flown) return;
    let intercepts: boolean | undefined;
    const update = (next: boolean) => {
      if (intercepts === next) return;
      intercepts = next;
      window.sidecar.setPointerInterception(next);
    };
    update(false);
    const handleMove = (event: MouseEvent) => {
      const island = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest(".introduction-panel, .notch-wings, .slot-stage");
      update(island != null);
    };
    const handleLeave = () => {
      update(false);
    };
    window.addEventListener("mousemove", handleMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", handleLeave);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      document.documentElement.removeEventListener("mouseleave", handleLeave);
      window.sidecar.setPointerInterception(true);
    };
  }, [flown]);

  const landed = LANDED_BEATS.has(beat);
  // The landing is when the surface *starts* its spring from the capsule's
  // bounds to the panel's — held back by the exit, like every growth — so
  // anything styled "once the notch has expanded" waits out that whole
  // travel, not just the beat that begins it.
  const [surfaceSettled, setSurfaceSettled] = useState(false);
  useEffect(() => {
    if (!landed) return;
    const root = rootRef.current;
    const expandMs = root
      ? parseMilliseconds(getComputedStyle(root).getPropertyValue("--duration-exit")) +
        parseMilliseconds(getComputedStyle(root).getPropertyValue("--duration-shape"))
      : 0;
    const timer = setTimeout(() => setSurfaceSettled(true), expandMs);
    return () => clearTimeout(timer);
  }, [landed]);
  const standingDown = STANDING_DOWN_BEATS.has(beat);
  // Stood aside, not down: while macOS's microphone dialog is up the panel
  // is the waiting slot — the same pill a calendar consent stands down to,
  // wings ungated — and the panel it springs back to is unchanged.
  const standingAside = beat === INTRODUCTION_BEAT.MICROPHONE_DIALOG;
  const presentation = standingDown
    ? PANEL_PRESENTATION.CAPSULE
    : standingAside
      ? PANEL_PRESENTATION.SLOT
      : PANEL_PRESENTATION.PANEL;
  // The tour's flipped row wears the attention look and rides to the top,
  // exactly as the panel re-sorts a session that starts needing someone.
  const tourFlipped = tourFlipId ? rows.find((row) => row.id === tourFlipId) : undefined;
  const stagedRows = tourFlipped
    ? [
        {
          ...tourFlipped,
          urgency: SESSION_URGENCY.ATTENTION,
          label: urgencyLabel(SESSION_URGENCY.ATTENTION),
          detail: urgencyLabel(SESSION_URGENCY.ATTENTION),
        },
        ...rows.filter((row) => row.id !== tourFlipId),
      ]
    : rows;
  const stagedTally = sessionTally(stagedRows);
  const rowsNow = rowsPretend ? FIXTURE_EPOCH_MS : Date.now();
  // Whose turn the strip's meter draws, on the app's own vocabulary. The face
  // yields to the meter while the developer holds the floor — the real wings
  // own that trade, exactly as they do in the panel.
  const voiceTurn: WaveformVoice | undefined =
    voiceStatus === REALTIME_STATUS.RESPONDING
      ? WAVEFORM_VOICE.LUKE
      : voiceStatus === REALTIME_STATUS.LISTENING
        ? WAVEFORM_VOICE.DEVELOPER
        : undefined;
  const face: { motion?: FaceMotion; repeat: boolean; play: string } = reducedMotion
    ? { repeat: false, play: "still" }
    : beat === INTRODUCTION_BEAT.WAKE
      ? { motion: FACE_MOTION.WAKE, repeat: false, play: "wake" }
      : voiceStatus === REALTIME_STATUS.RESPONDING
        ? { motion: FACE_MOTION.TALKING, repeat: true, play: "talking" }
        : { repeat: false, play: "rest" };
  const gateFace = useSignInFaceCycle(reducedMotion || !standingDown);
  const showCaptions = captions !== undefined && outputSilent(bootstrap.outputAudio);

  return (
    <div
      ref={rootRef}
      className="app-stage introduction-stage"
      data-beat={beat}
      data-flown={String(flown)}
      data-fading={String(handoffFading)}
      data-settled={String(surfaceSettled)}
      data-lifted={String(rows.length > 0)}
      data-notch={String(bootstrap.display.notch.hasNotch)}
      data-signature={String(!reducedMotion)}
      {...(landed ? { "data-presentation": presentation } : undefined)}
      style={{
        ...cssCustomProperties({
          "--notch-top-inset": `${bootstrap.display.notch.topInset}px`,
          "--notch-housing-width": `${bootstrap.display.notch.housingWidth}px`,
          "--panel-height": `${panelHeight}px`,
          ...(slotHeight !== undefined ? { "--slot-height": `${slotHeight}px` } : undefined),
          "--introduction-wordmark-left": WORDMARK_FRACTION.left,
          "--introduction-wordmark-top": WORDMARK_FRACTION.top,
          "--introduction-wordmark-width": WORDMARK_FRACTION.width,
          "--introduction-wordmark-height": WORDMARK_FRACTION.height,
          "--introduction-wordmark-shift": WORDMARK_FRACTION.shift,
        }),
        ...flightStyle,
      }}
    >
      <div className="introduction-scrim" />
      {/* The app's own panel surface, mounted once the flight has left the
          dark: base.css owns every move it makes — the panel and capsule
          bounds, the spring between them, the flares, the exit-first
          ordering — keyed off the same presentation the real stage sets. */}
      {flown ? <div className="panel-surface" aria-hidden="true" /> : null}
      {/* The rows and bands — the app's own components — standing mid-screen
          for the detection and riding one spring up to the notch, where the
          panel window takes over the identical drawing the moment the
          introduction ends. */}
      <div ref={panelGroupRef} className="introduction-panel">
        <div ref={rowsListRef} className="introduction-rows">
          {stagedRows.map((row, index) => (
            <SessionRow
              key={row.id}
              session={row}
              index={index}
              now={rowsNow}
              leaving={false}
              onOpen={() => undefined}
              onOpenApplication={() => undefined}
              writes={INERT_WRITES}
            />
          ))}
        </div>
        {beat === INTRODUCTION_BEAT.PRACTICE ? (
          <div className="introduction-keycaps" data-held={String(talkHeld)} aria-hidden="true">
            <span className="introduction-keycaps-hold">Hold</span>
            <Keycaps
              accelerator={bootstrap.voiceHotkey ?? DEFAULT_VOICE_HOTKEYS[0] ?? "Alt+Space"}
            />
          </div>
        ) : null}
      </div>
      {/* The microphone wait's pill, on the consent slot's exact terms: the
          shape shrinks to a line that says what it is waiting for while
          macOS's own dialog holds the room. Its mark is the microphone
          itself, in Luke's own glyph vocabulary, because macOS's ask has no
          brand mark of its own; there is no way out, because the dialog's
          buttons are the only honest answer — base.css's slot rules own its
          arrival, its exit, and the pointer it may take while drawn. */}
      {flown ? (
        <div
          className="slot-stage"
          data-drawn={String(standingAside)}
          aria-hidden={!standingAside}
          inert={!standingAside}
        >
          <div ref={slotElement} className="key-slot sign-in-slot">
            <div className="key-slot-row">
              <span className="key-slot-mark">
                <MicrophoneIcon />
              </span>
              <span className="sign-in-slot-copy" role="status">
                <strong>Waiting for macOS…</strong>
                <small>Allow microphone access in macOS's dialog.</small>
              </span>
            </div>
          </div>
        </div>
      ) : null}
      {/* The real wings, the moment there is a strip to stand in: the same
          face, meter, and marks the app draws, trading the face for the meter
          while the developer holds the floor. At the gate the strip goes
          deliberately bare, exactly as the app's own signed-out strip does. */}
      {landed ? (
        <NotchWings
          tally={stagedTally}
          analyser={meterAnalyser}
          {...(voiceTurn ? { voice: voiceTurn } : undefined)}
          fixtureSpeaking={false}
          hasAudioSignal={meterAnalyser !== undefined}
          voiceOpening={false}
          meetingQuiet={false}
          sessionsSettled={true}
          presentation={presentation}
          housingWidth={bootstrap.display.notch.housingWidth}
          accountGated={standingDown}
          statusLabel={standingDown ? "Sign in" : tallySummary(stagedTally)}
        />
      ) : null}
      {/* The app's own signed-out Luke, at the wing spot the capsule pose
          puts him in — the identical element the real compact panel draws
          beneath, so the handoff's fade changes nothing on screen. */}
      {standingDown ? (
        <span className="sign-in-luke" aria-hidden="true">
          <LukeFace
            key={gateFace.play}
            {...(gateFace.motion ? { motion: gateFace.motion } : undefined)}
          />
        </span>
      ) : null}
      {/* The flight's own Luke: centre stage under the dark, landing on the
          exact spot the wings' face takes over. Gone once the wings stand. */}
      {landed ? null : (
        <div className="introduction-face-anchor">
          {/* The dark's halo, breathing at the stage's centre and gone with
              the veil. It halos the lockup rather than following the face:
              the centring shift below belongs to the word, not to the dark. */}
          <div className="introduction-glow" aria-hidden="true" />
          <div className="introduction-lockup">
            <span ref={faceRef} className="introduction-face">
              <LukeFace key={face.play} motion={face.motion} repeat={face.repeat} />
            </span>
            {/* The signature reveal: the wordmark's letters, from the same
              generated table the face is drawn from, standing where the
              lockup puts them beside the face-L. They draw themselves on as
              the wake's companion in introduction.css and dissolve when the
              rows arrive to take the stage. The strokes are a mask, not the
              ink: the panel's ink carries alpha, and translucent strokes
              painted one by one would double up where they overlap — the K's
              joint, the E's corners — so they draw as an opaque matte and
              the ink is laid over their union exactly once. */}
            {beat === INTRODUCTION_BEAT.DARK ? null : (
              <svg
                className="introduction-wordmark"
                viewBox={`${WORDMARK_ART.LETTERS_BOX.X} ${WORDMARK_ART.LETTERS_BOX.Y} ${WORDMARK_ART.LETTERS_BOX.WIDTH} ${WORDMARK_ART.LETTERS_BOX.HEIGHT}`}
                aria-hidden="true"
                focusable="false"
              >
                <mask id="introduction-wordmark-strokes">
                  {SIGNATURE_STROKES.map((penStroke) => (
                    <path
                      key={penStroke.d}
                      d={penStroke.d}
                      pathLength={1}
                      fill="none"
                      stroke="#fff"
                      strokeWidth={WORDMARK_ART.STROKE_WIDTH}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={cssCustomProperties({
                        "--introduction-stroke-delay": `${penStroke.delayS}s`,
                        "--introduction-stroke-time": `${penStroke.drawS}s`,
                      })}
                    />
                  ))}
                </mask>
                <rect
                  x={WORDMARK_ART.LETTERS_BOX.X}
                  y={WORDMARK_ART.LETTERS_BOX.Y}
                  width={WORDMARK_ART.LETTERS_BOX.WIDTH}
                  height={WORDMARK_ART.LETTERS_BOX.HEIGHT}
                  fill="currentColor"
                  mask="url(#introduction-wordmark-strokes)"
                />
              </svg>
            )}
            {/* His voice made visible while he speaks on the dark stage — the
              same meter the wings hold once he lands, at the stage's scale. */}
            {!flown && meterAnalyser ? (
              <span className="introduction-face-meter" aria-hidden="true">
                <Waveform analyser={meterAnalyser} voice={WAVEFORM_VOICE.LUKE} voiceActive />
              </span>
            ) : null}
          </div>
        </div>
      )}
      {showCaptions ? (
        <div className="introduction-caption" role="status">
          {captions.join(" ")}
        </div>
      ) : null}
      {/* Luke's own voice, like the panel's one sounding element. */}
      <audio ref={remoteAudioRef} autoPlay hidden>
        <track kind="captions" />
      </audio>
    </div>
  );
}
