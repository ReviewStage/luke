import { describe, expect, it } from "vitest";
import { AVATAR_PCM, createPcmChunker } from "./pcm-chunker";

/** The little-endian Int16 samples a chunk carries. */
function samplesOf(chunk: Uint8Array): number[] {
  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  return Array.from({ length: chunk.byteLength / 2 }, (_, index) => view.getInt16(index * 2, true));
}

describe("createPcmChunker", () => {
  it("emits 100 ms of 24 kHz PCM16 as one 4800-byte chunk", () => {
    const chunker = createPcmChunker();
    const chunks = chunker.push(new Float32Array(AVATAR_PCM.SAMPLE_RATE / 10));
    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([4_800]);
  });

  it("holds a partial chunk until render quanta complete it", () => {
    const chunker = createPcmChunker();
    const quantum = new Float32Array(128);
    const emitted: Uint8Array[] = [];
    for (let index = 0; index < 18; index += 1) emitted.push(...chunker.push(quantum));
    // 18 quanta are 2304 samples, short of a chunk; the 19th crosses 2400.
    expect(emitted).toEqual([]);
    expect(chunker.push(quantum).map((chunk) => chunk.byteLength)).toEqual([4_800]);
  });

  it("carries samples across a boundary in order, into chunks of their own buffers", () => {
    const chunker = createPcmChunker(4);
    const first = chunker.push(Float32Array.of(0.5, -0.5, 1, -1, 0.25, -0.25));
    const second = chunker.push(Float32Array.of(0, 0));
    expect(first.map(samplesOf)).toEqual([[16_384, -16_384, 32_767, -32_768]]);
    expect(second.map(samplesOf)).toEqual([[8_192, -8_192, 0, 0]]);
    expect(first[0]?.buffer).not.toBe(second[0]?.buffer);
    expect(first[0]?.buffer.byteLength).toBe(8);
  });

  it("emits every chunk one push completes", () => {
    const chunker = createPcmChunker(2);
    expect(chunker.push(new Float32Array(5))).toHaveLength(2);
    expect(chunker.push(new Float32Array(1))).toHaveLength(1);
  });

  it("clamps an overshoot to the Int16 range and reads NaN as silence", () => {
    const chunker = createPcmChunker(4);
    const [chunk] = chunker.push(Float32Array.of(1.7, -3, Number.NaN, Number.POSITIVE_INFINITY));
    expect(chunk && samplesOf(chunk)).toEqual([32_767, -32_768, 0, 32_767]);
  });

  it("refuses a chunk size that is not a positive whole number", () => {
    expect(() => createPcmChunker(0)).toThrow(RangeError);
    expect(() => createPcmChunker(2.5)).toThrow(RangeError);
  });
});
