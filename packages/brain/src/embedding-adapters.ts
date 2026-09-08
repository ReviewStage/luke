import {
  HOSTED_BRAIN_CONTRACT_VERSION,
  HOSTED_BRAIN_EMBED_BOUNDS,
  HOSTED_BRAIN_OPERATION,
  HOSTED_SERVICE_PATH,
  hostedBrainCapabilitiesFromWire,
  hostedBrainEmbedAnswerFromWire,
  hostedBrainEmbedRequestFromWire,
} from "@sidecar/hosted";
import {
  type EmbeddingAdapter,
  type EmbeddingBatch,
  type EmbeddingIdentity,
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
} from "@sidecar/runtime-contracts";
import { positiveInteger, text } from "@sidecar/wire";
import {
  BRAIN_REQUEST_TIMEOUT_MS,
  type FetchLike,
  failed,
  HTTP_STATUS,
  payloadOf,
  RETRY_AFTER_HEADER,
  rateLimitWaitMs,
  requestSignal,
  throttled,
  withoutTrailingSlash,
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

export const OPENAI_EMBEDDING_ADAPTER_ID = "openai-embeddings";
export const HOSTED_EMBEDDING_ADAPTER_ID = "hosted-embeddings";

/** Batches wider than the hosted bound are cut to it on both transports, so the two behave alike. */
export const EMBEDDING_BATCH_SIZE = HOSTED_BRAIN_EMBED_BOUNDS.MAXIMUM_TEXTS;

export interface OpenAiEmbeddingAdapterOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  now?: () => number;
  requestTimeoutMs?: number;
}

export class OpenAiEmbeddingAdapter implements EmbeddingAdapter {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  #dimensions: number | undefined;

  constructor(options: OpenAiEmbeddingAdapterOptions) {
    const apiKey = text(options.apiKey);
    if (!apiKey) throw new Error("OpenAI API key must not be empty");
    this.#apiKey = apiKey;
    this.#model = text(options.model) ?? BRAIN_EMBEDDING_MODEL;
    this.#baseUrl = withoutTrailingSlash(text(options.baseUrl) ?? BRAIN_OPENAI_DEFAULTS.BASE_URL);
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = positiveInteger(options.requestTimeoutMs, BRAIN_REQUEST_TIMEOUT_MS);
  }

  identity(): Promise<EmbeddingIdentity> {
    return Promise.resolve({
      provider: OPENAI_EMBEDDING_ADAPTER_ID,
      model: this.#model,
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
      response = await this.#fetch(`${this.#baseUrl}${BRAIN_EMBEDDINGS_PATH}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(brainEmbeddingsRequest(texts, { model: this.#model })),
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
  fetch?: FetchLike;
  now?: () => number;
  requestTimeoutMs?: number;
}

export class HostedEmbeddingAdapter implements EmbeddingAdapter {
  readonly #baseUrl: string;
  readonly #readAccessToken: () => Promise<string | undefined>;
  readonly #refreshAccount: () => Promise<void>;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  #model: string | undefined;
  #dimensions: number | undefined;
  #offered: boolean | undefined;

  constructor(options: HostedEmbeddingAdapterOptions) {
    const baseUrl = text(options.serviceBaseUrl);
    if (!baseUrl) throw new Error("Hosted service base URL must not be empty");
    this.#baseUrl = withoutTrailingSlash(baseUrl);
    this.#readAccessToken = options.readAccessToken;
    this.#refreshAccount = options.refreshAccount;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = positiveInteger(options.requestTimeoutMs, BRAIN_REQUEST_TIMEOUT_MS);
  }

  identity(): Promise<EmbeddingIdentity> {
    return Promise.resolve({
      provider: HOSTED_EMBEDDING_ADAPTER_ID,
      model: this.#model ?? BRAIN_EMBEDDING_MODEL,
      dimensions: this.#dimensions ?? 0,
    });
  }

  async #send(
    path: string,
    method: "GET" | "POST",
    token: string,
    body?: string,
    signal?: AbortSignal,
  ) {
    try {
      return await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "content-type": "application/json" } : undefined),
        },
        ...(body !== undefined ? { body } : undefined),
        signal: requestSignal(this.#timeoutMs, signal),
      });
    } catch {
      return undefined;
    }
  }

  async #authorized(call: (token: string) => Promise<Response | undefined>) {
    const token = await this.#readAccessToken();
    if (!token) return failed(MODEL_FAILURE.CREDENTIAL, "no account token");
    const response = await call(token);
    if (response?.status !== HTTP_STATUS.UNAUTHORIZED) return response;
    await this.#refreshAccount().catch(() => undefined);
    const refreshed = await this.#readAccessToken();
    if (refreshed && refreshed !== token) return call(refreshed);
    return response;
  }

  /** Reads the capabilities once: a service that does not list the embed operation offers no embeddings. */
  async #offers(): Promise<EmbeddingBatch | undefined> {
    if (this.#offered === true) return undefined;
    const response = await this.#authorized((token) =>
      this.#send(HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES, "GET", token),
    );
    if (!(response instanceof Response)) {
      return response ?? failed(MODEL_FAILURE.NETWORK, "capabilities request did not complete");
    }
    if (!response.ok) {
      return failed(
        response.status === HTTP_STATUS.UNAUTHORIZED
          ? MODEL_FAILURE.CREDENTIAL
          : MODEL_FAILURE.COMPATIBILITY,
        `the hosted service's capabilities answered ${response.status}`,
      );
    }
    const capabilities = hostedBrainCapabilitiesFromWire(await payloadOf(response));
    if (!capabilities?.operations.includes(HOSTED_BRAIN_OPERATION.EMBED)) {
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
    const response = await this.#authorized((token) =>
      this.#send(
        HOSTED_SERVICE_PATH.BRAIN_EMBED,
        "POST",
        token,
        JSON.stringify(read.request),
        options?.signal,
      ),
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
    if (
      response.status === HTTP_STATUS.NOT_FOUND ||
      response.status === HTTP_STATUS.METHOD_NOT_ALLOWED
    ) {
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
