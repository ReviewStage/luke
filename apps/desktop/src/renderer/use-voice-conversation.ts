import type { SessionNoticeAsk } from "@sidecar/attention";
import { sanitizedTraceEvent } from "@sidecar/devtrace/vocabulary";
import { FIXTURE_SPEAKING_CAPTION } from "@sidecar/fixtures";
import { type AppGuideSnapshot, EMPTY_APP_GUIDE } from "@sidecar/guide";
import { mentionedIssues, type TrackedIssue } from "@sidecar/issues";
import {
  ATTENTION_SPEECH_SOURCE,
  type AttentionSpeech,
  announcementConversationEntry,
  appendConversationEntry,
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  dispatchByKind,
  insertSpokenAskEntry,
  isCarriedAppAction,
  isCarriedIssueAction,
  isCarriedSessionAction,
  REALTIME_STATUS,
  type RealtimeStatus,
  type RealtimeVoice,
  type RealtimeVoiceSpeed,
  SESSION_TOOL_KIND,
  sessionActConversationEntry,
} from "@sidecar/realtime";
import {
  mentionedSessions,
  type ObservedWorkspaceProject,
  SESSION_MENTION_KIND,
  type Session,
  type SessionApplicationId,
  type SessionIdentity,
  type SessionMention,
} from "@sidecar/session";
import { TALK_KEY_RELEASE, talkKeyRelease } from "@sidecar/settings";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MicrophoneStatus, VoiceHotkeyState } from "#shared/wire/audio";
import type { SessionOpenResult, WorkspaceProviderId } from "#shared/wire/session";
import { askRefusal } from "./ask-luke";
import { voiceQuotaSpentNote } from "./microphone-access";
import { openPreferredMicrophone } from "./microphone-choice";
import { type AppActionCarrier, RealtimeVoiceSession } from "./realtime-session";
import { SpokenNoticeAnnouncer } from "./spoken-notices";
import { useStateWithRef } from "./use-state-with-ref";
import { WAVEFORM_VOICE, type WaveformVoice } from "./waveform";

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
 * How long a refused remote-audio play waits before trying again. Chromium
 * refuses transiently — an output route mid-arrival, a playback gate a later
 * state satisfies — and the words keep arriving on the stream regardless, so
 * a short clock loses less of the sentence than a longer one would.
 */
export const REMOTE_AUDIO_RETRY_MS = 1_000;

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
 * The notice drawn in the same strip, yielding only to Luke's own turn — his
 * words own the box whether or not the captions draw them. The developer's
 * turn is no reason to hide it: an open microphone draws nothing on the
 * strip, and the one refusal that happens during it — a typed ask against
 * the open turn — is exactly what the strip should answer with.
 */
