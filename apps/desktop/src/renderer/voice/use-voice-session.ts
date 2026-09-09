import { sanitizedTraceEvent } from "@sidecar/devtrace/vocabulary";
import { appSettingsView } from "@sidecar/settings/wire";
import {
  VOICE_READINESS_PART,
  type VoiceBridge,
  VoiceOrchestrator,
  type VoiceReadinessPart,
  type VoiceSurroundings,
} from "@sidecar/voice/orchestrator";
import { type RefObject, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import { VOICE_COMMAND, voiceExchangeKind } from "#shared/messages/voice-view";
import { hostedVoiceUnavailableNote } from "../microphone-access";
import { appSettingsNow, appStateNow, useAppState } from "../use-app-state";
import { outputSilent } from "../volume-hint";
import { ConversationCall } from "./conversation-call";
import { openPreferredMicrophone } from "./microphone-choice";
import { SpeakOnlyCall, type SpeakOnlyCallOptions } from "./speak-only-call";
import { useVoiceThread } from "./use-voice-thread";
import { startVoiceLevelMeter } from "./voice-level-meter";

/**
 * How long a refused remote-audio play waits before trying again. Chromium
 * refuses transiently — an output route mid-arrival, a playback gate a later
 * state satisfies — and the words keep arriving on the stream regardless, so
 * a short clock loses less of the sentence than a longer one would.
 */
export const REMOTE_AUDIO_RETRY_MS = 1_000;

/**
 * The callbacks and seams every call of either kind is built with beyond the
 * ones the orchestrator supplies: the credential, the voice and pace read at
 * each handshake, the element Luke plays through, and the development trace's
 * tap. What a call may do with them is the call's own type: a speak-only one
 * has no microphone member to open and declares no tools, so nothing here can
 * widen it.
 */
function callTransport(
  remoteAudio: RefObject<HTMLAudioElement | null>,
): Pick<SpeakOnlyCallOptions, "requestConnection" | "voice" | "audioElement" | "onWireEvent"> {
  return {
    requestConnection: () => window.sidecar.requestRealtimeCredential(),
    // Read at each handshake rather than captured, so a voice or a pace
    // changed between calls is the one the next call is configured with.
    voice: () => {
      const settings = appSettingsNow();
      return {
        ...(settings?.voice ? { voice: settings.voice } : undefined),
        ...(settings?.voiceSpeed ? { speed: settings.voiceSpeed } : undefined),
      };
    },
    audioElement: () => remoteAudio.current,
    // The development trace's tap, checked at each event rather than at
    // construction because a call outlives any one version of the document
    // that says whether a writer stands behind the bridge. The audio is
    // stripped here, before the event ever crosses the sandbox.
    onWireEvent: (direction, event) => {
      if (appStateNow()?.run.agentTraceEnabled !== true) return;
      window.sidecar.recordAgentTrace({ direction, event: sanitizedTraceEvent(event) });
    },
  };
}

/** Everything the policy asks of the main process, over the one bridge this window has. */
const BRIDGE: VoiceBridge = {
  reportView: (view, exchange) =>
    window.sidecar.reportVoiceView(
      view,
      exchange === undefined ? undefined : voiceExchangeKind(exchange),
    ),
  reportReady: (epoch) => void window.sidecar.reportVoiceReady(epoch),
  appendConversation: (entries) => window.sidecar.appendConversationHistory(entries),
  settleSpeech: (id, outcome) => void window.sidecar.settleSpeech(id, outcome),
  submitBrainAsk: (submission) => window.sidecar.submitBrainAsk(submission),
  waitBrainAsk: (runId, epoch) => window.sidecar.waitBrainAsk(runId, epoch),
  claimBrainReply: (runId, deliveryId, epoch) =>
    window.sidecar.claimBrainReply(runId, deliveryId, epoch),
  ackBrainReply: (runId, deliveryId, epoch) =>
    window.sidecar.ackBrainReply(runId, deliveryId, epoch),
  requestMicrophone: async () =>
    (await window.sidecar.requestMicrophone()) === MICROPHONE_STATUS.GRANTED,
  hostedUnavailableNote: async () =>
    hostedVoiceUnavailableNote(
      await window.sidecar.requestRealtimeDiagnostics().catch(() => undefined),
    ),
};

function createOrchestrator(
  remoteAudio: RefObject<HTMLAudioElement | null>,
): VoiceOrchestrator<MediaStream> {
  return new VoiceOrchestrator<MediaStream>({
    bridge: BRIDGE,
    createSpeakOnlyCall: (hooks) => new SpeakOnlyCall({ ...callTransport(remoteAudio), ...hooks }),
    createConversationCall: (hooks) =>
      new ConversationCall({
        ...callTransport(remoteAudio),
        ...hooks,
        // The press's device, chosen by facts read natively: the Mac's own
        // microphone where a Bluetooth headset would otherwise pay for the
        // capture with its music codec, the browser's default everywhere
        // else. The switch reads at the press, so flipping it needs no
        // reconnect.
        requestMicrophoneStream: () =>
          openPreferredMicrophone({
            route: () =>
              (appSettingsNow()?.preferBuiltInMicrophone ?? true)
                ? window.sidecar.getMicrophoneRoute()
                : Promise.resolve(undefined),
            enumerate: () => navigator.mediaDevices.enumerateDevices(),
            open: (audio) => navigator.mediaDevices.getUserMedia({ audio, video: false }),
          }),
      }),
  });
}

/**
 * One subscription, standing for as long as the window does and marked in the
 * readiness ledger while it stands: the main process sends this window
 * nothing until every named part has reported.
 */
function useReportingSubscription(
  orchestrator: VoiceOrchestrator<MediaStream>,
  part: VoiceReadinessPart,
  subscribe: () => () => void,
): void {
  // Held in a ref because the closure is rebuilt on every render while what
  // it names — the orchestrator — is not: listing it as a dependency would
  // tear the subscription down and stand it back up for every render.
  const subscribeRef = useRef(subscribe);
  subscribeRef.current = subscribe;
  useEffect(() => {
    const unsubscribe = subscribeRef.current();
    orchestrator.installed(part);
    return () => {
      orchestrator.uninstalled(part);
      unsubscribe();
    };
  }, [orchestrator, part]);
}

/**
 * The spoken conversation, held in the hidden voice window so no panel does.
 * Everything it decides is {@link VoiceOrchestrator}'s, in `@sidecar/voice`,
 * which touches no DOM: what is left here is the wiring only a browser can
 * do — the two calls' transports, the level meter's `AudioContext`, the
 * element Luke's voice plays through — and the subscriptions the main process
 * reaches this window on. Nothing is drawn here.
 */
export function useVoiceSession(remoteAudio: RefObject<HTMLAudioElement | null>): void {
  const orchestratorRef = useRef<VoiceOrchestrator<MediaStream> | undefined>(undefined);
  orchestratorRef.current ??= createOrchestrator(remoteAudio);
  const orchestrator = orchestratorRef.current;
  const audioContext = useRef<AudioContext | undefined>(undefined);

  const { meterStream, remoteStream } = useSyncExternalStore(
    useMemo(() => orchestrator.subscribe.bind(orchestrator), [orchestrator]),
    useMemo(() => orchestrator.snapshot.bind(orchestrator), [orchestrator]),
  );

  useVoiceThread(orchestrator);

  /**
   * Everything this window reads rather than owns — the settings that shape a
   * call, the roster the arrival beat is worded from, the talk key its
   * suggestion names, the output the captions answer, and the holds — on the
   * one channel main holds it on, handed over whole whenever it moves.
   */
  const state = useAppState();
  const settings = useMemo(
    () => (state?.settings ? appSettingsView(state.settings) : undefined),
    [state?.settings],
  );
  useEffect(() => {
    const surroundings: VoiceSurroundings = {
      voiceAvailable: settings?.voiceAvailable,
      voice: settings?.voice,
      voiceSpeed: settings?.voiceSpeed,
      captionsEnabled: settings?.voiceCaptions === true,
      outputSilent: outputSilent(state?.audio.outputAudio),
      microphoneGranted: state?.audio.microphoneStatus === MICROPHONE_STATUS.GRANTED,
      announcementsHeld: state?.announcements.held === true,
      sessions: state?.sessions.roster.sessions ?? [],
      talkKey: state?.hotkeys.talk,
    };
    orchestrator.surround(surroundings);
  }, [orchestrator, settings, state]);

  // The meter listens to whoever holds the turn, and it is also what ends
  // Luke's turn: his reply is over when it stops being audible, not when the
  // model stops producing it, and the call decides that a pause between two
  // sentences is not an ending. The loudness itself goes to the main process
  // for the panels to draw, at a bounded rate, and only while a stream is
  // active — which is exactly while a turn is listening or responding.
  useEffect(() => {
    if (!meterStream) return;
    const context = audioContext.current ?? new AudioContext({ latencyHint: "interactive" });
    audioContext.current = context;
    return startVoiceLevelMeter({
      stream: meterStream,
      audioContext: context,
      onActivity: (active) => orchestrator.reportRemoteAudioLevel(active),
      onLevel: (level) => window.sidecar.reportVoiceLevel(level),
    });
  }, [meterStream, orchestrator]);

  useEffect(() => {
    const element = remoteAudio.current;
    if (!element) return;
    element.srcObject = remoteStream ?? null;
    if (!remoteStream) return;
    // A refused play is the one failure the call cannot see: the reply runs
    // and the captions draw while nothing is heard. The launch's first
    // speak-only call is exactly the call with no user gesture behind it to
    // satisfy a playback gate, so the refusal is retried for as long as the
    // stream stands rather than swallowed once.
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
  }, [remoteAudio, remoteStream]);

  // A panel's ask, validated and forwarded by the main process. Each command
  // is the same act the panel used to perform on its own session; none opens
  // a turn the developer did not.
  useReportingSubscription(orchestrator, VOICE_READINESS_PART.COMMANDS, () =>
    window.sidecar.onVoiceCommand(({ command }) => {
      if (command === VOICE_COMMAND.DISCARD_LISTENING) orchestrator.discardListening();
      else if (command === VOICE_COMMAND.STOP_SPEAKING) orchestrator.stopSpeaking();
      else if (command === VOICE_COMMAND.REQUEST_MICROPHONE_ACCESS) {
        void orchestrator.requestMicrophoneAccess();
      } else if (command === VOICE_COMMAND.CLEAR_CONVERSATION) orchestrator.clearConversation();
    }),
  );

  // One proactive turn the main process decided to voice now — a briefing the
  // brain decided, or an onboarding beat whose observed values are read at
  // the moment it is spoken — and the arbiter taking one back before it is
  // said.
  useReportingSubscription(orchestrator, VOICE_READINESS_PART.SPEECH_OFFERS, () =>
    window.sidecar.onSpeechOffered((offer) => orchestrator.offerSpeech(offer)),
  );
  useReportingSubscription(orchestrator, VOICE_READINESS_PART.SPEECH_WITHDRAWALS, () =>
    window.sidecar.onSpeechWithdrawn(({ id }) => orchestrator.withdrawSpeech(id)),
  );

  // The main process offering an ended run's reply, and the brain's
  // generation ending under this window, which voids whatever it offered.
  useReportingSubscription(orchestrator, VOICE_READINESS_PART.REPLY_OFFERS, () =>
    window.sidecar.onBrainReplyOffered((offer) => orchestrator.offerReply(offer)),
  );
  useReportingSubscription(orchestrator, VOICE_READINESS_PART.REPLY_WITHDRAWALS, () =>
    window.sidecar.onBrainRepliesWithdrawn(() => orchestrator.withdrawReplies()),
  );

  // The talk key is registered by the main process so it answers from any app,
  // which is the whole point: no window to find, nothing to focus first. Both
  // edges arrive, because a turn you hold ends when the key does. A press
  // during a chord being recorded is held back in the main process, where the
  // recording is known; the release always lands, so a hold opened before the
  // recording began still ends when the key comes up.
  useEffect(
    () => window.sidecar.onVoiceHotkeyPress(() => void orchestrator.beginTalk()),
    [orchestrator],
  );
  useEffect(
    () => window.sidecar.onVoiceHotkeyRelease(() => orchestrator.endTalk()),
    [orchestrator],
  );
  // The stop key asks for quiet from any app, exactly as Escape asks for it
  // from the panel: the orchestrator answers whether there is a reply to stop,
  // so a press over silence simply does nothing.
  useEffect(
    () => window.sidecar.onStopHotkeyPress(() => orchestrator.stopSpeaking()),
    [orchestrator],
  );

  useEffect(
    () => () => {
      void orchestrator.stop();
    },
    [orchestrator],
  );
}
