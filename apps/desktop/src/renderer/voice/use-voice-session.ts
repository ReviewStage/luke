import * as Atom from "@effect-atom/atom/Atom";
import { useAtomValue } from "@effect-atom/atom-react/Hooks";
import { sanitizedTraceEvent } from "@sidecar/devtrace/vocabulary";
import { appSettingsView } from "@sidecar/settings/wire";
import {
  type LiveVoiceBridge,
  LiveVoiceOrchestrator,
  type LiveVoiceSurroundings,
} from "@sidecar/voice/orchestrator";
import { Duration, Effect, FiberId, Runtime, Schedule } from "effect";
import { type RefObject, useCallback, useEffect, useRef } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import {
  SILENT_VOICE_LEVELS,
  VOICE_COMMAND,
  type VoiceLevels,
  voiceExchangeKind,
} from "#shared/messages/voice-view";
import { useAct } from "../act";
import { hostedVoiceUnavailableNote } from "../microphone-access";
import { rendererRegistry, rendererRuntimeNow } from "../renderer-runtime";
import { appSettingsNow, appStateNow, useAppState } from "../use-app-state";
import { outputSilent } from "../volume-hint";
import { LiveCall } from "./live-call";
import { createBrowserSilence } from "./live-peer";
import { openPreferredMicrophone } from "./microphone-choice";
import { startVoiceLevelMeter } from "./voice-level-meter";

/**
 * How long a refused remote-audio play waits before trying again. Chromium
 * refuses transiently — an output route mid-arrival, a playback gate a later
 * state satisfies — and the words keep arriving on the stream regardless, so
 * a short clock loses less of the sentence than a longer one would.
 */
const REMOTE_AUDIO_RETRY_MS = 1_000;

/**
 * The two streams the meters listen to and the element plays, each a writable
 * atom the call's own callbacks set: the hook subscribes through the Hooks
 * door rather than through a `useState` a DOM callback would have to close
 * over, and a callback outside any render reads or writes the same value a
 * hook does.
 */
const remoteStreamAtom: Atom.Writable<MediaStream | undefined> = Atom.make<MediaStream | undefined>(
  undefined,
);
const localStreamAtom: Atom.Writable<MediaStream | undefined> = Atom.make<MediaStream | undefined>(
  undefined,
);

/**
 * The spoken conversation, held in the hidden voice window so no panel does.
 * Everything it decides is {@link LiveVoiceOrchestrator}'s, in `@sidecar/voice`,
 * which touches no DOM: what is left here is the wiring only a browser can
 * do — the peer connection, the capture device, the level meters'
 * `AudioContext`, the element Luke's voice plays through — and the
 * subscriptions the main process reaches this window on. Nothing is drawn
 * here, and nothing here appends to the model: every append is the host's.
 */
