import {
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type ModelAdapter,
  type ModelCapabilitiesAnswer,
  type ModelCompaction,
  type ModelRequestOptions,
  type ModelResponse,
  type ModelTokenCount,
  REASONING_EFFORT,
  type ReasoningEffort,
} from "@sidecar/runtime-contracts";
import { positiveInteger, text, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";
import {
  BRAIN_RATE_LIMIT_COOLDOWN_MS,
  type FetchLike,
  failed,
  RATE_LIMIT_STATUS,
  RETRY_AFTER_HEADER,
  requestFault,
  requestSignal,
  throttled,
  withoutTrailingSlash,
} from "./model-adapter-shared.js";
import {
  BRAIN_RESPONSES_COMPACT_PATH,
  BRAIN_RESPONSES_INPUT_TOKENS_PATH,
  BRAIN_RESPONSES_PATH,
  type BrainCompactRequest,
  type BrainInputTokensRequest,
  type BrainResponsesRequest,
  brainCompactRequest,
  brainInputTokensRequest,
  brainResponsesRequest,
  RESPONSES_ITEM_FORMAT,
  responsesCompactedWindow,
  responsesInputTokens,
  responsesModelAnswer,
  responsesToolDefinition,
} from "./responses-api.js";
import { TOOL_LOOP_RUNTIME } from "./runtime.js";

/* The key is not read here: it is the stored credential the settings store
   resolves, which reads `OPENAI_API_KEY` as its own fallback. */
const OPENAI_ENVIRONMENT = {
  BASE_URL: "OPENAI_BASE_URL",
  MODEL: "LUKE_BRAIN_MODEL",
} as const;

export const BRAIN_OPENAI_DEFAULTS = {
  BASE_URL: "https://api.openai.com/v1",
  MODEL: "gpt-5.6-terra",
  REASONING_EFFORT: REASONING_EFFORT.MEDIUM,
  /** A turn may read a transcript, reason over it, and act; the ceiling is for a runaway, not a budget. */
  REQUEST_TIMEOUT_MS: 90_000,
  MAXIMUM_OUTPUT_TOKENS: 16_000,
} as const;

export const OPENAI_MODEL_ADAPTER_ID = "openai-responses";

export interface OpenAiModelAdapterOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  reasoningEffort?: ReasoningEffort;
  fetch?: FetchLike;
  now?: () => number;
  requestTimeoutMs?: number;
  report?: (message: string) => void;
}

export type OpenAiModelOptions = Omit<OpenAiModelAdapterOptions, "apiKey">;

async function payloadOf(response: Response): Promise<UnparsedWireValue | undefined> {
  try {
    // SAFETY: response.json returns a runtime value; every reader below validates it as wire.
    return (await response.json()) as UnparsedWireValue;
  } catch {
    return undefined;
  }
}

/**
 * Carries inferences to the OpenAI Responses API on the developer's own key.
 * It never asks the API to retain a request, and it answers normalized: the
 * items, text, and calls of an answer; a throttle with the moment to resume;
 * or a failure named by kind. Reading inside an item is the context engine's
 * job, and deciding what to do with a call is the host's.
 */
export class OpenAiModelAdapter implements ModelAdapter {
  readonly model: string;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #reasoningEffort: ReasoningEffort;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  readonly #report: (message: string) => void;
  #quietUntil = 0;

  constructor(options: OpenAiModelAdapterOptions) {
    const apiKey = text(options.apiKey);
    if (!apiKey) throw new Error("OpenAI API key must not be empty");
    this.#apiKey = apiKey;
    this.model = text(options.model) ?? BRAIN_OPENAI_DEFAULTS.MODEL;
    this.#baseUrl = withoutTrailingSlash(text(options.baseUrl) ?? BRAIN_OPENAI_DEFAULTS.BASE_URL);
    this.#reasoningEffort = options.reasoningEffort ?? BRAIN_OPENAI_DEFAULTS.REASONING_EFFORT;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      BRAIN_OPENAI_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
    this.#report = options.report ?? ((message) => process.stderr.write(`${message}\n`));
  }

  capabilities(): Promise<ModelCapabilitiesAnswer> {
    return Promise.resolve({
      outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
      capabilities: {
        adapter: OPENAI_MODEL_ADAPTER_ID,
        model: this.model,
        checkpoint: {
          runtime: TOOL_LOOP_RUNTIME.ID,
          runtimeVersion: TOOL_LOOP_RUNTIME.VERSION,
          format: RESPONSES_ITEM_FORMAT.FORMAT,
          formatVersion: RESPONSES_ITEM_FORMAT.VERSION,
        },
        countsInputTokens: true,
        compacts: true,
        maximumOutputTokens: BRAIN_OPENAI_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
      },
    });
  }

  quietUntil(): number | undefined {
    return this.#quietUntil > this.#now() ? this.#quietUntil : undefined;
  }

