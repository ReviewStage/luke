import { ACT_KIND } from "@luke/host/acts";
import { RUN_PROFILE, type RunProfile } from "@luke/host/app-state";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { AVATAR_OFF, type AvatarState } from "@luke/voice/avatar";
import {
  callInProgress,
  IDLE_VOICE_VIEW,
  VOICE_COMMAND,
  type VoiceCallTranscript,
  type VoiceSpeakers,
  type VoiceView,
} from "@luke/voice/voice-view";
import * as Atom from "effect/reactivity/Atom";
import { useCallback } from "react";
import { useAct } from "./act.js";
import { useCallCommands } from "./call-commands.js";
import { APP_SLICE, useAppSlice } from "./use-app-state.js";

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

/** What the profile stages, or nothing for the idle run and any word this build does not know. */
export function fixtureVoice(profile: string): FixtureVoice | undefined {
  return isRunProfile(profile) ? FIXTURE_VOICES.get(profile) : undefined;
}

/**
 * The live conversation as the voice window last reported it, or an idle
 * voice where none stands, which tells its readers only as the view moves,
 * not as Luke's avatar or anything else beside it in the slice does.
 */
const voiceViewAtom: Atom.Atom<VoiceView> = Atom.map(
  APP_SLICE.VOICE,
  (voice) => voice?.view ?? IDLE_VOICE_VIEW,
);

/**
 * What was said on the standing call so far, as the document holds it
 * beside the view, which tells its one reader as a line grows and the view's
 * readers not at all; none for no call.
 */
const callTranscriptAtom: Atom.Atom<VoiceCallTranscript | undefined> = Atom.map(
  APP_SLICE.VOICE,
  (voice) => voice?.callTranscript,
);

/** Luke's avatar on the call as main holds it, which tells its readers only as the avatar moves, not as the words do. */
const voiceAvatarAtom: Atom.Atom<AvatarState> = Atom.map(
  APP_SLICE.VOICE,
  (voice) => voice?.avatar ?? AVATAR_OFF,
);

/** Whether the microphone is granted, which redraws its reader only as it turns. */
const microphoneGrantedAtom: Atom.Atom<boolean> = Atom.map(
  APP_SLICE.AUDIO,
  (audio) => audio?.microphoneStatus === MICROPHONE_STATUS.GRANTED,
);

/**
 * The failure drawn on the voice's notice line. A fault is worth reading
 * where the call is steered from — just above the composer that holds the
 * call — not on a settings page nobody is looking at. It yields to either speaker being heard, because words being
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
 * The notice drawn on the same line, yielding only to Luke's own voice, which
 * is the thing to listen to while it lasts. The developer being heard is no
 * reason to hide it: a refusal answered while they speak is exactly what the
 * line should answer with.
 */
export function voiceNoticeToShow(input: {
  fixtureSpeaking: boolean;
  speakers: VoiceSpeakers;
  notice: string | undefined;
}): string | undefined {
  if (input.fixtureSpeaking || input.speakers.lukeSpeaking) return undefined;
  return input.notice;
}

interface VoiceViewState {
  /** The live conversation as the voice window last reported it. */
  view: VoiceView;
  /** Whether Luke is speaking — his reply under way — as of the last report. */
  speaking: boolean;
  /** Whether the developer's microphone is being heard, which can stand with {@link speaking}. */
  listening: boolean;
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
  // A voice window that went away leaves no view behind, and an idle voice is
  // what every panel draws in its place.
  const view = useAppSlice(voiceViewAtom);
  useCallCommands(view, useAppSlice(microphoneGrantedAtom), (command) =>
    tell(ACT_KIND.VOICE_COMMAND, { command }),
  );

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
    stopSpeaking,
    requestMicrophoneAccess,
  };
}

/** The voice as the voice window last reported it, read alone: a surface that draws the call and offers none of its chords. */
export function useStandingVoiceView(): VoiceView {
  return useAppSlice(voiceViewAtom);
}

/** The agent a call is in progress into, which redraws its reader only as it moves; none while no call stands. */
const callingAgentAtom: Atom.Atom<string | undefined> = Atom.map(voiceViewAtom, (view) =>
  callInProgress(view) ? view.call?.agentId : undefined,
);

/** The agent a call is in progress into, whose tab wears the live mark and draws the call; none while no call stands. */
export function useCallingAgent(): string | undefined {
  return useAppSlice(callingAgentAtom);
}

/** Luke's avatar on the standing call, or none, as main holds it for every window. */
export function useVoiceAvatar(): AvatarState {
  return useAppSlice(voiceAvatarAtom);
}

/** What was said on the standing call so far, which its agent's tab's live transcript draws; none for no call. */
export function useCallTranscript(): VoiceCallTranscript | undefined {
  return useAppSlice(callTranscriptAtom);
}
