import {
  type AppGuideSnapshot,
  ATTENTION_SPEECH_SOURCE,
  type AttentionSpeech,
  EMPTY_APP_GUIDE,
  type NormalizedSession,
  type ObservedWorkspaceProject,
  REALTIME_STATUS,
  type RealtimeStatus,
  type RealtimeVoice,
  type RealtimeVoiceSpeed,
  type SessionIdentity,
  type TrackedIssue,
} from "@sidecar/core";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { MicrophoneStatus, SessionOpenResult, VoiceHotkeyState } from "../shared/contracts";
import { TALK_KEY_RELEASE, talkKeyRelease } from "../shared/voice-hotkey";
import { askRefusal } from "./ask-luke";
import { type AppActionCarrier, RealtimeVoiceSession } from "./realtime-session";
import { SpokenNoticeAnnouncer } from "./spoken-notices";
import { WAVEFORM_VOICE, type WaveformVoice } from "./waveform";

/**
 * What the speaking evidence run captions the reply with. A capture run never
 * opens a call, so there are no words to draw unless the fixture supplies
 * them — and it must, or the caption strip ships unphotographed. Synthetic,
 * like every fixture, and long enough to wrap: a one-line fixture would leave
 * the wrapped form of the strip unphotographed too.
 */
export const FIXTURE_SPEAKING_CAPTION =
  "Claude Code finished checkout-service, and Codex is still migrating the payments schema. Two sessions are waiting on you.";

/**
 * What a changed voice on a live call should do. The API locks a session's
 * voice the moment the model first speaks, so the one way to change it now is
 * to open a new call — but a spoken "change your voice" is confirmed in the
 * old one, so the restart waits until that turn has ended.
 */
export const VOICE_RESTART = {
  /** Nothing to do: no change, or a change that is not owed a live call. */
  NONE: "none",
  /** A restart is owed, but the turn under way has to finish first. */
  WAIT: "wait",
  /** The call ended on its own; the next one is minted in the new voice. */
  DROP: "drop",
  /** The call is idle enough to close and open again in the new voice. */
  RESTART: "restart",
} as const;

export type VoiceRestart = (typeof VOICE_RESTART)[keyof typeof VOICE_RESTART];

/**
 * Whose voice the meter is drawing. The waveform follows whoever is actually
 * talking: the developer while push-to-talk is held, Luke while it answers,
 * nobody otherwise.
 */
export function waveformVoice(status: RealtimeStatus): WaveformVoice | undefined {
  if (status === REALTIME_STATUS.RESPONDING) return WAVEFORM_VOICE.LUKE;
  if (status === REALTIME_STATUS.LISTENING) return WAVEFORM_VOICE.DEVELOPER;
  return undefined;
}

/**
 * The stream the meter should listen to for this status, or none. Typed over
 * the stream itself so the rule can be tested without a MediaStream.
 */
export function activeVoiceStream<T>(input: {
  status: RealtimeStatus;
  local: T | undefined;
  remote: T | undefined;
}): T | undefined {
  if (input.status === REALTIME_STATUS.RESPONDING) return input.remote;
  if (input.status === REALTIME_STATUS.LISTENING) return input.local;
  return undefined;
}

/**
 * The exchange is live from the press to the end of the reply — the call
 * coming up, a turn being held, Luke speaking — and the media duck follows it.
 */
export function voiceExchangeActive(status: RealtimeStatus): boolean {
  return (
    status === REALTIME_STATUS.CONNECTING ||
    status === REALTIME_STATUS.LISTENING ||
    status === REALTIME_STATUS.RESPONDING
  );
}

/**
 * The words drawn under the shape. A capture run always draws the fixture's
 * words; otherwise Luke's caption is shown only when there is a reason to
 * read them and the reply they belong to is his turn: the captions preference,
 * a reply answering an ask the developer typed, or an output that would
 * swallow the speech.
 */
