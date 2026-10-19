/**
 * voice-choice.ts -- how the Voice setting offers the Live voices: in what order, under which heading, in which words, and heard from which clip.
 *
 * The voices stand in groups, so thirty-odd names read as a few families
 * rather than one alphabet: OpenAI's original voices first, the default
 * among them, then each language in `LIVE_VOICE_LANGUAGE`'s order, and
 * within English each region in `LIVE_VOICE_REGION`'s. The headings and the
 * line under each name are OpenAI's own published description of the voice
 * (`@luke/live`'s `LIVE_VOICE_PROFILE`), and a voice it describes nowhere
 * says nothing rather than something guessed.
 */

import {
  LIVE_DEFAULTS,
  LIVE_VOICE_LANGUAGE,
  LIVE_VOICE_LIST,
  LIVE_VOICE_PROFILE,
  LIVE_VOICE_REGION,
  type LiveVoice,
  type LiveVoiceLanguage,
  type LiveVoicePresentation,
  type LiveVoiceProfile,
  type LiveVoiceRegion,
} from "@luke/live";

/** The heading over the voices OpenAI describes by no language or region. */
const ORIGINAL_VOICES = "Original";

/** A word for each value of a vocabulary, as a control reads it. */
type Names<Value extends string> = { readonly [Each in Value]: string };

const LANGUAGE_NAME = {
  english: "English",
  portuguese: "Portuguese",
  french: "French",
  german: "German",
  hindi: "Hindi",
  japanese: "Japanese",
  korean: "Korean",
} satisfies Names<LiveVoiceLanguage>;

const REGION_NAME = {
  "north-american": "North American",
  "southern-us": "Southern U.S.",
  british: "British",
  irish: "Irish",
  australian: "Australian",
  filipino: "Filipino",
  brazilian: "Brazilian",
} satisfies Names<LiveVoiceRegion>;

const PRESENTATION_NAME = {
  feminine: "Feminine",
  masculine: "Masculine",
} satisfies Names<LiveVoicePresentation>;

const LANGUAGE_ORDER: readonly LiveVoiceLanguage[] = Object.values(LIVE_VOICE_LANGUAGE);
const REGION_ORDER: readonly LiveVoiceRegion[] = Object.values(LIVE_VOICE_REGION);

/** Where a voice's group stands among the groups: the originals first, then by language, then by region. */
function groupRank(profile: LiveVoiceProfile | undefined): readonly [number, number] {
  if (profile === undefined) return [-1, -1];
  const region = profile.region === undefined ? -1 : REGION_ORDER.indexOf(profile.region);
  return [LANGUAGE_ORDER.indexOf(profile.language), region];
}

/** Every Live voice, its group's members together, in the order the groups stand and the vocabulary's order within each. */
export const OFFERED_VOICE_LIST: readonly LiveVoice[] = LIVE_VOICE_LIST.map((voice, index) => ({
  voice,
  index,
  rank: groupRank(LIVE_VOICE_PROFILE[voice]),
}))
  .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.index - b.index)
  .map(({ voice }) => voice);

/* The API names its voices in lowercase; on a control they read as names. The
   default carries its status into the menu, so returning to it never needs the
   README or a memory of what shipped. */
export function voiceOptionLabel(voice: LiveVoice): string {
  const name = voice.charAt(0).toUpperCase() + voice.slice(1);
  return voice === LIVE_DEFAULTS.VOICE ? `${name} (default)` : name;
}

/** The heading a voice stands under: its language, and its region where OpenAI names one. */
export function voiceGroup(voice: LiveVoice): string {
  const profile = LIVE_VOICE_PROFILE[voice];
  if (profile === undefined) return ORIGINAL_VOICES;
  const language = LANGUAGE_NAME[profile.language];
  return profile.region === undefined ? language : `${language} · ${REGION_NAME[profile.region]}`;
}

/** The line under a voice's name: how it presents, where OpenAI says. */
export function voiceDetail(voice: LiveVoice): string | undefined {
  const profile = LIVE_VOICE_PROFILE[voice];
  return profile === undefined ? undefined : PRESENTATION_NAME[profile.presentation];
}

/* Each voice's clip under the panel's asset base, recorded from the voice
   itself by `tools/voice-samples`, which names the file this way. */
export function voiceSamplePath(voice: LiveVoice): string {
  return `voices/${voice}.m4a`;
}
