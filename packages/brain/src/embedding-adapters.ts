import {
  type AccountToken,
  HOSTED_BRAIN_CONTRACT_VERSION,
  HOSTED_BRAIN_EMBED_BOUNDS,
  HOSTED_BRAIN_OPERATION,
  HOSTED_SERVICE_PATH,
  hostedBrainEmbedAnswerFromWire,
  hostedBrainEmbedRequestFromWire,
} from "@sidecar/hosted";
import { BUILTIN_EMBEDDING_ADAPTER } from "@sidecar/runtime";
import {
  type EmbeddingAdapter,
  type EmbeddingBatch,
  type EmbeddingIdentity,
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
} from "@sidecar/runtime/vocabulary";
import {
  type CloudFetch,
  HTTP_METHOD,
  HTTP_STATUS,
  isRecord,
  isWireNumber,
  isWireString,
  numberVectors,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { type BrainTransport, hostedBrainTransport, keyedBrainTransport } from "./client.js";
import { failed, notServed, payloadOf, throttled } from "./model-adapter-shared.js";
import { BRAIN_OPENAI_DEFAULTS } from "./openai-model-adapter.js";

/**
 * The two embedding adapters the notebook index runs on, one per credential:
 * OpenAI's embeddings endpoint on the developer's own key, and Luke's hosted
 * service under the account's token, speaking the second brain contract's
 * embed operation. Neither keeps anything: a batch of chunk texts goes up,
 * one vector per text comes back, and the identity every vector was made
 * under is what the index stores beside it. A hosted service that lacks the
 * operation is a compatibility failure, which the automatic provider
 * selection degrades to keyword search and an explicit selection reports.
 */

/** OpenAI's embeddings endpoint, the one call the notebook index makes on a key. */
export const BRAIN_EMBEDDINGS_PATH = "/embeddings";

/** The embedding model the notebook index runs on by default; a build-fixed choice, not a request field. */
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

/** Batches wider than the hosted bound are cut to it on both transports, so the two behave alike. */
export const EMBEDDING_BATCH_SIZE = HOSTED_BRAIN_EMBED_BOUNDS.MAXIMUM_TEXTS;

export interface OpenAiEmbeddingAdapterOptions {
  apiKey: string;
  fetch?: CloudFetch;
  now?: () => number;
  requestTimeoutMs?: number;
}

/** The model and endpoint are fixed by the build: the index stores vectors under one model, and a key chooses none. */
export class OpenAiEmbeddingAdapter implements EmbeddingAdapter {
  readonly #client: BrainTransport;
  #dimensions: number | undefined;

  constructor(options: OpenAiEmbeddingAdapterOptions) {
    this.#client = keyedBrainTransport({
      ...options,
      baseUrl: BRAIN_OPENAI_DEFAULTS.BASE_URL,
    });
  }

  identity(): Promise<EmbeddingIdentity> {
    return Promise.resolve({
      provider: BUILTIN_EMBEDDING_ADAPTER.OPENAI,
      model: BRAIN_EMBEDDING_MODEL,
      dimensions: this.#dimensions ?? 0,
    });
  }

  async embed(
    texts: readonly string[],
    options?: { signal?: AbortSignal },
  ): Promise<EmbeddingBatch> {
    if (texts.length === 0) return { outcome: MODEL_RESPONSE_OUTCOME.ANSWERED, vectors: [] };
    if (texts.length > EMBEDDING_BATCH_SIZE) {
      return failed(
        MODEL_FAILURE.BOUNDS,
        `an embedding batch carries at most ${EMBEDDING_BATCH_SIZE} texts`,
      );
    }
    const response = await this.#client.send(
      BRAIN_EMBEDDINGS_PATH,
      HTTP_METHOD.POST,
      JSON.stringify(brainEmbeddingsRequest(texts, { model: BRAIN_EMBEDDING_MODEL })),
      options?.signal,
    );
    if (!(response instanceof Response)) return response;
    if (response.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
      return throttled(this.#client.quietUntil(response).until);
    }
    if (response.status === HTTP_STATUS.UNAUTHORIZED) {
      return failed(MODEL_FAILURE.CREDENTIAL, "the OpenAI key was refused");
    }
    if (!response.ok) {
      return failed(MODEL_FAILURE.UPSTREAM, `embeddings failed with status ${response.status}`);
    }
    const answer = embeddingsVectors(await payloadOf(response));
    if (!answer || answer.vectors.length !== texts.length) {
      return failed(MODEL_FAILURE.MALFORMED, "embeddings answer did not carry one vector per text");
    }
    this.#dimensions = answer.vectors[0]?.length ?? this.#dimensions;
    return { outcome: MODEL_RESPONSE_OUTCOME.ANSWERED, vectors: answer.vectors };
  }
}

