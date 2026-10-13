import { useAtomValue } from "@effect/atom-react/Hooks";
import { PRODUCT_EXCHANGE_KIND } from "@sidecar/analytics";
import { sanitizedTraceEvent } from "@sidecar/devtrace/vocabulary";
import { appSettingsView } from "@sidecar/settings/wire";
import {
  type LiveVoiceBridge,
  LiveVoiceOrchestrator,
  type LiveVoiceSurroundings,
} from "@sidecar/voice/orchestrator";
import { Duration, Effect, Schedule } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { type RefObject, useCallback, useEffect, useRef } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import { AVATAR_STATUS } from "#shared/messages/avatar";
import { VOICE_COMMAND } from "#shared/messages/voice-view";
import { useAct } from "../act";
import { hostedVoiceUnavailableNote } from "../microphone-access";
import { rendererRegistry, rendererServicesNow } from "../renderer-runtime";
import { appSettingsNow, appStateNow, useAppState } from "../use-app-state";
import { outputSilent } from "../volume-hint";
import { type AvatarAudioActs, LiveCall, type LiveStreamSlot } from "./live-call";
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

/** One of the two atoms as the slot a call shows its stream in and reads back before clearing it. */
function atomSlot(atom: Atom.Writable<MediaStream | undefined>): LiveStreamSlot {
  return {
    current: () => rendererRegistry.get(atom),
    show: (stream) => rendererRegistry.set(atom, stream),
  };
}

/**
 * The spoken conversation, held in the hidden voice window so no panel does.
 * Everything it decides is {@link LiveVoiceOrchestrator}'s, in `@sidecar/voice`,
 * which touches no DOM: what is left here is the wiring only a browser can
 * do — the peer connection, the capture device, the level meters'
 * `AudioContext`, the element Luke's voice plays through — and the
 * subscriptions the main process reaches this window on. Nothing is drawn
 * here, and nothing here appends to the model: every append is the host's.
 * `avatarAudio` is where Luke's voice goes while a face stands on the call;
 * absent, no face is fed and the element is never muted for one.
 */
