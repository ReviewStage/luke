import { type ConversationEntry, REALTIME_STATUS, type RealtimeStatus } from "@sidecar/realtime";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MicrophoneStatus, VoiceHotkeyState } from "#shared/wire/audio";
import type { AppBootstrap } from "#shared/wire/session";
import {
  IDLE_VOICE_VIEW,
  VOICE_COMMAND,
  VOICE_COMMAND_OUTCOME,
  type VoiceCommandOutcome,
  type VoiceView,
} from "#shared/wire/voice-view";
import { useBootstrapRacedChannel } from "./use-bootstrap-raced-channel";
import { VOICE_ERROR_NOTICE_MS } from "./voice/use-voice-session";
import { VOICE_ACTIVITY_HANGOVER_MS, VOICE_ACTIVITY_THRESHOLD } from "./voice/voice-level-meter";
import { WAVEFORM_VOICE, type WaveformVoice } from "./waveform";

/**
 * What the composer hears back from a typed ask: nothing when the ask reached
 * a conversation, so the draft clears, and a reason when it did not, so the
 * developer's words stay theirs to retry. An ask nobody answered — the voice
 * window gone, the wait run out — is refused too: words lost on a silence
 * would be the one outcome nobody chose. The strip already carries the
 * specific refusal through the view, so this only has to be true.
 */
export const ASK_UNSENT_REASON = "Luke could not take that ask. Try again.";

export function askDraftReason(outcome: VoiceCommandOutcome | undefined): string | undefined {
  return outcome === VOICE_COMMAND_OUTCOME.ACCEPTED ? undefined : ASK_UNSENT_REASON;
}

/** What the strip says when the stored thread could not be deleted. */
export const CLEAR_FAILED_REASON = "Could not clear history. Try again.";

/**
 * How long a voice has been active, read off the relayed levels with the
 * meter's own hangover: a loud report starts it, a quiet one lets it run out
 * from the last loud report rather than from itself, so the panel's edge
 * lands where the voice window's did.
 */
export function voiceActiveFor(input: {
  level: number;
  now: number;
  lastLoudAt: number | undefined;
}) {
  const lastLoudAt = input.level > VOICE_ACTIVITY_THRESHOLD ? input.now : input.lastLoudAt;
  const remainingMs =
    lastLoudAt === undefined ? 0 : Math.max(0, lastLoudAt + VOICE_ACTIVITY_HANGOVER_MS - input.now);
  return { lastLoudAt, remainingMs };
}

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

export interface VoiceViewState {
  /** The live conversation as the voice window last reported it. */
  view: VoiceView;
  /** Whether Luke is speaking — his reply under way — as of the last report. */
  speaking: boolean;
  voiceTurn: WaveformVoice | undefined;
  /** How loud whoever is talking is, in the unit interval, as last relayed. */
  level: number;
  /**
   * Whether whoever holds the turn is audibly speaking, read off the relayed
   * level with the same hangover the voice window's own meter keeps, so the
   * face and the meter answer the same edge the turn ends on.
   */
  voiceActive: boolean;
  microphoneStatus: MicrophoneStatus;
  voiceHotkey: VoiceHotkeyState | undefined;
  /**
   * Every line the thread holds, words whole — this launch's and, ahead of
   * them, what the last launch left within the retention policy — the same
   * on every display's panel. The model still receives only the recent
   * slice, each line cut at render to its own length bound.
   */
  conversationHistory: readonly ConversationEntry[];
  /** The bootstrap's snapshots, applied only where no push has spoken yet. */
  acceptBootstrap: (bootstrap: AppBootstrap) => void;
  /**
   * A typed ask to Luke, forwarded to the voice window and answered with
   * whether it reached a conversation: nothing when it did, a reason when it
   * did not, so the composer keeps a refused draft. The specific refusal
   * lands on the strip through the view.
   */
  askLuke: (text: string) => Promise<string | undefined>;
  /** Escape out of an open turn: forget the press and the latch, and stop listening. */
  discardListening: () => void;
  stopSpeaking: () => void;
  requestMicrophoneAccess: () => void;
  /** Clears the visible history, the next call's context, and the stored file. */
  clearConversationHistory: () => void;
}

/**
 * The panel's view of the conversation the hidden voice window holds. The
 * panel owns none of it: state arrives as one snapshot the main process
 * forwards from the voice window, so every display draws the same voice at
 * the same instant, and every press is forwarded to the main process, which
 * validates it and hands it on. A panel reload, close, or display change
 * therefore costs the exchange nothing.
 */
