import { sanitizedTraceEvent } from "@sidecar/devtrace/vocabulary";
import { LIVE_TRANSPORT_STATE } from "@sidecar/gateway";
import { LIVE_STATUS, type LiveStatus } from "@sidecar/live";
import { WingFace as LukeFace, MicrophoneIcon } from "@sidecar/panel";
import { FACE_MOTION, FACE_MOTION_CYCLE_MS, type FaceMotion, WORDMARK_ART } from "@sidecar/surface";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import type { LiveCaptionRow } from "@sidecar/voice/orchestrator";
import { type Effect, Runtime } from "effect";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import type { AppStateSnapshot } from "#shared/messages/app-state";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import type { DisplayDiagnostic } from "#shared/messages/session";
import type { VoiceSpeakers } from "#shared/messages/voice-view";
import { useAct } from "../act";
import { NotchWings } from "../notch-wings";
import { PANEL_PRESENTATION } from "../panel-state";
import { rendererRuntimeNow } from "../renderer-runtime";
import { sessionTally } from "../session-model";
import { parseMilliseconds } from "../session-motion";
import { appStateNow } from "../use-app-state";
import { usePrefersReducedMotion } from "../use-reduced-motion";
import { LiveCall } from "../voice/live-call";
import { createBrowserSilence } from "../voice/live-peer";
import { openPreferredMicrophone } from "../voice/microphone-choice";
import { startVoiceLevelMeter } from "../voice/voice-level-meter";
import { outputSilent } from "../volume-hint";
import { WAVEFORM_VOICE, Waveform, type WaveformVoice } from "../waveform";
import { IntroductionAudio } from "./introduction-audio";
import { capsuleFaceCenter, FLIGHT_LANDING_SIZE } from "./introduction-flight";
import { lukeCaption, lukeOutputQuiet } from "./introduction-quiet";

/**
 * The introduction's beats, as one pure transition table. What follows below
 * owns the clocks, the session, and the drawing; what belongs here is the
 * order of the moments. The introduction is a scripted greeting: the
 * microphone is asked for first, at the developer's own press, because the
 * talk key will want it once they sign in, and then Luke says his piece and
 * hands over. The session opens with no capture device and is never unmuted,
 * so nothing the developer says during it is heard, and the greeting is the
 * voice service's one instruction on `session.started` — the takeover sends
 * nothing but the hang-up. Every beat a session stands in leaves on a clock
 * of the takeover's own, never on the model alone choosing to stop.
 */

export const INTRODUCTION_BEAT = {
  /** The desktop dims and the tone rises. */
  DARK: "dark",
  /** The smile draws itself and the eyes blink open. */
  WAKE: "wake",
  /** Luke asks, on screen, for the microphone the talk key will want; the press is theirs. */
  MICROPHONE: "microphone",
  /** macOS's own dialog is up; the stage waits on its answer. */
  MICROPHONE_DIALOG: "microphone-dialog",
  /** The scrim lifts and Luke springs up into the notch, to the capsule he greets from. */
  FLIGHT: "flight",
  /**
   * The flight's quiet twin, for an introduction that will not be spoken: a
   * voice that never stood up. Luke glides from the centre straight toward
   * the capsule and the ordinary gate, the room tone fading under the sweep
   * rather than being cut with the window.
   */
  GLIDE: "glide",
  /** Landed; the session is being created against the offer, with no device on it. */
  CONNECT: "connect",
  /** The session started and the voice service's greeting is being spoken, to nobody's microphone. */
  GREETING: "greeting",
  /** The capsule gates: the hang-up, then the sign-in Luke takes the wing spot. */
  STAND_DOWN: "stand-down",
  /** The takeover fades over the real capsule, whose greeting then expands. */
  DONE: "done",
} as const;

export type IntroductionBeat = (typeof INTRODUCTION_BEAT)[keyof typeof INTRODUCTION_BEAT];

