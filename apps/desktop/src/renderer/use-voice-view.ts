import {
  BRAIN_ASK_REFUSAL,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_SUBMISSION_OUTCOME,
} from "@sidecar/brain/requests";
import type { BrainAskSubmissionResult, BrainRequestSnapshot } from "@sidecar/brain/requests-wire";
import { REALTIME_STATUS, type RealtimeStatus } from "@sidecar/realtime";
import { VOICE_ERROR_NOTICE_MS } from "@sidecar/voice/orchestrator";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import {
  IDLE_VOICE_VIEW,
  VOICE_COMMAND,
  VOICE_COMMAND_OUTCOME,
  type VoiceCommandOutcome,
  type VoiceView,
} from "#shared/messages/voice-view";
import { act, tell } from "./act";
import { useAppState } from "./use-app-state";
import { VOICE_ACTIVITY_HANGOVER_MS, VOICE_ACTIVITY_THRESHOLD } from "./voice/voice-level-meter";
import { WAVEFORM_VOICE, type WaveformVoice } from "./waveform";

/**
 * What the composer hears back from a typed ask: nothing when the brain
 * accepted it into a run, so the draft clears, and a reason when it did not,
 * so the developer's words stay theirs to retry. An ask nobody answered — the
 * bridge throwing, the main process gone — is refused too: words lost on a
 * silence would be the one outcome nobody chose.
 */
export const ASK_UNSENT_REASON = "Luke could not take that ask. Try again.";

/** No run standing, which is what a document with no brain answer yet reads as. */
const EMPTY_BRAIN_REQUESTS: readonly BrainRequestSnapshot[] = [];

export function askDraftReason(result: BrainAskSubmissionResult | undefined): string | undefined {
  if (result === undefined) return ASK_UNSENT_REASON;
  return result.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED
    ? undefined
    : BRAIN_ASK_REFUSAL[result.reason];
}

/** What the strip says when the stored thread could not be deleted. */
export const CLEAR_FAILED_REASON =
  "Conversation was cleared from view, but its file could not be fully erased. Try again.";

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
  /**
   * A typed ask to Luke, submitted to the brain in the main process and
   * answered with whether it was accepted into a run: nothing when it was, a
   * reason when it was not, so the composer keeps a refused draft. The reply
   * arrives later, in the thread and in the voice.
   */
  askLuke: (text: string) => Promise<string | undefined>;
  /** Every run the brain holds, for Conversation to draw a pending ask beside its words. */
  brainRequests: readonly BrainRequestSnapshot[];
  /** Cancels one run the developer no longer wants. */
  cancelBrainAsk: (runId: string) => void;
  /** Escape out of an open turn: forget the press and the latch, and stop listening. */
  discardListening: () => void;
  stopSpeaking: () => void;
  requestMicrophoneAccess: () => void;
  /** Clears the visible history, the next call's context, and the stored file. */
  clearConversationLines: () => void;
}

/**
 * The panel's view of the conversation the hidden voice window holds. The
 * panel owns none of it: the voice window reports one snapshot to the main
 * process, which carries it in the app-state document every panel reads, so
 * every display draws the same voice at the same instant. Every press is
 * forwarded to the main process, which validates it and hands it on. A panel
 * reload, close, or display change therefore costs the exchange nothing.
 */
export function useVoiceView(): VoiceViewState {
  const state = useAppState();
  // A voice window that went away leaves no view behind, and an idle voice is
  // what every panel draws in its place.
  const view = state?.voice.view ?? IDLE_VOICE_VIEW;
  // Each report is a fresh object even at a repeated loudness, so the hangover
  // below re-arms on every arrival rather than only on a changed number.
  const [levelReport, setLevelReport] = useState({ level: 0 });
  const level = levelReport.level;

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
  // A turn ending takes the voice with it, whatever the last level said. A
  // press whose call is still opening is a live turn: its device is already
  // heard, and the bars follow it as they will once the channel is up.
  const turnLive = waveformVoice(view.voiceStatus) !== undefined || view.talkOpening;
  useEffect(() => {
    if (!turnLive) setVoiceActive(false);
  }, [turnLive]);

  // One submission id per press of Send: the id is what makes a retry of
  // this very ask the same run and a second deliberate ask a new one.
  const askLuke = useCallback(
    async (text: string): Promise<string | undefined> =>
      askDraftReason(
        await act(ACT_KIND.BRAIN_SUBMIT_ASK, {
          submission: {
            submissionId: crypto.randomUUID(),
            question: text,
            origin: BRAIN_REQUEST_ORIGIN.TYPED,
          },
        }).catch((): BrainAskSubmissionResult | undefined => undefined),
      ),
    [],
  );
  // Every version of the document carries the whole list the standing brain
  // holds: a run absent from it is one no current brain can find, so its row
  // must go.
  const brainRequests = state?.brain.runs ?? EMPTY_BRAIN_REQUESTS;
  const cancelBrainAsk = useCallback((runId: string) => {
    void act(ACT_KIND.BRAIN_CANCEL_ASK, { runId }).catch(() => undefined);
  }, []);
  const discardListening = useCallback(() => {
    tell(ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.DISCARD_LISTENING });
  }, []);
  const stopSpeaking = useCallback(() => {
    tell(ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.STOP_SPEAKING });
  }, []);
  const requestMicrophoneAccess = useCallback(() => {
    tell(ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.REQUEST_MICROPHONE_ACCESS });
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
  const clearConversationLines = useCallback(() => {
    act(ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.CLEAR_CONVERSATION })
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
    askLuke,
    brainRequests,
    cancelBrainAsk,
    discardListening,
    stopSpeaking,
    requestMicrophoneAccess,
    clearConversationLines,
  };
}
