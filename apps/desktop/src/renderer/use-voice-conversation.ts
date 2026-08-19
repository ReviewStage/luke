import {
  type AppGuideSnapshot,
  ATTENTION_SPEECH_SOURCE,
  type AttentionSpeech,
  type CarriedSessionAction,
  dispatchByKind,
  EMPTY_APP_GUIDE,
  mentionedIssues,
  mentionedSessions,
  type NormalizedSession,
  type ObservedWorkspaceProject,
  REALTIME_STATUS,
  type RealtimeStatus,
  type RealtimeVoice,
  type RealtimeVoiceSpeed,
  SESSION_MENTION_KIND,
  SESSION_TOOL_KIND,
  type SessionIdentity,
  type SessionMention,
  type SessionNoticeAsk,
  type TrackedIssue,
} from "@sidecar/core";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MicrophoneStatus,
  SessionOpenResult,
  VoiceHotkeyState,
  WorkspaceProviderId,
} from "../shared/contracts";
import { TALK_KEY_RELEASE, talkKeyRelease } from "../shared/voice-hotkey";
import { askRefusal } from "./ask-luke";
import { openPreferredMicrophone } from "./microphone-choice";
import { type AppActionCarrier, RealtimeVoiceSession } from "./realtime-session";
import { SpokenNoticeAnnouncer } from "./spoken-notices";
import { useStateWithRef } from "./use-state-with-ref";
import { WAVEFORM_VOICE, type WaveformVoice } from "./waveform";

/**
 * What the speaking evidence run captions the reply with. A capture run never
 * opens a call, so there are no words to draw unless the fixture supplies
 * them — and it must, or the caption strip ships unphotographed. Synthetic,
 * like every fixture, and long enough to wrap: a one-line fixture would leave
 * the wrapped form of the strip unphotographed too. It names four of the
 * fixture roster's own sessions and one of its workspaces, so the photograph
 * holds both kinds of mention chip and the band at every row it can grow to,
 // SAFETY: The preceding check establishes the asserted contract.
 * exactly as they would stand over a live reply walking the roster.
 */
export const FIXTURE_SPEAKING_CAPTION =
  "Bootstrap the desktop shell and Review trust constraints are finished, lisbon-v2 is packaging the macOS build, and Follow a cloud agent and Watch a cloud session are waiting on you.";

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
 * How long a voice failure stays on the caption strip. The strip takes no
 * pointer, so time is its only dismissal: long enough to be read twice, short
 * enough that the shape does not wear a fault all afternoon. The next attempt
 * clears it sooner — connecting starts by reporting nothing wrong.
 */
export const VOICE_ERROR_NOTICE_MS = 12_000;

/**
 * The failure drawn in the same strip the captions use. A fault is worth
 * reading where the words it interrupted would have landed — at the shape's
 * foot, under the field that asked — not on a settings page nobody is
 * looking at. It yields to a live turn, because words being said are the
 * thing to read over words that already failed, and a capture run never
 * draws one: a fixture has no call to fail.
 */
export function voiceErrorToShow(input: {
  fixtureSpeaking: boolean;
  voice: WaveformVoice | undefined;
  error: string | undefined;
}): string | undefined {
  if (input.fixtureSpeaking || input.voice !== undefined) return undefined;
  return input.error;
}

/**
 * The words drawn under the shape, one entry per response so back-to-back
 * responses stack apart instead of running together. A capture run always
 * draws the fixture's words; otherwise Luke's captions are shown only when
 * there is a reason to read them and the reply they belong to is his turn:
 * the captions preference, a reply answering an ask the developer typed, or
 * an output that would swallow the speech.
 */