export const INTRODUCTION_EVENT = {
  /** The dark has held long enough on its own clock. */
  DARK_SETTLED: "dark-settled",
  WAKE_DONE: "wake-done",
  /** The developer pressed to be heard; macOS asks next. */
  MICROPHONE_PRESSED: "microphone-pressed",
  MICROPHONE_GRANTED: "microphone-granted",
  /** macOS's dialog was refused, or a refusal already stood; the greeting plays regardless. */
  MICROPHONE_DENIED: "microphone-refused",
  FLIGHT_SETTLED: "flight-settled",
  /** The session announced itself started; the greeting follows on its own. */
  SESSION_STARTED: "session-started",
  /** The session could not be opened, did not start, or ended before its end. */
  VOICE_FAILED: "voice-failed",
  /** Luke's output has gone quiet, by the ledger's settle and the track's level. */
  OUTPUT_QUIET: "output-quiet",
  /** The greeting has run to its ceiling, quiet or not. */
  GREETING_CEILING: "greeting-ceiling",
  /** The landed panel has finished standing down to the capsule. */
  STOOD_DOWN: "stood-down",
} as const;

export type IntroductionEvent = (typeof INTRODUCTION_EVENT)[keyof typeof INTRODUCTION_EVENT];

/**
 * Where each event moves each beat. An event a beat does not name leaves it
 * standing — the component fires clocks and callbacks freely, and only the
 * table decides which of them matter where. Total over the beats, so a new
 * beat does not build until this table has answered for it.
 */
const TRANSITIONS = {
  [INTRODUCTION_BEAT.DARK]: {
    [INTRODUCTION_EVENT.DARK_SETTLED]: INTRODUCTION_BEAT.WAKE,
  },
  [INTRODUCTION_BEAT.WAKE]: {
    [INTRODUCTION_EVENT.WAKE_DONE]: INTRODUCTION_BEAT.MICROPHONE,
  },
  [INTRODUCTION_BEAT.MICROPHONE]: {
    [INTRODUCTION_EVENT.MICROPHONE_PRESSED]: INTRODUCTION_BEAT.MICROPHONE_DIALOG,
    // A grant already standing needs no dialog and no press, and a refusal,
    // standing or fresh, changes nothing of what follows: the greeting never
    // hears the developer, so it is spoken to them either way.
    [INTRODUCTION_EVENT.MICROPHONE_GRANTED]: INTRODUCTION_BEAT.FLIGHT,
    [INTRODUCTION_EVENT.MICROPHONE_DENIED]: INTRODUCTION_BEAT.FLIGHT,
  },
  [INTRODUCTION_BEAT.MICROPHONE_DIALOG]: {
    [INTRODUCTION_EVENT.MICROPHONE_GRANTED]: INTRODUCTION_BEAT.FLIGHT,
    [INTRODUCTION_EVENT.MICROPHONE_DENIED]: INTRODUCTION_BEAT.FLIGHT,
  },
  [INTRODUCTION_BEAT.FLIGHT]: {
    [INTRODUCTION_EVENT.FLIGHT_SETTLED]: INTRODUCTION_BEAT.CONNECT,
  },
  [INTRODUCTION_BEAT.GLIDE]: {
    [INTRODUCTION_EVENT.FLIGHT_SETTLED]: INTRODUCTION_BEAT.STAND_DOWN,
  },
  [INTRODUCTION_BEAT.CONNECT]: {
    [INTRODUCTION_EVENT.SESSION_STARTED]: INTRODUCTION_BEAT.GREETING,
  },
  [INTRODUCTION_BEAT.GREETING]: {
    // Luke's piece said, he hands over: the quiet is the kind end, and the
    // ceiling is the one that does not wait on the model, so a beat whose
    // only way out was the model choosing to stop cannot stand here.
    [INTRODUCTION_EVENT.OUTPUT_QUIET]: INTRODUCTION_BEAT.STAND_DOWN,
    [INTRODUCTION_EVENT.GREETING_CEILING]: INTRODUCTION_BEAT.STAND_DOWN,
  },
  [INTRODUCTION_BEAT.STAND_DOWN]: {
    [INTRODUCTION_EVENT.STOOD_DOWN]: INTRODUCTION_BEAT.DONE,
  },
  [INTRODUCTION_BEAT.DONE]: {},
} as const satisfies Record<IntroductionBeat, Partial<Record<IntroductionEvent, IntroductionBeat>>>;

