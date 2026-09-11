import type { UnparsedWireValue } from "@sidecar/wire";
import { Schema } from "effect";

/**
 * Every built-in voice the Live API speaks with, as the SDK's `BuiltInVoice`
 * lists them. The set is the API's, not Luke's: a voice outside it is refused
 * at session creation, so offering one would be a control that cannot work.
 * A voice is chosen at creation and cannot change after startup, so a changed
 * setting is heard on the next session rather than by any event.
 */
export const LIVE_VOICE = {
  ALLOY: "alloy",
  ASH: "ash",
  BALLAD: "ballad",
  BEACON: "beacon",
  BOSSA: "bossa",
  CEDAR: "cedar",
  CINDER: "cinder",
  CORAL: "coral",
  DELTA: "delta",
  ECHO: "echo",
  GLEAM: "gleam",
  MARIN: "marin",
  MERIDIAN: "meridian",
  QUARTZ: "quartz",
  RIPPLE: "ripple",
  SAGE: "sage",
  SHIMMER: "shimmer",
  STONE: "stone",
  TEMPO: "tempo",
  VERSE: "verse",
  VESPER: "vesper",
  WILLOW: "willow",
} as const;

export type LiveVoice = (typeof LIVE_VOICE)[keyof typeof LIVE_VOICE];

export const LiveVoiceSchema = Schema.Literal(...Object.values(LIVE_VOICE));

/** Settings offers the voices in this order. */
export const LIVE_VOICE_LIST: readonly LiveVoice[] = Object.values(LIVE_VOICE);

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
