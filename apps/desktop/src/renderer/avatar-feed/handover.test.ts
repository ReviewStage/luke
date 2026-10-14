import { describe, expect, it } from "vitest";
import { AVATAR_FEED_KIND, AVATAR_STATUS, type AvatarFeed } from "#shared/messages/avatar";
import {
  AVATAR_HANDOVER_DIRECT,
  type AvatarHandover,
  avatarVoiced,
  handoverInterrupt,
  handoverOnFeed,
  handoverOnStatus,
} from "./handover";

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
      const { handover, sent } = feedAll(handoverOnStatus(AVATAR_HANDOVER_DIRECT, status), [
        AUDIO,
        TURN_END,
      ]);
      expect(sent).toEqual([]);
      expect(avatarVoiced(handover)).toBe(false);
    }
  });

  it("takes Luke's voice at once when it goes live between turns, and feeds the next turn whole", () => {
    const live = handoverOnStatus(AVATAR_HANDOVER_DIRECT, AVATAR_STATUS.LIVE);
    expect(avatarVoiced(live)).toBe(true);
    expect(feedAll(live, [AUDIO, AUDIO, TURN_END]).sent).toEqual([AUDIO, AUDIO, TURN_END]);
  });

  it("leaves a turn already playing on the element and hands over the one after it", () => {
    const midTurn = feedAll(AVATAR_HANDOVER_DIRECT, [AUDIO]).handover;
    const live = handoverOnStatus(midTurn, AVATAR_STATUS.LIVE);
    expect(avatarVoiced(live)).toBe(false);
    // The rest of the turn, its end included, is the element's alone.
    const finished = feedAll(live, [AUDIO, TURN_END]);
    expect(finished.sent).toEqual([]);
    expect(avatarVoiced(finished.handover)).toBe(true);
    expect(feedAll(finished.handover, [AUDIO, TURN_END]).sent).toEqual([AUDIO, TURN_END]);
  });

  it("gives the voice back at once when the avatar ends mid-turn, and sends no more of it", () => {
    const feeding = feedAll(handoverOnStatus(AVATAR_HANDOVER_DIRECT, AVATAR_STATUS.LIVE), [
      AUDIO,
    ]).handover;
    const ended = handoverOnStatus(feeding, AVATAR_STATUS.ENDED);
    expect(avatarVoiced(ended)).toBe(false);
    expect(feedAll(ended, [AUDIO, TURN_END]).sent).toEqual([]);
    expect(handoverInterrupt(ended).feed).toBeUndefined();
  });

  it("drops the feed while the stop's silence stands, and takes it up again after", () => {
    const live = handoverOnStatus(AVATAR_HANDOVER_DIRECT, AVATAR_STATUS.LIVE);
    const silenced = feedAll(live, [AUDIO, TURN_END], true);
    expect(silenced.sent).toEqual([]);
    expect(avatarVoiced(silenced.handover)).toBe(true);
    expect(feedAll(silenced.handover, [AUDIO]).sent).toEqual([AUDIO]);
  });

  it("interrupts only where audio went to the avatar since the last interrupt", () => {
    const live = handoverOnStatus(AVATAR_HANDOVER_DIRECT, AVATAR_STATUS.LIVE);
    expect(handoverInterrupt(live).feed).toBeUndefined();
    const fed = feedAll(live, [AUDIO, TURN_END]).handover;
    const interrupted = handoverInterrupt(fed);
    expect(interrupted.feed).toEqual(INTERRUPT);
    expect(handoverInterrupt(interrupted.handover).feed).toBeUndefined();
  });
});
