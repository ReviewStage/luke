import assert from "node:assert/strict";
import { test } from "vitest";
import {
  AVATAR_END_REASON,
  AVATAR_FEED_BOUNDS,
  AVATAR_FEED_KIND,
  AVATAR_OFF,
  AVATAR_STATUS,
  avatarFeedFromWire,
  avatarTiled,
} from "./avatar.js";

/** Base64 of `bytes` zero bytes, as the voice window's tee would encode that much silence. */
function silence(bytes: number): string {
  return Buffer.alloc(bytes).toString("base64");
}

test("a feed message is a 40 ms chunk of audio, a turn's end, or an interrupt", () => {
  const audio = { kind: AVATAR_FEED_KIND.AUDIO, pcm: silence(AVATAR_FEED_BOUNDS.PCM_BYTES) };
  assert.deepEqual(avatarFeedFromWire(audio), audio);
  // A turn's last chunk may be shorter than 40 ms.
  const tail = { kind: AVATAR_FEED_KIND.AUDIO, pcm: silence(6) };
  assert.deepEqual(avatarFeedFromWire(tail), tail);
  assert.deepEqual(avatarFeedFromWire({ kind: AVATAR_FEED_KIND.TURN_END }), {
    kind: AVATAR_FEED_KIND.TURN_END,
  });
  assert.deepEqual(avatarFeedFromWire({ kind: AVATAR_FEED_KIND.INTERRUPT }), {
    kind: AVATAR_FEED_KIND.INTERRUPT,
  });
});

test("a chunk longer than 40 ms is refused", () => {
  const pcm = silence(AVATAR_FEED_BOUNDS.PCM_BYTES + 2);
  assert.equal(avatarFeedFromWire({ kind: AVATAR_FEED_KIND.AUDIO, pcm }), undefined);
});

test("a malformed feed message is refused", () => {
  const refused = [
    { kind: AVATAR_FEED_KIND.AUDIO, pcm: "" },
    { kind: AVATAR_FEED_KIND.AUDIO, pcm: "not base64!" },
    { kind: AVATAR_FEED_KIND.AUDIO, pcm: "AAA" },
    // Three bytes is a sample and a half.
    { kind: AVATAR_FEED_KIND.AUDIO, pcm: silence(3) },
    { kind: AVATAR_FEED_KIND.AUDIO },
    { kind: AVATAR_FEED_KIND.AUDIO, pcm: [0, 0] },
    { kind: AVATAR_FEED_KIND.TURN_END, pcm: silence(2) },
    { kind: "speak" },
    "turn_end",
    undefined,
  ];
  for (const value of refused) assert.equal(avatarFeedFromWire(value), undefined);
});

test("the tile stands while the avatar comes up and is up, and through an end it can be restarted from", () => {
  const tiled = [
    { status: AVATAR_STATUS.STARTING },
    { status: AVATAR_STATUS.LIVE },
    { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.SERVER_CLOSED },
    { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.ERROR },
    { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.NO_CAPACITY },
    { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.UNAVAILABLE },
  ];
  for (const avatar of tiled) assert.equal(avatarTiled(avatar), true, JSON.stringify(avatar));
  const untiled = [
    AVATAR_OFF,
    { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.USER },
    { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.CALL_ENDED },
  ];
  for (const avatar of untiled) assert.equal(avatarTiled(avatar), false, JSON.stringify(avatar));
});
