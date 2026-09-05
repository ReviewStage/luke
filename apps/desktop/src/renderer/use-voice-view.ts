import { type ConversationEntry, REALTIME_STATUS, type RealtimeStatus } from "@sidecar/realtime";
import { useCallback, useEffect, useState } from "react";
import type { MicrophoneStatus, VoiceHotkeyState } from "#shared/wire/audio";
import type { AppBootstrap } from "#shared/wire/session";
import { VOICE_COMMAND, type VoiceView } from "#shared/wire/voice-view";
import { useBootstrapRacedChannel } from "./use-bootstrap-raced-channel";
import { VOICE_ACTIVITY_HANGOVER_MS, VOICE_ACTIVITY_THRESHOLD } from "./voice/voice-level-meter";
import { WAVEFORM_VOICE, type WaveformVoice } from "./waveform";

/** What a panel draws before the voice window has reported anything. */
export const IDLE_VOICE_VIEW: VoiceView = {
  voiceStatus: REALTIME_STATUS.IDLE,
  voiceError: undefined,
  voiceNotice: undefined,
  talkOpening: false,
  lukeCaptions: undefined,
  liveConversationEntries: [],
};

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
   * A typed ask to Luke, forwarded to the voice window. It answers once the
   * ask is on its way; the reply, or the refusal, lands back on the strip
   * through the view rather than through this promise.
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
  useEffect(() => {
    if (levelReport.level <= VOICE_ACTIVITY_THRESHOLD) return;
    setVoiceActive(true);
    const timer = window.setTimeout(() => setVoiceActive(false), VOICE_ACTIVITY_HANGOVER_MS);
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

  const askLuke = useCallback(async (text: string): Promise<string | undefined> => {
    await window.sidecar.voiceCommand(VOICE_COMMAND.ASK_TEXT, text);
    return undefined;
  }, []);
  const discardListening = useCallback(() => {
    void window.sidecar.voiceCommand(VOICE_COMMAND.DISCARD_LISTENING, undefined);
  }, []);
  const stopSpeaking = useCallback(() => {
    void window.sidecar.voiceCommand(VOICE_COMMAND.STOP_SPEAKING, undefined);
  }, []);
  const requestMicrophoneAccess = useCallback(() => {
    void window.sidecar.voiceCommand(VOICE_COMMAND.REQUEST_MICROPHONE_ACCESS, undefined);
  }, []);
  const clearConversationHistory = useCallback(() => {
    void window.sidecar.voiceCommand(VOICE_COMMAND.CLEAR_CONVERSATION, undefined);
  }, []);

  return {
    view,
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
