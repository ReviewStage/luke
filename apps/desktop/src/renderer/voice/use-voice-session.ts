import { sanitizedTraceEvent } from "@sidecar/devtrace/vocabulary";
import { appSettingsView } from "@sidecar/settings/wire";
import {
  type LiveVoiceBridge,
  LiveVoiceOrchestrator,
  type LiveVoiceSurroundings,
} from "@sidecar/voice/orchestrator";
import { type RefObject, useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import { VOICE_COMMAND, voiceExchangeKind } from "#shared/messages/voice-view";
import { act, tell } from "../act";
import { hostedVoiceUnavailableNote } from "../microphone-access";
import { appSettingsNow, appStateNow, useAppState } from "../use-app-state";
import { outputSilent } from "../volume-hint";
import { LiveCall } from "./live-call";
import { openPreferredMicrophone } from "./microphone-choice";
import { startVoiceLevelMeter } from "./voice-level-meter";

/**
 * How long a refused remote-audio play waits before trying again. Chromium
 * refuses transiently — an output route mid-arrival, a playback gate a later
 * state satisfies — and the words keep arriving on the stream regardless, so
 * a short clock loses less of the sentence than a longer one would.
 */
const REMOTE_AUDIO_RETRY_MS = 1_000;

/** Everything the policy asks of the main process, over the one bridge this window has. */
const BRIDGE: LiveVoiceBridge = {
  reportView: (view, exchange) =>
    window.sidecar.reportVoiceView(
      view,
      exchange === undefined ? undefined : voiceExchangeKind(exchange),
    ),
  requestMicrophone: async () =>
    (await act(ACT_KIND.MICROPHONE_REQUEST)) === MICROPHONE_STATUS.GRANTED,
  hostedUnavailableNote: async () =>
    hostedVoiceUnavailableNote(await act(ACT_KIND.VOICE_DIAGNOSTICS).catch(() => undefined)),
};

/** The two streams the meters listen to and the element plays, as the call hands them over. */
interface Streams {
  local: MediaStream | undefined;
  remote: MediaStream | undefined;
}

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
  const [streams, setStreams] = useState<Streams>({ local: undefined, remote: undefined });
  const callRef = useRef<LiveCall | undefined>(undefined);
  const orchestratorRef = useRef<LiveVoiceOrchestrator | undefined>(undefined);
  orchestratorRef.current ??= new LiveVoiceOrchestrator({
    bridge: BRIDGE,
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
        onRemoteStream: (remote) => setStreams((held) => ({ ...held, remote })),
        onLocalStream: (local) => setStreams((held) => ({ ...held, local })),
        now: () => Date.now(),
        schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
        // SAFETY: every timer the call cancels is one the scheduler above made, a window timeout handle.
        cancel: (timer) => window.clearTimeout(timer as number),
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
  const audioContext = useRef<AudioContext | undefined>(undefined);

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
  // off a missing one. The loudness the panels draw is whoever is talking.
  useEffect(() => {
    if (!streams.remote) return;
    const context = audioContext.current ?? new AudioContext({ latencyHint: "interactive" });
    audioContext.current = context;
    return startVoiceLevelMeter({
      stream: streams.remote,
      audioContext: context,
      onActivity: (active) => callRef.current?.reportRemoteAudioLevel(active),
      onLevel: (level) => {
        if (!callRef.current?.listening) window.sidecar.reportVoiceLevel(level);
      },
    });
  }, [streams.remote]);

  useEffect(() => {
    if (!streams.local) return;
    const context = audioContext.current ?? new AudioContext({ latencyHint: "interactive" });
    audioContext.current = context;
    return startVoiceLevelMeter({
      stream: streams.local,
      audioContext: context,
      onActivity: (active) => callRef.current?.reportMicrophoneActivity(active),
      onLevel: (level) => {
        if (callRef.current?.listening) window.sidecar.reportVoiceLevel(level);
      },
    });
  }, [streams.local]);

  useEffect(() => {
    const element = remoteAudio.current;
    if (!element) return;
    element.srcObject = streams.remote ?? null;
    if (!streams.remote) return;
    // A refused play is the one failure the call cannot see: Luke speaks and
    // the captions draw while nothing is heard. A session opened for a
    // briefing is exactly the one with no user gesture behind it to satisfy a
    // playback gate, so the refusal is retried for as long as the stream
    // stands rather than swallowed once.
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let detached = false;
    const play = () => {
      element.play().catch(() => {
        if (!detached) retryTimer = setTimeout(play, REMOTE_AUDIO_RETRY_MS);
      });
    };
    play();
    return () => {
      detached = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
    };
  }, [remoteAudio, streams.remote]);

  // A panel's ask, validated and forwarded by the main process. Each command
  // is the same action the panel used to perform on its own session; none opens
  // a turn the developer did not, and a Clear reaches the record on main alone.
  useEffect(
    () =>
      window.sidecar.onVoiceCommand(({ command }) => {
        if (command === VOICE_COMMAND.STOP_SPEAKING) void orchestrator.stopSpeaking();
        else if (command === VOICE_COMMAND.REQUEST_MICROPHONE_ACCESS) {
          void orchestrator.requestMicrophoneAccess();
        }
      }),
    [orchestrator],
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
    orchestrator.adoptStanding(standingPhase);
  }, [orchestrator, standingPhase, state]);
  useEffect(
    () =>
      window.sidecar.onVoiceLiveSessionChanged((change) => orchestrator.obeySessionChange(change)),
    [orchestrator],
  );

  // The talk key is registered by the main process so it answers from any app,
  // which is the whole point: no window to find, nothing to focus first. Only
  // the press decides anything: the microphone is a switch on the session, so
  // a release ends nothing. A press during a chord being recorded is held
  // back in the main process, where the recording is known.
  useEffect(
    () => window.sidecar.onVoiceHotkeyPress(() => void orchestrator.beginTalk()),
    [orchestrator],
  );
  // The stop key asks for quiet from any app, exactly as Escape asks for it
  // from the panel: the microphone closes, and the host tells the model to
  // stop speaking; a press over no session simply does nothing.
  useEffect(
    () => window.sidecar.onStopHotkeyPress(() => void orchestrator.stopSpeaking()),
    [orchestrator],
  );

  useEffect(
    () => () => {
      void orchestrator.stop();
    },
    [orchestrator],
  );
}
