import { PRODUCT_ASK_OUTCOME, PRODUCT_SURFACE_EVENT } from "@sidecar/analytics";
import { sanitizedTraceEvent } from "@sidecar/devtrace/vocabulary";
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
import { SESSION_STATUS, type Session } from "@sidecar/session";
import { TALK_KEY_RELEASE, talkKeyRelease, voiceHotkeyLabel } from "@sidecar/settings";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MicrophoneStatus, OutputAudioState, VoiceHotkeyState } from "#shared/wire/audio";
import type { AppBootstrap } from "#shared/wire/session";
import { type AppSettingsView, appSettingsView } from "#shared/wire/settings";
import {
  VOICE_COMMAND,
  type VoiceView,
  voiceExchangeActive,
  voiceExchangeKind,
} from "#shared/wire/voice-view";
import { hostedVoiceUnavailableNote } from "../microphone-access";
import { useStateWithRef } from "../use-state-with-ref";
import { outputSilent } from "../volume-hint";
import { openPreferredMicrophone } from "./microphone-choice";
import { REPLY_KIND, RealtimeVoiceSession, type ReplyKind } from "./realtime-session";
import { SpeechMouth } from "./speech-mouth";
import { startVoiceLevelMeter } from "./voice-level-meter";

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
 * The words the panels draw under the shape, one entry per response so
 * back-to-back responses stack apart instead of running together. Luke's
 * captions are offered only when there is a reason to read them and the reply
 * they belong to is his turn: the captions preference, a reply answering an
 * ask the developer typed, or an output that would swallow the speech. A
 * capture run's fixture words are the panel's own affair; no voice window
 * stands in one.
 */
