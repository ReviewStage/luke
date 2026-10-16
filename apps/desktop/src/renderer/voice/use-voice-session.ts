import { useAtomValue } from "@effect/atom-react/Hooks";
import { PRODUCT_EXCHANGE_KIND } from "@luke/features/analytics";
import { sanitizedTraceEvent } from "@luke/gateway/devtrace";
import { ACT_KIND } from "@luke/host/acts";
import { appSettingsView } from "@luke/settings/wire";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { AVATAR_STATUS } from "@luke/voice/avatar";
import { hostedVoiceUnavailableNote } from "@luke/voice/microphone-access";
import {
  type LiveVoiceBridge,
  LiveVoiceOrchestrator,
  type LiveVoiceSurroundings,
} from "@luke/voice/orchestrator";
import { VOICE_COMMAND } from "@luke/voice/voice-view";
import { outputSilent } from "@luke/voice/volume-hint";
import { Duration, Effect, Schedule } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { type RefObject, useCallback, useEffect, useRef } from "react";
import { useAct } from "../act";
import { startAvatarFeed } from "../avatar-feed/start-avatar-feed";
import { rendererRegistry, rendererServicesNow } from "../renderer-runtime";
import { appSettingsNow, appStateNow, useAppState } from "../use-app-state";
import { type AvatarFeedActs, LiveCall, type LiveStreamSlot } from "./live-call";
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
 * Everything it decides is {@link LiveVoiceOrchestrator}'s, in `@luke/voice`,
 * which touches no DOM: what is left here is the wiring only a browser can
 * do — the peer connection, the capture device, the level meters'
 * `AudioContext`, the element Luke's voice plays through — and the
 * subscriptions the main process reaches this window on. Nothing is drawn
 * here, and nothing here appends to the model: every append is the host's.
 *
 * With `avatarFeed`, Luke's voice is also teed to his avatar while the call
 * window shows one, and the element is muted while the avatar voices him.
 * Like the acts, it is read once, when the window's orchestrator is made.
 */
export function useVoiceSession(
  remoteAudio: RefObject<HTMLAudioElement | null>,
  avatarFeed?: AvatarFeedActs,
): void {
  const { act, tell } = useAct();
  const local = useAtomValue(localStreamAtom);
  const remote = useAtomValue(remoteStreamAtom);
  const callRef = useRef<LiveCall | undefined>(undefined);
  const orchestratorRef = useRef<LiveVoiceOrchestrator | undefined>(undefined);
  /**
   * Why Luke's voice is not played: the stop silencing the utterance it cut
   * short, the developer's speaker toggle, and his avatar voicing him in the
   * element's place. The element is muted while any stands, and never the
   * stream, which the meter and the avatar's tee read.
   */
  const outputSilenced = useRef(false);
  const speakerMuted = useRef(false);
  const avatarVoiced = useRef(false);
  const playRemoteAudio = () => {
    if (remoteAudio.current) {
      remoteAudio.current.muted =
        outputSilenced.current || speakerMuted.current || avatarVoiced.current;
    }
  };
  /** Everything the policy asks of the main process, over the one bridge this window has. */
  const bridge: LiveVoiceBridge = {
    // Every exchange is a spoken one: a call is only ever opened by a press.
    // The speaker toggle is the view's, so it is played as reported.
    reportView: (view, exchangeOpened) => {
      speakerMuted.current = view.speakerMuted;
      playRemoteAudio();
      window.luke.reportVoiceView(view, exchangeOpened ? PRODUCT_EXCHANGE_KIND.SPOKEN : undefined);
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
          createSession: (sdp, taskId) =>
            act(ACT_KIND.VOICE_CREATE_LIVE_SESSION, { sdp, taskId: taskId }),
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
        ...(avatarFeed && {
          avatarFeed: {
            acts: avatarFeed,
            startTee: startAvatarFeed,
            onAvatarVoiced: (voiced: boolean) => {
              avatarVoiced.current = voiced;
              playRemoteAudio();
            },
          },
        }),
        services: rendererServicesNow(),
        // The development trace's tap, checked at each event rather than at
        // construction because a session outlives any one version of the
        // document that says whether a writer stands behind the bridge.
        onWireEvent: (direction, event) => {
          if (appStateNow()?.run.agentTraceEnabled !== true) return;
          window.luke.recordAgentTrace({ direction, event: sanitizedTraceEvent(event) });
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

  // The avatar's status as the panel reported it, for the call to hand
  // Luke's voice over to it, or take it back.
  const avatarStatus = state?.voice.avatar.status ?? AVATAR_STATUS.OFF;
  useEffect(() => {
    callRef.current?.reportAvatarStatus(avatarStatus);
  }, [avatarStatus]);

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
      window.luke.onVoiceCommand(({ command }) => {
        if (command === VOICE_COMMAND.STOP_SPEAKING) {
          callRef.current?.interruptAvatar();
          drive(orchestrator.stopSpeaking());
        } else if (command === VOICE_COMMAND.END_CALL) {
          // The graceful close can take its bound, and the avatar must not talk on through it.
          callRef.current?.interruptAvatar();
          drive(orchestrator.stopCall());
        } else if (command === VOICE_COMMAND.TOGGLE_MICROPHONE)
          drive(orchestrator.toggleMicrophone());
        else if (command === VOICE_COMMAND.MUTE_SPEAKER) drive(orchestrator.muteSpeaker(true));
        else if (command === VOICE_COMMAND.UNMUTE_SPEAKER) drive(orchestrator.muteSpeaker(false));
        else if (command === VOICE_COMMAND.REQUEST_MICROPHONE_ACCESS) {
          drive(orchestrator.requestMicrophoneAccess());
        }
      }),
    [drive, orchestrator],
  );

  // The Plans tab's microphone, about the plan the panel had open: a call about
  // that plan opened and heard, or its microphone toggled, as the main process
  // forwards the press.
  useEffect(
    () => window.luke.onTasksTalk(({ taskId }) => drive(orchestrator.talkAboutTask(taskId))),
    [drive, orchestrator],
  );

  // The host's word on its one session: closing hangs up.
  useEffect(
    () =>
      window.luke.onVoiceLiveSessionChanged((change) =>
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
  // The call is told too, since a hold over Luke gone quiet flushes his avatar.
  useEffect(
    () =>
      window.luke.onVoiceHotkeyPress((press) => {
        callRef.current?.reportTalkKey(true);
        drive(orchestrator.beginTalk(press?.taskId));
      }),
    [drive, orchestrator],
  );
  useEffect(
    () =>
      window.luke.onVoiceHotkeyRelease(() => {
        callRef.current?.reportTalkKey(false);
        drive(orchestrator.endTalk());
      }),
    [drive, orchestrator],
  );
  // The stop key asks for quiet from any app, exactly as Escape asks for it
  // from the panel: the microphone closes, and where Luke is speaking the
  // host tells the model to stop; a press over no session simply does
  // nothing. Luke's avatar, a second behind him, is flushed at once.
  useEffect(
    () =>
      window.luke.onStopHotkeyPress(() => {
        callRef.current?.interruptAvatar();
        drive(orchestrator.stopSpeaking());
      }),
    [drive, orchestrator],
  );

  useEffect(
    () => () => {
      drive(orchestrator.stop());
    },
    [drive, orchestrator],
  );
}
