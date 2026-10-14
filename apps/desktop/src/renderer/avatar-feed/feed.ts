/**
 * feed.ts -- the avatar feed the voice window hands main, as #1 pins it.
 *
 * A local copy of the pinned shape until #1's `AvatarFeed` schema lands in
 * `#shared/messages`, which #10 swaps this for: `audio` carries 40 ms of
 * PCM16LE 24 kHz mono in base64, `turn_end` closes a turn after its last
 * chunk, and `interrupt` flushes the avatar when the developer cuts in.
 */

export const AVATAR_FEED_KIND = {
  AUDIO: "audio",
  TURN_END: "turn_end",
  INTERRUPT: "interrupt",
} as const;

export type AvatarFeed =
  | { readonly kind: typeof AVATAR_FEED_KIND.AUDIO; readonly pcm: string }
  | { readonly kind: typeof AVATAR_FEED_KIND.TURN_END }
  | { readonly kind: typeof AVATAR_FEED_KIND.INTERRUPT };
