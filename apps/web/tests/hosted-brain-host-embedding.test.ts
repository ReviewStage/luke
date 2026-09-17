import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Effect, Redacted } from "effect";
import { HTTP_STATUS } from "../server/core";
import { hostedEmbedder } from "../server/hosted/brain-host/embedding";
import { HOSTED_OPENAI_DEFAULTS } from "../server/hosted/openai";

/**
 * The embedder as the notebook's search reaches OpenAI through it: one POST
 * to the embeddings endpoint on Luke's own key, read back as one vector per
 * text in the texts' order, and nothing for anything else. The fake answers
 * as the network would; no key here is real.
 */

interface Seen {
  url: string;
  authorization: string | null;
  body: string;
}

function embedding(index: number, vector: readonly number[]) {
  return { object: "embedding", index, embedding: vector };
}

function answer(data: readonly ReturnType<typeof embedding>[]): Response {
  return new Response(
    JSON.stringify({
      object: "list",
      model: "text-embedding-3-small",
      data,
      usage: { total_tokens: 3 },
    }),
    { headers: { "content-type": "application/json" } },
  );
}

function embed(texts: readonly string[], respond: (seen: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const embedder = hostedEmbedder(Redacted.make("sk-test-not-a-real-key"));
  const vectors = Effect.provide(
    embedder.embed(texts),
    fakeHttpClientLayer(async (url, init) => {
      const request = new Request(url, init);
      const record: Seen = {
        url,
        authorization: request.headers.get("authorization"),
        body: await request.text(),
      };
      seen.push(record);
      return respond(record);
    }),
  );
  return { seen, vectors };
}

it.effect(
  "one POST carries the texts and the model under Luke's key, and the vectors come back in the texts' order whatever order the answer listed them",
  () =>
    Effect.gen(function* () {
      const { seen, vectors } = embed(["first", "second"], () =>
        answer([embedding(1, [0, 1]), embedding(0, [1, 0])]),
      );
      assert.deepEqual(yield* vectors, [
        [1, 0],
        [0, 1],
      ]);
      assert.equal(seen.length, 1);
      assert.equal(seen[0]?.url, `${HOSTED_OPENAI_DEFAULTS.BASE_URL}/embeddings`);
      assert.equal(seen[0]?.authorization, "Bearer sk-test-not-a-real-key");
      assert.deepEqual(JSON.parse(seen[0]?.body ?? "{}"), {
        model: "text-embedding-3-small",
        input: ["first", "second"],
        encoding_format: "float",
      });
    }),
);

it.effect(
  "a refusal, a network fault, a short answer, an uneven width, and a shape of its own each read as no vectors",
  () =>
    Effect.gen(function* () {
      assert.equal(
        yield* embed(["a"], () => new Response("{}", { status: HTTP_STATUS.TOO_MANY_REQUESTS }))
          .vectors,
        undefined,
      );
      assert.equal(
        yield* embed(["a"], () => {
          throw new TypeError("fetch failed");
        }).vectors,
        undefined,
      );
      assert.equal(yield* embed(["a", "b"], () => answer([embedding(0, [1])])).vectors, undefined);
      assert.equal(
        yield* embed(["a", "b"], () => answer([embedding(0, [1]), embedding(1, [1, 2])])).vectors,
        undefined,
      );
      assert.equal(yield* embed(["a"], () => answer([embedding(0, [])])).vectors, undefined);
      assert.equal(
        yield* embed(["a"], () => new Response(JSON.stringify({ data: "no" }))).vectors,
        undefined,
      );
    }),
);

it.effect("no texts is no call", () =>
  Effect.gen(function* () {
    const { seen, vectors } = embed([], () => {
      throw new Error("not reached");
    });
    assert.deepEqual(yield* vectors, []);
    assert.equal(seen.length, 0);
  }),
);