export function voiceNoticeToShow(input: {
  fixtureSpeaking: boolean;
  voice: WaveformVoice | undefined;
  notice: string | undefined;
}): string | undefined {
  if (input.fixtureSpeaking || input.voice === WAVEFORM_VOICE.LUKE) return undefined;
  return input.notice;
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
 * Every attention sentence already passed the evaluator's CTO-relevance gate,
 * so each may open a speak-only call of Luke's own to be heard. The call stays
 * tool-free; this permission changes only whether the approved words wait for
 * an existing conversation.
 */
const ANNOUNCER_SPEECH_SOURCES: ReadonlySet<string> = new Set([
  ATTENTION_SPEECH_SOURCE.STATUS_EDGE,
  ATTENTION_SPEECH_SOURCE.EVALUATOR,
  ATTENTION_SPEECH_SOURCE.NOTICE_REQUEST,
]);

/** The speech the announcer takes, which may open Luke's own call to be said. */
export function announcerNotices(speech: readonly AttentionSpeech[]): AttentionSpeech[] {
  return speech.filter((item) => ANNOUNCER_SPEECH_SOURCES.has(item.source));
}

/**
 * One batch of attention speech in the order it was decided. Every item
 * counts, however it reached the developer — spoken on an open call, read out
 * on Luke's own, or only shown as a popup — since each is something Luke just
 * told them, and each earns a history line so the next call remembers it.
 * Ordering by decision is arithmetic, so no model output chooses what the
 * history holds.
 */
export function speechByDecision(speech: readonly AttentionSpeech[]): readonly AttentionSpeech[] {
  return [...speech].sort((a, b) => a.decidedAt - b.decidedAt);
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
  sessions: readonly Session[];
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
 * The other half of {@link announcerNotices}. Kept as a separate selector for
 * wire compatibility with an older source that may not earn the announcer.
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
  /**
   * Whether this run records the development trace. True only when the main
   * process built a writer — an unpackaged, live run the developer pointed at
   * a directory — so on every other run the wire is never even tapped.
   */
  agentTraceEnabled: boolean;
  sessions: readonly Session[];
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
   * The spoken form of pressing one app mark on a row, for an open that named
   * the app. Passed in on the same terms as {@link openSession}.
   */
  openSessionApplication: (
    identity: SessionIdentity,
    applicationId: SessionApplicationId,
  ) => Promise<SessionOpenResult>;
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
  /**
   * A state worth the same strip a failure borrows, in its own quieter tone:
   * today's allowance spent under a talk-key press, or the run-out the panel
   * noticed. Kept apart from {@link voiceError} because the two colour
   * differently — a spent day is not a fault — while sharing its clock and
   * its yielding to live words.
   */
  voiceNotice: string | undefined;
  /** Puts a sentence on the notice strip: the run-out announcement's one way in. */
  announceVoiceNotice: (text: string) => void;
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
   * chat. Present exactly as long as the reply is — it is what the surface
   * anchors the pressable notices to — and independent of the captions
   * preference, which only governs whether the words are drawn.
   */
  mentionedSessions: readonly SessionMention[];
  /**
   * The tracked issues the reply being spoken names — by identifier or by
   * whole title — on the session mentions' own terms: resolved against the
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
  const [voiceNotice, setVoiceNotice] = useState<string>();
  const [voiceStatus, setVoiceStatus, voiceStatusNow] = useStateWithRef<RealtimeStatus>(
    REALTIME_STATUS.IDLE,
  );
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
   * The conversation history, surviving here across calls: a call is a
   * transport that comes and goes — an announcement is often read out on
   * Luke's own speak-only call, which the talk-key press tears down on its
   * way to opening the developer's, and an idle call retires — while the
   * thread itself lives here and re-feeds whichever call opens next. The
   * session's own copy goes with its teardown; this one is the conversation.
   */
  const conversationRef = useRef<readonly ConversationEntry[]>([]);
  /**
   * Whether the turn under way read a transcript aloud. The rendering travels
   * only in the turn that asked for it, so the reply that spoke it must not
   * be recorded: the record keeps the act — already recorded at the carry —
   * and not a word of what it rendered.
   */
  const transcriptSpokenRef = useRef(false);

  /**
   * Appends one line to the history and tells the call now open, when there
   * is a line to append. Nothing here ever removes a line — the history's own
   * bounds retire the oldest, and a session leaving the roster costs a line
   * its identity at render, never its words.
   */
  const rememberConversationEntry = useCallback((entry: ConversationEntry | undefined) => {
    if (!entry) return;
    conversationRef.current = appendConversationEntry(conversationRef.current, entry);
    voiceSession.current?.updateConversation(conversationRef.current);
  }, []);

  /**
   * Where the spoken turn now owed a transcription belongs in the history:
   * the entry the history ended with at the moment the turn committed —
   * everything recorded after that mark is the turn's own produce. Marked at
   * the commit edge, consumed by the transcription, and overwritten by the
   * next commit, so a transcription that never arrives leaves nothing stale
   * standing.
   */
  const spokenTurnMarkRef = useRef<{ after: ConversationEntry | undefined } | undefined>(undefined);
  /** The status an edge is read against, for the commit mark above. */
  const previousVoiceStatus = useRef<RealtimeStatus>(REALTIME_STATUS.IDLE);

  /**
   * Records a spoken ask where its turn happened rather than where its
   * transcription landed: the words come back on the service's own clock,
   * sometimes after the reply they asked for has ended, and an exchange
   * stored in reverse would be re-fed in reverse to every later call. A
   * transcription with no mark to land on — a turn delivered without a
   * listening edge — appends plainly, which is the order said in the common
   * case of the words beating the reply.
   */
  const rememberSpokenAsk = useCallback((transcript: string) => {
    const mark = spokenTurnMarkRef.current;
    spokenTurnMarkRef.current = undefined;
    conversationRef.current = mark
      ? insertSpokenAskEntry(conversationRef.current, transcript, mark.after)
      : appendConversationEntry(conversationRef.current, {
          kind: CONVERSATION_ENTRY_KIND.SPOKEN_ASK,
          words: transcript,
        });
    voiceSession.current?.updateConversation(conversationRef.current);
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
      carryAct: async (envelope) => {
        const authorization = await window.sidecar.authorizeAct(envelope);
        if (authorization.status !== ACT_RESULT_STATUS.ACCEPTED) return authorization;
        const { act: action, armed } = envelope;
        if (!armed) {
          return {
            status: ACT_RESULT_STATUS.REJECTED,
            reason: "Only a request you make yourself can carry an act.",
          };
        }
        if (isCarriedAppAction(action)) {
          return optionsRef.current.carryAppAction(action);
        }
        if (isCarriedIssueAction(action)) {
          return window.sidecar.executeIssueAction(action);
        }
        if (!isCarriedSessionAction(action)) {
          return {
            status: ACT_RESULT_STATUS.REJECTED,
            reason: "No handler carries that act.",
          };
        }
        // The ask is recorded before the outcome is known: a refusal still
        // leaves the developer having asked it, and the next turn may point
        // back at the session it named. The outcome needs no line of its own —
        // the reply voicing it is recorded as what Luke said.
        rememberConversationEntry(sessionActConversationEntry(action, sessionsRef.current));
        // The reply that voices a transcript reading must stay out of the
        // history: the rendering travels only in the turn that asked for it.
        if (action.kind === SESSION_TOOL_KIND.READ_TRANSCRIPT) {
          transcriptSpokenRef.current = true;
        }
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
          [SESSION_TOOL_KIND.RENAME_WORKSPACE]: (act) =>
            window.sidecar.renameSessionWorkspace(act.identity, act.name),
          [SESSION_TOOL_KIND.RENAME_SESSION]: (act) =>
            window.sidecar.renameSession(act.identity, act.name),
          [SESSION_TOOL_KIND.OPEN]: (act) =>
            act.applicationId
              ? optionsRef.current.openSessionApplication(act.identity, act.applicationId)
              : optionsRef.current.openSession(act.identity),
          [SESSION_TOOL_KIND.READ_TRANSCRIPT]: (act) =>
            window.sidecar.readSessionTranscript(act.identity),
        });
      },
      onStatus: setVoiceStatus,
      onLocalStream: setLocalStream,
      onRemoteStream: setRemoteStream,
      onError: setVoiceError,
      onCaption: (texts, about) => setVoiceCaption({ texts, about }),
      onReplyEnded: (texts, about) => {
        const spokeTranscript = transcriptSpokenRef.current;
        transcriptSpokenRef.current = false;
        // An announcement's reply is already recorded from the update that
        // decided it — with the identity the attention layer validated, which
        // the words alone cannot carry — and a transcript reading enters the
        // record only as the act it was.
        if (about || spokeTranscript) return;
        rememberConversationEntry({ kind: CONVERSATION_ENTRY_KIND.REPLY, words: texts.join(" ") });
      },
      // The developer's spoken words, back from the service that heard them,
      // placed where their turn happened: the thread holds both halves of
      // the exchange, in the order they were said.
      onSpokenAsk: rememberSpokenAsk,
      // The development trace's tap, checked at each event rather than at
      // construction because the session outlives the bootstrap that says
      // whether a writer stands behind the bridge. The audio is stripped
      // here, before the event ever crosses the sandbox.
      onWireEvent: (direction, event) => {
        if (!optionsRef.current.agentTraceEnabled) return;
        window.sidecar.recordAgentTrace({ direction, event: sanitizedTraceEvent(event) });
      },
    });
    return voiceSession.current;
  }, [rememberConversationEntry, rememberSpokenAsk, setVoiceStatus]);

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
   * Opens the developer's call and feeds it everything a turn is validated
   * against. Nothing is asked of the system on the way: connecting declares a
   * bare transceiver, no capture device opens, and the microphone permission
   * has no part in it — the device stays the press's own act.
   */
  const startConversation = useCallback(async (): Promise<boolean> => {
    setVoiceError(undefined);
    setVoiceNotice(undefined);
    const session = ensureVoiceSession();
    if (!(await session.connect())) return false;
    session.updateSessions(sessionsRef.current, noticeAsksRef.current);
    // After the roster, which it is rendered against. The history outlives
    // the calls themselves on purpose: it is the conversation, and this call
    // is only the newest transport to carry it — the announcement a "what did
    // you just say?" points back at was often read out on the speak-only call
    // this one just replaced.
    session.updateConversation(conversationRef.current);
    session.updateWorkspaceProjects(
      workspaceProjectsRef.current,
      defaultWorkspaceProviderRef.current,
      workspaceProjectDefaultsRef.current,
    );
    session.updateGuide(guideRef.current);
    session.updateIssues(issuesRef.current);
    return true;
  }, [ensureVoiceSession]);

  /**
   * The press's way in: asks the system about the microphone, then opens the
   * call, answering with what the system said — the one fact a caller that
   * could not send anything needs in order to say why. The gate belongs here
   * and not on the call itself, because the press is what opens a capture
   * device; a call opened for a typed ask goes through {@link startConversation}
   * and never asks.
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
    await startConversation();
    return permission;
  }, [ensureVoiceSession, startConversation]);

  /**
   * The spent-allowance sentence when that is what "unavailable" means right
   * now, read off the voice service's own diagnostics at the moment of the
   * refusal — or nothing, leaving the ordinary unavailability words to stand.
   * Asked at the moment rather than held: the day turns over on its own, and
   * a note decided at launch would outlive the allowance coming back.
   */
  const spentAllowanceNote = useCallback(async (): Promise<string | undefined> => {
    const diagnostics = await window.sidecar.requestRealtimeDiagnostics().catch(() => undefined);
    return voiceQuotaSpentNote(diagnostics, Date.now());
  }, []);

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
   * The talk key going down. Every press the system lets capture goes to the
   * session, including the one that has no call to press against yet: the
   * microphone opens for the press, so one that beats the call is remembered
   * and applied when it comes up.
   */
  const beginTalk = useCallback(async () => {
    talkPressedAt.current = performance.now();
    // A latched turn is already open. This press is someone saying they are
    // done, which is the release's to answer.
    if (talkLatched.current) return;
    const session = ensureVoiceSession();
    // The press is what opens a capture device, and the call under it may
    // have been opened by a typed ask, which asked the system for nothing.
    // So a press against anything but a granted microphone asks before the
    // turn opens: refused, the press is dropped here — before its device
    // request could fail a standing call that was carrying the typed
    // conversation fine.
    if (microphoneStatus !== "granted") {
      const pressedAt = talkPressedAt.current;
      const permission = await window.sidecar.requestMicrophone();
      setMicrophoneStatus(permission);
      if (permission !== "granted") {
        // Said where the device failure used to land it: the caption strip.
        setVoiceError(
          "The talk key needs the microphone. Allow it in System Settings, " +
            "under Privacy & Security, Microphone — or type to Luke instead.",
        );
        return;
      }
      // The system's prompt can outlive the press that raised it. A key
      // released — or pressed again — while it stood has no turn left to
      // open here: opening one would put a live microphone under a key
      // that is already up.
      if (talkPressedAt.current !== pressedAt) return;
    }
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
    // A press against a spent allowance would otherwise be answered by
    // nothing at all — the one silence that reads as Luke being broken. The
    // sentence lands on the notice strip, where the reply would have: a
    // notice rather than an error, because a spent day is a state with its
    // own return, not a fault.
    if (session.status === REALTIME_STATUS.UNAVAILABLE) {
      const spent = await spentAllowanceNote();
      if (spent) setVoiceNotice(spent);
    }
  }, [ensureVoiceSession, microphoneStatus, spentAllowanceNote, startMicrophone]);

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
      // A latch keeps a turn open past the release, so it needs a turn to
      // keep: pending counts — the tap-to-open flow latches while its call is
      // still on the way — but a press that opened none, because the
      // permission prompt or a failed device swallowed it, must not latch, or
      // the next press would read as the end of a turn nobody is holding.
      if (
        voiceSession.current?.turnPending === true ||
        voiceStatusNow() === REALTIME_STATUS.LISTENING
      ) {
        talkLatched.current = true;
      }
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
  }, [voiceStatusNow]);

  /**
   * A typed ask to Luke himself. It rides the same call the talk key opens
   * and opens the same kind of turn: typing is the developer asking in their
   * own words, so the turn may carry a tool the way a spoken one may, behind
   * the same roster gauntlet. But it asks the system for nothing on the way:
   * typing opens no capture device, and the reply arrives on the call's
   * receiving half, so a typed ask goes whether or not the system would let
   * a press capture. Answers with why the ask could not go, or nothing when
   * it did — the reply is spoken, and its words land under the panel as the
   * answer.
   */
  const askLuke = useCallback(
    async (text: string): Promise<string | undefined> => {
      const session = ensureVoiceSession();
      // Luke's own speak-only call cannot carry a typed ask — it was sent no
      // roster to validate one against — so it counts as no call here, and
      // `connect` inside stands it down for the developer's own. A microphone
      // call still connecting is awaited, not doubled.
      if (!session.isConnected || !session.microphoneCall) {
        await startConversation();
      }
      if (session.sendText(text)) {
        setTypedAsk(true);
        // A new typed turn lets a leftover transcript skip go, exactly as a
        // spoken one does — after the send, whose interrupt hands over the
        // cut reply's words and is the flag's last rightful consumer.
        transcriptSpokenRef.current = false;
        // The developer's own words enter the history as they were typed, so
        // the thread holds both halves of the exchange the reply answers.
        rememberConversationEntry({ kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: text });
        // A sent ask outdates whatever refusal the strip was still reading:
        // a call already open skips `startConversation`, so the clear it
        // would have run happens here.
        setVoiceNotice(undefined);
        return undefined;
      }
      const spent =
        session.status === REALTIME_STATUS.UNAVAILABLE ? await spentAllowanceNote() : undefined;
      const refusal = askRefusal(session.status, spent);
      // The refusal lands where the reply would have: on the caption strip,
      // in the notice tone, the same way a talk-key press against a spent
      // allowance is answered. The composer draws no line of its own — one
      // mechanism, one look — and a failure's red already on the strip
      // outranks this, so the two never fight for the box.
      setVoiceNotice(refusal);
      return refusal;
    },
    [rememberConversationEntry, ensureVoiceSession, spentAllowanceNote, startConversation],
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
    // Reconnecting is the call's act, not a press: the device the old call
    // held went with its close, and the next press asks for its own.
    void (async () => {
      await voiceSession.current?.close();
      await startConversation();
    })();
  }, [options.voice, startConversation, voiceStatus]);

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
    // The transcript skip belongs to the turn that read the transcript, and a
    // reply abandoned wordless never fires the handover that consumes it — so
    // a new spoken turn opening lets it go, or the flag would swallow the
    // next reply from the history.
    if (voiceStatus === REALTIME_STATUS.LISTENING) {
      transcriptSpokenRef.current = false;
    }
    // A spoken turn committing — the microphone closing into a reply — is the
    // moment its ask belongs at: the words come back later, on the
    // transcription's own clock, and this mark is what lets them land where
    // the turn actually was rather than behind a reply that outran them.
    if (
      previousVoiceStatus.current === REALTIME_STATUS.LISTENING &&
      voiceStatus === REALTIME_STATUS.RESPONDING
    ) {
      spokenTurnMarkRef.current = { after: conversationRef.current.at(-1) };
    }
    previousVoiceStatus.current = voiceStatus;
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

  // The notice leaves on the same clock the error does: it shares the strip,
  // and the state it reports keeps standing in the composer and on the face.
  useEffect(() => {
    if (voiceNotice === undefined) return;
    const timer = setTimeout(() => setVoiceNotice(undefined), VOICE_ERROR_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [voiceNotice]);

  // An exchange going live outranks the clock: the conversation has moved on,
  // and a fault the turn hid must not come back once the words finish.
  // `startConversation` clears the calls that have to reconnect; this clears
  // the one that carried a mid-call error and never dropped.
  useEffect(() => {
    if (voiceExchangeActive(voiceStatus)) {
      setVoiceError(undefined);
      setVoiceNotice(undefined);
    }
  }, [voiceStatus]);

  useEffect(() => {
    window.sidecar.setVoiceExchangeActive(voiceExchangeActive(voiceStatus));
  }, [voiceStatus]);

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
      // However a mention reaches the developer — spoken on this call, read
      // out on Luke's own, or only shown as a popup — it is something Luke
      // just told them, so it enters the history: the next turn may say just
      // "that chat", and the line carries the identity the words alone
      // cannot.
      for (const item of speechByDecision(speech)) {
        rememberConversationEntry(announcementConversationEntry(item));
      }
      const notices = announcerNotices(speech);
      if (notices.length > 0) ensureAnnouncer().enqueue(notices);
      // Any source not entitled to open Luke's call may still ride the
      // developer's own. The announcer paces it by the READY edge like every
      // other sentence, so a batch is not refused or lost.
      if (!voiceSession.current?.microphoneCall) return;
      const summaries = evaluatorSummaries(speech);
      if (summaries.length > 0) ensureAnnouncer().enqueueRide(summaries);
    });
  }, [rememberConversationEntry, ensureAnnouncer]);

  // The announcer paces itself by the session's status: READY is when a queued
  // sentence can speak and when an empty queue starts the walk toward closing
  // the call Luke opened for himself. Built through ensure so the status
  // history is already standing when the first notice arrives — the grace
  // window after a reply needs to know one just ended.
  useEffect(() => {
    ensureAnnouncer().onStatus(voiceStatus);
  }, [ensureAnnouncer, voiceStatus]);

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
    voiceNotice,
    announceVoiceNotice: setVoiceNotice,
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