export function lukeCaptionsToShow(input: {
  fixtureSpeaking: boolean;
  captionsEnabled: boolean;
  typedAsk: boolean;
  outputSilent: boolean;
  voice: WaveformVoice | undefined;
  captions: readonly string[] | undefined;
}): readonly string[] | undefined {
  if (input.fixtureSpeaking) return [FIXTURE_SPEAKING_CAPTION];
  if (
    (input.captionsEnabled || input.typedAsk || input.outputSilent) &&
    input.voice === WAVEFORM_VOICE.LUKE
  ) {
    return input.captions;
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
export function talkKeyPress(input: { latched: boolean; microphoneCall: boolean }) {
  if (input.latched) {
    return { deferToRelease: true, openCall: false } satisfies {
      deferToRelease: boolean;
      openCall: boolean;
    };
  }
  return { deferToRelease: false, openCall: !input.microphoneCall } satisfies {
    deferToRelease: boolean;
    openCall: boolean;
  };
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
 // SAFETY: The preceding check establishes the asserted contract.
 * counts as one to reopen: its credential may already have been minted in the
 * old voice. A call that ended on its own owes nothing.
 */
export function voiceRestartAction(input: {
  previous: RealtimeVoice | undefined;
  next: RealtimeVoice | undefined;
  live: boolean;
  due: boolean;
  status: RealtimeStatus;
}) {
  if (input.next === undefined) {
    return { due: input.due, action: VOICE_RESTART.NONE } satisfies {
      due: boolean;
      action: VoiceRestart;
    };
  }
  const due =
    input.due || (input.previous !== undefined && input.previous !== input.next && input.live);
  if (!due) {
    return { due: false, action: VOICE_RESTART.NONE } satisfies {
      due: boolean;
      action: VoiceRestart;
    };
  }
  if (
    input.status === REALTIME_STATUS.IDLE ||
    input.status === REALTIME_STATUS.FAILED ||
    input.status === REALTIME_STATUS.UNAVAILABLE
  ) {
    return { due: false, action: VOICE_RESTART.DROP } satisfies {
      due: boolean;
      action: VoiceRestart;
    };
  }
  if (input.status !== REALTIME_STATUS.READY) {
    return { due: true, action: VOICE_RESTART.WAIT } satisfies {
      due: boolean;
      action: VoiceRestart;
    };
  }
  return { due: false, action: VOICE_RESTART.RESTART } satisfies {
    due: boolean;
    action: VoiceRestart;
  };
}

/**
 * The sources entitled to be heard without a call already open: a status edge
 * — raised deterministically, carrying the update's bounded fields for the
 * voice to word — and an evaluator answer to a standing ask the developer
 * made themselves. Both go to the announcer, which may open a speak-only call
 * of Luke's own to say them.
 */
const ANNOUNCER_SPEECH_SOURCES: ReadonlySet<string> = new Set([
  ATTENTION_SPEECH_SOURCE.STATUS_EDGE,
  ATTENTION_SPEECH_SOURCE.NOTICE_REQUEST,
]);

/** The speech the announcer takes, which may open Luke's own call to be said. */
export function announcerNotices(speech: readonly AttentionSpeech[]): AttentionSpeech[] {
  return speech.filter((item) => ANNOUNCER_SPEECH_SOURCES.has(item.source));
}

/**
 * The newest item of one batch of attention speech, by the moment it was
 * decided. Every item counts, however it reached the developer — spoken on an
 // SAFETY: The preceding check establishes the asserted contract.
 * open call, read out on Luke's own, or only shown as a popup — since each is
 * something Luke just told them. Picking the newest is arithmetic, so no
 * model output chooses what survives the batch.
 */
export function latestSpeech(speech: readonly AttentionSpeech[]): AttentionSpeech | undefined {
  let latest: AttentionSpeech | undefined;
  for (const item of speech) {
    if (latest === undefined || item.decidedAt >= latest.decidedAt) latest = item;
  }
  return latest;
}

/**
 * The session one batch of attention speech leaves under discussion: the
 * newest mention, because it is the one a bare "that chat" a moment later
 * points back at. Deterministic on both sides: the deciders behind the speech
 * are the status edge and the standing ask, and {@link latestSpeech} picks the
 * newest by arithmetic, so no model output chooses what the reference points
 * at.
 */
export function latestSpeechReference(
  speech: readonly AttentionSpeech[],
): SessionIdentity | undefined {
  const latest = latestSpeech(speech);
  return latest
    ? { providerId: latest.providerId, providerSessionId: latest.providerSessionId }
    : undefined;
}

/**
 * The session one carried act is aimed at, when it is aimed at one at all. An
 * act the developer just asked of a session makes it the session under
 // SAFETY: The preceding check establishes the asserted contract.
 * discussion as surely as an announcement does — "read me that transcript"
 * is followed by "open that chat" often enough — and a workspace creation
 * aims at no session, so it moves the reference not at all.
 */
export function carriedSessionIdentity(action: CarriedSessionAction): SessionIdentity | undefined {
  return "identity" in action ? action.identity : undefined;
}

/**
 * The sessions the replies being spoken are about, for the surface to draw
 * pressable previews of. An announcement already carries its one
 * roster-validated subject, and that stays the whole answer: the update was
 * about one session, whatever else its sentence brushes past. A conversation
 * reply carries no subject, so its previews are read from the words
 * themselves — the roster sessions whose own titles appear whole in the
 * captions, and the workspaces whose names do, each resolved to its freshest
 * observed chat — which is how "what are we working on?" is answered with a
 * chip per thing named. Back-to-back replies stack their captions, and the
 * chips follow every caption still on screen, because all of it is what Luke
 * is currently telling the developer. The words select only among observed
 * sessions; the identities never come from the model. A capture run has no
 * reply, so its fixture words stand in for the captions — the chips the
 * fixture sentence earns are photographed like everything else the surface
 * draws.
 */
export function replyMentions(input: {
  fixtureSpeaking: boolean;
  about: SessionIdentity | undefined;
  captions: readonly string[] | undefined;
  sessions: readonly NormalizedSession[];
}): readonly SessionMention[] {
  if (input.about) return [{ ...input.about, kind: SESSION_MENTION_KIND.SESSION }];
  const spoken = input.fixtureSpeaking ? FIXTURE_SPEAKING_CAPTION : input.captions?.join("\n");
  return mentionedSessions(spoken, input.sessions);
}

/**
 * The issue half of {@link replyMentions}, on its rules exactly: the tracked
 * issues the replies being spoken name — by identifier like LUKE-123, or by
 * whole title — each resolved against the observed issue roster and never
 * from the model's words alone. An announcement's one validated subject is a
 * session, and it stays the whole answer: identifiers riding along in its
 * sentence earn nothing, because the update was about the session. The
 * fixture sentence names no issues and a capture run observes no tracker, so
 * a capture run draws none.
 */
export function replyIssueMentions(input: {
  fixtureSpeaking: boolean;
  about: SessionIdentity | undefined;
  captions: readonly string[] | undefined;
  issues: readonly TrackedIssue[] | undefined;
}): readonly TrackedIssue[] {
  if (input.about) return [];
  const spoken = input.fixtureSpeaking ? FIXTURE_SPEAKING_CAPTION : input.captions?.join("\n");
  return mentionedIssues(spoken, input.issues);
}

/**
 * The other half of {@link announcerNotices}: an unbidden evaluator summary is
 * a model's words on a session nobody asked about, so it keeps its original
 * bound — spoken only on a call the developer opened themselves.
 */
export function evaluatorSummaries(speech: readonly AttentionSpeech[]): AttentionSpeech[] {
  return speech.filter((item) => !ANNOUNCER_SPEECH_SOURCES.has(item.source));
}

export interface VoiceConversationOptions {
  /**
   * Whether a press may open the Mac's own microphone instead of a Bluetooth
   * headset's. Off means the route is never even read: the system default is
   * the user's exact choice.
   */
  preferBuiltInMicrophone: boolean;
  sessions: readonly NormalizedSession[];
  /**
   * The standing asks riding the roster they annotate, so a conversation can
   * say — and withdraw — what Luke is already listening for.
   */
  noticeAsks: readonly SessionNoticeAsk[];
  workspaceProjects: readonly ObservedWorkspaceProject[];
  defaultWorkspaceProvider: WorkspaceProviderId | undefined;
  /** The per-provider default projects, riding the projects context they steer. */
  workspaceProjectDefaults: Readonly<Partial<Record<WorkspaceProviderId, string>>> | undefined;
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
  /**
   * Whether the meeting quiet is holding — a meeting on the connected
   * calendar covers now and the setting is on. True silences the announcer at
   * once, the announcement mid-sentence on Luke's own call included.
   */
  meetingQuiet: boolean;
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
  /**
   * Why the last call failed or ended, for the caption strip to show. Set by
   * the session, cleared by the next attempt or by {@link VOICE_ERROR_NOTICE_MS}
   * running out — whichever comes first.
   */
  voiceError: string | undefined;
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
  /**
   * The words being spoken, one entry per response: a turn that speaks twice
   * back-to-back keeps both on screen, stacked oldest first.
   */
  lukeCaptions: readonly string[] | undefined;
  /**
   * The sessions the reply being spoken is about: an announcement's one
   * validated subject, or what a conversation reply names in its words — a
   * chat by its title, or a workspace by name, resolved to its freshest
   // SAFETY: The preceding check establishes the asserted contract.
   * chat. Present exactly as long as the reply is — it is what the surface
   * anchors the pressable notices to — and independent of the captions
   * preference, which only governs whether the words are drawn.
   */
  mentionedSessions: readonly SessionMention[];
  /**
   * The tracked issues the reply being spoken names — by identifier or by
   * whole title — on the session mentions' own terms: resolved against the
   // SAFETY: The preceding check establishes the asserted contract.
   * observed issue roster, present exactly as long as the reply, and empty
   * for an announcement, whose one validated subject is a session. The rows
   * are the roster's own, because no panel surface holds the issue roster
   * for the chips to resolve against.
   */
  mentionedIssues: readonly TrackedIssue[];
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
  const [voiceError, setVoiceError] = useState<string>();
  const [voiceStatus, setVoiceStatus, voiceStatusNow] = useStateWithRef<RealtimeStatus>(
    REALTIME_STATUS.IDLE,
  );
  /**
   * A pressed talk key still waiting for the call it asked to open. The meter
   * is drawn from this rather than from the connection, because the press is
   * the moment the developer needs answering: the handshake behind it takes
   // SAFETY: The preceding check establishes the asserted contract.
   * seconds, and a key that visibly does nothing for that long reads as a key
   * that did nothing.
   */
  const [talkOpening, setTalkOpening] = useState(false);
  const [voiceHotkey, setVoiceHotkey] = useState<VoiceHotkeyState>();
  const [localStream, setLocalStream] = useState<MediaStream>();
  const [remoteStream, setRemoteStream] = useState<MediaStream>();
  // One state for the words and their subject, set together by the session so
  // the notice the surface anchors to the subject can never draw against a
  // caption from a different reply.
  const [voiceCaption, setVoiceCaption] = useState<{
    texts: readonly string[] | undefined;
    about: SessionIdentity | undefined;
  }>({ texts: undefined, about: undefined });
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
  const noticeAsksRef = useRef(options.noticeAsks);
  const workspaceProjectsRef = useRef(options.workspaceProjects);
  const defaultWorkspaceProviderRef = useRef(options.defaultWorkspaceProvider);
  const workspaceProjectDefaultsRef = useRef(options.workspaceProjectDefaults);
  const guideRef = useRef<AppGuideSnapshot>(EMPTY_APP_GUIDE);
  const issuesRef = useRef<readonly TrackedIssue[] | undefined>(undefined);
  // The same roster as state, because the issue chips are derived from it and
  // a derivation only reruns on what React can see change.
  const [trackedIssues, setTrackedIssues] = useState<readonly TrackedIssue[] | undefined>(
    undefined,
  );
  /**
   * The session under discussion, surviving here across calls: an announcement
   * is often read out on Luke's own speak-only call, which the talk-key press
   * tears down on its way to opening the developer's — and "open that chat"
   * arrives on the call that never heard the announcement. The session's own
   * copy goes with its teardown; this one re-feeds the next call.
   */
  const sessionReferenceRef = useRef<SessionIdentity | undefined>(undefined);
  /**
   * The most recent announcement's words, surviving here on the reference's
   * own terms: the announcement was often read out on Luke's speak-only call,
   * which the talk-key press tears down — and "what did you just say?"
   * arrives on the call that never said it. The session's copy goes with its
   * teardown; this one re-feeds the next call.
   */
  const lastAnnouncementRef = useRef<AttentionSpeech | undefined>(undefined);

  /**
   * Moves the session under discussion, when there is somewhere to move it.
   * Nothing here ever clears it — a reference whose session stops being
   * observed withdraws itself against the roster instead.
   */
  const rememberSessionReference = useCallback((identity: SessionIdentity | undefined) => {
    if (!identity) return;
    sessionReferenceRef.current = identity;
    voiceSession.current?.updateSessionReference(identity);
  }, []);

  /**
   * Keeps the newest announcement's words, when a batch carried any. Nothing
   * here ever clears them: words already said do not go stale the way an
   * identity does, and the next announcement replaces them soon enough.
   */
  const rememberLastAnnouncement = useCallback((speech: AttentionSpeech | undefined) => {
    if (!speech) return;
    lastAnnouncementRef.current = speech;
    voiceSession.current?.updateLastAnnouncement(speech);
  }, []);

  const ensureVoiceSession = useCallback((): RealtimeVoiceSession => {
    voiceSession.current ??= new RealtimeVoiceSession({
      requestConnection: () => window.sidecar.requestRealtimeCredential(),
      // The press's device, chosen by facts read natively: the Mac's own
      // microphone where a Bluetooth headset would otherwise pay for the
      // capture with its music codec, the browser's default everywhere else.
      // The switch reads at the press, so flipping it needs no reconnect.
      requestMicrophoneStream: () =>
        openPreferredMicrophone({
          route: () =>
            optionsRef.current.preferBuiltInMicrophone
              ? window.sidecar.getMicrophoneRoute()
              : Promise.resolve(undefined),
          enumerate: () => navigator.mediaDevices.enumerateDevices(),
          open: (audio) => navigator.mediaDevices.getUserMedia({ audio, video: false }),
        }),
      // The same bridge calls the rows use — the composer, the chips, and the
      // press that opens a session: a spoken ask is a third way to ask for the
      // same act, behind the same gauntlet in the main process.
      carryAction: (action: CarriedSessionAction) => {
        // The act's target becomes the session under discussion before the
        // outcome is known: a refusal still leaves the developer talking
        // about that session, and the next turn may point back at it.
        rememberSessionReference(carriedSessionIdentity(action));
        return dispatchByKind(action, {
          [SESSION_TOOL_KIND.MESSAGE]: (act) =>
            window.sidecar.sendSessionMessage(act.identity, act.text),
          [SESSION_TOOL_KIND.CONTROL]: (act) =>
            window.sidecar.executeSessionControl(act.identity, act.control.id),
          [SESSION_TOOL_KIND.NOTICE_REQUEST]: (act) =>
            window.sidecar.requestSessionNotice(act.identity, act.request),
          [SESSION_TOOL_KIND.NOTICE_WITHDRAW]: (act) =>
            window.sidecar.withdrawSessionNotice(act.identity),
          [SESSION_TOOL_KIND.CREATE_WORKSPACE]: (act) =>
            window.sidecar.createSessionWorkspace(
              act.providerId,
              act.providerProjectId,
              act.providerTargetId,
              act.agent,
              act.name,
              act.task,
              act.agentSelection,
            ),
          [SESSION_TOOL_KIND.ADD_AGENT]: (act) =>
            window.sidecar.addWorkspaceAgent(
              act.identity,
              act.agent,
              act.name,
              act.task,
              act.model,
              act.effort,
            ),
          [SESSION_TOOL_KIND.OPEN]: (act) => optionsRef.current.openSession(act.identity),
          [SESSION_TOOL_KIND.READ_TRANSCRIPT]: (act) =>
            window.sidecar.readSessionTranscript(act.identity),
        });
      },
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
      onError: setVoiceError,
      onCaption: (texts, about) => setVoiceCaption({ texts, about }),
    });
    return voiceSession.current;
  }, [rememberSessionReference, setVoiceStatus]);

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
  // it is not only true of a launch: a key entered in the panel turns a
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
    if (voiceStatusNow() === REALTIME_STATUS.UNAVAILABLE) {
      setVoiceStatus(REALTIME_STATUS.IDLE);
    }
  }, [options.voiceAvailable, setVoiceStatus, stopMicrophone, voiceStatusNow]);

  /**
   * Opens the call, answering with what the system said about the microphone —
   * the one fact a caller that could not send anything needs in order to say
   * why.
   */
  const startMicrophone = useCallback(async (): Promise<MicrophoneStatus> => {
    setVoiceError(undefined);
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
      session.updateSessions(sessionsRef.current, noticeAsksRef.current);
      // After the roster, which it is rendered against. The reference outlives
      // the calls themselves on purpose: the announcement it points back at
      // may have been read out on the speak-only call this one just replaced.
      session.updateSessionReference(sessionReferenceRef.current);
      // The announcement's own words re-feed on the same terms, so "what did
      // you just say?" can be answered on the call that replaced the one that
      // said it.
      if (lastAnnouncementRef.current) {
        session.updateLastAnnouncement(lastAnnouncementRef.current);
      }
      session.updateWorkspaceProjects(
        workspaceProjectsRef.current,
        defaultWorkspaceProviderRef.current,
        workspaceProjectDefaultsRef.current,
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
   * Asks the system for access and nothing else. The capture device itself is
   * the talk key's own act: it opens with a press and closes with the turn,
   * and this row must not be a second way to it.
   */
  const requestMicrophoneAccess = useCallback(async () => {
    setMicrophoneStatus(await window.sidecar.requestMicrophone());
  }, []);

  /**
   * What the talk key means, wherever it was pressed. A first press has to open
   * the call before it can open a turn, which is what lets the key work without
   * the panel ever being visited.
   *
   * The talk key going down. Every press goes to the session, including the one
   * that has no call to press against yet: the microphone opens for the press,
   * so one that beats the call is remembered and applied when it comes up.
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
   // SAFETY: The preceding check establishes the asserted contract.
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
    voiceSession.current?.endTurn(true);
    // A held press let go of before the call opened is no longer always
    // dropped: its words were captured beside the handshake, and a press that
    // said something is still owed its turn — the session keeps it pending
    // and delivers it when the channel opens, so the meter rides until the
    // reply to it begins. One that said nothing leaves with its meter, as it
    // always did.
    if (
      voiceSession.current &&
      !voiceSession.current.isConnected &&
      !voiceSession.current.turnPending
    ) {
      setTalkOpening(false);
    }
  }, []);

  /**
   * A typed ask to Luke himself. It rides the same call the talk key opens —
   * permission, connect, then the turn — and opens the same kind of turn:
   * typing is the developer asking in their own words, so the turn may carry
   * a tool the way a spoken one may, behind the same roster gauntlet. Answers
   * with why the ask could not go, or nothing when it did — the reply is
   // SAFETY: The preceding check establishes the asserted contract.
   * spoken, and its words land under the panel as the answer.
   */
  const askLuke = useCallback(
    async (text: string): Promise<string | undefined> => {
      const session = ensureVoiceSession();
      let microphone: MicrophoneStatus = "granted";
      // Luke's own speak-only call cannot carry a typed ask — it was sent no
      // roster to validate one against — so it counts as no call here, and
      // `connect` inside stands it down for the developer's own. A microphone
      // call still connecting is awaited, not doubled.
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
    // Held as state beside the ref, because the issue chips derive from it:
    // the ref feeds a call being opened, the state re-renders the band when
    // an observation pass moves the board under a reply already speaking.
    setTrackedIssues(issues);
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

  // The strip the error is drawn on takes no pointer, so nothing but time can
  // dismiss it: a fault left up would sit on the desktop all afternoon. A new
  // error re-arms the clock — it is a new thing to read.
  useEffect(() => {
    if (voiceError === undefined) return;
    const timer = setTimeout(() => setVoiceError(undefined), VOICE_ERROR_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [voiceError]);

  // An exchange going live outranks the clock: the conversation has moved on,
  // and a fault the turn hid must not come back once the words finish.
  // `startMicrophone` clears the calls that have to reconnect; this clears the
  // one that carried a mid-call error and never dropped.
  useEffect(() => {
    if (voiceExchangeActive(voiceStatus)) setVoiceError(undefined);
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
    noticeAsksRef.current = options.noticeAsks;
    voiceSession.current?.updateSessions(options.sessions, options.noticeAsks);
  }, [options.sessions, options.noticeAsks]);

  useEffect(() => {
    workspaceProjectsRef.current = options.workspaceProjects;
    defaultWorkspaceProviderRef.current = options.defaultWorkspaceProvider;
    workspaceProjectDefaultsRef.current = options.workspaceProjectDefaults;
    voiceSession.current?.updateWorkspaceProjects(
      options.workspaceProjects,
      options.defaultWorkspaceProvider,
      options.workspaceProjectDefaults,
    );
  }, [
    options.defaultWorkspaceProvider,
    options.workspaceProjectDefaults,
    options.workspaceProjects,
  ]);

  useEffect(() => {
    return window.sidecar.onAttentionSpeech((speech) => {
      // However the mention reaches the developer — spoken on this call, read
      // out on Luke's own, or only shown as a popup — its session is now the
      // one under discussion, and the next turn may say just "that chat".
      rememberSessionReference(latestSpeechReference(speech));
      // And its words are now the last announcement, so "what did you just
      // say?" has an answer on whichever call the question lands on. The two
      // compose: the reference carries the identity, this carries the words.
      rememberLastAnnouncement(latestSpeech(speech));
      const notices = announcerNotices(speech);
      if (notices.length > 0) ensureAnnouncer().enqueue(notices);
      const session = voiceSession.current;
      if (!session?.microphoneCall) return;
      for (const item of evaluatorSummaries(speech)) session.speak(item);
    });
  }, [ensureAnnouncer, rememberLastAnnouncement, rememberSessionReference]);

  // The announcer paces itself by the session's status: READY is when a queued
  // sentence can speak and when an empty queue starts the walk toward closing
  // the call Luke opened for himself.
  useEffect(() => {
    announcer.current?.onStatus(voiceStatus);
  }, [voiceStatus]);

  // The meeting quiet reaching the announcer. Quiet beginning is built
  // through ensure, so it stands even before the first notice would have
  // built the announcer; quiet ending has no announcer to wake, because the
  // main process re-sends what the meeting held as a fresh backlog.
  useEffect(() => {
    if (options.meetingQuiet) ensureAnnouncer().setMeetingQuiet(true);
    else announcer.current?.setMeetingQuiet(false);
  }, [ensureAnnouncer, options.meetingQuiet]);

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

  // Derived, not queued: the subjects arrive with the captions and die with
  // the reply, so a chip can never lag the words or stand for a session the
  // reply is not talking about.
  const mentioned = useMemo(
    () =>
      replyMentions({
        fixtureSpeaking: options.fixtureSpeaking,
        about: voiceCaption.about,
        captions: voiceCaption.texts,
        sessions: options.sessions,
      }),
    [options.fixtureSpeaking, options.sessions, voiceCaption],
  );
  // The issue half of the same derivation, against the tracker's roster
  // instead of the sessions'.
  const mentionedIssueRows = useMemo(
    () =>
      replyIssueMentions({
        fixtureSpeaking: options.fixtureSpeaking,
        about: voiceCaption.about,
        captions: voiceCaption.texts,
        issues: trackedIssues,
      }),
    [options.fixtureSpeaking, trackedIssues, voiceCaption],
  );

  const voiceTurn = waveformVoice(voiceStatus);
  const lukeCaptions = lukeCaptionsToShow({
    fixtureSpeaking: options.fixtureSpeaking,
    captionsEnabled: options.voiceCaptions,
    typedAsk,
    outputSilent: options.outputSilent,
    voice: voiceTurn,
    captions: voiceCaption.texts,
  });

  return {
    analyser,
    microphoneStatus,
    setMicrophoneStatus,
    voiceError,
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
    lukeCaptions,
    mentionedSessions: mentioned,
    mentionedIssues: mentionedIssueRows,
    remoteAudio,
    discardListening,
    stopSpeaking,
    syncGuide,
    syncIssues,
  };
}
