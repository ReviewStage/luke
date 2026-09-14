import assert from "node:assert/strict";
import { test } from "vitest";
import { BRAIN_EMBEDDING_MODEL, embeddingsVectors } from "./embedding-adapters.js";

function embeddingsPayload(vectors: readonly number[][], model = BRAIN_EMBEDDING_MODEL) {
  return {
    object: "list",
    model,
    data: vectors.map((embedding, index) => ({ object: "embedding", index, embedding })).reverse(),
  };
}

test("the embeddings answer is read in the order of the texts, or not at all", () => {
  assert.deepEqual(
    embeddingsVectors(
      embeddingsPayload([
        [1, 0],
        [0, 1],
      ]),
    ),
    {
      model: BRAIN_EMBEDDING_MODEL,
      vectors: [
        [1, 0],
        [0, 1],
      ],
    },
  );
  assert.equal(embeddingsVectors(embeddingsPayload([[1, 0], [1]])), undefined, "unequal widths");
  assert.equal(embeddingsVectors({ data: "no" }), undefined);
});
