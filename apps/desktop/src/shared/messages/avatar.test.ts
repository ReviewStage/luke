import assert from "node:assert/strict";
import { test } from "vitest";
import { AVATAR_FEED_BOUNDS, AVATAR_FEED_KIND, avatarFeedFromWire } from "./avatar";

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
