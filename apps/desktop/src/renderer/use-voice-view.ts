import type { BrainRequestSnapshot } from "@sidecar/brain/requests-wire";
import { NoticeStrip } from "@sidecar/voice/orchestrator";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { RUN_PROFILE, type RunProfile } from "#shared/messages/app-state";
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
 * The conversation a capture run stages, since no voice window stands in one:
 * which speakers are heard, and whether the Mac's output is off. Decided by
 * the launch profile alone, so every frame of an evidence run is the same
 * frame.
 */
export interface FixtureVoice {
  speakers: VoiceSpeakers;
  muted: boolean;
}

const FIXTURE_VOICES: ReadonlyMap<RunProfile, FixtureVoice> = new Map([
  [RUN_PROFILE.SPEAKING, { speakers: { listening: false, lukeSpeaking: true }, muted: false }],
  [RUN_PROFILE.MUTED, { speakers: { listening: false, lukeSpeaking: true }, muted: true }],
  [RUN_PROFILE.DUPLEX, { speakers: { listening: true, lukeSpeaking: true }, muted: false }],
]);

const RUN_PROFILES: ReadonlySet<string> = new Set(Object.values(RUN_PROFILE));

function isRunProfile(profile: string): profile is RunProfile {
  return RUN_PROFILES.has(profile);
}

/** What the profile stages, or nothing for the idle run and any word this build does not know. */
export function fixtureVoice(profile: string): FixtureVoice | undefined {
  return isRunProfile(profile) ? FIXTURE_VOICES.get(profile) : undefined;
}

/**
 * The failure drawn in the same strip the captions use. A fault is worth
 * reading where the words it interrupted would have landed — at the shape's
 * foot, under the field that asked — not on a settings page nobody is
 * looking at. It yields to either speaker being heard, because words being
 * said are the thing to read over words that already failed, and a capture
 * run never draws one: a fixture has no call to fail.
 */
export function voiceErrorToShow(input: {
  fixtureSpeaking: boolean;
  speakers: VoiceSpeakers;
  error: string | undefined;
}): string | undefined {
  if (input.fixtureSpeaking || input.speakers.listening || input.speakers.lukeSpeaking) {
    return undefined;
  }
  return input.error;
}

/**
 * The notice drawn in the same strip, yielding only to Luke's own voice — his
 * words own the box whether or not the captions draw them. The developer
 * being heard is no reason to hide it: an open microphone draws nothing on
 * the strip, and a refusal answered during it is exactly what the strip
 * should answer with.
 */
export function voiceNoticeToShow(input: {
  fixtureSpeaking: boolean;
  speakers: VoiceSpeakers;
  notice: string | undefined;
}): string | undefined {
  if (input.fixtureSpeaking || input.speakers.lukeSpeaking) return undefined;
  return input.notice;
}

/**
 * Whether each speaker is audibly talking, read off their relayed level with
 * the same hangover the voice window's own meters keep, so each meter's bars
 * settle on the edge the voice window measured rather than on a frame of
 * their own.
 */
export type VoiceActivity = { readonly [voice in WaveformVoice]: boolean };

export const NO_VOICE_ACTIVITY: VoiceActivity = { developer: false, luke: false };

/**
 * A fresh object per report even at a repeated loudness, so a hangover
 * re-arms on every arrival rather than only on a changed number.
 */
interface LevelReport {
  levels: VoiceLevels;
}

/**
 * One speaker's edge over the relayed levels. Live is the speaker's own
 * standing — a voice whose meter is not drawn is not active, whatever the
 * last level said — and a press whose call is still opening counts as live
 * for the developer, whose device is already heard.
 */
function useVoiceActive(report: LevelReport, voice: WaveformVoice, live: boolean): boolean {
  const level = report.levels[voice];
  const [active, setActive] = useState(false);
  const lastLoudAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    const decided = voiceActiveFor({
      level,
      now: performance.now(),
      lastLoudAt: lastLoudAt.current,
    });
    lastLoudAt.current = decided.lastLoudAt;
    if (decided.remainingMs === 0) {
      setActive(false);
      return;
    }
    setActive(true);
    const timer = window.setTimeout(() => setActive(false), decided.remainingMs);
    return () => window.clearTimeout(timer);
  }, [report, level]);
  useEffect(() => {
    if (!live) setActive(false);
  }, [live]);
  return live && active;
}

export interface VoiceViewState {
  /** The live conversation as the voice window last reported it. */
  view: VoiceView;
  /** Whether Luke is speaking — his reply under way — as of the last report. */
  speaking: boolean;
  /** Whether the developer's microphone is being heard, which can stand with {@link speaking}. */
  listening: boolean;
  /** How loud each speaker is, in the unit interval, as last relayed. */
  levels: VoiceLevels;
  /** Which speakers are audibly talking, on the relayed levels' own hangover. */
  voiceActive: VoiceActivity;
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
  const [levelReport, setLevelReport] = useState<LevelReport>({ levels: SILENT_VOICE_LEVELS });
  useEffect(
    () => window.sidecar.onVoiceLevelChanged((reported) => setLevelReport({ levels: reported })),
    [],
  );
  const voiceActive: VoiceActivity = {
    developer: useVoiceActive(
      levelReport,
      WAVEFORM_VOICE.DEVELOPER,
      view.listening || view.talkOpening,
    ),
    luke: useVoiceActive(levelReport, WAVEFORM_VOICE.LUKE, view.lukeSpeaking),
  };

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
    levels: levelReport.levels,
    voiceActive,
    brainRequests,
    stopSpeaking,
    requestMicrophoneAccess,
    clearConversationLines,
  };
}
