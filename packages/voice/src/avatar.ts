// avatar.ts -- Luke's avatar on a call: its standing in the document, and the voice feed it is lip-synced to.
import type { UnparsedWireValue } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Schema as EffectSchema, Result } from "effect";

/**
 * Where the avatar stands, as main holds it in the document: `OFF` until the
 * developer asks for video, `STARTING` while the service mints the session
 * and the panel waits on its first frame, `LIVE` once that frame has
 * drawn, and `ENDED` once it is down while the call goes on as voice, which
 * is when the tile offers to restart it.
 */
export const AVATAR_STATUS = {
  OFF: "off",
  STARTING: "starting",
  LIVE: "live",
  ENDED: "ended",
} as const;

export type AvatarStatus = (typeof AVATAR_STATUS)[keyof typeof AVATAR_STATUS];

/**
 * Why the avatar went down, as the tile says it: the developer turned video
 * off, Keyframe closed the session, the plan's concurrent sessions were all
 * taken, the service could not put one up, the session failed, or the call
 * itself ended.
 */
export const AVATAR_END_REASON = {
  USER: "user",
  SERVER_CLOSED: "server-closed",
  NO_CAPACITY: "no-capacity",
  UNAVAILABLE: "unavailable",
  ERROR: "error",
  CALL_ENDED: "call-ended",
} as const;

export type AvatarEndReason = (typeof AVATAR_END_REASON)[keyof typeof AVATAR_END_REASON];

/**
 * The avatar as the document carries it, with why it went down once it has.
 * Keyframe's session grant is never here, because the document reaches every
 * window and the grant may reach the panel window alone.
 */
export interface AvatarState {
  status: AvatarStatus;
  /** Present once the status is `ENDED`, and only then. */
  endReason?: AvatarEndReason;
}

/** No avatar asked for: every launch's, and every call's until video is turned on. */
export const AVATAR_OFF: AvatarState = { status: AVATAR_STATUS.OFF };

/**
 * The avatar as the panel reports it: starting, live, or ended with a
 * reason beside `ENDED` and nowhere else, so a report cannot say the avatar
 * is live for a reason or ended for none. It never reports `OFF`: whether
 * video was asked for is main's to say, from the host.
 */
export const avatarStateSchema = EffectSchema.Union([
  EffectSchema.Struct({
    status: EffectSchema.Literals([AVATAR_STATUS.STARTING, AVATAR_STATUS.LIVE]),
  }),
  EffectSchema.Struct({
    status: EffectSchema.Literal(AVATAR_STATUS.ENDED),
    endReason: EffectSchema.Literals(Object.values(AVATAR_END_REASON)),
  }),
]);

/**
 * The ends the tile stays up through to offer "Restart video": a session the
 * service or Keyframe could not put up or keep up. The developer's own off
 * and the call's end take the tile down.
 */
const AVATAR_RESTART_REASONS: ReadonlySet<AvatarEndReason> = new Set([
  AVATAR_END_REASON.SERVER_CLOSED,
  AVATAR_END_REASON.ERROR,
  AVATAR_END_REASON.NO_CAPACITY,
  AVATAR_END_REASON.UNAVAILABLE,
]);

/** Whether the avatar is up on the call: starting or live, which is while every view of the call draws its picture. */
export function avatarStanding(avatar: AvatarState): boolean {
  return avatar.status === AVATAR_STATUS.STARTING || avatar.status === AVATAR_STATUS.LIVE;
}

/**
 * Whether the avatar's tile is up at the top of the call's Call tab: while
 * the avatar is starting or live, and once it ended for a reason the tile offers
 * to restart it from. Read beside whether the call stands, which the tile
 * never outlives.
 */
export function avatarTiled(avatar: AvatarState): boolean {
  switch (avatar.status) {
    case AVATAR_STATUS.STARTING:
    case AVATAR_STATUS.LIVE:
      return true;
    case AVATAR_STATUS.ENDED:
      return avatar.endReason !== undefined && AVATAR_RESTART_REASONS.has(avatar.endReason);
    case AVATAR_STATUS.OFF:
      return false;
  }
}

/** What one feed message says: a chunk of Luke's voice, the end of his turn, or the developer cutting in. */
export const AVATAR_FEED_KIND = {
  AUDIO: "audio",
  TURN_END: "turn_end",
  INTERRUPT: "interrupt",
} as const;

/**
 * The longest audio chunk a feed message carries: 40 ms of PCM16LE at 24 kHz
 * mono, one Keyframe video frame, is 960 samples of two bytes, and its
 * base64 is four characters for every three of those bytes.
 */
export const AVATAR_FEED_BOUNDS = {
  SAMPLE_RATE: 24_000,
  CHUNK_MS: 40,
  PCM_BYTES: 1_920,
  PCM_BASE64_CHARS: 2_560,
} as const;

/** Padded base64 in the standard alphabet, whole quads only. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

/**
 * Whether base64 decodes to whole PCM16 samples: an odd byte count is half a
 * sample, which Keyframe would read as the next sample's low byte.
 */
function isWholeSamples(base64: string): boolean {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return ((base64.length / 4) * 3 - padding) % 2 === 0;
}

/** One chunk of PCM16LE 24 kHz mono, base64, never empty and never longer than 40 ms. */
const pcmChunk = EffectSchema.String.check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(AVATAR_FEED_BOUNDS.PCM_BASE64_CHARS),
  EffectSchema.isPattern(BASE64),
  EffectSchema.makeFilter(isWholeSamples),
);

/**
 * One message of the feed the voice window sends main for the panel:
 * Luke's voice off the WebRTC track, cut into 40 ms chunks; the end of his
 * turn, which Keyframe's bridge maps to `endAudioTurn`; or the developer
 * cutting in, which it maps to `endAudioTurn` then `interrupt`.
 */
const avatarFeedSchema = EffectSchema.Union([
  EffectSchema.Struct({ kind: EffectSchema.Literal(AVATAR_FEED_KIND.AUDIO), pcm: pcmChunk }),
  EffectSchema.Struct({ kind: EffectSchema.Literal(AVATAR_FEED_KIND.TURN_END) }),
  EffectSchema.Struct({ kind: EffectSchema.Literal(AVATAR_FEED_KIND.INTERRUPT) }),
]);

export type AvatarFeed = typeof avatarFeedSchema.Type;

/** A feed message as it crossed from another window, or nothing where it is malformed or too long. */
export function avatarFeedFromWire(value: UnparsedWireValue): AvatarFeed | undefined {
  return Result.getOrUndefined(readEither(avatarFeedSchema)(value));
}
