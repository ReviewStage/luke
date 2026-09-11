import type { BrainRequestSnapshot } from "@sidecar/brain/requests-wire";
import { NoticeStrip } from "@sidecar/voice/orchestrator";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import {
  IDLE_VOICE_VIEW,
  SILENT_VOICE_LEVELS,
  VOICE_COMMAND,
  VOICE_COMMAND_OUTCOME,
  type VoiceCommandOutcome,
  type VoiceLevels,
  type VoiceSpeakers,
  type VoiceView,
} from "#shared/messages/voice-view";
import { useAct } from "./act";
import { useAppState } from "./use-app-state";
import { VOICE_ACTIVITY_HANGOVER_MS, VOICE_ACTIVITY_THRESHOLD } from "./voice/voice-level-meter";
import { WAVEFORM_VOICE, type WaveformVoice } from "./waveform";

/** No run standing, which is what a document with no brain answer yet reads as. */
const EMPTY_BRAIN_REQUESTS: readonly BrainRequestSnapshot[] = [];

/** What the strip says when the stored thread could not be deleted. */
/** What the strip says of a Clear the service did not take: the thread stands exactly as it was. */
export const CLEAR_FAILED_REASON =
  "Luke's service could not clear the conversation, so it still stands. Try again in a moment.";

/**
 * The two lines the panel puts on the strip itself: a fault and a notice the
 * main process answered to this panel's own press, which the voice window
 * never saw and so never reports.
 */
export interface PanelStripLines {
  error: string | undefined;
  notice: string | undefined;
}

const NO_PANEL_STRIP_LINES: PanelStripLines = { error: undefined, notice: undefined };

/**
 * The view the panel draws: the voice window's report, with the panel's own
 * strip lines standing over the report's for as long as they last. Each line
 * displaces only its own slot, so a refusal never hides a fault, and a report
 * the panel adds nothing to is handed on as the same object.
 */
export function panelVoiceView(reported: VoiceView, strip: PanelStripLines): VoiceView {
  if (strip.error === undefined && strip.notice === undefined) return reported;
  return {
    ...reported,
    voiceError: strip.error ?? reported.voiceError,
    voiceNotice: strip.notice ?? reported.voiceNotice,
  };
}

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
 * Whose voice the one meter is drawing. The waveform follows whoever is
 * actually talking: Luke while he speaks, the developer while the microphone
 * is heard and Luke is not, nobody otherwise. Both speakers can stand at once
 * and only one meter is drawn, so Luke's answer wins the place.
 */
export function waveformVoice(speakers: VoiceSpeakers): WaveformVoice | undefined {
  if (speakers.lukeSpeaking) return WAVEFORM_VOICE.LUKE;
  if (speakers.listening) return WAVEFORM_VOICE.DEVELOPER;
  return undefined;
}

/** The loudness under that meter: the drawn voice's own, and nothing where no voice holds it. */
export function drawnLevel(voice: WaveformVoice | undefined, levels: VoiceLevels): number {
  if (voice === WAVEFORM_VOICE.LUKE) return levels.luke;
  if (voice === WAVEFORM_VOICE.DEVELOPER) return levels.developer;
  return 0;
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
 * strip, and a refusal answered during it is exactly what the strip should
 * answer with.
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
  /** Whether the developer's microphone is being heard, which can stand with {@link speaking}. */
  listening: boolean;
  voiceTurn: WaveformVoice | undefined;
  /** How loud each speaker is, in the unit interval, as last relayed. */
  levels: VoiceLevels;
  /** How loud the voice the one meter draws is, which is {@link voiceTurn}'s own reading. */
  level: number;
  /**
   * Whether whoever holds the turn is audibly speaking, read off the relayed
   * level with the same hangover the voice window's own meter keeps, so the
   * face and the meter answer the same edge the turn ends on.
   */
  voiceActive: boolean;
  /** Every run the brain holds, for Conversation to draw a pending ask beside its words. */
  brainRequests: readonly BrainRequestSnapshot[];
  /** Escape out of an open turn: forget the press and the latch, and stop listening. */
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
  const { act, tell } = useAct();
  const state = useAppState();
  // A voice window that went away leaves no view behind, and an idle voice is
  // what every panel draws in its place.
  const view = state?.voice.view ?? IDLE_VOICE_VIEW;
  // Each report is a fresh object even at a repeated loudness, so the hangover
  // below re-arms on every arrival rather than only on a changed number.
  const [levelReport, setLevelReport] = useState({ levels: SILENT_VOICE_LEVELS });
  const levels = levelReport.levels;
  const voiceTurn = waveformVoice(view);
  const level = drawnLevel(voiceTurn, levels);

  useEffect(
    () => window.sidecar.onVoiceLevelChanged((reported) => setLevelReport({ levels: reported })),
    [],
  );
  const [voiceActive, setVoiceActive] = useState(false);
  const lastLoudAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    const decided = voiceActiveFor({
      level,
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
  }, [levelReport, level]);
  // A turn ending takes the voice with it, whatever the last level said. A
  // press whose call is still opening is a live turn: its device is already
  // heard, and the bars follow it as they will once the channel is up.
  const turnLive = voiceTurn !== undefined || view.talkOpening;
  useEffect(() => {
    if (!turnLive) setVoiceActive(false);
  }, [turnLive]);

  // The panel's own strip lines, on the same clock the voice window's strip
  // keeps, because they share the box the developer reads them in. The strip
  // reports each change into React state, so the view below re-composes on a
  // line arriving or expiring.
  const [stripLines, setStripLines] = useState(NO_PANEL_STRIP_LINES);
  const [strip] = useState(() => {
    const created: NoticeStrip = new NoticeStrip({
      onChanged: () => setStripLines({ error: created.error, notice: created.notice }),
    });
    return created;
  });
  useEffect(() => () => strip.stop(), [strip]);
  // Every version of the document carries the whole list the standing brain
  // holds: a run absent from it is one no current brain can find, so its row
  // must go.
  const brainRequests = state?.brain.runs ?? EMPTY_BRAIN_REQUESTS;
  const stopSpeaking = useCallback(() => {
    tell(ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.STOP_SPEAKING });
  }, []);
  const requestMicrophoneAccess = useCallback(() => {
    tell(ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.REQUEST_MICROPHONE_ACCESS });
  }, []);
  // The stored thread refusing to go is the main process's answer to this
  // press, not anything the voice window saw, so it is the panel's own fault
  // to report.
  const clearConversationLines = useCallback(() => {
    act(ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.CLEAR_CONVERSATION })
      .catch((): VoiceCommandOutcome => VOICE_COMMAND_OUTCOME.REFUSED)
      .then((outcome) => {
        if (outcome === VOICE_COMMAND_OUTCOME.REFUSED) strip.showError(CLEAR_FAILED_REASON);
      });
  }, [strip]);

  return {
    view: panelVoiceView(view, stripLines),
    speaking: view.lukeSpeaking,
    listening: view.listening,
    voiceTurn,
    levels,
    level,
    voiceActive: turnLive && voiceActive,
    brainRequests,
    stopSpeaking,
    requestMicrophoneAccess,
    clearConversationLines,
  };
}