export function useVoiceSession(
  remoteAudio: RefObject<HTMLAudioElement | null>,
  avatarAudio?: AvatarAudioActs,
): void {
  const { act, tell } = useAct();
  const local = useAtomValue(localStreamAtom);
  const remote = useAtomValue(remoteStreamAtom);
  const callRef = useRef<LiveCall | undefined>(undefined);
  const orchestratorRef = useRef<LiveVoiceOrchestrator | undefined>(undefined);
  // Read at each call's construction, since the orchestrator and its factory outlive this render.
  const avatarAudioRef = useRef(avatarAudio);
  avatarAudioRef.current = avatarAudio;
  /**
   * Why Luke's voice is not played: the stop silencing the utterance it cut
   * short, and the developer's speaker toggle. The element is muted while
   * either stands, and never the stream, which the meter reads.
   */
  const outputSilenced = useRef(false);
  const speakerMuted = useRef(false);
  /**
   * Whether the face is drawing and speaking for Luke in the call window, so
   * his voice here would be heard twice. Note that the element is muted
   * rather than detached, because Chromium renders a remote WebRTC stream
   * into the tee's audio graph only while an element plays it.
   */
  const avatarVoicing = useRef(false);
  const playRemoteAudio = () => {
    if (remoteAudio.current) {
      remoteAudio.current.muted =
        outputSilenced.current || speakerMuted.current || avatarVoicing.current;
    }
  };
  /** Everything the policy asks of the main process, over the one bridge this window has. */
  const bridge: LiveVoiceBridge = {
    // Every exchange is a spoken one: a call is only ever opened by a press.
    // The speaker toggle is the view's, so it is played as reported.
    reportView: (view, exchangeOpened) => {
      speakerMuted.current = view.speakerMuted;
      playRemoteAudio();
      window.sidecar.reportVoiceView(
        view,
        exchangeOpened ? PRODUCT_EXCHANGE_KIND.SPOKEN : undefined,
      );
    },
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
    services: rendererServicesNow(),
    createCall: (events) => {
      const call = new LiveCall({
        events,
        acts: {
          createSession: (sdp, planId) => act(ACT_KIND.VOICE_CREATE_LIVE_SESSION, { sdp, planId }),
          endSession: (request) => tell(ACT_KIND.VOICE_END_LIVE_SESSION, request),
          reportTransport: (report) => tell(ACT_KIND.VOICE_REPORT_LIVE_TRANSPORT, report),
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
        remoteStream: atomSlot(remoteStreamAtom),
        localStream: atomSlot(localStreamAtom),
        // The element alone is muted, never the stream: the meter reads the
        // stream, and is what tells the call when the silenced utterance ends.
        onOutputSilenced: (silenced) => {
          outputSilenced.current = silenced;
          playRemoteAudio();
        },
        avatar: avatarAudioRef.current ? { acts: avatarAudioRef.current } : undefined,
        services: rendererServicesNow(),
        // The development trace's tap, checked at each event rather than at
        // construction because a session outlives any one version of the
        // document that says whether a writer stands behind the bridge.
        onWireEvent: (direction, event) => {
          if (appStateNow()?.run.agentTraceEnabled !== true) return;
          window.sidecar.recordAgentTrace({ direction, event: sanitizedTraceEvent(event) });
        },
      });
      call.reportAvatarStatus(appStateNow()?.voice.avatar.status ?? AVATAR_STATUS.OFF);
      callRef.current = call;
      return call;
    },
  });
  const orchestrator = orchestratorRef.current;
  /**
   * Every verb of the orchestrator is an Effect, and this window is the edge
   * that runs one: a key press, a command, or the host's own word starts a
   * fiber under the renderer's own services, which are the same services the
   * call beneath already runs its session's life under.
   */
  const drive = useCallback((effect: Effect.Effect<unknown>) => {
    Effect.runForkWith(rendererServicesNow())(effect);
  }, []);
  /**
   * The stop, from the key or the panel: the face is told to drop what it
   * buffered behind Luke's voice whether or not his own track still speaks,
   * since it runs behind that track.
   */
  const stopSpeaking = useCallback(() => {
    callRef.current?.interruptAvatar();
    drive(orchestrator.stopSpeaking());
  }, [drive, orchestrator]);
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

  // The face's status as main holds it: the call tees Luke's voice into it
  // from the ask on, and the element goes quiet only once the face speaks
  // for him, and plays again once it is down.
  const avatarStatus = state?.voice.avatar.status ?? AVATAR_STATUS.OFF;
  useEffect(() => {
    avatarVoicing.current = avatarAudio !== undefined && avatarStatus === AVATAR_STATUS.LIVE;
    playRemoteAudio();
    callRef.current?.reportAvatarStatus(avatarStatus);
  }, [avatarAudio, avatarStatus]);

  // Two meters over one context: Luke's track decides the speaking status,
  // since the guide forbids reading it off transcript events, and the
  // microphone's track decides idle, since the guide forbids reading silence
  // off a missing one.
  useEffect(() => {
    if (!remote) return;
    const context = audioContext.current ?? new AudioContext({ latencyHint: "interactive" });
    audioContext.current = context;
    return startVoiceLevelMeter({
      stream: remote,
      audioContext: context,
      onActivity: (active) => callRef.current?.reportRemoteAudioLevel(active),
    });
  }, [remote]);

  useEffect(() => {
    if (!local) return;
    const context = audioContext.current ?? new AudioContext({ latencyHint: "interactive" });
    audioContext.current = context;
    return startVoiceLevelMeter({
      stream: local,
      audioContext: context,
      onActivity: (active) => callRef.current?.reportMicrophoneActivity(active),
    });
  }, [local]);

  useEffect(() => {
    const element = remoteAudio.current;
    if (!element) return;
    element.srcObject = remote ?? null;
    if (!remote) return;
    // A refused play is the one failure the call cannot see: Luke speaks and
    // the captions draw while nothing is heard, so the refusal is retried for as long as the stream
    // stands rather than swallowed once, under the renderer's own services
    // rather than a timer seam.
    const fiber = Effect.runForkWith(rendererServicesNow())(
      Effect.retry(
        Effect.tryPromise(() => element.play()),
        Schedule.spaced(Duration.millis(REMOTE_AUDIO_RETRY_MS)),
      ),
    );
    return () => {
      fiber.interruptUnsafe();
    };
  }, [remoteAudio, remote]);

  // A panel's ask, validated and forwarded by the main process. Each command
  // is the same action the panel used to perform on its own session; none opens
  // a turn the developer did not, and a Clear reaches the record on main alone.
  useEffect(
    () =>
      window.sidecar.onVoiceCommand(({ command }) => {
        if (command === VOICE_COMMAND.STOP_SPEAKING) stopSpeaking();
        else if (command === VOICE_COMMAND.END_CALL) drive(orchestrator.stopCall());
        else if (command === VOICE_COMMAND.TOGGLE_MICROPHONE)
          drive(orchestrator.toggleMicrophone());
        else if (command === VOICE_COMMAND.MUTE_SPEAKER) drive(orchestrator.muteSpeaker(true));
        else if (command === VOICE_COMMAND.UNMUTE_SPEAKER) drive(orchestrator.muteSpeaker(false));
        else if (command === VOICE_COMMAND.REQUEST_MICROPHONE_ACCESS) {
          drive(orchestrator.requestMicrophoneAccess());
        }
      }),
    [drive, orchestrator, stopSpeaking],
  );

  // The Plans tab's microphone, about the plan the panel had open: a call about
  // that plan opened and heard, or its microphone toggled, as the main process
  // forwards the press.
  useEffect(
    () => window.sidecar.onPlanningTalk(({ planId }) => drive(orchestrator.talkAboutPlan(planId))),
    [drive, orchestrator],
  );

  // The host's word on its one session: closing hangs up.
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
  // recording still ends. A press made while the panel has a plan open names
  // that plan, and is heard on that plan's call.
  useEffect(
    () =>
      window.sidecar.onVoiceHotkeyPress((press) => drive(orchestrator.beginTalk(press?.planId))),
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
  useEffect(() => window.sidecar.onStopHotkeyPress(stopSpeaking), [stopSpeaking]);

  useEffect(
    () => () => {
      drive(orchestrator.stop());
    },
    [drive, orchestrator],
  );
}