export function lukeCaptionToShow(input: {
  fixtureSpeaking: boolean;
  captionsEnabled: boolean;
  typedAsk: boolean;
  outputSilent: boolean;
  voice: WaveformVoice | undefined;
  caption: string | undefined;
}): string | undefined {
  if (input.fixtureSpeaking) return FIXTURE_SPEAKING_CAPTION;
  if (
    (input.captionsEnabled || input.typedAsk || input.outputSilent) &&
    input.voice === WAVEFORM_VOICE.LUKE
  ) {
    return input.caption;
  }
  return undefined;
}

/**
 * What a talk-key press does before the session is asked. A latched turn is
 * already open — this press is someone saying they are done, which is the
 * release's to answer. Otherwise a press against no microphone call has
 * seconds of handshake ahead of it, and the meter has to answer the press,
 * not the handshake.
 */
export function talkKeyPress(input: { latched: boolean; microphoneCall: boolean }): {
  deferToRelease: boolean;
  openCall: boolean;
} {
  if (input.latched) return { deferToRelease: true, openCall: false };
  return { deferToRelease: false, openCall: !input.microphoneCall };
}

/**
 * Whether the press-wait meter should stay up. Connecting is still the
 * handshake; a pending turn is a takeover still owed a call — the meter must
 * ride across Luke's own call settling on its way to the developer's.
 */
export function talkOpeningHolds(input: { status: RealtimeStatus; turnPending: boolean }): boolean {
  return input.status === REALTIME_STATUS.CONNECTING || input.turnPending;
}

/**
 * Whether a typed ask's reply is still the one being spoken. The caption of a
 * typed conversation stays readable whatever the preference says, and clears
 * the moment the turn moves on.
 */
export function typedAskHolds(status: RealtimeStatus): boolean {
  return status === REALTIME_STATUS.RESPONDING;
}

/**
 * Whether a changed pace should be carried onto the call now open. The first
 * snapshot is the stored value rather than a change, and with no next value
 * there is nothing to apply — the next call is minted at the stored pace.
 */
export function liveSpeedApplies(
  previous: RealtimeVoiceSpeed | undefined,
  next: RealtimeVoiceSpeed | undefined,
): boolean {
  return next !== undefined && previous !== undefined && previous !== next;
}

/**
 * What a changed voice should do to a call already up. A call being opened
 * counts as one to reopen: its credential may already have been minted in the
 * old voice. A call that ended on its own owes nothing.
 */
export function voiceRestartAction(input: {
  previous: RealtimeVoice | undefined;
  next: RealtimeVoice | undefined;
  live: boolean;
  due: boolean;
  status: RealtimeStatus;
}): { due: boolean; action: VoiceRestart } {
  if (input.next === undefined) return { due: input.due, action: VOICE_RESTART.NONE };
  const due =
    input.due || (input.previous !== undefined && input.previous !== input.next && input.live);
  if (!due) return { due: false, action: VOICE_RESTART.NONE };
  if (
    input.status === REALTIME_STATUS.IDLE ||
    input.status === REALTIME_STATUS.FAILED ||
    input.status === REALTIME_STATUS.UNAVAILABLE
  ) {
    return { due: false, action: VOICE_RESTART.DROP };
  }
  if (input.status !== REALTIME_STATUS.READY) {
    return { due: true, action: VOICE_RESTART.WAIT };
  }
  return { due: false, action: VOICE_RESTART.RESTART };
}

/**
 * Status-edge notices — deterministic, worded on this machine — go to the
 * announcer, which may open a speak-only call of Luke's own to say them. An
 * evaluator summary is a model's words, so it keeps its original bound: spoken
 * only on a call the developer opened themselves.
 */
export function statusEdgeNotices(speech: readonly AttentionSpeech[]): AttentionSpeech[] {
  return speech.filter((item) => item.source === ATTENTION_SPEECH_SOURCE.STATUS_EDGE);
}

/** The other half of {@link statusEdgeNotices}: summaries that ride an open call. */
export function evaluatorSummaries(speech: readonly AttentionSpeech[]): AttentionSpeech[] {
  return speech.filter((item) => item.source !== ATTENTION_SPEECH_SOURCE.STATUS_EDGE);
}

