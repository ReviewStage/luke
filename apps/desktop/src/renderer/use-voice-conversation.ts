import type { RememberedFact } from "@sidecar/acts";
import { PRODUCT_EXCHANGE_KIND, type ProductExchangeKind } from "@sidecar/analytics";
import { sanitizedTraceEvent } from "@sidecar/devtrace/vocabulary";
import { FIXTURE_SPEAKING_CAPTION } from "@sidecar/fixtures";
import type { AppGuideSnapshot } from "@sidecar/guide";
import {
  type ArrivalSpeech,
  adoptConversationThread,
  announcementConversationEntry,
  appendConversationThreadEntry,
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  insertSpokenAskThreadEntry,
  isArrivalSpeech,
  REALTIME_STATUS,
  type RealtimeStatus,
  type RealtimeVoice,
  type RealtimeVoiceSpeed,
  realtimeSessionConfig,
  replyConversationEntry,
  retainedConversationEntries,
  storedConversationMaximumAgeMs,
  streamingConversationEntry,
} from "@sidecar/realtime";
import {
  type ObservedWorkspaceProject,
  SESSION_STATUS,
  type Session,
  type SessionApplicationId,
  type SessionIdentity,
} from "@sidecar/session";
import { TALK_KEY_RELEASE, talkKeyRelease, voiceHotkeyLabel } from "@sidecar/settings";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MicrophoneStatus, VoiceHotkeyState } from "#shared/wire/audio";
import type {
  ConversationHistoryPayload,
  SessionOpenResult,
  WorkspaceProviderId,
} from "#shared/wire/session";
import { hostedVoiceUnavailableNote } from "./microphone-access";
import { openPreferredMicrophone } from "./microphone-choice";
import {
  type AppActionCarrier,
  REPLY_KIND,
  RealtimeVoiceSession,
  type ReplyKind,
} from "./realtime-session";
import { SpeechMouth } from "./speech-mouth";
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
 * Who opened the exchange the count is about. Luke's own speak-only call has
 * no microphone to offer, which is the whole of what tells his announcement
 * from a turn the developer took; between the developer's own two ways in,
 * only the composer says so in advance, so the talk key is what is left.
 */