function eventTarget(
  row: Partial<Record<IntroductionEvent, IntroductionBeat>>,
  event: IntroductionEvent,
): IntroductionBeat | undefined {
  return row[event];
}

/**
 * The beats a voice failure sends through the quiet glide rather than the
 * stand-down: nothing has flown yet, so Luke still has his whole journey —
 * centre to capsule to the ordinary gate — to make gracefully.
 */
const PRE_FLIGHT_BEATS: ReadonlySet<IntroductionBeat> = new Set([
  INTRODUCTION_BEAT.DARK,
  INTRODUCTION_BEAT.WAKE,
  INTRODUCTION_BEAT.MICROPHONE,
  INTRODUCTION_BEAT.MICROPHONE_DIALOG,
]);

/**
 * The next beat. One event cuts across the table: the voice failing ends the
 * introduction honestly and gracefully — the quiet glide while the stage has
 * not flown, the stand-down once it has — because the signed-in panel behind
 * it needs no voice, and a takeover cut mid-note would make a refused quota
 * feel like a crash.
 */
export function nextIntroductionBeat(
  beat: IntroductionBeat,
  event: IntroductionEvent,
): IntroductionBeat {
  if (beat === INTRODUCTION_BEAT.DONE) return beat;
  if (event === INTRODUCTION_EVENT.VOICE_FAILED) {
    return PRE_FLIGHT_BEATS.has(beat) ? INTRODUCTION_BEAT.GLIDE : INTRODUCTION_BEAT.STAND_DOWN;
  }
  return eventTarget(TRANSITIONS[beat], event) ?? beat;
}

/** How long the dark holds before the wake. */
const DARK_HOLD_MS = 900;
/** The bell leads the wake's end by the eyes' opening, not the head's settle. */
const WAKE_BELL_LEAD_MS = 600;
/** How long a started session may stay silent before the greeting is given up on. */
const GREETING_TIMEOUT_MS = 20_000;
/**
 * The greeting's ceiling however long the model talks: the script is three or
 * four short sentences and takes a fraction of this, so the ceiling is the
 * end that does not depend on the model choosing to stop.
 */
const GREETING_CEILING_MS = 45_000;

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

/** The beats after the flight has left the dark stage for the notch. */
const FLOWN_BEATS: ReadonlySet<IntroductionBeat> = new Set([
  INTRODUCTION_BEAT.FLIGHT,
  INTRODUCTION_BEAT.GLIDE,
  INTRODUCTION_BEAT.CONNECT,
  INTRODUCTION_BEAT.GREETING,
  INTRODUCTION_BEAT.STAND_DOWN,
  INTRODUCTION_BEAT.DONE,
]);

/**
 * The beats the flight has settled through: the real wings take the strip —
 * the same component the app itself draws, in the capsule pose, since the
 * introduction draws no rows and Luke greets from the capsule he will be
 * found in — and the flight's own face stands down, having landed on the
 * spot the wings' face now holds.
 */
const LANDED_BEATS: ReadonlySet<IntroductionBeat> = new Set([
  INTRODUCTION_BEAT.CONNECT,
  INTRODUCTION_BEAT.GREETING,
  INTRODUCTION_BEAT.STAND_DOWN,
  INTRODUCTION_BEAT.DONE,
]);

/** The beats a session stands or is coming up in, where its ending is news. */
const SESSION_BEATS: ReadonlySet<IntroductionBeat> = new Set([
  INTRODUCTION_BEAT.CONNECT,
  INTRODUCTION_BEAT.GREETING,
]);

/** The two beats the microphone ask is drawn on the dark stage. */
const ASKING_BEATS: ReadonlySet<IntroductionBeat> = new Set([
  INTRODUCTION_BEAT.MICROPHONE,
  INTRODUCTION_BEAT.MICROPHONE_DIALOG,
]);

