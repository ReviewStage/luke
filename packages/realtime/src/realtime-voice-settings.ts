/**
 * Every voice the Realtime API can speak with, and every pace Luke can speak
 * at. The sets are the API's, not Luke's: a value outside them is refused at
 * mint time, so offering one would be a control that cannot work.
 */

import { isWireNumber, isWireString, type UnparsedWireValue } from "@sidecar/wire";

export const REALTIME_VOICE = {
  ALLOY: "alloy",
  ASH: "ash",
  BALLAD: "ballad",
  CEDAR: "cedar",
  CORAL: "coral",
  ECHO: "echo",
  MARIN: "marin",
  SAGE: "sage",
  SHIMMER: "shimmer",
  VERSE: "verse",
} as const;

export type RealtimeVoice = (typeof REALTIME_VOICE)[keyof typeof REALTIME_VOICE];

/** Settings offers the voices in this order. */
export const REALTIME_VOICE_LIST: readonly RealtimeVoice[] = Object.values(REALTIME_VOICE);

/** Guards a voice arriving from storage or IPC. */
export function isRealtimeVoice(value: UnparsedWireValue): value is RealtimeVoice {
  if (!isWireString(value)) return false;
  // SAFETY: value is a string; list membership is the voice vocabulary contract check.
  return REALTIME_VOICE_LIST.includes(value as RealtimeVoice);
}

/**
 * Every pace Luke can speak at, as a multiple of the voice's natural rate.
 * The API accepts anything from 0.25 to 1.5; the offered steps are the ones
 * that stay intelligible, spaced widely enough to be told apart by ear.
 */
export const REALTIME_VOICE_SPEED = {
  SLOW: 0.75,
  NORMAL: 1,
  QUICK: 1.25,
  FAST: 1.5,
} as const;

export type RealtimeVoiceSpeed = (typeof REALTIME_VOICE_SPEED)[keyof typeof REALTIME_VOICE_SPEED];

/** Settings offers the speeds in this order, slowest to fastest. */
export const REALTIME_VOICE_SPEED_LIST: readonly RealtimeVoiceSpeed[] =
  Object.values(REALTIME_VOICE_SPEED);

/** Guards a speed arriving from storage or IPC. */
export function isRealtimeVoiceSpeed(value: UnparsedWireValue): value is RealtimeVoiceSpeed {
  if (!isWireNumber(value)) return false;
  // SAFETY: value is a number; list membership is the speed vocabulary contract check.
  return REALTIME_VOICE_SPEED_LIST.includes(value as RealtimeVoiceSpeed);
}

export const REALTIME_DEFAULTS = {
  MODEL: "gpt-realtime-2.1",
  VOICE: REALTIME_VOICE.CEDAR,
  SPEED: REALTIME_VOICE_SPEED.NORMAL,
} as const;
