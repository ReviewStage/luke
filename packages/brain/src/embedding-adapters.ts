import {
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
import { type CloudFetch, HTTP_STATUS, positiveInteger, text } from "@sidecar/wire";
import {
  BRAIN_REQUEST_TIMEOUT_MS,
  failed,
  HostedServiceCalls,
  HTTP_METHOD,
  notServed,
  payloadOf,
  RETRY_AFTER_HEADER,
  rateLimitWaitMs,
  requestSignal,
  throttled,
} from "./model-adapter-shared.js";
import { BRAIN_OPENAI_DEFAULTS } from "./openai-model-adapter.js";
import {
  BRAIN_EMBEDDING_MODEL,
  BRAIN_EMBEDDINGS_PATH,
  brainEmbeddingsRequest,
  embeddingsVectors,
} from "./responses-api.js";

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

export const OPENAI_EMBEDDING_ADAPTER_ID = BUILTIN_EMBEDDING_ADAPTER.OPENAI;
export const HOSTED_EMBEDDING_ADAPTER_ID = BUILTIN_EMBEDDING_ADAPTER.HOSTED;

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
  readonly #apiKey: string;
  readonly #fetch: CloudFetch;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  #dimensions: number | undefined;

  constructor(options: OpenAiEmbeddingAdapterOptions) {
    const apiKey = text(options.apiKey);
    if (!apiKey) throw new Error("OpenAI API key must not be empty");
    this.#apiKey = apiKey;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = positiveInteger(options.requestTimeoutMs, BRAIN_REQUEST_TIMEOUT_MS);
  }

  identity(): Promise<EmbeddingIdentity> {
    return Promise.resolve({
      provider: OPENAI_EMBEDDING_ADAPTER_ID,
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
    let response: Response;
    try {
      response = await this.#fetch(`${BRAIN_OPENAI_DEFAULTS.BASE_URL}${BRAIN_EMBEDDINGS_PATH}`, {
        method: HTTP_METHOD.POST,
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(brainEmbeddingsRequest(texts, { model: BRAIN_EMBEDDING_MODEL })),
        signal: requestSignal(this.#timeoutMs, options?.signal),
      });
    } catch (error) {
      return failed(
        MODEL_FAILURE.NETWORK,
        `embeddings request did not complete: ${error instanceof Error ? error.name : "unknown error"}`,
      );
    }
    if (response.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
      return throttled(this.#now() + rateLimitWaitMs(response.headers.get(RETRY_AFTER_HEADER)));
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

export interface HostedEmbeddingAdapterOptions {
  serviceBaseUrl: string;
  readAccessToken: () => Promise<string | undefined>;
  refreshAccount: () => Promise<void>;
  fetch?: CloudFetch;
  now?: () => number;
  requestTimeoutMs?: number;
}

export class HostedEmbeddingAdapter implements EmbeddingAdapter {
  readonly #calls: HostedServiceCalls;
  readonly #now: () => number;
  #model: string | undefined;
  #dimensions: number | undefined;
  #offered: boolean | undefined;

  constructor(options: HostedEmbeddingAdapterOptions) {
    this.#calls = new HostedServiceCalls(options);
    this.#now = options.now ?? Date.now;
  }

  identity(): Promise<EmbeddingIdentity> {
    return Promise.resolve({
      provider: HOSTED_EMBEDDING_ADAPTER_ID,
      model: this.#model ?? BRAIN_EMBEDDING_MODEL,
      dimensions: this.#dimensions ?? 0,
    });
  }

  /** Reads the capabilities once: a service that does not list the embed operation offers no embeddings. */
  async #offers(): Promise<EmbeddingBatch | undefined> {
    if (this.#offered === true) return undefined;
    const capabilities = await this.#calls.capabilities();
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
    const response = await this.#calls.request(
      HOSTED_SERVICE_PATH.BRAIN_EMBED,
      HTTP_METHOD.POST,
      JSON.stringify(read.request),
      options?.signal,
    );
    if (!(response instanceof Response)) {
      return response ?? failed(MODEL_FAILURE.NETWORK, "embed request did not complete");
    }
    if (response.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
      return throttled(this.#now() + rateLimitWaitMs(response.headers.get(RETRY_AFTER_HEADER)));
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
