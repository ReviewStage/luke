import { describe, expect, it } from "vitest";
import { AVATAR_FEED_KIND, AVATAR_STATUS, type AvatarFeed } from "./avatar.js";
import {
  AVATAR_HANDOVER_DIRECT,
  type AvatarHandover,
  avatarVoiced,
  handoverInterrupt,
  handoverOnFeed,
  handoverOnStatus,
  handoverOnTee,
} from "./avatar-handover.js";

/** The handover once the tee reads Luke's track, between his turns. */
const TEE_STANDING = handoverOnTee(AVATAR_HANDOVER_DIRECT, true, false);

const AUDIO: AvatarFeed = { kind: AVATAR_FEED_KIND.AUDIO, pcm: "AAAA" };
const TURN_END: AvatarFeed = { kind: AVATAR_FEED_KIND.TURN_END };
const INTERRUPT: AvatarFeed = { kind: AVATAR_FEED_KIND.INTERRUPT };

/** Runs feeds through the handover, unsilenced, answering where it ends and what went out. */
function feedAll(handover: AvatarHandover, feeds: readonly AvatarFeed[], silenced = false) {
  const sent: AvatarFeed[] = [];
  let current = handover;
  for (const feed of feeds) {
    const step = handoverOnFeed(current, feed, silenced);
    current = step.handover;
    if (step.feed) sent.push(step.feed);
  }
  return { handover: current, sent };
}

describe("the avatar handover", () => {
  it("sends nothing and leaves the element playing until the avatar is live", () => {
    for (const status of [AVATAR_STATUS.OFF, AVATAR_STATUS.STARTING, AVATAR_STATUS.ENDED]) {
      const { handover, sent } = feedAll(handoverOnStatus(TEE_STANDING, status), [AUDIO, TURN_END]);
      expect(sent).toEqual([]);
      expect(avatarVoiced(handover)).toBe(false);
    }
  });

  it("takes Luke's voice at once when it goes live between turns, and feeds the next turn whole", () => {
    const live = handoverOnStatus(TEE_STANDING, AVATAR_STATUS.LIVE);
    expect(avatarVoiced(live)).toBe(true);
    expect(feedAll(live, [AUDIO, AUDIO, TURN_END]).sent).toEqual([AUDIO, AUDIO, TURN_END]);
  });

  it("leaves a turn already playing on the element and hands over the one after it", () => {
    const midTurn = feedAll(TEE_STANDING, [AUDIO]).handover;
    const live = handoverOnStatus(midTurn, AVATAR_STATUS.LIVE);
    expect(avatarVoiced(live)).toBe(false);
    // The rest of the turn, its end included, is the element's alone.
    const finished = feedAll(live, [AUDIO, TURN_END]);
    expect(finished.sent).toEqual([]);
    expect(avatarVoiced(finished.handover)).toBe(true);
    expect(feedAll(finished.handover, [AUDIO, TURN_END]).sent).toEqual([AUDIO, TURN_END]);
  });

  it("gives the voice back at once when the avatar ends mid-turn, and sends no more of it", () => {
    const feeding = feedAll(handoverOnStatus(TEE_STANDING, AVATAR_STATUS.LIVE), [AUDIO]).handover;
    const ended = handoverOnStatus(feeding, AVATAR_STATUS.ENDED);
    expect(avatarVoiced(ended)).toBe(false);
    expect(feedAll(ended, [AUDIO, TURN_END]).sent).toEqual([]);
    expect(handoverInterrupt(ended).feed).toBeUndefined();
  });

  it("drops the feed while the stop's silence stands, and takes it up again after", () => {
    const live = handoverOnStatus(TEE_STANDING, AVATAR_STATUS.LIVE);
    const silenced = feedAll(live, [AUDIO, TURN_END], true);
    expect(silenced.sent).toEqual([]);
    expect(avatarVoiced(silenced.handover)).toBe(true);
    expect(feedAll(silenced.handover, [AUDIO]).sent).toEqual([AUDIO]);
  });

  it("interrupts only where audio went to the avatar since the last interrupt", () => {
    const live = handoverOnStatus(TEE_STANDING, AVATAR_STATUS.LIVE);
    expect(handoverInterrupt(live).feed).toBeUndefined();
    const fed = feedAll(live, [AUDIO, TURN_END]).handover;
    const interrupted = handoverInterrupt(fed);
    expect(interrupted.feed).toEqual(INTERRUPT);
    expect(handoverInterrupt(interrupted.handover).feed).toBeUndefined();
  });

  it("keeps Luke on the element while no tee stands, and goes live once one does", () => {
    const waiting = handoverOnStatus(AVATAR_HANDOVER_DIRECT, AVATAR_STATUS.LIVE);
    expect(avatarVoiced(waiting)).toBe(false);
    expect(feedAll(waiting, [AUDIO]).sent).toEqual([]);
    const standing = handoverOnStatus(handoverOnTee(waiting, true, false), AVATAR_STATUS.LIVE);
    expect(avatarVoiced(standing)).toBe(true);
    // A tee taken down gives the voice back.
    expect(avatarVoiced(handoverOnTee(standing, false, false))).toBe(false);
  });

  it("takes a turn the meter hears as the tee stands as open, and leaves it on the element", () => {
    const standing = handoverOnStatus(
      handoverOnTee(AVATAR_HANDOVER_DIRECT, true, true),
      AVATAR_STATUS.LIVE,
    );
    expect(avatarVoiced(standing)).toBe(false);
    const finished = feedAll(standing, [AUDIO, TURN_END]);
    expect(finished.sent).toEqual([]);
    expect(avatarVoiced(finished.handover)).toBe(true);
  });
});