export function useVoiceSession(remoteAudio: RefObject<HTMLAudioElement | null>): void {
  const { act, tell } = useAct();
  const local = useAtomValue(localStreamAtom);
  const remote = useAtomValue(remoteStreamAtom);
  const callRef = useRef<LiveCall | undefined>(undefined);
  const orchestratorRef = useRef<LiveVoiceOrchestrator | undefined>(undefined);
  /** Everything the policy asks of the main process, over the one bridge this window has. */
  const bridge: LiveVoiceBridge = {
    reportView: (view, exchange) =>
      window.sidecar.reportVoiceView(
        view,
        exchange === undefined ? undefined : voiceExchangeKind(exchange),
      ),
    requestMicrophone: () =>
      Effect.promise(
        async () => (await act(ACT_KIND.MICROPHONE_REQUEST)) === MICROPHONE_STATUS.GRANTED,
      ),
    hostedUnavailableNote: () =>
      Effect.promise(async () =>
        hostedVoiceUnavailableNote(await act(ACT_KIND.VOICE_DIAGNOSTICS).catch(() => undefined)),
      ),
    stopSpeaking: () => Effect.promise(() => act(ACT_KIND.VOICE_STOP_SPEAKING).catch(() => false)),
  };
  orchestratorRef.current ??= new LiveVoiceOrchestrator({
    bridge,
    createCall: (events) => {
      const call = new LiveCall({
        events,
        acts: {
          createSession: (sdp) => act(ACT_KIND.VOICE_CREATE_LIVE_SESSION, { sdp }),
          endSession: () => tell(ACT_KIND.VOICE_END_LIVE_SESSION),
          reportTransport: (state) => tell(ACT_KIND.VOICE_REPORT_LIVE_TRANSPORT, { state }),
          reportActivity: (idle) => tell(ACT_KIND.VOICE_REPORT_LIVE_ACTIVITY, { idle }),
        },
        createPeerConnection: () => new RTCPeerConnection(),
        createSilence: createBrowserSilence,
        // The press's device, chosen by facts read natively: the Mac's own
        // microphone where a Bluetooth headset would otherwise pay for the
        // capture with its music codec, the browser's default everywhere
        // else. The switch reads at each open, so flipping it needs no
        // reconnect.
        openMicrophone: () =>
          openPreferredMicrophone({
            route: () =>
              (appSettingsNow()?.preferBuiltInMicrophone ?? true)
                ? act(ACT_KIND.MICROPHONE_ROUTE)
                : Promise.resolve(undefined),
            enumerate: () => navigator.mediaDevices.enumerateDevices(),
            open: (audio) => navigator.mediaDevices.getUserMedia({ audio, video: false }),
          }),
        onRemoteStream: (remote) => rendererRegistry.set(remoteStreamAtom, remote),
        onLocalStream: (local) => rendererRegistry.set(localStreamAtom, local),
        runtime: rendererRuntimeNow(),
        // The development trace's tap, checked at each event rather than at
        // construction because a session outlives any one version of the
        // document that says whether a writer stands behind the bridge.
        onWireEvent: (direction, event) => {
          if (appStateNow()?.run.agentTraceEnabled !== true) return;
          window.sidecar.recordAgentTrace({ direction, event: sanitizedTraceEvent(event) });
        },
      });
      callRef.current = call;
      return call;
    },
  });
  const orchestrator = orchestratorRef.current;
  /**
   * Every verb of the orchestrator is an Effect, and this window is the edge
   * that runs one: a key press, a command, or the host's own word starts a
   * fiber of the renderer's own runtime, which is the same runtime the call
   * beneath already forks its session's life on.
   */
  const drive = useCallback((effect: Effect.Effect<unknown>) => {
    Runtime.runFork(rendererRuntimeNow())(effect);
  }, []);
  const audioContext = useRef<AudioContext | undefined>(undefined);
  /**
   * The pair the panels draw from, each meter amending its own half: a meter
   * hears one stream, and the report carries both so a panel never draws one
   * speaker's loudness under the other's name.
   */
  const levels = useRef<VoiceLevels>(SILENT_VOICE_LEVELS);
  const relayLevel = useCallback((moved: Partial<VoiceLevels>) => {
    levels.current = { ...levels.current, ...moved };
    window.sidecar.reportVoiceLevel(levels.current);
  }, []);

  /**
   * Everything this window reads rather than owns — whether a voice stands,
   * whether captions are wanted, the output the captions answer, and the
   * microphone's grant — on the one channel main holds it on, handed over
   * whole whenever it moves.
   */
  const state = useAppState();
  useEffect(() => {
    const settings = state?.settings ? appSettingsView(state.settings) : undefined;
    const surroundings: LiveVoiceSurroundings = {
      voiceAvailable: settings?.voiceAvailable,
      captionsEnabled: settings?.voiceCaptions === true,
      outputSilent: outputSilent(state?.audio.outputAudio),
      microphoneGranted: state?.audio.microphoneStatus === MICROPHONE_STATUS.GRANTED,
    };
    orchestrator.surround(surroundings);
  }, [orchestrator, state]);

  // Two meters over one context: Luke's track decides the speaking status,
  // since the guide forbids reading it off transcript events, and the
  // microphone's track decides idle, since the guide forbids reading silence
  // off a missing one. Each reports its own loudness whatever the other is
  // doing, because the session is full duplex and the panel decides which of
  // the two it draws.
  useEffect(() => {
    if (!remote) return;
    const context = audioContext.current ?? new AudioContext({ latencyHint: "interactive" });
    audioContext.current = context;
    const relay = (luke: number) => relayLevel({ luke });
    const stop = startVoiceLevelMeter({
      stream: remote,
      audioContext: context,
      onActivity: (active) => callRef.current?.reportRemoteAudioLevel(active),
      onLevel: relay,
    });
    // A stream that went away carries no loudness, and the last reading it
    // left would otherwise stand under the other speaker's meter.
    return () => {
      stop();
      relay(0);
    };
  }, [remote, relayLevel]);

  useEffect(() => {
    if (!local) return;
    const context = audioContext.current ?? new AudioContext({ latencyHint: "interactive" });
    audioContext.current = context;
    const relay = (developer: number) => relayLevel({ developer });
    const stop = startVoiceLevelMeter({
      stream: local,
      audioContext: context,
      onActivity: (active) => callRef.current?.reportMicrophoneActivity(active),
      onLevel: relay,
    });
    return () => {
      stop();
      relay(0);
    };
  }, [local, relayLevel]);

  useEffect(() => {
    const element = remoteAudio.current;
    if (!element) return;
    element.srcObject = remote ?? null;
    if (!remote) return;
    // A refused play is the one failure the call cannot see: Luke speaks and
    // the captions draw while nothing is heard. A session opened for a
    // briefing is exactly the one with no user gesture behind it to satisfy a
    // playback gate, so the refusal is retried for as long as the stream
    // stands rather than swallowed once, on the renderer's own runtime rather
    // than a timer seam.
    const fiber = Runtime.runFork(rendererRuntimeNow())(
      Effect.retry(
        Effect.tryPromise(() => element.play()),
        Schedule.spaced(Duration.millis(REMOTE_AUDIO_RETRY_MS)),
      ),
    );
    return () => {
      fiber.unsafeInterruptAsFork(FiberId.none);
    };
  }, [remoteAudio, remote]);

  // A panel's ask, validated and forwarded by the main process. Each command
  // is the same action the panel used to perform on its own session; none opens
  // a turn the developer did not, and a Clear reaches the record on main alone.
  useEffect(
    () =>
      window.sidecar.onVoiceCommand(({ command }) => {
        if (command === VOICE_COMMAND.STOP_SPEAKING) drive(orchestrator.stopSpeaking());
        else if (command === VOICE_COMMAND.REQUEST_MICROPHONE_ACCESS) {
          drive(orchestrator.requestMicrophoneAccess());
        }
      }),
    [drive, orchestrator],
  );

  // The host's word on its one session: wanted opens one muted for whatever
  // Luke has to say, closing hangs up. The phase the document held when this
  // window came up is obeyed once, since a wanted announced before the
  // subscription stood would otherwise reach nobody.
  const standingPhase = state?.voice.liveSession?.phase;
  const adopted = useRef(false);
  useEffect(() => {
    if (adopted.current || state === undefined) return;
    adopted.current = true;
    drive(orchestrator.adoptStanding(standingPhase));
  }, [drive, orchestrator, standingPhase, state]);
  useEffect(
    () =>
      window.sidecar.onVoiceLiveSessionChanged((change) =>
        drive(orchestrator.obeySessionChange(change)),
      ),
    [drive, orchestrator],
  );

  // The talk key is registered by the main process so it answers from any app,
  // which is the whole point: no window to find, nothing to focus first. It
  // is held to talk: the press opens the microphone and the release closes
  // it, so the device is open exactly while the key is down. A press during
  // a chord being recorded is held back in the main process, where the
  // recording is known; a release always lands, so a hold begun before the
  // recording still ends.
  useEffect(
    () => window.sidecar.onVoiceHotkeyPress(() => drive(orchestrator.beginTalk())),
    [drive, orchestrator],
  );
  useEffect(
    () => window.sidecar.onVoiceHotkeyRelease(() => drive(orchestrator.endTalk())),
    [drive, orchestrator],
  );
  // The stop key asks for quiet from any app, exactly as Escape asks for it
  // from the panel: the microphone closes, and where Luke is speaking the
  // host tells the model to stop; a press over no session simply does
  // nothing.
  useEffect(
    () => window.sidecar.onStopHotkeyPress(() => drive(orchestrator.stopSpeaking())),
    [drive, orchestrator],
  );

  useEffect(
    () => () => {
      drive(orchestrator.stop());
    },
    [drive, orchestrator],
  );
}