export interface HostedEmbeddingAdapterOptions extends AccountToken {
  serviceBaseUrl: string;
  fetch?: CloudFetch;
  now?: () => number;
  requestTimeoutMs?: number;
}

export class HostedEmbeddingAdapter implements EmbeddingAdapter {
  readonly #client: BrainTransport;
  #model: string | undefined;
  #dimensions: number | undefined;
  #offered: boolean | undefined;

  constructor(options: HostedEmbeddingAdapterOptions) {
    this.#client = hostedBrainTransport({ ...options, baseUrl: options.serviceBaseUrl });
  }

  identity(): Promise<EmbeddingIdentity> {
    return Promise.resolve({
      provider: BUILTIN_EMBEDDING_ADAPTER.HOSTED,
      model: this.#model ?? BRAIN_EMBEDDING_MODEL,
      dimensions: this.#dimensions ?? 0,
    });
  }

  /** Reads the capabilities once: a service that does not list the embed operation offers no embeddings. */
  async #offers(): Promise<EmbeddingBatch | undefined> {
    if (this.#offered === true) return undefined;
    const capabilities = await this.#client.capabilities();
    if ("outcome" in capabilities) return capabilities;
    if (!capabilities.operations.includes(HOSTED_BRAIN_OPERATION.EMBED)) {
      this.#offered = false;
      return failed(
        MODEL_FAILURE.COMPATIBILITY,
        `the hosted service does not offer the ${HOSTED_BRAIN_OPERATION.EMBED} operation`,
      );
    }
    this.#offered = true;
    return undefined;
  }

  async embed(
    texts: readonly string[],
    options?: { signal?: AbortSignal },
  ): Promise<EmbeddingBatch> {
    if (texts.length === 0) return { outcome: MODEL_RESPONSE_OUTCOME.ANSWERED, vectors: [] };
    const refused = await this.#offers();
    if (refused) return refused;
    const read = hostedBrainEmbedRequestFromWire({
      contract: HOSTED_BRAIN_CONTRACT_VERSION,
      texts,
    });
    if (!read.ok) return failed(MODEL_FAILURE.BOUNDS, `embed request refused: ${read.refusal}`);
    const response = await this.#client.send(
      HOSTED_SERVICE_PATH.BRAIN_EMBED,
      HTTP_METHOD.POST,
      JSON.stringify(read.request),
      options?.signal,
    );
    if (!(response instanceof Response)) return response;
    if (response.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
      return throttled(this.#client.quietUntil(response).until);
    }
    if (response.status === HTTP_STATUS.UNAUTHORIZED) {
      return failed(MODEL_FAILURE.CREDENTIAL, "the account token was refused");
    }
    if (notServed(response)) {
      return failed(MODEL_FAILURE.COMPATIBILITY, "the hosted service does not serve embeddings");
    }
    if (!response.ok) {
      return failed(MODEL_FAILURE.UPSTREAM, `hosted embed failed with status ${response.status}`);
    }
    const answer = hostedBrainEmbedAnswerFromWire(await payloadOf(response));
    if (!answer || answer.vectors.length !== texts.length) {
      return failed(MODEL_FAILURE.MALFORMED, "embed answer did not carry one vector per text");
    }
    this.#model = answer.model;
    this.#dimensions = answer.dimensions;
    return { outcome: MODEL_RESPONSE_OUTCOME.ANSWERED, vectors: answer.vectors };
  }
}
