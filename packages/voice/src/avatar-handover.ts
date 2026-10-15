/**
 * avatar-handover.ts -- whether Luke is heard through the voice window's element or through his avatar, and what of the tee's feed goes out.
 *
 * The avatar renders about a second behind GPT Live's own timeline, so the
 * voice moves over to it only between turns: a `LIVE` arriving while a turn
 * is open leaves that turn on the element and hands the next one over, and
 * no word is heard twice. Nor does it move before the tee stands: a tee still
 * loading, or one that failed, would leave Luke heard nowhere, and a turn
 * already playing when it stands is one it has not seen open, so the turn
 * the meter hears then is taken as open. Anything but `LIVE` puts the voice straight back on
 * the element, at once. While the stop's silence stands the feed is dropped,
 * because the avatar must not voice what the element was silenced for. A
 * pure function over status, feed, and interrupt, like the turn gate it
 * reads, so a test needs no clock.
 */

import { AVATAR_FEED_KIND, AVATAR_STATUS, type AvatarFeed, type AvatarStatus } from "./avatar.js";

/** Where Luke is heard: the element, the element until its turn ends, or the avatar. */
const AVATAR_ROUTE = {
  DIRECT: "direct",
  AWAITING_TURN: "awaiting-turn",
  AVATAR: "avatar",
} as const;

type AvatarRoute = (typeof AVATAR_ROUTE)[keyof typeof AVATAR_ROUTE];

export interface AvatarHandover {
  readonly route: AvatarRoute;
  /** Whether the tee stands and reads Luke's track, which the avatar can only voice him through. */
  readonly teeStanding: boolean;
  /** Whether the tee has a turn open, read off its feed: audio opens one and `turn_end` closes it. */
  readonly turnOpen: boolean;
  /** Whether audio went to the avatar since the last interrupt, so an interrupt has something to flush. */
  readonly fedSinceInterrupt: boolean;
}

export interface AvatarHandoverStep {
  readonly handover: AvatarHandover;
  /** What goes to the avatar, if anything. */
  readonly feed: AvatarFeed | undefined;
}

export const AVATAR_HANDOVER_DIRECT: AvatarHandover = {
  route: AVATAR_ROUTE.DIRECT,
  teeStanding: false,
  turnOpen: false,
  fedSinceInterrupt: false,
};

/** Whether the element is muted for the avatar, which is voicing Luke in its place. */
export function avatarVoiced(handover: AvatarHandover): boolean {
  return handover.route === AVATAR_ROUTE.AVATAR;
}

/** The avatar's status as the document moved it. */
export function handoverOnStatus(handover: AvatarHandover, status: AvatarStatus): AvatarHandover {
  if (status !== AVATAR_STATUS.LIVE) {
    return { ...handover, route: AVATAR_ROUTE.DIRECT, fedSinceInterrupt: false };
  }
  if (handover.route !== AVATAR_ROUTE.DIRECT || !handover.teeStanding) return handover;
  return {
    ...handover,
    route: handover.turnOpen ? AVATAR_ROUTE.AWAITING_TURN : AVATAR_ROUTE.AVATAR,
  };
}

/**
 * The tee standing up, with whether Luke is heard speaking on his track as
 * it does, or taken down, which leaves nothing open and the voice on the
 * element. The caller applies the status again after a tee stands.
 */
export function handoverOnTee(
  handover: AvatarHandover,
  standing: boolean,
  speaking: boolean,
): AvatarHandover {
  if (!standing) return AVATAR_HANDOVER_DIRECT;
  return { ...handover, teeStanding: true, turnOpen: handover.turnOpen || speaking };
}

/**
 * One message off the tee. Note that the turn a handover waited out ends on
 * the element and its `turn_end` goes nowhere, because the avatar never
 * heard the turn it closes.
 */
export function handoverOnFeed(
  handover: AvatarHandover,
  feed: AvatarFeed,
  silenced: boolean,
): AvatarHandoverStep {
  const turnOpen =
    feed.kind === AVATAR_FEED_KIND.AUDIO
      ? true
      : feed.kind === AVATAR_FEED_KIND.TURN_END
        ? false
        : handover.turnOpen;
  if (handover.route === AVATAR_ROUTE.AWAITING_TURN && !turnOpen) {
    return { handover: { ...handover, route: AVATAR_ROUTE.AVATAR, turnOpen }, feed: undefined };
  }
  if (handover.route !== AVATAR_ROUTE.AVATAR || silenced) {
    return { handover: { ...handover, turnOpen }, feed: undefined };
  }
  const fedSinceInterrupt = handover.fedSinceInterrupt || feed.kind === AVATAR_FEED_KIND.AUDIO;
  return { handover: { ...handover, turnOpen, fedSinceInterrupt }, feed };
}

/** The developer cutting in: the avatar is flushed where it has audio of this call's to flush. */
export function handoverInterrupt(handover: AvatarHandover): AvatarHandoverStep {
  if (handover.route !== AVATAR_ROUTE.AVATAR || !handover.fedSinceInterrupt) {
    return { handover, feed: undefined };
  }
  return {
    handover: { ...handover, fedSinceInterrupt: false },
    feed: { kind: AVATAR_FEED_KIND.INTERRUPT },
  };
}
