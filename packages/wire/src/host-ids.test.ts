import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { brainHostId, sentLineId } from "./host-ids.js";

/** The digest as `node:crypto` lays it out, which every row written before the pure digest was keyed by. */
function nodeId(parts: readonly string[]): string {
  const digest = createHash("sha256")
    .update(Buffer.from("3c9b1f8e4a524d6b9e0f7b2c5a1d8e43", "hex"))
    .update(JSON.stringify(parts), "utf8")
    .digest()
    .subarray(0, 16);
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x80;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = digest.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

describe("host ids", () => {
  it("mints the id node:crypto minted for every coordinate, so rows already written keep theirs", () => {
    const coordinates = [
      ["sent", "4f0c2a8e-91b3-4d55-a7e2-0c6b1f9d3e72"],
      ["turn", "session-1", "turn_3"],
      ["received", "session-1", "turn_3", "2"],
      ["sent", "naïve — ünïcode 🙂"],
      ["sent", ""],
    ];
    for (const parts of coordinates) expect(brainHostId(parts)).toBe(nodeId(parts));
  });

  it("names a sent line by its key", () => {
    expect(sentLineId("key-1")).toBe(nodeId(["sent", "key-1"]));
    expect(sentLineId("key-1")).not.toBe(sentLineId("key-2"));
  });
});
