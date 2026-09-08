import { numberVector, type UnparsedWireValue } from "@sidecar/wire";

/** The similarity every vector rank reads; two vectors of unequal width are unrelated. */
export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

/** A stored embedding as its JSON column holds it, or nothing for a column that is not a vector. */
export function parseEmbedding(serialized: string): number[] | undefined {
  if (serialized.length === 0) return undefined;
  try {
    // SAFETY: JSON.parse returns a runtime value; every member is checked as a wire number below.
    return numberVector(JSON.parse(serialized) as UnparsedWireValue);
  } catch {
    return undefined;
  }
}

export function serializeEmbedding(vector: readonly number[]): string {
  return JSON.stringify(vector);
}