/**
 * The introduction as the panel window draws it, over the whole of the display
 * that window stands on.
 *
 * The document is read once, at the mount: the takeover is a scripted flight
 * rather than a surface that follows state, so it subscribes to nothing — a
 * roster arriving mid-beat must not re-run the beat it arrived during. A panel
 * always stands on a display, so a state naming none is the read having
 * failed rather than a state worth drawing, and the ordinary panel stands in
 * its place rather than a fullscreen surface with nothing on it.
 */
export function IntroductionTakeover(): React.JSX.Element | null {
  const { tell } = useAct();
  const [state] = useState(appStateNow);
  const display = state?.window.display;
  useEffect(() => {
    if (state !== undefined && display === undefined) {
      tell(ACT_KIND.INTRODUCTION_ABANDON, { reason: "The takeover's state named no display." });
    }
  }, [state, display]);
  if (!state || display === undefined) return null;
  return <IntroductionFlight state={state} display={display} />;
}

/**
 * The one-time fullscreen introduction, given to the developer who just
 * signed in. Entirely spoken by the voice service's greeting: no line is
 * drawn, and the one text beside the capsule is the caption strip, forced on
 * exactly where the app itself forces it — when the machine's output is
 * silent, where the caption is the speech. The session behind it is the
 * introduction's own: created through the voice service's accountless
 * endpoint, which holds its trusted side and sends the greeting, seeded by
 * the main process with the developer's first name and nothing else
 * observed, as data. This window is a peer of it and nothing more — the
 * same `LiveCall` the conversation runs on, opened with the peer's own
 * silence in the device's place and never unmuted, sending only the hang-up
 * — so nothing is heard here, and nothing said or shown here can become an
 * action. What lands at the top of the screen is the app's own furniture —
 * the capsule and the wings the signed-in panel draws — so the handoff to
 * the real panel changes nothing the developer can see.
 */