export function voiceExchangeKind(input: {
  microphoneCall: boolean;
  typedAsk: boolean;
}): ProductExchangeKind {
  if (!input.microphoneCall) return PRODUCT_EXCHANGE_KIND.ANNOUNCEMENT;
  return input.typedAsk ? PRODUCT_EXCHANGE_KIND.TYPED : PRODUCT_EXCHANGE_KIND.SPOKEN;
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

/** A transcription belongs only to the same visible history generation as its turn. */
export function spokenAskBelongsToConversation(
  markGeneration: number | undefined,
  conversationGeneration: number,
): boolean {
  return conversationEntryBelongsToConversation(markGeneration, conversationGeneration);
}

/** An asynchronous entry belongs only to the history generation in which its work began. */
export function conversationEntryBelongsToConversation(
  entryGeneration: number | undefined,
  conversationGeneration: number,
): boolean {
  return entryGeneration !== undefined && entryGeneration === conversationGeneration;
}

/**
 * Whether a status still has a call behind it. A gone call takes its
 * half-transcribed spoken turns with it: their completed transcripts can no
 * longer arrive, so a preview left standing would stream forever.
 */
export function spokenAskPreviewSurvives(status: RealtimeStatus): boolean {
  return (
    status !== REALTIME_STATUS.IDLE &&
    status !== REALTIME_STATUS.FAILED &&
    status !== REALTIME_STATUS.UNAVAILABLE
  );
}

/** One empty map, so clearing previews repeatedly re-renders nothing. */
const NO_SPOKEN_ASK_PREVIEWS: ReadonlyMap<string, string> = new Map();

/**
 * The lines still being said, for History to draw under the settled thread:
 * the developer's spoken turns as the service transcribes them, then the
 * reply or announcement as its words are generated — the ask precedes its
 * answer. Presentation only, so each line mirrors exactly what its own
 * recording path will keep: a briefing settles as an announcement, and the
 * reply that is voicing a transcript reading draws nothing, because the
 * record keeps the act and never a word of the rendering.
 */
export function liveConversationEntries(input: {
  spokenAskPreviews: ReadonlyMap<string, string>;
  captions: readonly string[] | undefined;
  kind: ReplyKind | undefined;
  transcriptSpoken: boolean;
}): readonly ConversationEntry[] {
  const lines: ConversationEntry[] = [];
  for (const words of input.spokenAskPreviews.values()) {
    const ask = streamingConversationEntry(CONVERSATION_ENTRY_KIND.SPOKEN_ASK, words);
    if (ask) lines.push(ask);
  }
  const briefing = input.kind === REPLY_KIND.BRIEFING;
  if (input.captions && (briefing || !input.transcriptSpoken)) {
    const speech = streamingConversationEntry(
      briefing ? CONVERSATION_ENTRY_KIND.ANNOUNCEMENT : CONVERSATION_ENTRY_KIND.REPLY,
      input.captions.join(" "),
    );
    if (speech) lines.push(speech);
  }
  return lines;
}

/** Moves turns opened before restore behind the restored thread. */
export function rebaseSpokenTurnMarks(
  marks: readonly { after: ConversationEntry | undefined }[],
  restoredTail: ConversationEntry,
): void {
  for (const mark of marks) mark.after ??= restoredTail;
}

/** Stored history may change only after restore and outside a pending Clear. */
export function conversationHistoryMayPersist(seeded: boolean, clearing: boolean): boolean {
  return seeded && !clearing;
}

/** Holds the first call until bootstrap has supplied its durable reply context. */
export function waitForConversationContext(
  ready: boolean,
  waiters: Set<() => void>,
): Promise<void> {
  if (ready) return Promise.resolve();
  return new Promise((resolve) => waiters.add(resolve));
}

/** Captures the reply that owns an act before main-process authorization can pause it. */
export async function authorizeConversationAct<T>(
  activeReplyGeneration: { readonly current: number | undefined },
  authorize: () => Promise<T>,
): Promise<{ authorization: T; generation: number | undefined }> {
  const generation = activeReplyGeneration.current;
  return { authorization: await authorize(), generation };
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
  workspaceProjects: readonly ObservedWorkspaceProject[];
  defaultWorkspaceProvider: WorkspaceProviderId | undefined;
  /** The per-provider default projects, riding the projects context they steer. */
  workspaceProjectDefaults: Readonly<Partial<Record<WorkspaceProviderId, string>>> | undefined;
  voice: RealtimeVoice | undefined;
  voiceSpeed: RealtimeVoiceSpeed | undefined;
  voiceCaptions: boolean;
  /**
   * The talk key the launch registered, standing in until a change is pushed.
   * Read only when the arrival beat is worded, so its suggestion names the
   * chord that actually works rather than a default the system refused.
   */
  bootstrapVoiceHotkey: string | undefined;
  /**
   * Whether a Realtime credential can be minted. Undefined until settings have
   * arrived, so the first frames of a launch do not draw the unavailable
   * state over a working key.
   */
  voiceAvailable: boolean | undefined;
  outputSilent: boolean;
  /**
   * Whether announcements are held — the developer's pause switch is on, or a
   * meeting on the connected calendar covers now under the meeting quiet.
   * True silences the mouth at once, the announcement mid-sentence on
   * Luke's own call included.
   */
  announcementsHeld: boolean;
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
  /** Whether restored history and personal memory are ready for the first turn. */
  conversationContextReady: boolean;
  /** Durable personal memory supplied at bootstrap and kept current by pushes. */
  rememberedFacts: readonly RememberedFact[];
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
  /** A temporary state shown on the caption strip in its quieter notice tone. */
  voiceNotice: string | undefined;
  voiceStatus: RealtimeStatus;
  setVoiceStatus: (status: RealtimeStatus) => void;
  talkOpening: boolean;
  voiceHotkey: VoiceHotkeyState | undefined;
  handleVoiceActivity: (active: boolean) => void;
  requestMicrophoneAccess: () => Promise<void>;
  startMicrophone: () => Promise<MicrophoneStatus>;
  stopMicrophone: () => Promise<void>;
  askLuke: (text: string) => Promise<string | undefined>;
  /**
   * Every line the thread holds, words whole — this launch's and, ahead of
   * them, what the last launch left within the retention policy — shared
   * across every display's panel. The model still receives only the recent
   * slice, each line cut at render to its own length bound.
   */
  conversationHistory: readonly ConversationEntry[];
  /** Clears the visible history, the next call's context, and the stored file. */
  clearConversationHistory: () => void;
  /**
   * The lines still being said, for History to draw under the settled thread:
   * a spoken ask as the service transcribes it, a reply or announcement as
   * its words are generated. Never part of {@link conversationHistory} — each
   * settles into it through its own recording path, or leaves without one
   * exactly as the words it previews do.
   */
  liveConversationEntries: readonly ConversationEntry[];
  /**
   * Bootstrap's snapshot of the shared thread, for a panel that opens late.
   * Applied only while this window's own thread is untouched: the snapshot is
   * older than anything that raced past it — another window's report arrives
   * on the live channel, and this window's own lines never come back at all —
   * so a touched thread is always the newer word.
   */
  seedConversationHistory: (entries: readonly ConversationEntry[]) => void;
  voiceTurn: WaveformVoice | undefined;
  /**
   * The words being spoken, one entry per response: a turn that speaks twice
   * back-to-back keeps both on screen, stacked oldest first.
   */
  lukeCaptions: readonly string[] | undefined;
  remoteAudio: RefObject<HTMLAudioElement | null>;
  /** Escape out of an open turn: forget the press and the latch, and stop listening. */
  discardListening: () => void;
  stopSpeaking: () => boolean;
  syncGuide: (guide: AppGuideSnapshot) => void;
}

/**
 * The spoken conversation: talk key, quiet timer, meter, captions, a changed
 * voice or pace on a live call, and the mouth that lets Luke speak into
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
  // With a ref beside it, because the arrival beat is worded at the moment it
  // is spoken — inside the mouth's own closures — not at a render.
  const [voiceHotkey, setVoiceHotkey, voiceHotkeyNow] = useStateWithRef<
    VoiceHotkeyState | undefined
  >(undefined);
  const [localStream, setLocalStream] = useState<MediaStream>();
  const [remoteStream, setRemoteStream] = useState<MediaStream>();
  // One state for the words and their kind, set together by the session so
  // the live History line can never file a caption under a different reply.
  const [voiceCaption, setVoiceCaption] = useState<{
    texts: readonly string[] | undefined;
    kind: ReplyKind | undefined;
  }>({ texts: undefined, kind: undefined });
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
  const mouth = useRef<SpeechMouth | undefined>(undefined);
  /** When the talk key went down, which is what tells a hold from a tap. */
  const talkPressedAt = useRef<number | undefined>(undefined);
  /** Whether a tap has left a turn open for a later press to end. */
  const talkLatched = useRef(false);
  /** Whether the exchange the count last saw was still standing. */
  const exchangeCounted = useRef(false);
  /**
   * Whether the exchange about to open was opened by the composer. The
   * {@link typedAsk} state cannot answer for it: that is set once the words
   * are away, which is after the call the ask opened has already reached the
   * edge the count is taken on.
   */
  const typedExchange = useRef(false);
  const sessionsRef = useRef(options.sessions);
  /**
   * The conversation history, surviving here across calls: a call is a
   * transport that comes and goes — an announcement is often read out on
   * Luke's own speak-only call, which the talk-key press tears down on its
   * way to opening the developer's, and an idle call retires — while the
   * whole thread itself lives here for this app launch. Only its bounded
   * recent slice re-feeds whichever call opens next; the session's own copy
   * goes with its teardown.
   */
  const conversationRef = useRef<readonly ConversationEntry[]>([]);
  const conversationContextWaitersRef = useRef(new Set<() => void>());
  /**
   * Whether the stored thread has been placed. Once, at the first bootstrap
   * that carries one: a second seeding would re-add lines the developer had
   * already cleared, and a launch that clears before the bootstrap lands must
   * stay cleared.
   */
  const conversationSeeded = useRef(false);
  /** Whether a Clear's deletion is still in flight, so nothing may rewrite it. */
  const conversationClearing = useRef(false);
  /** Rises when Clear retires every event that began before that press. */
  const conversationGenerationRef = useRef(0);
  // State is the ref's identical drawn copy, so History retains the whole
  // current launch even though a call receives only the recent context slice.
  const [conversationHistory, setConversationHistory] = useState<readonly ConversationEntry[]>([]);
  useEffect(() => {
    if (!options.conversationContextReady) return;
    for (const resolve of conversationContextWaitersRef.current) resolve();
    conversationContextWaitersRef.current.clear();
  }, [options.conversationContextReady]);
  /** Where each server-identified spoken turn belongs when its transcript returns. */
  const spokenTurnMarksRef = useRef(
    new Map<
      string,
      { after: ConversationEntry | undefined; generation: number; recordedAt: number }
    >(),
  );
  /** Local turn-close marks waiting for the server item ids that name them. */
  const pendingSpokenTurnMarksRef = useRef<
    { after: ConversationEntry | undefined; generation: number; recordedAt: number }[]
  >([]);
  /** The turn opened by the current talk-key press, before it closes. */
  const activeSpokenTurnMarkRef = useRef<
    { after: ConversationEntry | undefined; generation: number; recordedAt: number } | undefined
  >(undefined);
  /** The generation of the developer-opened turn whose reply is still in flight. */
  const activeReplyGenerationRef = useRef<number | undefined>(undefined);
  /** The History generation in which the current announcement began speaking. */
  const activeAnnouncementGenerationRef = useRef<number | undefined>(undefined);
  /**
   * Whether the turn under way read a transcript aloud. The rendering travels
   * only in the turn that asked for it, so the reply that spoke it must not
   * be recorded: the record keeps the act — already recorded at the carry —
   * and not a word of what it rendered.
   */
  const transcriptSpokenRef = useRef(false);
  // State beside the ref, because the session's callbacks read the flag
  // synchronously while History's live line derives from what React can see.
  const [transcriptSpoken, setTranscriptSpoken] = useState(false);
  const markTranscriptSpoken = useCallback((value: boolean) => {
    transcriptSpokenRef.current = value;
    setTranscriptSpoken(value);
  }, []);
  /**
   * The developer's spoken turns still being transcribed, keyed by the server
   * item that names each turn: the preview History draws while the completed
   * transcript is still on the service's own clock. Kept apart from the
   * thread — a preview settles by leaving when `rememberSpokenAsk` records
   * the completed words, or by leaving alone when nothing ever will.
   */
  const [spokenAskPreviews, setSpokenAskPreviews] =
    useState<ReadonlyMap<string, string>>(NO_SPOKEN_ASK_PREVIEWS);
  const dropSpokenAskPreview = useCallback((itemId: string) => {
    setSpokenAskPreviews((previews) => {
      if (!previews.has(itemId)) return previews;
      const next = new Map(previews);
      next.delete(itemId);
      return next;
    });
  }, []);

  /**
   * Draws and persists the same retained thread. The brain reads the thread
   * from the main process's own copy, so nothing is re-fed to a call here.
   * Clear uses its own acknowledged path below so the screen cannot outrun
   * the deletion.
   */
  const publishConversation = useCallback(() => {
    conversationRef.current = retainedConversationEntries(conversationRef.current, Date.now());
    setConversationHistory(conversationRef.current);
    // Before the restore this thread is only part of itself, and while a Clear
    // is in flight the file it would write is already being deleted: either
    // write would stand in for a thread nobody has.
    if (conversationHistoryMayPersist(conversationSeeded.current, conversationClearing.current)) {
      window.sidecar.reportConversationHistory(conversationRef.current);
    }
  }, []);

  useEffect(() => {
    const expiresAt = conversationHistory.reduce(
      (soonest, entry) =>
        entry.recordedAt === undefined
          ? soonest
          : Math.min(soonest, entry.recordedAt + storedConversationMaximumAgeMs),
      Number.POSITIVE_INFINITY,
    );
    if (!Number.isFinite(expiresAt)) return;
    const timer = window.setTimeout(publishConversation, Math.max(0, expiresAt - Date.now() + 1));
    return () => window.clearTimeout(timer);
  }, [conversationHistory, publishConversation]);

  /**
   * Appends one flattened line to this launch's history. A session leaving the
   * roster costs a line its identity at model render, never its visible words.
   */
  const rememberConversationEntry = useCallback(
    (entry: ConversationEntry | undefined, generation = conversationGenerationRef.current) => {
      if (
        !entry ||
        !conversationEntryBelongsToConversation(generation, conversationGenerationRef.current)
      ) {
        return;
      }
      conversationRef.current = appendConversationThreadEntry(conversationRef.current, entry);
      publishConversation();
    },
    [publishConversation],
  );

  const clearConversationHistory = useCallback(() => {
    if (conversationClearing.current) return;
    conversationClearing.current = true;
    void window.sidecar
      .clearConversationHistory()
      .then((cleared) => {
        if (!cleared) {
          conversationClearing.current = false;
          setVoiceError("Could not clear history. Try again.");
          return;
        }
        conversationGenerationRef.current += 1;
        // Seeded before it is emptied, so a bootstrap still in flight cannot
        // deliver the very thread this press just cleared.
        conversationSeeded.current = true;
        conversationRef.current = [];
        spokenTurnMarksRef.current.clear();
        pendingSpokenTurnMarksRef.current = [];
        setConversationHistory([]);
        // The previews go with the marks: a transcription still arriving
        // belongs to a turn the press just retired.
        setSpokenAskPreviews(NO_SPOKEN_ASK_PREVIEWS);
        talkLatched.current = false;
        talkPressedAt.current = undefined;
        activeReplyGenerationRef.current = undefined;
        activeAnnouncementGenerationRef.current = undefined;
        conversationClearing.current = false;
      })
      .catch(() => {
        conversationClearing.current = false;
        setVoiceError("Could not clear history. Try again.");
      });
  }, []);

  /**
   * Takes another window's report of the shared thread as this window's own.
   * An exchange lands on one window — voice on the primary display's panel, a
   * typed ask on the panel it was typed into — so every other display hears
   * about it here, through the main process, and draws the same History. A
   * cleared report is a Clear pressed elsewhere: it retires this window's
   * in-flight turns the way its own press would, but leaves the talk key's
   * latch alone, because a key held here is not another display's to let go.
   */
  const applySharedConversationHistory = useCallback((payload: ConversationHistoryPayload) => {
    conversationSeeded.current = true;
    if (payload.cleared) {
      conversationGenerationRef.current += 1;
      conversationRef.current = [];
      spokenTurnMarksRef.current.clear();
      pendingSpokenTurnMarksRef.current = [];
      setConversationHistory([]);
      // The previews go with the marks here too: the turns they belong to
      // were just retired, wherever the Clear was pressed.
      setSpokenAskPreviews(NO_SPOKEN_ASK_PREVIEWS);
      activeReplyGenerationRef.current = undefined;
      activeAnnouncementGenerationRef.current = undefined;
      return;
    }
    conversationRef.current = adoptConversationThread(conversationRef.current, payload.entries);
    setConversationHistory(conversationRef.current);
  }, []);

  // Every other display's half of the one conversation, mirrored by the main
  // process. A window's own reports are never echoed back to it, which is why
  // the bootstrap seed below must yield to a touched thread rather than to a
  // push having arrived.
  useEffect(
    () => window.sidecar.onConversationHistoryChanged(applySharedConversationHistory),
    [applySharedConversationHistory],
  );

  const seedConversationHistory = useCallback(
    (entries: readonly ConversationEntry[]) => {
      // A snapshot the main process built before this window's first report —
      // or before a Clear pressed here — must not stand old lines back up.
      if (conversationSeeded.current || conversationGenerationRef.current > 0) return;
      const restoredTail = entries.at(-1);
      if (restoredTail) {
        rebaseSpokenTurnMarks(
          [
            ...spokenTurnMarksRef.current.values(),
            ...pendingSpokenTurnMarksRef.current,
            ...(activeSpokenTurnMarkRef.current ? [activeSpokenTurnMarkRef.current] : []),
          ],
          restoredTail,
        );
      }
      applySharedConversationHistory({
        entries: [...entries, ...conversationRef.current],
        cleared: false,
      });
      publishConversation();
    },
    [applySharedConversationHistory, publishConversation],
  );

  /**
   * Records a spoken ask where its turn happened rather than where its
   * transcription landed: the words come back on the service's own clock,
   * sometimes after the reply they asked for has ended, and an exchange
   * stored in reverse would be re-fed in reverse to every later call. The
   * server item binds it to the mark made for that exact turn, so a transcript
   * delayed past Clear cannot borrow a newer turn's place.
   */
  const rememberSpokenAsk = useCallback(
    (transcript: string, itemId: string) => {
      // The completed words supersede the turn's preview whether or not they
      // may be recorded: either way, nothing about this turn is still arriving.
      dropSpokenAskPreview(itemId);
      const mark = spokenTurnMarksRef.current.get(itemId);
      spokenTurnMarksRef.current.delete(itemId);
      if (
        !mark ||
        !spokenAskBelongsToConversation(mark.generation, conversationGenerationRef.current)
      ) {
        return;
      }
      const placed = insertSpokenAskThreadEntry(
        conversationRef.current,
        transcript,
        mark.after,
        mark.recordedAt,
      );
      // A transcription that came back empty ended its turn — the preview
      // and the mark are already spent — but placed no line, and a thread
      // that did not change owes the open call no update and the other
      // displays no report.
      if (placed === conversationRef.current) return;
      conversationRef.current = placed;
      publishConversation();
    },
    [dropSpokenAskPreview, publishConversation],
  );

  const ensureVoiceSession = useCallback((): RealtimeVoiceSession => {
    voiceSession.current ??= new RealtimeVoiceSession({
      requestConnection: () => window.sidecar.requestRealtimeCredential(),
      sessionConfig: (model) =>
        realtimeSessionConfig({
          model,
          ...(optionsRef.current.voice ? { voice: optionsRef.current.voice } : undefined),
          ...(optionsRef.current.voiceSpeed ? { speed: optionsRef.current.voiceSpeed } : undefined),
        }),
      audioElement: () => remoteAudio.current,
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
      // The voice's one tool: the developer's words go to the brain in the
      // main process, which reads, decides, and acts behind its own validators,
      // and the reply comes back for the voice to say. A reply to an ask the
      // developer made is recorded when the words end, like every reply.
      askBrain: async (question) => {
        const generation = conversationGenerationRef.current;
        const answer = await window.sidecar.askBrain(question);
        if (answer.status === ACT_RESULT_STATUS.ACCEPTED) {
          activeReplyGenerationRef.current = generation;
        }
        return answer;
      },
      onStatus: setVoiceStatus,
      onLocalStream: setLocalStream,
      onRemoteStream: setRemoteStream,
      onError: setVoiceError,
      onCaption: (texts, kind) => setVoiceCaption({ texts, kind }),
      onReplyEnded: (texts, kind) => {
        if (kind === REPLY_KIND.BRIEFING) {
          const generation = activeAnnouncementGenerationRef.current;
          activeAnnouncementGenerationRef.current = undefined;
          rememberConversationEntry(announcementConversationEntry(texts.join(" ")), generation);
          return;
        }
        const generation = activeReplyGenerationRef.current;
        activeReplyGenerationRef.current = undefined;
        rememberConversationEntry(replyConversationEntry(texts.join(" ")), generation);
      },
      onSpokenAskCommitted: (itemId) => {
        const mark = pendingSpokenTurnMarksRef.current.shift();
        if (mark) spokenTurnMarksRef.current.set(itemId, mark);
      },
      onSpokenAskClosed: () => {
        const mark = activeSpokenTurnMarkRef.current;
        activeSpokenTurnMarkRef.current = undefined;
        if (mark) pendingSpokenTurnMarksRef.current.push(mark);
      },
      // The developer's spoken words, back from the service that heard them,
      // placed where their turn happened: the thread holds both halves of
      // the exchange, in the order they were said.
      onSpokenAsk: rememberSpokenAsk,
      // The same words while they are still arriving, previewed on the
      // completed transcript's own terms: only a turn whose committed item
      // holds a mark in the history generation still showing may draw, so a
      // straggler after Clear previews nothing it could never record.
      onSpokenAskDelta: (itemId, delta) => {
        const mark = spokenTurnMarksRef.current.get(itemId);
        if (
          !mark ||
          !spokenAskBelongsToConversation(mark.generation, conversationGenerationRef.current)
        ) {
          return;
        }
        setSpokenAskPreviews((previews) => {
          const next = new Map(previews);
          next.set(itemId, (next.get(itemId) ?? "") + delta);
          return next;
        });
      },
      // No completed transcript is coming for this turn, so its preview
      // leaves the way its recorded line never arrives.
      onSpokenAskFailed: dropSpokenAskPreview,
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
  }, [dropSpokenAskPreview, rememberConversationEntry, rememberSpokenAsk, setVoiceStatus]);

  /**
   * Words the arrival beat from what is true at the moment it is spoken, not
   * at the moment it was queued: the trigger lands seconds after sign-in,
   * while the first observation pass and the call's own handshake are still
   * running, and a beat worded then would name no session on a machine full
   * of them. The title is read from the same observed roster every row draws,
   * and the spoken try is only suggested while voice could actually take it.
   */
  const wordedArrival = useCallback(
    (speech: ArrivalSpeech): ArrivalSpeech => {
      const current = optionsRef.current;
      const working = current.sessions.find(
        (session) => session.status === SESSION_STATUS.WORKING && session.realtimeVoice !== true,
      );
      // A change wins whole, exactly as `voiceHotkeyToShow` reads the pair: a
      // changed state with no chord is a key deleted or lost, and falling back
      // to bootstrap would speak a chord that no longer answers.
      const changedTalkKey = voiceHotkeyNow();
      const talkKey = changedTalkKey ? changedTalkKey.hotkey : current.bootstrapVoiceHotkey;
      return {
        ...speech,
        ...(working ? { sessionTitle: working.title } : undefined),
        ...(current.voiceAvailable && talkKey !== undefined
          ? { talkKeyLabel: voiceHotkeyLabel(talkKey) }
          : undefined),
      };
    },
    [voiceHotkeyNow],
  );

  /**
   * The mouth that lets Luke speak into silence: it takes the one turn the
   * main process's speech arbiter offers — a briefing the brain decided or an
   * onboarding beat — and, when no conversation is open, opens a speak-only
   * call of Luke's own to say it through, then closes it; what became of the
   * offer goes back by id, and only then is the next offered. Built beside
   * the session because it drives nothing else. The session it drives is
   * wrapped once, so an arrival beat is worded at the moment of speaking;
   * every other member forwards untouched.
   */
  const ensureMouth = useCallback((): SpeechMouth => {
    mouth.current ??= new SpeechMouth({
      settle: (id, outcome) => void window.sidecar.settleSpeech(id, outcome),
      session: () => {
        const session = ensureVoiceSession();
        return {
          get isConnected() {
            return session.isConnected;
          },
          get isConnecting() {
            return session.isConnecting;
          },
          get status() {
            return session.status;
          },
          get microphoneCall() {
            return session.microphoneCall;
          },
          connect: (connectOptions: { microphone: false }) => session.connect(connectOptions),
          speak: (item) => {
            if (!isArrivalSpeech(item)) {
              const spoke = session.speak(item);
              if (spoke) {
                activeAnnouncementGenerationRef.current = conversationGenerationRef.current;
              }
              return spoke;
            }
            return session.speak(wordedArrival(item));
          },
          stopSpeaking: () => session.stopSpeaking(),
          close: () => session.close(),
        };
      },
    });
    return mouth.current;
  }, [ensureVoiceSession, wordedArrival]);

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
   * Opens the developer's call. Nothing is fed to it: the roster, the history,
   * and the guide are the brain's, in the main process, and the voice reaches
   * them through its one tool. Nothing is asked of the system on the way
   * either: connecting declares a bare transceiver, no capture device opens,
   * and the microphone permission has no part in it — the device stays the
   * press's own act.
   */
  const startConversation = useCallback(async (): Promise<boolean> => {
    await waitForConversationContext(
      optionsRef.current.conversationContextReady,
      conversationContextWaitersRef.current,
    );
    setVoiceError(undefined);
    setVoiceNotice(undefined);
    const session = ensureVoiceSession();
    return session.connect();
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

  /** The neutral note used when the hosted service's emergency brake refuses a call. */
  const hostedUnavailableNote = useCallback(async (): Promise<string | undefined> => {
    const diagnostics = await window.sidecar.requestRealtimeDiagnostics().catch(() => undefined);
    return hostedVoiceUnavailableNote(diagnostics);
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
    // An ask whose send never landed leaves its mark behind; the key is the
    // other way in, so this press is what clears it.
    typedExchange.current = false;
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
    // The interruption can synchronously hand over the reply the developer
    // just cut off. Let that older line land before marking the new turn, so
    // its delayed transcript is inserted after everything that preceded it.
    session.beginTurn();
    activeSpokenTurnMarkRef.current = {
      after: conversationRef.current.at(-1),
      generation: conversationGenerationRef.current,
      recordedAt: Date.now(),
    };
    // Only after the interrupted reply's handover does this new turn own the
    // active reply generation.
    activeReplyGenerationRef.current = activeSpokenTurnMarkRef.current.generation;
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
    // A hosted refusal would otherwise be answered by nothing at all. Keep
    // the emergency ceiling private and surface only temporary unavailability.
    if (session.status === REALTIME_STATUS.UNAVAILABLE) {
      const unavailable = await hostedUnavailableNote();
      if (unavailable) setVoiceNotice(unavailable);
    }
  }, [ensureVoiceSession, hostedUnavailableNote, microphoneStatus, startMicrophone]);

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
   * A typed ask to Luke himself. The words go to the brain over the bridge —
   * typing is the developer asking in their own words, so the brain's turn may
   * act, behind the same validators every act runs — and the reply comes back
   * to be spoken on the same call the talk key opens. It asks the system for
   * nothing on the way: typing opens no capture device, and the reply arrives
   * on the call's receiving half. Answers with why the ask could not go, or
   * nothing when it did — the reply is spoken, and its words land under the
   * panel as the answer; where voice cannot speak it, the words stand on the
   * strip instead, so an ask is never answered with silence.
   */
  const askLuke = useCallback(
    async (text: string): Promise<string | undefined> => {
      const generation = conversationGenerationRef.current;
      const session = ensureVoiceSession();
      typedExchange.current = true;
      // The developer's own words enter the history as they were typed, so
      // the thread holds both halves of the exchange the reply answers.
      rememberConversationEntry(
        { kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: text },
        generation,
      );
      // A sent ask outdates whatever refusal the strip was still reading.
      setVoiceNotice(undefined);
      // Luke's own speak-only call cannot carry the reply to a typed ask — it
      // is not a conversation — so it counts as no call here, and `connect`
      // inside stands it down for the developer's own. A microphone call
      // still connecting is awaited, not doubled.
      const connecting =
        !session.isConnected || !session.microphoneCall
          ? startConversation()
          : Promise.resolve(true);
      const [connected, answer] = await Promise.all([connecting, window.sidecar.askBrain(text)]);
      if (answer.status !== ACT_RESULT_STATUS.ACCEPTED) {
        setVoiceNotice(answer.reason);
        return answer.reason;
      }
      if (connected && session.speakReply(answer.briefing)) {
        activeReplyGenerationRef.current = generation;
        setTypedAsk(true);
        return undefined;
      }
      // Voice cannot say it, so the words stand on the strip and enter the
      // record as the reply they are.
      rememberConversationEntry(replyConversationEntry(answer.briefing), generation);
      setVoiceNotice(answer.briefing);
      return undefined;
    },
    [rememberConversationEntry, ensureVoiceSession, startConversation],
  );

  const discardListening = useCallback(() => {
    talkLatched.current = false;
    talkPressedAt.current = undefined;
    voiceSession.current?.stopListening(false);
  }, []);

  const stopSpeaking = useCallback(() => voiceSession.current?.stopSpeaking() === true, []);

  // The guide goes to the main process, where the brain reads it and an app
  // act the brain asks for is validated against it; the voice itself is told
  // nothing about the app.
  const syncGuide = useCallback((guide: AppGuideSnapshot) => {
    window.sidecar.reportAppGuide(guide);
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
      markTranscriptSpoken(false);
    }
    // The call gone takes its half-transcribed turns with it: no completed
    // transcript can arrive to settle a preview, so none may keep streaming.
    if (!spokenAskPreviewSurvives(voiceStatus)) {
      setSpokenAskPreviews(NO_SPOKEN_ASK_PREVIEWS);
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
  }, [markTranscriptSpoken, voiceStatus]);

  // The strip the error is drawn on takes no pointer, so nothing but time can
  // dismiss it: a fault left up would sit on the desktop all afternoon. A new
  // error re-arms the clock — it is a new thing to read.
  useEffect(() => {
    if (voiceError === undefined) return;
    const timer = setTimeout(() => setVoiceError(undefined), VOICE_ERROR_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [voiceError]);

  // The notice leaves on the same clock the error does: it shares the strip.
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
    const active = voiceExchangeActive(voiceStatus);
    // The panel takes the level on every change — the duck and the face
    // follow it — while the count takes only the rising edge, or one turn's
    // walk from connecting through responding would be counted three times.
    const rising = active && !exchangeCounted.current;
    exchangeCounted.current = active;
    if (!rising) {
      window.sidecar.setVoiceExchangeActive(active, undefined);
      return;
    }
    const kind = voiceExchangeKind({
      microphoneCall: voiceSession.current?.microphoneCall === true,
      typedAsk: typedExchange.current,
    });
    typedExchange.current = false;
    window.sidecar.setVoiceExchangeActive(active, kind);
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
  }, [options.sessions]);

  // One proactive turn the main process decided to voice now — a briefing
  // the brain decided, or an onboarding beat whose observed values (a
  // working session's title, the talk key) are read at the moment it is
  // spoken. The mouth rides an open call or opens Luke's own, hands it back
  // held under the quiet, and settles it stale rather than speaking it past
  // its deadline; every outcome is reported by id so the next can be offered.
  useEffect(() => {
    return window.sidecar.onSpeechOffered((offer) => {
      ensureMouth().offer(offer);
    });
  }, [ensureMouth]);

  // The main process taking an offer back — the gate a beat explained stood
  // down, the account it greeted signed out — before it is spoken.
  useEffect(() => {
    return window.sidecar.onSpeechWithdrawn(({ id }) => {
      mouth.current?.withdraw(id);
    });
  }, []);

  // An app act the brain decided that only this renderer can perform. It was
  // validated against the guide in the main process; the carrier performs it
  // and the answer goes back by the request's id, so the brain's turn can say
  // what happened.
  useEffect(() => {
    return window.sidecar.onBrainAppAct((request) => {
      void optionsRef.current
        .carryAppAction(request.action)
        .catch((error: Error) => ({
          status: ACT_RESULT_STATUS.REJECTED,
          reason: error instanceof Error ? error.message : "The change could not be made.",
        }))
        .then((answer) => window.sidecar.answerBrainAppAct(request.requestId, answer));
    });
  }, []);

  // The mouth paces itself by the session's status: READY is when the offer
  // in hand can speak and when an empty hand starts the walk toward closing
  // the call Luke opened for himself. Built through ensure so the status
  // history is already standing when the first offer arrives — the grace
  // window after a reply needs to know one just ended.
  useEffect(() => {
    ensureMouth().onStatus(voiceStatus);
  }, [ensureMouth, voiceStatus]);

  // The hold reaching the mouth. A hold beginning is built through ensure, so
  // it stands even before the first offer would have built the mouth; a hold
  // ending has nothing here to wake, because the main process offers what it
  // held once the quiet ends.
  useEffect(() => {
    if (options.announcementsHeld) ensureMouth().setHeld(true);
    else mouth.current?.setHeld(false);
  }, [ensureMouth, options.announcementsHeld]);

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
  useEffect(() => window.sidecar.onVoiceHotkeyChanged(setVoiceHotkey), [setVoiceHotkey]);
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

  // Derived, not queued: the live lines arrive with the captions and die with
  // them, so History can never show words still arriving for a reply or a
  // turn that has already settled or left.
  const live = useMemo(
    () =>
      liveConversationEntries({
        spokenAskPreviews,
        captions: voiceCaption.texts,
        kind: voiceCaption.kind,
        transcriptSpoken,
      }),
    [spokenAskPreviews, transcriptSpoken, voiceCaption],
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
    voiceStatus,
    setVoiceStatus,
    talkOpening,
    voiceHotkey,
    handleVoiceActivity,
    requestMicrophoneAccess,
    startMicrophone,
    stopMicrophone,
    askLuke,
    conversationHistory,
    clearConversationHistory,
    liveConversationEntries: live,
    seedConversationHistory,
    voiceTurn,
    lukeCaptions,
    remoteAudio,
    discardListening,
    stopSpeaking,
    syncGuide,
  };
}
