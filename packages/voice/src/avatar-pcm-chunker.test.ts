import { describe, expect, it } from "vitest";
import { PCM_CHUNK_SAMPLES } from "./avatar-pcm.js";
import { createPcmChunker } from "./avatar-pcm-chunker.js";

describe("the PCM chunker", () => {
  it("answers 40 ms chunks across 128-sample render quanta, holding the remainder", () => {
    const chunk = createPcmChunker();
    const quantum = new Float32Array(128).fill(0.5);
    const answered = Array.from({ length: 15 }, () => chunk(quantum)).map(
      (chunks) => chunks.length,
    );
    // 15 quanta are 1920 samples: exactly two chunks, the first after the eighth quantum.
    expect(answered).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]);
  });

  it("clamps past full scale rather than wrapping, and reads NaN as silence", () => {
    const chunk = createPcmChunker();
    const samples = new Float32Array(PCM_CHUNK_SAMPLES);
    samples.set([1, -1, 1.5, -3, Number.NaN, 0.5]);
    const [pcm = new Int16Array()] = chunk(samples);
    expect(Array.from(pcm.subarray(0, 6))).toEqual([32_767, -32_768, 32_767, -32_768, 0, 16_384]);
  });
});
