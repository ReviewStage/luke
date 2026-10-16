// avatar-view.ts -- the signals that carry Luke's avatar's video from the panel to the floating call window: the window's offer, the panel's answer, and the window's close.
import type { UnparsedWireValue } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Schema as EffectSchema, Result } from "effect";

/**
 * What one signal says. The call window offers to receive video, the panel
 * answers with the avatar's track, and the window closes the view once its
 * card no longer draws the avatar. Each names the view it is about, so an
 * answer for a view the window has put away, or a close for one the panel
 * has already replaced, reaches nothing.
 */
export const AVATAR_VIEW_SIGNAL = {
  OFFER: "offer",
  ANSWER: "answer",
  CLOSE: "close",
} as const;

/**
 * The longest a view's id and a session description may be. A description
 * carries every candidate it gathered, since nothing trickles after it, and
 * a single video line with a window's host candidates is a few kilobytes.
 */
const AVATAR_VIEW_BOUNDS = {
  VIEW_CHARS: 64,
  SDP_CHARS: 32_768,
} as const;

const view = EffectSchema.String.check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(AVATAR_VIEW_BOUNDS.VIEW_CHARS),
);

const sdp = EffectSchema.String.check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(AVATAR_VIEW_BOUNDS.SDP_CHARS),
);

const avatarViewOfferSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(AVATAR_VIEW_SIGNAL.OFFER),
  view,
  sdp,
});

/** One signal between the two windows, which main relays and reads no further than its kind. */
const avatarViewSignalSchema = EffectSchema.Union([
  avatarViewOfferSchema,
  EffectSchema.Struct({ kind: EffectSchema.Literal(AVATAR_VIEW_SIGNAL.ANSWER), view, sdp }),
  EffectSchema.Struct({ kind: EffectSchema.Literal(AVATAR_VIEW_SIGNAL.CLOSE), view }),
]);

export type AvatarViewOffer = typeof avatarViewOfferSchema.Type;

export type AvatarViewSignal = typeof avatarViewSignalSchema.Type;

/** A signal as it crossed from another window, or nothing where it is malformed or too long. */
export function avatarViewSignalFromWire(value: UnparsedWireValue): AvatarViewSignal | undefined {
  return Result.getOrUndefined(readEither(avatarViewSignalSchema)(value));
}
