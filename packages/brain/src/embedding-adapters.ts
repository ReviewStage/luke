import {
  isRecord,
  isWireNumber,
  isWireString,
  numberVectors,
  type UnparsedWireValue,
} from "@sidecar/wire";

/**
 * The embeddings request and answer as OpenAI's endpoint speaks them: what
 * Luke's hosted service sends upstream for its embed operation and how it
 * reads the vectors back, in the order of the texts. Nothing here keeps a
 * vector; the service answers them to its caller and stores none.
 */

/** OpenAI's embeddings endpoint, the one call the hosted embed operation makes upstream. */
export const BRAIN_EMBEDDINGS_PATH = "/embeddings";

/** The embedding model the hosted embed operation runs on; a build-fixed choice, not a request field. */
export const BRAIN_EMBEDDING_MODEL = "text-embedding-3-small";

/** The embeddings request: the texts and the model, and no retention asked for. */
export function brainEmbeddingsRequest(texts: readonly string[], options: { model: string }) {
  return { model: options.model, input: texts, encoding_format: "float" };
}

export type BrainEmbeddingsRequest = ReturnType<typeof brainEmbeddingsRequest>;

/**
 * The vectors an embeddings answer carries, in the order of the texts sent,
 * or nothing for a payload of any other shape or a vector of another width.
 */
export function embeddingsVectors(
  payload: UnparsedWireValue | undefined,
): { model: string; vectors: number[][] } | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return undefined;
  const model = isWireString(payload.model) && payload.model.length > 0 ? payload.model : undefined;
  if (!model) return undefined;
  const indexed: { index: number; embedding: UnparsedWireValue }[] = [];
  for (const entry of payload.data) {
    if (!isRecord(entry) || !isWireNumber(entry.index)) return undefined;
    indexed.push({ index: entry.index, embedding: entry.embedding });
  }
  indexed.sort((a, b) => a.index - b.index);
  const vectors = numberVectors(indexed.map((entry) => entry.embedding));
  return vectors ? { model, vectors } : undefined;
}