export function useVoiceView(): VoiceViewState {
  const [view, setView] = useState<VoiceView>(IDLE_VOICE_VIEW);
  // Each report is a fresh object even at a repeated loudness, so the hangover
  // below re-arms on every arrival rather than only on a changed number.
  const [levelReport, setLevelReport] = useState({ level: 0 });
  const level = levelReport.level;
  const [microphoneStatus, setMicrophoneStatus] = useState<MicrophoneStatus>("not-determined");
  const [voiceHotkey, setVoiceHotkey] = useState<VoiceHotkeyState>();
  const [conversationHistory, setConversationHistory] = useState<readonly ConversationEntry[]>([]);

  const acceptViewBootstrap = useBootstrapRacedChannel(
    (onChange) => window.sidecar.onVoiceViewChanged(onChange),
    setView,
  );
  const acceptMicrophoneBootstrap = useBootstrapRacedChannel(
    (onChange) => window.sidecar.onMicrophoneStatusChanged(onChange),
    setMicrophoneStatus,
  );
  // The thread as the main process holds it, whoever appended the last line:
  // the voice window's report or the main process's own act line, relayed
  // whole. A Clear relays as an empty thread, which is all a view needs.
  const acceptHistoryBootstrap = useBootstrapRacedChannel(
    (onChange) =>
      window.sidecar.onConversationHistoryChanged((payload) => onChange(payload.entries)),
    setConversationHistory,
  );
  const acceptBootstrap = useCallback(
    (bootstrap: AppBootstrap) => {
      acceptViewBootstrap(bootstrap.voiceView ?? IDLE_VOICE_VIEW);
      acceptMicrophoneBootstrap(bootstrap.microphoneStatus);
      acceptHistoryBootstrap(bootstrap.conversationHistory);
    },
    [acceptHistoryBootstrap, acceptMicrophoneBootstrap, acceptViewBootstrap],
  );

  useEffect(
    () => window.sidecar.onVoiceLevelChanged((reported) => setLevelReport({ level: reported })),
    [],
  );
  const [voiceActive, setVoiceActive] = useState(false);
  const lastLoudAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    const decided = voiceActiveFor({
      level: levelReport.level,
      now: performance.now(),
      lastLoudAt: lastLoudAt.current,
    });
    lastLoudAt.current = decided.lastLoudAt;
    if (decided.remainingMs === 0) {
      setVoiceActive(false);
      return;
    }
    setVoiceActive(true);
    const timer = window.setTimeout(() => setVoiceActive(false), decided.remainingMs);
    return () => window.clearTimeout(timer);
  }, [levelReport]);
  // A turn ending takes the voice with it, whatever the last level said.
  const turnLive = waveformVoice(view.voiceStatus) !== undefined;
  useEffect(() => {
    if (!turnLive) setVoiceActive(false);
  }, [turnLive]);
  // A broadcast with no accelerator is still a change — the key was deleted
  // or lost its chord — so it is kept as one rather than as no news at all,
  // or bootstrap's old chord would keep winning for the rest of the session.
  useEffect(() => window.sidecar.onVoiceHotkeyChanged(setVoiceHotkey), []);

  const askLuke = useCallback(
    async (text: string): Promise<string | undefined> =>
      askDraftReason(
        await window.sidecar
          .voiceCommand(VOICE_COMMAND.ASK_TEXT, text)
          .catch((): VoiceCommandOutcome => VOICE_COMMAND_OUTCOME.REFUSED),
      ),
    [],
  );
  const discardListening = useCallback(() => {
    void window.sidecar.voiceCommand(VOICE_COMMAND.DISCARD_LISTENING, undefined);
  }, []);
  const stopSpeaking = useCallback(() => {
    void window.sidecar.voiceCommand(VOICE_COMMAND.STOP_SPEAKING, undefined);
  }, []);
  const requestMicrophoneAccess = useCallback(() => {
    void window.sidecar.voiceCommand(VOICE_COMMAND.REQUEST_MICROPHONE_ACCESS, undefined);
  }, []);
  // The one failure the panel reports itself: the stored thread refusing to
  // go is the main process's answer to this press, not anything the voice
  // window saw, so it borrows the strip here on the strip's own clock.
  const [localError, setLocalError] = useState<string>();
  useEffect(() => {
    if (localError === undefined) return;
    const timer = window.setTimeout(() => setLocalError(undefined), VOICE_ERROR_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [localError]);
  const clearConversationHistory = useCallback(() => {
    void window.sidecar
      .voiceCommand(VOICE_COMMAND.CLEAR_CONVERSATION, undefined)
      .catch((): VoiceCommandOutcome => VOICE_COMMAND_OUTCOME.REFUSED)
      .then((outcome) => {
        if (outcome === VOICE_COMMAND_OUTCOME.REFUSED) setLocalError(CLEAR_FAILED_REASON);
      });
  }, []);

  return {
    view: localError === undefined ? view : { ...view, voiceError: localError },
    speaking: view.voiceStatus === REALTIME_STATUS.RESPONDING,
    voiceTurn: waveformVoice(view.voiceStatus),
    level,
    voiceActive: turnLive && voiceActive,
    microphoneStatus,
    voiceHotkey,
    conversationHistory,
    acceptBootstrap,
    askLuke,
    discardListening,
    stopSpeaking,
    requestMicrophoneAccess,
    clearConversationHistory,
  };
}