export interface VoiceConversationOptions {
  sessions: readonly NormalizedSession[];
  workspaceProjects: readonly ObservedWorkspaceProject[];
  defaultWorkspaceProvider: string | undefined;
  voice: RealtimeVoice | undefined;
  voiceSpeed: RealtimeVoiceSpeed | undefined;
  voiceCaptions: boolean;
  /**
   * Whether a Realtime credential can be minted. Undefined until settings have
   * arrived, so the first frames of a launch do not draw the unavailable
   * state over a working key.
   */
  voiceAvailable: boolean | undefined;
  outputSilent: boolean;
  fixtureSpeaking: boolean;
  /**
   * True while a settings row is recording a chord. Both Luke keys stay
   * registered through a recording, so a press of a current chord landing then
   * is held here rather than opening the microphone under the field being
   * typed into.
   */
  capturingShortcut: () => boolean;
  /**
   * The spoken form of pressing a row. Passed in rather than reached through a
   * ref: this hook is called after the handler exists, so there is no
   * declaration-order cycle to break.
   */
  openSession: (identity: SessionIdentity) => Promise<SessionOpenResult>;
  /**
   * The spoken asks about Luke himself. Passed in on the same terms as
   * {@link openSession}.
   */
  carryAppAction: AppActionCarrier;
}

export interface VoiceConversation {
  analyser: AnalyserNode | undefined;
  microphoneStatus: MicrophoneStatus;
  setMicrophoneStatus: (status: MicrophoneStatus) => void;
  microphoneError: string | undefined;
  voiceStatus: RealtimeStatus;
  setVoiceStatus: (status: RealtimeStatus) => void;
  talkOpening: boolean;
  voiceHotkey: VoiceHotkeyState | undefined;
  handleVoiceActivity: (active: boolean) => void;
  requestMicrophoneAccess: () => Promise<void>;
  startMicrophone: () => Promise<MicrophoneStatus>;
  stopMicrophone: () => Promise<void>;
  askLuke: (text: string) => Promise<string | undefined>;
  voiceTurn: WaveformVoice | undefined;
  lukeCaption: string | undefined;
  remoteAudio: RefObject<HTMLAudioElement | null>;
  /** Escape out of an open turn: forget the press and the latch, and stop listening. */
  discardListening: () => void;
  stopSpeaking: () => boolean;
  syncGuide: (guide: AppGuideSnapshot) => void;
  syncIssues: (issues: readonly TrackedIssue[] | undefined) => void;
}

/**
 * The spoken conversation: talk key, quiet timer, meter, captions, a changed
 * voice or pace on a live call, and the announcer that lets Luke speak into
 * silence. One cluster, so the rules it is made of can be tested apart from
 * the panel that draws around them.
 */
