import type { UnparsedWireValue } from "@luke/wire";
import { Schema } from "effect";

/**
 * Every built-in voice the Live API speaks with: the SDK's `BuiltInVoice`
 * (openai 7.39.0), and the voices OpenAI's GPT-Live guide lists beside it
 * that the SDK does not yet name, each of which the API accepted at session
 * creation when they were added. The set is the API's, not Luke's: a voice
 * outside it is refused at session creation, so offering one would be a
 * control that cannot work. A voice is chosen at creation and cannot change
 * after startup, so a changed setting is heard on the next session rather
 * than by any event.
 */
export const LIVE_VOICE = {
  ALLOY: "alloy",
  ASH: "ash",
  BALLAD: "ballad",
  BEACON: "beacon",
  BOSSA: "bossa",
  BRISE: "brise",
  CEDAR: "cedar",
  CINDER: "cinder",
  CORAL: "coral",
  DELTA: "delta",
  ECHO: "echo",
  FLITZ: "flitz",
  GLEAM: "gleam",
  HAREMA: "harema",
  JUNI: "juni",
  MARIN: "marin",
  MERIDIAN: "meridian",
  NIRA: "nira",
  NOEUL: "noeul",
  NURI: "nuri",
  QUARTZ: "quartz",
  RIPPLE: "ripple",
  SAGE: "sage",
  SHIDA: "shida",
  SHIMMER: "shimmer",
  SILLAGE: "sillage",
  STONE: "stone",
  TEMPO: "tempo",
  VERSE: "verse",
  VESPER: "vesper",
  WILLOW: "willow",
} as const;

export type LiveVoice = (typeof LIVE_VOICE)[keyof typeof LIVE_VOICE];

const LiveVoiceSchema = Schema.Literals(Object.values(LIVE_VOICE));

/** Settings offers the voices in this order. */
export const LIVE_VOICE_LIST: readonly LiveVoice[] = Object.values(LIVE_VOICE);

/** The language a voice is made to speak, as OpenAI's guide names it. */
export const LIVE_VOICE_LANGUAGE = {
  ENGLISH: "english",
  PORTUGUESE: "portuguese",
  FRENCH: "french",
  GERMAN: "german",
  HINDI: "hindi",
  JAPANESE: "japanese",
  KOREAN: "korean",
} as const;

export type LiveVoiceLanguage = (typeof LIVE_VOICE_LANGUAGE)[keyof typeof LIVE_VOICE_LANGUAGE];

/** The regional speaking style a voice carries, as OpenAI's guide names it. */
export const LIVE_VOICE_REGION = {
  NORTH_AMERICAN: "north-american",
  SOUTHERN_US: "southern-us",
  BRITISH: "british",
  IRISH: "irish",
  AUSTRALIAN: "australian",
  FILIPINO: "filipino",
  BRAZILIAN: "brazilian",
} as const;

export type LiveVoiceRegion = (typeof LIVE_VOICE_REGION)[keyof typeof LIVE_VOICE_REGION];

/** How a voice presents, as OpenAI's guide names it. */
export const LIVE_VOICE_PRESENTATION = {
  FEMININE: "feminine",
  MASCULINE: "masculine",
} as const;

export type LiveVoicePresentation =
  (typeof LIVE_VOICE_PRESENTATION)[keyof typeof LIVE_VOICE_PRESENTATION];

/** What OpenAI publishes about one voice: its language, and where it names them, its region and how it presents. */
export interface LiveVoiceProfile {
  language: LiveVoiceLanguage;
  region?: LiveVoiceRegion;
  presentation?: LiveVoicePresentation;
}

const { ENGLISH, PORTUGUESE, FRENCH, GERMAN, HINDI, JAPANESE, KOREAN } = LIVE_VOICE_LANGUAGE;
const { FEMININE, MASCULINE } = LIVE_VOICE_PRESENTATION;

/** What OpenAI publishes about every voice. */
export type LiveVoiceProfiles = { readonly [Voice in LiveVoice]: LiveVoiceProfile };

/**
 * Each voice as OpenAI describes it. The "Voice options" table of the GPT-Live
 * guide (developers.openai.com/api/docs/guides/live-conversations) covers the
 * voices GPT-Live added: language, regional influence, and presentation. The
 * earlier ten (alloy through verse, marin, and cedar) it leaves out, and
 * OpenAI says of them only that they "are currently optimized for English"
 * (the text-to-speech guide), so they stand as English with no region and no
 * presentation, rather than with one guessed at by ear.
 */
export const LIVE_VOICE_PROFILE: LiveVoiceProfiles = {
  alloy: { language: ENGLISH },
  ash: { language: ENGLISH },
  ballad: { language: ENGLISH },
  cedar: { language: ENGLISH },
  coral: { language: ENGLISH },
  echo: { language: ENGLISH },
  marin: { language: ENGLISH },
  sage: { language: ENGLISH },
  shimmer: { language: ENGLISH },
  verse: { language: ENGLISH },
  quartz: { language: ENGLISH, region: LIVE_VOICE_REGION.AUSTRALIAN, presentation: FEMININE },
  ripple: { language: ENGLISH, region: LIVE_VOICE_REGION.AUSTRALIAN, presentation: MASCULINE },
  vesper: { language: ENGLISH, region: LIVE_VOICE_REGION.BRITISH, presentation: MASCULINE },
  willow: { language: ENGLISH, region: LIVE_VOICE_REGION.IRISH, presentation: FEMININE },
  stone: { language: ENGLISH, region: LIVE_VOICE_REGION.IRISH, presentation: MASCULINE },
  gleam: { language: ENGLISH, region: LIVE_VOICE_REGION.NORTH_AMERICAN, presentation: FEMININE },
  meridian: {
    language: ENGLISH,
    region: LIVE_VOICE_REGION.NORTH_AMERICAN,
    presentation: MASCULINE,
  },
  bossa: { language: PORTUGUESE, region: LIVE_VOICE_REGION.BRAZILIAN, presentation: FEMININE },
  tempo: { language: PORTUGUESE, region: LIVE_VOICE_REGION.BRAZILIAN, presentation: MASCULINE },
  beacon: { language: ENGLISH, region: LIVE_VOICE_REGION.FILIPINO, presentation: MASCULINE },
  delta: { language: ENGLISH, region: LIVE_VOICE_REGION.SOUTHERN_US, presentation: FEMININE },
  cinder: { language: ENGLISH, region: LIVE_VOICE_REGION.SOUTHERN_US, presentation: MASCULINE },
  nuri: { language: GERMAN, presentation: FEMININE },
  juni: { language: GERMAN, presentation: FEMININE },
  flitz: { language: GERMAN, presentation: MASCULINE },
  brise: { language: FRENCH, presentation: FEMININE },
  sillage: { language: FRENCH, presentation: MASCULINE },
  nira: { language: HINDI, presentation: FEMININE },
  harema: { language: JAPANESE, presentation: FEMININE },
  shida: { language: JAPANESE, presentation: MASCULINE },
  noeul: { language: KOREAN, presentation: FEMININE },
};

const readsLiveVoice = Schema.is(LiveVoiceSchema);

/** Guards a voice arriving from storage or IPC. */
export function isLiveVoice(value: UnparsedWireValue): value is LiveVoice {
  return readsLiveVoice(value);
}

/**
 * The model and the voice a session is created with when nothing chose
 * otherwise. `marin` is the API's own default for this model, so a session
 * that names no voice and one that names this one sound the same.
 */
export const LIVE_DEFAULTS = {
  MODEL: "gpt-live-1",
  VOICE: LIVE_VOICE.MARIN,
} as const;
