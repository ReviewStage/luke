import { Effect, Schema } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import { accountCall, fixedBearer, HTTP_METHOD } from "../../core.js";
import { HOSTED_OPENAI_DEFAULTS } from "../openai.js";

/**
 * How the notebook's search reaches OpenAI's embeddings model, on Luke's own
 * key: one POST per search carrying the query and the passages not yet
 * cached, answered as one vector per text in the order the texts were sent,
 * or as nothing for a refusal, a network fault, a body of another shape, or
 * the call's own deadline. No model runs here and nothing is kept: what the
 * vectors are cached against is the search's business
 * (`store/workspace-embeddings.ts`). A deployment without the key builds no
 * embedder, and the search runs keyword-only and says so.
 */

export const HOSTED_EMBEDDING = {
  /** The embeddings model every hosted passage and query is embedded by; a build-fixed choice, not a request field. */
  MODEL: "text-embedding-3-small",
  /** OpenAI's embeddings endpoint under the hosted base URL. */
  PATH: "/embeddings",
  /** Plain floats, so the vector decodes as the number array the cache holds. */
  ENCODING: "float",
} as const;

export interface HostedEmbedder {
  /** The model the vectors are made by, which is what the cache keys them under beside the hash. */
  readonly model: string;
  /** One vector per text, in the texts' order, or nothing when the model could not be had. */
  embed(
    texts: readonly string[],
  ): Effect.Effect<readonly (readonly number[])[] | undefined, never, HttpClient.HttpClient>;
}

/** The embeddings request as OpenAI's endpoint takes it: the texts, the model, and no retention asked for. */
function embeddingsRequest(texts: readonly string[], model: string) {
  return { model, input: texts, encoding_format: HOSTED_EMBEDDING.ENCODING };
}

/** What is read of the answer: each text's vector and its position; the model name and usage are not kept. */
const EmbeddingsAnswerSchema = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      index: Schema.Number,
      embedding: Schema.Array(Schema.Number),
    }),
  ),
});

type EmbeddingsAnswer = Schema.Schema.Type<typeof EmbeddingsAnswerSchema>;

/** The vectors in the texts' order, of one width, one per text; nothing for an answer that is not exactly that. */
function vectorsOf(
  answer: EmbeddingsAnswer,
  count: number,
): readonly (readonly number[])[] | undefined {
  if (answer.data.length !== count) return undefined;
  const ordered = [...answer.data].sort((a, b) => a.index - b.index);
  const width = ordered[0]?.embedding.length ?? 0;
  if (width === 0) return undefined;
  if (ordered.some((entry, index) => entry.index !== index || entry.embedding.length !== width)) {
    return undefined;
  }
  return ordered.map((entry) => entry.embedding);
}

/** The embedder over Luke's own key, one call per `embed`, under the hosted OpenAI deadline. */
export function hostedEmbedder(
  apiKey: string,
  model: string = HOSTED_EMBEDDING.MODEL,
): HostedEmbedder {
  const call = accountCall({
    baseUrl: HOSTED_OPENAI_DEFAULTS.BASE_URL,
    credential: fixedBearer(apiKey),
    requestTimeoutMs: HOSTED_OPENAI_DEFAULTS.REQUEST_TIMEOUT_MS,
  });
  return {
    model,
    embed: (texts) =>
      texts.length === 0
        ? Effect.succeed([])
        : Effect.map(
            call.ask(
              {
                method: HTTP_METHOD.POST,
                path: HOSTED_EMBEDDING.PATH,
                body: JSON.stringify(embeddingsRequest(texts, model)),
              },
              EmbeddingsAnswerSchema,
            ),
            (answer) => (answer ? vectorsOf(answer, texts.length) : undefined),
          ),
  };
}