export function lukeCaptionsToShow(input: {
  captionsEnabled: boolean;
  typedAsk: boolean;
  outputSilent: boolean;
  status: RealtimeStatus;
  captions: readonly string[] | undefined;
}): readonly string[] | undefined {
  if (
    (input.captionsEnabled || input.typedAsk || input.outputSilent) &&
    input.status === REALTIME_STATUS.RESPONDING
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

/**
 * The state the voice window reads from the main process rather than owns:
 * the settings that shape a call, the roster the arrival beat is worded from,
 * the talk key its suggestion names, and the output the captions answer.
 * Seeded from the bootstrap and kept current by the same pushes every panel
 * receives.
 */
interface VoiceSurroundings {
  settings: AppSettingsView | undefined;
  agentTraceEnabled: boolean;
  sessions: readonly Session[];
  bootstrapVoiceHotkey: string | undefined;
  voiceHotkey: VoiceHotkeyState | undefined;
  outputAudio: OutputAudioState | undefined;
  announcementsHeld: boolean;
  /** Whether restored history and personal memory are ready for the first turn. */
  conversationContextReady: boolean;
}

const INITIAL_SURROUNDINGS: VoiceSurroundings = {
  settings: undefined,
  agentTraceEnabled: false,
  sessions: [],
  bootstrapVoiceHotkey: undefined,
  voiceHotkey: undefined,
  outputAudio: undefined,
  announcementsHeld: false,
  conversationContextReady: false,
};

/**
 * The spoken conversation, held in the hidden voice window so no panel does:
 * the session, the microphone, the talk key's latch, the mouth that lets Luke
 * speak into silence, the level meter that ends his turn, and the thread the
 * exchange leaves behind. It holds no policy: it carries out the commands the
 * main process forwards and reports every edge back as one `VoiceView`, which
 * the main process hands to every panel. Nothing is drawn here.
 */
export function useVoiceSession(remoteAudio: RefObject<HTMLAudioElement | null>): void {
  const [surroundings, setSurroundings, surroundingsNow] =
    useStateWithRef<VoiceSurroundings>(INITIAL_SURROUNDINGS);
  const amend = useCallback(
    (change: Partial<VoiceSurroundings>) => {
      setSurroundings({ ...surroundingsNow(), ...change });
    },
    [setSurroundings, surroundingsNow],
  );

  // Read only inside the press's own closure, so the ref is the half that matters.
  const [, setMicrophoneStatus, microphoneStatusNow] =
    useStateWithRef<MicrophoneStatus>("not-determined");
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
   * Whether the stored thread has been placed. Once, at the bootstrap that
   * carries it: a second seeding would re-add lines the developer had already
   * cleared, and a Clear that lands before the bootstrap must stay cleared.
   */
  const conversationSeeded = useRef(false);
  /** Rises when Clear retires every event that began before that press. */
  const conversationGenerationRef = useRef(0);
  // State is the ref's identical copy, so the retention timer below reads the
  // thread React can see.
  const [conversationHistory, setConversationHistory] = useState<readonly ConversationEntry[]>([]);
  useEffect(() => {
    if (!surroundings.conversationContextReady) return;
    for (const resolve of conversationContextWaitersRef.current) resolve();
    conversationContextWaitersRef.current.clear();
  }, [surroundings.conversationContextReady]);
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
   * Persists the retained thread. This window is the thread's one writer: the
   * main process stores what it reports, relays it to every panel's History,
   * and reads the recent slice for the brain, so nothing is re-fed to a call
   * here. Before the restore this thread is only part of itself, and a write
   * then would stand in for a thread nobody has.
   */
  const publishConversation = useCallback(() => {
    conversationRef.current = retainedConversationEntries(conversationRef.current, Date.now());
    setConversationHistory(conversationRef.current);
    if (conversationSeeded.current) {
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

  /**
   * The Clear a panel pressed, already carried out by the main process — the
   * file deleted, every panel told — arriving here to retire this window's
   * in-flight turns the way the press would have. The talk key's latch goes
   * with them: a turn the press just retired is not one the next press ends.
   */
  const clearConversation = useCallback(() => {
    conversationGenerationRef.current += 1;
    // Seeded even if the bootstrap has not landed, so one still in flight
    // cannot deliver the very thread this press just cleared.
    conversationSeeded.current = true;
    conversationRef.current = [];
    spokenTurnMarksRef.current.clear();
    pendingSpokenTurnMarksRef.current = [];
    setConversationHistory([]);
    // The previews go with the marks: a transcription still arriving belongs
    // to a turn the press just retired.
    setSpokenAskPreviews(NO_SPOKEN_ASK_PREVIEWS);
    talkLatched.current = false;
    talkPressedAt.current = undefined;
    activeReplyGenerationRef.current = undefined;
    activeAnnouncementGenerationRef.current = undefined;
  }, []);

  /**
   * The stored thread, placed once from the bootstrap that carries it. Turns
   * opened before it landed are moved behind it, so a transcript arriving
   * late is inserted after the restored lines rather than ahead of them.
   */
  const seedConversationHistory = useCallback(
    (entries: readonly ConversationEntry[]) => {
      if (conversationSeeded.current || conversationGenerationRef.current > 0) return;
      conversationSeeded.current = true;
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
      conversationRef.current = adoptConversationThread(conversationRef.current, [
        ...entries,
        ...conversationRef.current,
      ]);
      publishConversation();
    },
    [publishConversation],
  );

  // The main process's own lines in the thread — the ask a carried act was —
  // relayed here as to every panel, so this window's next whole report
  // carries them rather than standing them back down. A Clear travels on its
  // own command instead, so a relay that says cleared has nothing left to do.
  useEffect(
    () =>
      window.sidecar.onConversationHistoryChanged((payload) => {
        if (payload.cleared) return;
        conversationRef.current = adoptConversationThread(conversationRef.current, payload.entries);
        setConversationHistory(conversationRef.current);
      }),
    [],
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
      // that did not change owes the other displays no report.
      if (placed === conversationRef.current) return;
      conversationRef.current = placed;
      publishConversation();
    },
    [dropSpokenAskPreview, publishConversation],
  );

  const ensureVoiceSession = useCallback((): RealtimeVoiceSession => {
    voiceSession.current ??= new RealtimeVoiceSession({
      requestConnection: () => window.sidecar.requestRealtimeCredential(),
      sessionConfig: (model) => {
        const settings = surroundingsNow().settings;
        return realtimeSessionConfig({
          model,
          ...(settings?.voice ? { voice: settings.voice } : undefined),
          ...(settings?.voiceSpeed ? { speed: settings.voiceSpeed } : undefined),
        });
      },
      audioElement: () => remoteAudio.current,
      // The press's device, chosen by facts read natively: the Mac's own
      // microphone where a Bluetooth headset would otherwise pay for the
      // capture with its music codec, the browser's default everywhere else.
      // The switch reads at the press, so flipping it needs no reconnect.
      requestMicrophoneStream: () =>
        openPreferredMicrophone({
          route: () =>
            (surroundingsNow().settings?.preferBuiltInMicrophone ?? true)
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
        if (!surroundingsNow().agentTraceEnabled) return;
        window.sidecar.recordAgentTrace({ direction, event: sanitizedTraceEvent(event) });
      },
    });
    return voiceSession.current;
  }, [
    dropSpokenAskPreview,
    remoteAudio,
    rememberConversationEntry,
    rememberSpokenAsk,
    setVoiceStatus,
    surroundingsNow,
  ]);

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
      const current = surroundingsNow();
      const working = current.sessions.find(
        (session) => session.status === SESSION_STATUS.WORKING && session.realtimeVoice !== true,
      );
      // A change wins whole, exactly as `voiceHotkeyToShow` reads the pair: a
      // changed state with no chord is a key deleted or lost, and falling back
      // to bootstrap would speak a chord that no longer answers.
      const changedTalkKey = current.voiceHotkey;
      const talkKey = changedTalkKey ? changedTalkKey.hotkey : current.bootstrapVoiceHotkey;
      return {
        ...speech,
        ...(working ? { sessionTitle: working.title } : undefined),
        ...(current.settings?.voiceAvailable && talkKey !== undefined
          ? { talkKeyLabel: voiceHotkeyLabel(talkKey) }
          : undefined),
      };
    },
    [surroundingsNow],
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

  // Voice arriving and voice going away. It is not read from bootstrap alone,
  // because it is not only true of a launch: a key entered in the panel turns
  // a session that reported itself unavailable into one that can connect,
  // without a relaunch — and deleting that key has to close whatever call is
  // open rather than leave a live microphone answering a talk key the main
  // process has already given back.
  const voiceAvailable = surroundings.settings?.voiceAvailable;
  useEffect(() => {
    // Not yet known. Saying "off" before the answer arrives would draw the
    // unavailable state over a working key for the first frames of every launch.
    if (voiceAvailable === undefined) return;
    if (!voiceAvailable) {
      void stopMicrophone().then(() => {
        // The close is async. A key deleted and reconnected while it was in
        // flight has already rebuilt a minter; forcing unavailable then would
        // leave the talk key looking dead over a live credential.
        if (surroundingsNow().settings?.voiceAvailable === false) {
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
  }, [voiceAvailable, setVoiceStatus, stopMicrophone, surroundingsNow, voiceStatusNow]);

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
      surroundingsNow().conversationContextReady,
      conversationContextWaitersRef.current,
    );
    setVoiceError(undefined);
    setVoiceNotice(undefined);
    const session = ensureVoiceSession();
    return session.connect();
  }, [ensureVoiceSession, surroundingsNow]);

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
  }, [ensureVoiceSession, setMicrophoneStatus, startConversation]);

  /** The neutral note used when the hosted service's emergency brake refuses a call. */
  const hostedUnavailableNote = useCallback(async (): Promise<string | undefined> => {
    const diagnostics = await window.sidecar.requestRealtimeDiagnostics().catch(() => undefined);
    return hostedVoiceUnavailableNote(diagnostics);
  }, []);

  /**
   * Asks the system for access and nothing else. The capture device itself is
   * the talk key's own act: it opens with a press and closes with the turn,
   * and the panel's row must not be a second way to it.
   */
  const requestMicrophoneAccess = useCallback(async () => {
    setMicrophoneStatus(await window.sidecar.requestMicrophone());
  }, [setMicrophoneStatus]);

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
    if (microphoneStatusNow() !== "granted") {
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
  }, [
    ensureVoiceSession,
    hostedUnavailableNote,
    microphoneStatusNow,
    setMicrophoneStatus,
    startMicrophone,
  ]);

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
   * A typed ask to Luke himself, forwarded from the panel it was typed into.
   * The words go to the brain over the bridge — typing is the developer
   * asking in their own words, so the brain's turn may act, behind the same
   * validators every act runs — and the reply comes back to be spoken on the
   * same call the talk key opens. It asks the system for nothing on the way:
   * typing opens no capture device, and the reply arrives on the call's
   * receiving half. A refusal lands on the strip; where voice cannot speak
   * the reply, the words stand on the strip instead, so an ask is never
   * answered with silence. Whether the ask reached a conversation is counted
   * here, where the answer is known, and never what it carried.
   */
  const askLuke = useCallback(
    async (text: string): Promise<void> => {
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
      window.sidecar.recordSurfaceEvent(PRODUCT_SURFACE_EVENT.ASK_SUBMIT, {
        ask_outcome:
          answer.status === ACT_RESULT_STATUS.ACCEPTED
            ? PRODUCT_ASK_OUTCOME.SENT
            : PRODUCT_ASK_OUTCOME.REFUSED,
      });
      if (answer.status !== ACT_RESULT_STATUS.ACCEPTED) {
        setVoiceNotice(answer.reason);
        return;
      }
      if (connected && session.speakReply(answer.briefing)) {
        activeReplyGenerationRef.current = generation;
        setTypedAsk(true);
        return;
      }
      // Voice cannot say it, so the words stand on the strip and enter the
      // record as the reply they are.
      rememberConversationEntry(replyConversationEntry(answer.briefing), generation);
      setVoiceNotice(answer.briefing);
    },
    [rememberConversationEntry, ensureVoiceSession, startConversation],
  );

  const discardListening = useCallback(() => {
    talkLatched.current = false;
    talkPressedAt.current = undefined;
    voiceSession.current?.stopListening(false);
  }, []);

  // The bootstrap, read once: the settings that shape a call, the thread the
  // last launch left, and the facts pushes will keep current from here on.
  // The voice window stands on no display and never announces itself ready;
  // the panel-only fields are simply not read.
  useEffect(() => {
    let cancelled = false;
    void window.sidecar.getBootstrap().then((value: AppBootstrap) => {
      if (cancelled) return;
      seedConversationHistory(value.conversationHistory);
      setMicrophoneStatus(value.microphoneStatus);
      const current = surroundingsNow();
      // Only fill in what no push has said yet: the bootstrap snapshot is
      // older than any change that raced past it.
      amend({
        settings: current.settings ?? appSettingsView(value.settings),
        agentTraceEnabled: value.agentTraceEnabled,
        sessions: current.sessions.length > 0 ? current.sessions : value.sessionRoster.sessions,
        bootstrapVoiceHotkey: value.voiceHotkey,
        outputAudio: current.outputAudio ?? value.outputAudio,
        announcementsHeld: current.announcementsHeld || value.announcementsHeld,
        conversationContextReady: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [amend, seedConversationHistory, setMicrophoneStatus, surroundingsNow]);

  useEffect(
    () =>
      window.sidecar.onSettingsChanged((pushed) => amend({ settings: appSettingsView(pushed) })),
    [amend],
  );
  useEffect(
    () => window.sidecar.onSessionsChanged((pushed) => amend({ sessions: pushed.sessions })),
    [amend],
  );
  useEffect(
    () => window.sidecar.onAnnouncementsHeldChanged((held) => amend({ announcementsHeld: held })),
    [amend],
  );
  useEffect(
    () => window.sidecar.onVoiceHotkeyChanged((state) => amend({ voiceHotkey: state })),
    [amend],
  );
  useEffect(
    () => window.sidecar.onOutputAudioChanged((state) => amend({ outputAudio: state })),
    [amend],
  );
  // The system's answer as the main process last learned it — a panel's row
  // asked, or this window's own press did — so a press here reads the same
  // status the rows draw.
  useEffect(
    () => window.sidecar.onMicrophoneStatusChanged(setMicrophoneStatus),
    [setMicrophoneStatus],
  );

  // A panel's ask, validated and forwarded by the main process. Each command
  // is the same act the panel used to perform on its own session; none opens
  // a turn the developer did not.
  useEffect(
    () =>
      window.sidecar.onVoiceCommand(({ command, text }) => {
        if (command === VOICE_COMMAND.ASK_TEXT) {
          if (text !== undefined) void askLuke(text);
        } else if (command === VOICE_COMMAND.DISCARD_LISTENING) discardListening();
        else if (command === VOICE_COMMAND.STOP_SPEAKING) voiceSession.current?.stopSpeaking();
        else if (command === VOICE_COMMAND.REQUEST_MICROPHONE_ACCESS)
          void requestMicrophoneAccess();
        else if (command === VOICE_COMMAND.CLEAR_CONVERSATION) clearConversation();
      }),
    [askLuke, clearConversation, discardListening, requestMicrophoneAccess],
  );

  const heardSpeed = useRef<RealtimeVoiceSpeed | undefined>(undefined);
  const voiceSpeed = surroundings.settings?.voiceSpeed;
  useEffect(() => {
    if (voiceSpeed === undefined) return;
    const previous = heardSpeed.current;
    heardSpeed.current = voiceSpeed;
    if (!liveSpeedApplies(previous, voiceSpeed)) return;
    voiceSession.current?.applySpeed(voiceSpeed);
  }, [voiceSpeed]);

  const heardVoice = useRef<RealtimeVoice | undefined>(undefined);
  const voiceRestartDue = useRef(false);
  const voice = surroundings.settings?.voice;
  useEffect(() => {
    const decided = voiceRestartAction({
      previous: heardVoice.current,
      next: voice,
      live:
        voiceSession.current?.isConnected === true || voiceSession.current?.isConnecting === true,
      due: voiceRestartDue.current,
      status: voiceStatus,
    });
    if (voice !== undefined) heardVoice.current = voice;
    voiceRestartDue.current = decided.due;
    if (decided.action !== VOICE_RESTART.RESTART) return;
    // Reconnecting is the call's act, not a press: the device the old call
    // held went with its close, and the next press asks for its own.
    void (async () => {
      await voiceSession.current?.close();
      await startConversation();
    })();
  }, [voice, startConversation, voiceStatus]);

  const activeStream = activeVoiceStream({
    status: voiceStatus,
    local: localStream,
    remote: remoteStream,
  });

  // The meter listens to whoever holds the turn, and it is also what ends
  // Luke's turn: his reply is over when it stops being audible, not when the
  // model stops producing it, and the session decides that a pause between
  // two sentences is not an ending. The loudness itself goes to the main
  // process for the panels to draw, at a bounded rate, and only while a
  // stream is active — which is exactly while a turn is listening or
  // responding.
  useEffect(() => {
    if (!activeStream) return;
    const context = audioContext.current ?? new AudioContext({ latencyHint: "interactive" });
    audioContext.current = context;
    return startVoiceLevelMeter({
      stream: activeStream,
      audioContext: context,
      onActivity: (active) => voiceSession.current?.reportRemoteAudioLevel(active),
      onLevel: (level) => window.sidecar.reportVoiceLevel(level),
    });
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
    if (surroundings.announcementsHeld) ensureMouth().setHeld(true);
    else mouth.current?.setHeld(false);
  }, [ensureMouth, surroundings.announcementsHeld]);

  // The talk key is registered by the main process so it answers from any app,
  // which is the whole point: no window to find, nothing to focus first. Both
  // edges arrive, because a turn you hold ends when the key does. A press
  // during a chord being recorded is held back in the main process, where
  // the recording is known; the release always lands, so a hold opened
  // before the recording began still ends when the key comes up rather than
  // leaving the microphone open — and a release whose press was held back
  // finds nothing pressed and answers nothing.
  useEffect(() => window.sidecar.onVoiceHotkeyPress(() => void beginTalk()), [beginTalk]);
  useEffect(() => window.sidecar.onVoiceHotkeyRelease(endTalk), [endTalk]);
  // The stop key asks for quiet from any app, exactly as Escape asks for it
  // from the panel: the session itself answers whether there is a reply to
  // stop, so a press over silence simply does nothing.
  useEffect(
    () => window.sidecar.onStopHotkeyPress(() => void voiceSession.current?.stopSpeaking()),
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

  const lukeCaptions = lukeCaptionsToShow({
    captionsEnabled: surroundings.settings?.voiceCaptions === true,
    typedAsk,
    outputSilent: outputSilent(surroundings.outputAudio),
    status: voiceStatus,
    captions: voiceCaption.texts,
  });

  // The whole snapshot, on every edge: it is small, and a panel that opens
  // late is handed the latest by the main process. The count of exchanges
  // rides the same report — the kind travels only on the edge that opened
  // one, or a turn walking from connecting through responding would be
  // counted three times — because this window alone knows who opened it:
  // Luke's own speak-only call has no microphone, and only the composer says
  // typed in advance.
  useEffect(() => {
    const view: VoiceView = {
      voiceStatus,
      voiceError,
      voiceNotice,
      talkOpening,
      lukeCaptions,
      liveConversationEntries: live,
    };
    const active = voiceExchangeActive(voiceStatus);
    const rising = active && !exchangeCounted.current;
    exchangeCounted.current = active;
    if (!rising) {
      window.sidecar.reportVoiceView(view, undefined);
      return;
    }
    const kind = voiceExchangeKind({
      microphoneCall: voiceSession.current?.microphoneCall === true,
      typedAsk: typedExchange.current,
    });
    typedExchange.current = false;
    window.sidecar.reportVoiceView(view, kind);
  }, [live, lukeCaptions, talkOpening, voiceError, voiceNotice, voiceStatus]);
}