export function useVoiceConversation(options: VoiceConversationOptions): VoiceConversation {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [analyser, setAnalyser] = useState<AnalyserNode>();
  const [microphoneStatus, setMicrophoneStatus] = useState<MicrophoneStatus>("not-determined");
  const [microphoneError, setMicrophoneError] = useState<string>();
  const [voiceStatus, setVoiceStatus] = useState<RealtimeStatus>(REALTIME_STATUS.IDLE);
  /**
   * A pressed talk key still waiting for the call it asked to open. The meter
   * is drawn from this rather than from the connection, because the press is
   * the moment the developer needs answering: the handshake behind it takes
   * seconds, and a key that visibly does nothing for that long reads as a key
   * that did nothing.
   */
  const [talkOpening, setTalkOpening] = useState(false);
  const [voiceHotkey, setVoiceHotkey] = useState<VoiceHotkeyState>();
  const [localStream, setLocalStream] = useState<MediaStream>();
  const [remoteStream, setRemoteStream] = useState<MediaStream>();
  const [voiceCaption, setVoiceCaption] = useState<string>();
  /**
   * Whether the reply under way answers an ask the developer typed. A typed
   * ask is read, not only heard, so its reply draws the caption whatever the
   * captions preference says — the preference is about speech being
   * duplicated, and here the words are the half of the conversation the
   * developer chose. Cleared the moment the turn moves on.
   */
  const [typedAsk, setTypedAsk] = useState(false);

  const audioContext = useRef<AudioContext | undefined>(undefined);
  const remoteAudio = useRef<HTMLAudioElement | null>(null);
  const voiceSession = useRef<RealtimeVoiceSession | undefined>(undefined);
  const announcer = useRef<SpokenNoticeAnnouncer | undefined>(undefined);
  /** When the talk key went down, which is what tells a hold from a tap. */
  const talkPressedAt = useRef<number | undefined>(undefined);
  /** Whether a tap has left a turn open for a later press to end. */
  const talkLatched = useRef(false);
  const sessionsRef = useRef(options.sessions);
  const workspaceProjectsRef = useRef(options.workspaceProjects);
  const defaultWorkspaceProviderRef = useRef(options.defaultWorkspaceProvider);
  const guideRef = useRef<AppGuideSnapshot>(EMPTY_APP_GUIDE);
  const issuesRef = useRef<readonly TrackedIssue[] | undefined>(undefined);

  const ensureVoiceSession = useCallback((): RealtimeVoiceSession => {
    voiceSession.current ??= new RealtimeVoiceSession({
      requestConnection: () => window.sidecar.requestRealtimeCredential(),
      // The same bridge calls the rows use — the composer, the chips, and the
      // press that opens a session: a spoken ask is a third way to ask for the
      // same act, behind the same gauntlet in the main process.
      carryAction: (action) =>
        action.kind === "message"
          ? window.sidecar.sendSessionMessage(action.identity, action.text)
          : action.kind === "control"
            ? window.sidecar.executeSessionControl(action.identity, action.control.id)
            : action.kind === "create-workspace"
              ? window.sidecar.createSessionWorkspace(
                  action.providerId,
                  action.providerProjectId,
                  action.name,
                  action.task,
                  action.agentSelection,
                )
              : action.kind === "add-agent"
                ? window.sidecar.addWorkspaceAgent(
                    action.identity,
                    action.agent,
                    action.name,
                    action.task,
                    action.model,
                    action.effort,
                  )
                : optionsRef.current.openSession(action.identity),
      // The asks about Luke himself — a settings change, the panel shown —
      // behind the same gauntlet: validated against the guide before this is
      // called, and performed by the same handlers the panel's controls use.
      carryAppAction: (action) => optionsRef.current.carryAppAction(action),
      // The issue acts have no rows to share a bridge call with, but the shape
      // is the same: validated against the roster here, and again in the main
      // process against what it observed.
      carryIssueAction: (action) => window.sidecar.executeIssueAction(action),
      onStatus: setVoiceStatus,
      onLocalStream: setLocalStream,
      onRemoteStream: setRemoteStream,
      onError: setMicrophoneError,
      onCaption: setVoiceCaption,
    });
    return voiceSession.current;
  }, []);

  /**
   * The announcer that lets Luke speak into silence: it queues the notices the
   * main process decided to voice and, when no conversation is open, opens a
   * speak-only call of Luke's own to say them through — then closes it. Built
   * beside the session because it drives nothing else.
   */
  const ensureAnnouncer = useCallback((): SpokenNoticeAnnouncer => {
    announcer.current ??= new SpokenNoticeAnnouncer({
      session: () => ensureVoiceSession(),
    });
    return announcer.current;
  }, [ensureVoiceSession]);

  const stopMicrophone = useCallback(async () => {
    // The call is gone, so a tap-to-keep-open turn cannot still be open. Leaving
    // the latch set would make the next press — after a key is connected again —
    // look like the end of that turn and do nothing.
    talkLatched.current = false;
    talkPressedAt.current = undefined;
    await voiceSession.current?.close();
  }, []);

  // Voice arriving and voice going away. It is not read from bootstrap, because
  // it is no longer only true of a launch: a key entered in the panel turns a
  // session that reported itself unavailable into one that can connect, without a
  // relaunch — and deleting that key has to close whatever call is open rather
  // than leave a live microphone answering a talk key the main process has
  // already given back.
  useEffect(() => {
    const voiceAvailable = options.voiceAvailable;
    // Not yet known. Saying "off" before the answer arrives would draw the
    // unavailable state over a working key for the first frames of every launch.
    if (voiceAvailable === undefined) return;
    if (!voiceAvailable) {
      void stopMicrophone().then(() => {
        // The close is async. A key deleted and reconnected while it was in
        // flight has already rebuilt a minter; forcing unavailable then would
        // leave the talk key looking dead over a live credential.
        if (optionsRef.current.voiceAvailable === false) {
          setVoiceStatus(REALTIME_STATUS.UNAVAILABLE);
        }
      });
      return;
    }
    // Only the status voice being off put there is lifted. Anything else — a
    // failure, a call already open — is the session's own to report.
    if (voiceStatus === REALTIME_STATUS.UNAVAILABLE) {
      setVoiceStatus(REALTIME_STATUS.IDLE);
    }
  }, [options.voiceAvailable, stopMicrophone, voiceStatus]);

  /**
   * Opens the call, answering with what the system said about the microphone —
   * the one fact a caller that could not send anything needs in order to say
   * why.
   */
  const startMicrophone = useCallback(async (): Promise<MicrophoneStatus> => {
    setMicrophoneError(undefined);
    const session = ensureVoiceSession();
    const permission = await window.sidecar.requestMicrophone();
    setMicrophoneStatus(permission);
    if (permission !== "granted") {
      // The press that asked for this is still waiting for a call that is now
      // not coming. The status never changes on this path, so the meter the
      // press put up is taken down here rather than by a status settling.
      session.dropPendingTurn();
      setTalkOpening(false);
      return permission;
    }
    if (await session.connect()) {
      session.updateSessions(sessionsRef.current);
      session.updateWorkspaceProjects(
        workspaceProjectsRef.current,
        defaultWorkspaceProviderRef.current,
      );
      session.updateGuide(guideRef.current);
      session.updateIssues(issuesRef.current);
    }
    return permission;
  }, [ensureVoiceSession]);

  /**
   * Luke's reply is over when it stops being audible, not when the model stops
   * producing it. The meter is already measuring the stream, so the quiet it
   * reports is what ends the turn — and the session is what decides that a
   * pause between two sentences is not an ending.
   */
  const handleVoiceActivity = useCallback((active: boolean) => {
    voiceSession.current?.reportRemoteAudioLevel(active);
  }, []);

  /**
   * Asks the system for access and nothing else. Opening a call here would hold
   * the capture device and light the microphone indicator without anyone having
   * pressed the talk key, which is not what the row offers.
   */
  const requestMicrophoneAccess = useCallback(async () => {
    setMicrophoneStatus(await window.sidecar.requestMicrophone());
  }, []);

  /**
   * The talk key going down. Every press goes to the session, including the one
   * that has no call to press against yet: the microphone opens with the call,
   * so a press before then is remembered and applied when it comes up.
   */
  const beginTalk = useCallback(async () => {
    talkPressedAt.current = performance.now();
    // A latched turn is already open. This press is someone saying they are
    // done, which is the release's to answer.
    if (talkLatched.current) return;
    const session = ensureVoiceSession();
    session.beginTurn();
    const press = talkKeyPress({ latched: false, microphoneCall: session.microphoneCall });
    // A press against no call — or against Luke's own speak-only call, which
    // has no microphone to offer — has seconds of handshake ahead of it, and
    // the meter has to answer the press, not the handshake.
    if (press.openCall) setTalkOpening(true);
    // The developer's call is up or already coming; the press waits its turn.
    if (!press.openCall) return;
    // `connect` inside stands Luke's own call down if one is open: the
    // developer pressing the key always gets the developer's call.
    await startMicrophone();
  }, [ensureVoiceSession, startMicrophone]);

  /**
   * The talk key coming up. How long it was held is the whole of the decision:
   * held, the turn was as long as the key was down and is sent; tapped, it
   * stays open for the question too long to hold through, and the next release
   * sends it.
   */
  const endTalk = useCallback(() => {
    const pressedAt = talkPressedAt.current;
    talkPressedAt.current = undefined;
    // A release with nothing before it is not this key's to answer — a turn
    // ended by Escape leaves the key still down.
    if (pressedAt === undefined) return;
    const release = talkKeyRelease({
      heldMs: performance.now() - pressedAt,
      latched: talkLatched.current,
    });
    if (release === TALK_KEY_RELEASE.LATCH) {
      talkLatched.current = true;
      return;
    }
    talkLatched.current = false;
    // A held press let go of before the call opened is dropped, not sent —
    // nothing was captured to send — and the meter it put up leaves with it.
    if (voiceSession.current && !voiceSession.current.isConnected) setTalkOpening(false);
    voiceSession.current?.endTurn(true);
  }, []);

  /**
   * A typed ask to Luke himself. It rides the same call the talk key opens —
   * permission, connect, then the turn — and opens the same kind of turn:
   * typing is the developer asking in their own words, so the turn may carry
   * a tool the way a spoken one may, behind the same roster gauntlet. Answers
   * with why the ask could not go, or nothing when it did — the reply is
   * spoken, and its words land under the panel as the answer.
   */
  const askLuke = useCallback(
    async (text: string): Promise<string | undefined> => {
      const session = ensureVoiceSession();
      let microphone: MicrophoneStatus = "granted";
      // Luke's own speak-only call cannot carry a typed ask — it was sent no
      // roster to validate one against — so it counts as no call here, and
      // `connect` inside stands it down for the developer's own. A microphone
      // call still connecting is awaited exactly as before.
      if (!session.isConnected || !session.microphoneCall) {
        microphone = await startMicrophone();
      }
      if (session.sendText(text)) {
        setTypedAsk(true);
        return undefined;
      }
      return askRefusal(session.status, microphone);
    },
    [ensureVoiceSession, startMicrophone],
  );

  const discardListening = useCallback(() => {
    talkLatched.current = false;
    talkPressedAt.current = undefined;
    voiceSession.current?.stopListening(false);
  }, []);

  const stopSpeaking = useCallback(() => voiceSession.current?.stopSpeaking() === true, []);

  const syncGuide = useCallback((guide: AppGuideSnapshot) => {
    guideRef.current = guide;
    voiceSession.current?.updateGuide(guide);
  }, []);

  const syncIssues = useCallback((issues: readonly TrackedIssue[] | undefined) => {
    issuesRef.current = issues;
    voiceSession.current?.updateIssues(issues);
  }, []);

  const heardSpeed = useRef<RealtimeVoiceSpeed | undefined>(undefined);
  useEffect(() => {
    const speed = options.voiceSpeed;
    if (speed === undefined) return;
    const previous = heardSpeed.current;
    heardSpeed.current = speed;
    if (!liveSpeedApplies(previous, speed)) return;
    voiceSession.current?.applySpeed(speed);
  }, [options.voiceSpeed]);

  const heardVoice = useRef<RealtimeVoice | undefined>(undefined);
  const voiceRestartDue = useRef(false);
  useEffect(() => {
    const decided = voiceRestartAction({
      previous: heardVoice.current,
      next: options.voice,
      live:
        voiceSession.current?.isConnected === true || voiceSession.current?.isConnecting === true,
      due: voiceRestartDue.current,
      status: voiceStatus,
    });
    if (options.voice !== undefined) heardVoice.current = options.voice;
    voiceRestartDue.current = decided.due;
    if (decided.action !== VOICE_RESTART.RESTART) return;
    void (async () => {
      await voiceSession.current?.close();
      await startMicrophone();
    })();
  }, [options.voice, startMicrophone, voiceStatus]);

  const activeStream = activeVoiceStream({
    status: voiceStatus,
    local: localStream,
    remote: remoteStream,
  });

  useEffect(() => {
    if (!activeStream) {
      setAnalyser(undefined);
      return;
    }
    const context = audioContext.current ?? new AudioContext({ latencyHint: "interactive" });
    audioContext.current = context;
    // A suspended context reads a flatline whatever the microphone hears, and
    // the talk key is a system shortcut, so no user gesture in this window has
    // ever vouched for the context. Resuming is a no-op when it is running.
    if (context.state === "suspended") void context.resume();
    const source = context.createMediaStreamSource(activeStream);
    const nextAnalyser = context.createAnalyser();
    nextAnalyser.fftSize = 256;
    nextAnalyser.smoothingTimeConstant = 0.82;
    source.connect(nextAnalyser);
    setAnalyser(nextAnalyser);
    return () => {
      source.disconnect();
      setAnalyser(undefined);
    };
  }, [activeStream]);

  useEffect(() => {
    // The reply that answered the typed ask is over, so the caption goes
    // back to being the preference's to grant.
    if (!typedAskHolds(voiceStatus)) {
      setTypedAsk(false);
    }
    // Any settled status ends the wait the press started, however it ended:
    // listening takes the meter live, ready means the turn was dropped
    // mid-handshake, and a failure has its own message to show. Unless the
    // press is still owed a turn — a takeover passes through Luke's own call
    // settling on its way to the developer's, and the meter must ride across.
    if (
      !talkOpeningHolds({
        status: voiceStatus,
        turnPending: voiceSession.current?.turnPending === true,
      })
    ) {
      setTalkOpening(false);
    }
  }, [voiceStatus]);

  useEffect(() => {
    window.sidecar.setVoiceExchangeActive(voiceExchangeActive(voiceStatus));
  }, [voiceStatus]);

  useEffect(() => {
    const element = remoteAudio.current;
    if (!element) return;
    element.srcObject = remoteStream ?? null;
    if (remoteStream) void element.play().catch(() => undefined);
  }, [remoteStream]);

  useEffect(() => {
    sessionsRef.current = options.sessions;
    voiceSession.current?.updateSessions(options.sessions);
  }, [options.sessions]);

  useEffect(() => {
    workspaceProjectsRef.current = options.workspaceProjects;
    defaultWorkspaceProviderRef.current = options.defaultWorkspaceProvider;
    voiceSession.current?.updateWorkspaceProjects(
      options.workspaceProjects,
      options.defaultWorkspaceProvider,
    );
  }, [options.defaultWorkspaceProvider, options.workspaceProjects]);

  useEffect(() => {
    return window.sidecar.onAttentionSpeech((speech) => {
      const notices = statusEdgeNotices(speech);
      if (notices.length > 0) ensureAnnouncer().enqueue(notices);
      const session = voiceSession.current;
      if (!session?.microphoneCall) return;
      for (const item of evaluatorSummaries(speech)) session.speak(item);
    });
  }, [ensureAnnouncer]);

  // The announcer paces itself by the session's status: READY is when a queued
  // sentence can speak and when an empty queue starts the walk toward closing
  // the call Luke opened for himself.
  useEffect(() => {
    announcer.current?.onStatus(voiceStatus);
  }, [voiceStatus]);

  // The talk key is registered by the main process so it answers from any app,
  // which is the whole point: no window to find, nothing to focus first. Both
  // edges arrive, because a turn you hold ends when the key does. Only the
  // press defers to a chord being recorded: the release always lands, so a
  // hold opened before the recording began still ends when the key comes up
  // rather than leaving the microphone open under the field — and a release
  // whose press was held back finds nothing pressed and answers nothing.
  useEffect(
    () =>
      window.sidecar.onVoiceHotkeyPress(() => {
        if (!optionsRef.current.capturingShortcut()) void beginTalk();
      }),
    [beginTalk],
  );
  useEffect(() => window.sidecar.onVoiceHotkeyRelease(endTalk), [endTalk]);
  useEffect(() => window.sidecar.onVoiceHotkeyChanged(setVoiceHotkey), []);
  // The stop key asks for quiet from any app, exactly as Escape asks for it
  // from the panel: the session itself answers whether there is a reply to
  // stop, so a press over silence simply does nothing. It defers to a chord
  // being recorded on the talk key's terms — the keystroke there is an answer
  // to the field, not an ask of Luke.
  useEffect(
    () =>
      window.sidecar.onStopHotkeyPress(() => {
        if (!optionsRef.current.capturingShortcut()) voiceSession.current?.stopSpeaking();
      }),
    [],
  );

  useEffect(
    () => () => {
      void voiceSession.current?.close();
    },
    [],
  );

  const voiceTurn = waveformVoice(voiceStatus);
  const lukeCaption = lukeCaptionToShow({
    fixtureSpeaking: options.fixtureSpeaking,
    captionsEnabled: options.voiceCaptions,
    typedAsk,
    outputSilent: options.outputSilent,
    voice: voiceTurn,
    caption: voiceCaption,
  });

  return {
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
  };
}
