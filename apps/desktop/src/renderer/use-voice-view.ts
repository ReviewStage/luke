import { useCallback, useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { RUN_PROFILE, type RunProfile } from "#shared/messages/app-state";
import {
  IDLE_VOICE_VIEW,
  SILENT_VOICE_LEVELS,
  VOICE_COMMAND,
  type VoiceLevels,
  type VoiceSpeakers,
  type VoiceView,
} from "#shared/messages/voice-view";
import { useAct } from "./act";
import { useAppState } from "./use-app-state";
import { VOICE_ACTIVITY_HANGOVER_MS, VOICE_ACTIVITY_THRESHOLD } from "./voice/voice-level-meter";
import { WAVEFORM_VOICE, type WaveformVoice } from "./waveform";

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
interface FixtureVoice {
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

/**
 * What the speaking evidence run captions the reply with. A capture run never
 * opens a call, so there are no words to draw unless the fixture supplies
 * them — and it must, or the caption strip ships unphotographed. Synthetic,
 * like every fixture, and shaped like a reply of several messages: the first
 * long enough to wrap, and two more behind it, so the wrapped form of the
 * strip and the stack of segments it draws are both in the frame.
 */
export const FIXTURE_SPEAKING_CAPTIONS: readonly string[] = [
  "The plan now says the parser keeps its own cache, the migration runs once at launch, and the old reader stays until every install has moved over.",
  "Two questions are still open in the plan.",
  "Say the word and we can settle the first one now.",
];

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

interface VoiceViewState {
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
  /** Escape out of an open turn: forget the press and the latch, and stop listening. */
  stopSpeaking: () => void;
  requestMicrophoneAccess: () => void;
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
  const { tell } = useAct();
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

  const stopSpeaking = useCallback(() => {
    tell(ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.STOP_SPEAKING });
  }, []);
  const requestMicrophoneAccess = useCallback(() => {
    tell(ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.REQUEST_MICROPHONE_ACCESS });
  }, []);
  return {
    view,
    speaking: view.lukeSpeaking,
    listening: view.listening,
    levels: levelReport.levels,
    voiceActive,
    stopSpeaking,
    requestMicrophoneAccess,
  };
}
