/**
 * voice-choice.ts -- how the Voice setting offers the Live voices: in what order, under which heading, with which tag, and heard from which clip.
 *
 * The voices stand in groups, so thirty-odd names read as a few families
 * rather than one alphabet: each language in `LIVE_VOICE_LANGUAGE`'s order,
 * English first, and within a language the voices of no named region first
 * (OpenAI's original ten, the default among them), then each region in
 * `LIVE_VOICE_REGION`'s order. A heading names a region the way it is said,
 * "Australian English", and each voice wears how it presents as a tag at the
 * end of its row. Both are OpenAI's own published description of the voice
 * (`@luke/live`'s `LIVE_VOICE_PROFILE`), and a voice it gives no presentation
 * wears no tag rather than one guessed.
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

/** Where a voice's group stands among the groups: by language, then those of no region, then by region. */
function groupRank(profile: LiveVoiceProfile): readonly [number, number] {
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

/** The heading a voice stands under: its language, led by its region where OpenAI names one, as "Australian English". */
export function voiceGroup(voice: LiveVoice): string {
  const { language, region } = LIVE_VOICE_PROFILE[voice];
  const languageName = LANGUAGE_NAME[language];
  return region === undefined ? languageName : `${REGION_NAME[region]} ${languageName}`;
}

/** The tag at the end of a voice's row: how it presents, where OpenAI says. */
export function voiceTag(voice: LiveVoice): string | undefined {
  const { presentation } = LIVE_VOICE_PROFILE[voice];
  return presentation === undefined ? undefined : PRESENTATION_NAME[presentation];
}

/* Each voice's clip under the panel's asset base, recorded from the voice
   itself by `tools/voice-samples`, which names the file this way. */
export function voiceSamplePath(voice: LiveVoice): string {
  return `voices/${voice}.m4a`;
}
