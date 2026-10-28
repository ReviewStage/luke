import { IDLE_VOICE_VIEW, type VoiceCallTranscript, type VoiceView } from "@luke/voice/voice-view";
import * as Atom from "effect/reactivity/Atom";
import { APP_SLICE, useAppSlice } from "./use-app-state.js";

/**
 * The live conversation as the voice window last reported it, or an idle
 * voice where none stands, which tells its readers only as the view moves,
 * not as anything else beside it in the slice does.
 */
const voiceViewAtom: Atom.Atom<VoiceView> = Atom.map(
  APP_SLICE.VOICE,
  (voice) => voice?.view ?? IDLE_VOICE_VIEW,
);

/** The voice as the voice window last reported it, read alone. */
export function useStandingVoiceView(): VoiceView {
  return useAppSlice(voiceViewAtom);
}

/** What was said on the standing call so far, which its agent's tab's live transcript draws; none for no call. */
export function useCallTranscript(): VoiceCallTranscript | undefined {
  return useAppSlice(APP_SLICE.CALL_TRANSCRIPT);
}