  async respond(
    items: readonly WireRecord[],
    options: ModelRequestOptions,
  ): Promise<ModelResponse> {
    const quietUntil = this.quietUntil();
    if (quietUntil !== undefined) return throttled(quietUntil);
    const response = await this.#post(
      BRAIN_RESPONSES_PATH,
      brainResponsesRequest(items, {
        model: this.model,
        instructions: options.prompt,
        tools: options.tools.map(responsesToolDefinition),
        maximumOutputTokens: options.maximumOutputTokens,
        reasoningEffort: options.reasoningEffort ?? this.#reasoningEffort,
      }),
      options.signal,
    );
    if (!(response instanceof Response)) return response;
    const answer = responsesModelAnswer(await payloadOf(response));
    return answer ?? failed(MODEL_FAILURE.MALFORMED, "response carried no output");
  }

  async countInputTokens(
    items: readonly WireRecord[],
    options: Pick<ModelRequestOptions, "prompt" | "tools" | "signal">,
  ): Promise<ModelTokenCount> {
    const quietUntil = this.quietUntil();
    if (quietUntil !== undefined) return throttled(quietUntil);
    const response = await this.#post(
      BRAIN_RESPONSES_INPUT_TOKENS_PATH,
      brainInputTokensRequest(items, {
        model: this.model,
        instructions: options.prompt,
        tools: options.tools.map(responsesToolDefinition),
      }),
      options.signal,
    );
    if (!(response instanceof Response)) return response;
    const inputTokens = responsesInputTokens(await payloadOf(response));
    return inputTokens === undefined
      ? failed(MODEL_FAILURE.MALFORMED, "count carried no input_tokens")
      : { outcome: MODEL_RESPONSE_OUTCOME.ANSWERED, inputTokens };
  }

  /** The explicit compaction: the whole window the API answers is the next context, adopted as it came. */
  async compact(
    items: readonly WireRecord[],
    options: Pick<ModelRequestOptions, "prompt" | "signal">,
  ): Promise<ModelCompaction> {
    const quietUntil = this.quietUntil();
    if (quietUntil !== undefined) return throttled(quietUntil);
    const response = await this.#post(
      BRAIN_RESPONSES_COMPACT_PATH,
      brainCompactRequest(items, { model: this.model, instructions: options.prompt }),
      options.signal,
    );
    if (!(response instanceof Response)) return response;
    const window = responsesCompactedWindow(await payloadOf(response));
    return window
      ? { outcome: MODEL_RESPONSE_OUTCOME.ANSWERED, items: window }
      : failed(MODEL_FAILURE.MALFORMED, "compaction carried no output");
  }

  /** One POST on the key; a response is the caller's to read, anything else is already a normalized end. */
  async #post(
    path: string,
    body: BrainResponsesRequest | BrainCompactRequest | BrainInputTokensRequest,
    signal: AbortSignal | undefined,
  ): Promise<Response | ReturnType<typeof failed> | ReturnType<typeof throttled>> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: requestSignal(this.#requestTimeoutMs, signal),
      });
    } catch (error) {
      return requestFault(error instanceof Error ? error : undefined);
    }
    if (response.status === RATE_LIMIT_STATUS) return this.#quiet(response);
    // Status alone diagnoses credentials or an outage without writing the
    // request, the key, or any session material to the log.
    if (response.status === 401 || response.status === 403) {
      return failed(MODEL_FAILURE.CREDENTIAL, `request failed with status ${response.status}`);
    }
    if (!response.ok) {
      return failed(MODEL_FAILURE.UPSTREAM, `request failed with status ${response.status}`);
    }
    return response;
  }

  #quiet(response: Response) {
    const retryAfterSeconds = Number(response.headers.get(RETRY_AFTER_HEADER));
    const waitMs =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : BRAIN_RATE_LIMIT_COOLDOWN_MS;
    this.#quietUntil = this.#now() + waitMs;
    this.#report(`OpenAI brain turns are rate limited; pausing for ${Math.round(waitMs / 1000)}s`);
    return throttled(this.#quietUntil);
  }
}

/**
 * Builds a keyed adapter only when there is a key to build one from, so a key
 * entered later builds one then rather than leaving the brain off until the
 * next launch.
 */
export function openAiModelAdapter(
  apiKey: string | undefined,
  options: OpenAiModelOptions = {},
): OpenAiModelAdapter | undefined {
  const resolved = text(apiKey);
  if (!resolved) return undefined;
  const model = text(options.model) ?? text(process.env[OPENAI_ENVIRONMENT.MODEL]);
  const baseUrl = text(options.baseUrl) ?? text(process.env[OPENAI_ENVIRONMENT.BASE_URL]);
  return new OpenAiModelAdapter({
    ...options,
    apiKey: resolved,
    ...(model ? { model } : undefined),
    ...(baseUrl ? { baseUrl } : undefined),
  });
}