function IntroductionFlight({
  state,
  display,
}: {
  state: AppStateSnapshot;
  /** The display this takeover covers, which the voice window alone lacks. */
  display: DisplayDiagnostic;
}): React.JSX.Element {
  const { act, tell } = useAct();
  const [beat, setBeat] = useState<IntroductionBeat>(INTRODUCTION_BEAT.DARK);
  const beatRef = useRef<IntroductionBeat>(beat);
  const [voiceStatus, setVoiceStatus] = useState<LiveStatus>(LIVE_STATUS.IDLE);
  const voiceStatusRef = useRef<LiveStatus>(voiceStatus);
  const [remoteStream, setRemoteStream] = useState<MediaStream | undefined>(undefined);
  const [meterAnalyser, setMeterAnalyser] = useState<AnalyserNode | undefined>(undefined);
  /** Both speakers' words as the call groups them; Luke's rows are the captions and the quiet. */
  const [captionRows, setCaptionRows] = useState<readonly LiveCaptionRow[]>([]);
  const captionRowsRef = useRef<readonly LiveCaptionRow[]>(captionRows);
  const [flightStyle, setFlightStyle] = useState<CSSProperties>({});

  const callRef = useRef<LiveCall | undefined>(undefined);
  const audioRef = useRef<IntroductionAudio | undefined>(undefined);
  /** The meters' own graph, reading levels only — nothing reaches a speaker. */
  const meterContextRef = useRef<AudioContext | undefined>(undefined);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const faceRef = useRef<HTMLSpanElement | null>(null);
  /**
   * Whether the introduction was actually given — the greeting spoken to its
   * quiet or its ceiling. A glide past a voice that never stood up hands off
   * the same way but marks nothing, so the introduction still plays for real
   * on a later launch.
   */
  const givenRef = useRef(false);

  const reducedMotion = usePrefersReducedMotion();

  const dispatch = useCallback((event: IntroductionEvent) => {
    setBeat((current) => {
      const next = nextIntroductionBeat(current, event);
      beatRef.current = next;
      return next;
    });
  }, []);

  /**
   * The one place this window's own `LiveCall` use reaches the renderer's
   * runtime, the same edge `use-voice-session.ts`'s hook and `LiveCall`
   * itself already run their own fibers on: every verb the takeover asks of
   * its call comes through here rather than each press converting its own.
   */
  const runCallEffect = useCallback(
    <A,>(effect: Effect.Effect<A>): Promise<A> => Runtime.runPromise(rendererRuntimeNow())(effect),
    [],
  );

  const audio = useCallback((): IntroductionAudio => {
    // Built against the output as bootstrapped: playing a room tone into a
    // muted Mac serves nobody, and the captions are the speech there.
    audioRef.current ??= new IntroductionAudio(!outputSilent(state.audio.outputAudio));
    return audioRef.current;
  }, [state]);

  /**
   * The introduction's peer. Its acts are the introduction's own two: the
   * offer, with the titles, to the accountless session the main process
   * holds, and the hang-up; a transport that closed or failed is the same
   * hang-up, so the main process never keeps a session whose peer is gone.
   * Idle is the takeover's own clock here, so the idle report goes nowhere.
   * Nothing here calls `unmute`, so the device opener below is never run:
   * the greeting is spoken to a line carrying the peer's own silence.
   */
  const ensureCall = useCallback((): LiveCall => {
    callRef.current ??= new LiveCall({
      events: {
        onStatus: (status) => {
          voiceStatusRef.current = status;
          setVoiceStatus(status);
          if (!SESSION_BEATS.has(beatRef.current)) return;
          if (status === LIVE_STATUS.FAILED) {
            dispatch(INTRODUCTION_EVENT.VOICE_FAILED);
            return;
          }
          // The session ending on the server's side — its duration limit, a
          // connection lost — is a failure while nothing has been said, and
          // the greeting's own quiet once something has: a closed session
          // says nothing more, and what was heard was heard.
          if (status === LIVE_STATUS.IDLE) {
            if (lukeCaption(captionRowsRef.current) === undefined) {
              dispatch(INTRODUCTION_EVENT.VOICE_FAILED);
              return;
            }
            givenRef.current = true;
            dispatch(INTRODUCTION_EVENT.OUTPUT_QUIET);
          }
        },
        onCaptions: (next) => {
          captionRowsRef.current = next;
          setCaptionRows(next);
        },
        onError: () => undefined,
      },
      acts: {
        createSession: (sdp) => act(ACT_KIND.INTRODUCTION_CREATE_SESSION, { sdp, titles: [] }),
        endSession: () => tell(ACT_KIND.INTRODUCTION_END_SESSION),
        reportTransport: (transport) => {
          if (
            transport === LIVE_TRANSPORT_STATE.CLOSED ||
            transport === LIVE_TRANSPORT_STATE.FAILED
          ) {
            tell(ACT_KIND.INTRODUCTION_END_SESSION);
          }
        },
        reportActivity: () => undefined,
      },
      createPeerConnection: () => new RTCPeerConnection(),
      createSilence: createBrowserSilence,
      openMicrophone: () =>
        openPreferredMicrophone({
          route: () => act(ACT_KIND.MICROPHONE_ROUTE),
          enumerate: () => navigator.mediaDevices.enumerateDevices(),
          open: (audioConstraints) =>
            navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false }),
        }),
      onRemoteStream: (stream) => {
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream ?? null;
        setRemoteStream(stream);
      },
      onLocalStream: () => undefined,
      runtime: rendererRuntimeNow(),
      onWireEvent: (direction, event) => {
        if (appStateNow()?.run.agentTraceEnabled !== true) return;
        window.sidecar.recordAgentTrace({ direction, event: sanitizedTraceEvent(event) });
      },
    });
    return callRef.current;
  }, [dispatch]);

  // The whole flow's standing wiring: the dark's own clock and the teardown
  // that hangs up whatever stands. The talk key is not routed here: the
  // greeting is scripted, and a key that unmuted the session would make it
  // the open call it is not.
  useEffect(() => {
    const darkTimer = setTimeout(() => dispatch(INTRODUCTION_EVENT.DARK_SETTLED), DARK_HOLD_MS);
    return () => {
      clearTimeout(darkTimer);
      if (callRef.current) void runCallEffect(callRef.current.close());
      audioRef.current?.dispose();
      void meterContextRef.current?.close().catch(() => undefined);
      meterContextRef.current = undefined;
    };
  }, [dispatch, runCallEffect]);

  // Luke's track decides whether he is speaking, since the guide forbids
  // reading that off transcript events; there is no microphone track to
  // meter, and idle is this takeover's own clock.
  useEffect(() => {
    if (!remoteStream) return;
    const context = meterContextRef.current ?? new AudioContext({ latencyHint: "interactive" });
    meterContextRef.current = context;
    return startVoiceLevelMeter({
      stream: remoteStream,
      audioContext: context,
      onActivity: (active) => callRef.current?.reportRemoteAudioLevel(active),
      onLevel: () => undefined,
    });
  }, [remoteStream]);

  // The drawn meter reads Luke's stream while he speaks; nobody else holds
  // the floor during the introduction.
  const meterStream = voiceStatus === LIVE_STATUS.SPEAKING ? remoteStream : undefined;
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

  // The greeting's end is read from the evidence the guide allows: Luke's
  // rows settled on the ledger's clock and his track quiet. Marking the
  // introduction given belongs here, because this is the moment it was.
  useEffect(() => {
    if (beat !== INTRODUCTION_BEAT.GREETING) return;
    if (!lukeOutputQuiet(captionRows, voiceStatus === LIVE_STATUS.SPEAKING)) return;
    givenRef.current = true;
    dispatch(INTRODUCTION_EVENT.OUTPUT_QUIET);
  }, [beat, captionRows, voiceStatus, dispatch]);

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
      case INTRODUCTION_BEAT.MICROPHONE: {
        // A grant already standing needs no press; a refusal already standing
        // gets no dialog, and the greeting goes on without the microphone it
        // never needed.
        if (state.audio.microphoneStatus === MICROPHONE_STATUS.GRANTED) {
          dispatch(INTRODUCTION_EVENT.MICROPHONE_GRANTED);
        } else if (state.audio.microphoneStatus !== MICROPHONE_STATUS.NOT_DETERMINED) {
          dispatch(INTRODUCTION_EVENT.MICROPHONE_DENIED);
        }
        return;
      }
      case INTRODUCTION_BEAT.MICROPHONE_DIALOG: {
        // macOS's own dialog, raised by the developer's press and answered
        // only by its buttons; the stage waits on the answer.
        void act(ACT_KIND.MICROPHONE_REQUEST).then((status) => {
          if (beatRef.current !== INTRODUCTION_BEAT.MICROPHONE_DIALOG) return;
          dispatch(
            status === MICROPHONE_STATUS.GRANTED
              ? INTRODUCTION_EVENT.MICROPHONE_GRANTED
              : INTRODUCTION_EVENT.MICROPHONE_DENIED,
          );
        });
        return;
      }
      case INTRODUCTION_BEAT.GLIDE:
      case INTRODUCTION_BEAT.FLIGHT: {
        // The dark lifts under the sweep, and the landing chimes when the
        // wings take the strip. Luke's leap is measured because he lands on
        // the exact spot and size of the capsule's wing face — the spot the
        // real wings' face takes over the moment the flight settles.
        audio().sweep();
        const root = rootRef.current;
        const target = capsuleFaceCenter({
          viewportWidth: window.innerWidth,
          housingWidth: display.notch.housingWidth,
          topInset: display.notch.topInset,
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
      case INTRODUCTION_BEAT.CONNECT: {
        // Landed, the session opens: the offer with the titles goes to the
        // main process, the answer comes back, and `open` resolves on
        // `session.started`. The opening is not a press's, so no capture
        // device rides the offer: the line carries the peer's own silence,
        // as a session opened for a briefing does, and the model's input
        // timeline runs against it so the greeting is spoken rather than held
        // for a word that cannot come. The greeting itself is the voice
        // service's, sent on the same event.
        let gone = false;
        const call = ensureCall();
        void runCallEffect(call.open({ byPress: false })).then((opened) => {
          if (gone) return;
          dispatch(opened ? INTRODUCTION_EVENT.SESSION_STARTED : INTRODUCTION_EVENT.VOICE_FAILED);
        });
        return () => {
          gone = true;
        };
      }
      case INTRODUCTION_BEAT.GREETING: {
        // A started session that says nothing is a greeting that never came.
        const silence = setTimeout(() => {
          if (lukeCaption(captionRowsRef.current) === undefined) {
            dispatch(INTRODUCTION_EVENT.VOICE_FAILED);
          }
        }, GREETING_TIMEOUT_MS);
        // A greeting heard to its ceiling was still heard: marking it given
        // here is what keeps a long greeting from replaying next launch.
        const ceiling = setTimeout(() => {
          if (lukeCaption(captionRowsRef.current) !== undefined) givenRef.current = true;
          dispatch(INTRODUCTION_EVENT.GREETING_CEILING);
        }, GREETING_CEILING_MS);
        return () => {
          clearTimeout(silence);
          clearTimeout(ceiling);
        };
      }
      case INTRODUCTION_BEAT.STAND_DOWN: {
        // The hang-up first, so nothing is said over the stand-down. The
        // capsule gates over the panel's own clock — the exit and the shape,
        // the same span the real collapse spends — and only then does the
        // handoff run, so the capsule the takeover fades over is the capsule
        // the real panel draws.
        if (callRef.current) void runCallEffect(callRef.current.close());
        const root = rootRef.current;
        const standMs = root
          ? parseMilliseconds(getComputedStyle(root).getPropertyValue("--duration-exit")) +
            parseMilliseconds(getComputedStyle(root).getPropertyValue("--duration-shape"))
          : 0;
        const timer = setTimeout(() => dispatch(INTRODUCTION_EVENT.STOOD_DOWN), standMs + 120);
        return () => clearTimeout(timer);
      }
      case INTRODUCTION_BEAT.DONE: {
        if (callRef.current) void runCallEffect(callRef.current.close());
        audioRef.current?.dispose();
        // What the stand-down leaves drawn is the identical compact capsule
        // the signed-in panel draws, so reporting the ending here — and
        // handing this window back to the panel it always was — changes
        // nothing on screen.
        void act(ACT_KIND.INTRODUCTION_COMPLETE, { given: givenRef.current });
        return;
      }
      default:
        return;
    }
  }, [audio, beat, state, display, dispatch, ensureCall, reducedMotion, runCallEffect]);

  // Once the flight lands, the desktop is the developer's again: the window
  // stops intercepting the pointer, and the landed strip is the one island
  // that reclaims it under a hovering pointer — the panel window's own
  // hit-region idiom, read off forwarded moves rather than element handlers.
  // Clicks land on the strip, never through it, and the desktop around it
  // stays the developer's. Nothing is restored on the way
  // out: the window this ran in is the panel, and what it intercepts once the
  // takeover has ended is `leaveTakeover`'s answer, not this effect's last
  // word on a window that used to be destroyed.
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
        ?.closest(".notch-wings");
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
    };
  }, [flown]);

  const landed = LANDED_BEATS.has(beat);
  // The introduction draws no session rows — a session Luke cannot observe
  // yet is not one to picture — so the surface he lands in is the capsule,
  // the pose the greeting is captioned under and the handoff leaves standing.
  const presentation = PANEL_PRESENTATION.CAPSULE;
  const asking = ASKING_BEATS.has(beat);
  const emptyTally = sessionTally([]);
  // Who the strip hears, on the app's own vocabulary: the introduction never
  // unmutes, so the developer is never listened to and only Luke's meter is
  // ever placed, beside his face as the real wings place it.
  const speakers: VoiceSpeakers = {
    listening: false,
    lukeSpeaking: voiceStatus === LIVE_STATUS.SPEAKING,
  };
  const voiceTurn: WaveformVoice | undefined = speakers.lukeSpeaking
    ? WAVEFORM_VOICE.LUKE
    : undefined;
  const face: { motion?: FaceMotion; repeat: boolean; play: string } = reducedMotion
    ? { repeat: false, play: "still" }
    : beat === INTRODUCTION_BEAT.WAKE
      ? { motion: FACE_MOTION.WAKE, repeat: false, play: "wake" }
      : voiceStatus === LIVE_STATUS.SPEAKING
        ? { motion: FACE_MOTION.TALKING, repeat: true, play: "talking" }
        : { repeat: false, play: "rest" };
  const caption = lukeCaption(captionRows);
  const showCaptions = caption !== undefined && outputSilent(state.audio.outputAudio);

  return (
    <div
      ref={rootRef}
      className="app-stage introduction-stage"
      data-beat={beat}
      data-flown={String(flown)}
      data-notch={String(display.notch.hasNotch)}
      data-signature={String(!reducedMotion)}
      {...(landed ? { "data-presentation": presentation } : undefined)}
      style={{
        ...cssCustomProperties({
          "--notch-top-inset": `${display.notch.topInset}px`,
          "--notch-housing-width": `${display.notch.housingWidth}px`,
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
      {/* The app's own capsule surface, mounted once the flight has left the
          dark: base.css owns every move it makes — the capsule bounds, the
          caption's growth, the flares — keyed off the same presentation the
          real stage sets. */}
      {flown ? <div className="panel-surface" aria-hidden="true" /> : null}
      {/* The real wings, the moment there is a strip to stand in: the same
          face and meter the app draws in its capsule, over a desk with
          nothing on it yet, and the same capsule the signed-in panel draws
          the moment the introduction ends. */}
      {landed ? (
        <NotchWings
          tally={emptyTally}
          {...(meterAnalyser && voiceTurn
            ? { measured: { voice: voiceTurn, analyser: meterAnalyser } }
            : undefined)}
          speakers={speakers}
          fixtureSpeaking={false}
          voiceOpening={beat === INTRODUCTION_BEAT.CONNECT}
          // Every run and briefing of Luke's is held while the introduction
          // is owed, so nothing is under way behind its strip.
          thinking={false}
          announcementsHeld={false}
          sessionsSettled={true}
          presentation={presentation}
          housingWidth={display.notch.housingWidth}
          accountGated={false}
        />
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
              the wake's companion in introduction.css and dissolve with the
              flight. The strokes are a mask, not the
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
          {/* The microphone ask, under the lockup: Luke's one request before
              he speaks, for the talk key's sake once they sign in and not
              for the greeting, which hears nobody. The press is theirs — it
              is what raises macOS's own dialog — and declining costs them
              nothing of the introduction, which is spoken either way. While
              the dialog holds the room, the block says what it is waiting
              for and offers nothing else, because the dialog's buttons are
              the only honest answer. */}
          {asking ? (
            <div
              className="introduction-ask"
              data-waiting={String(beat === INTRODUCTION_BEAT.MICROPHONE_DIALOG)}
            >
              {beat === INTRODUCTION_BEAT.MICROPHONE ? (
                <>
                  <button
                    type="button"
                    className="action-button introduction-ask-button"
                    onClick={() => dispatch(INTRODUCTION_EVENT.MICROPHONE_PRESSED)}
                  >
                    <MicrophoneIcon />
                    Let Luke hear you
                  </button>
                  <small className="introduction-ask-note">
                    Your Mac will ask about the microphone. Luke hears you only while you hold the
                    talk key, and not during this introduction.
                  </small>
                  <button
                    type="button"
                    className="quiet-button introduction-ask-skip"
                    onClick={() => dispatch(INTRODUCTION_EVENT.MICROPHONE_DENIED)}
                  >
                    Not now
                  </button>
                </>
              ) : (
                <span className="introduction-ask-wait" role="status">
                  <span className="key-slot-mark">
                    <MicrophoneIcon />
                  </span>
                  <span>
                    <strong>Waiting for macOS…</strong>
                    <small>Allow microphone access in macOS's dialog.</small>
                  </span>
                </span>
              )}
            </div>
          ) : null}
        </div>
      )}
      {showCaptions ? (
        <div className="introduction-caption" role="status">
          {caption}
        </div>
      ) : null}
      {/* Luke's own voice, like the panel's one sounding element. */}
      <audio ref={remoteAudioRef} autoPlay hidden>
        <track kind="captions" />
      </audio>
    </div>
  );
}
