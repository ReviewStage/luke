import { BUILTIN_MODEL_ADAPTER } from "@sidecar/runtime";
import {
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type ModelRequestOptions,
  REASONING_EFFORT,
  type ReasoningEffort,
} from "@sidecar/runtime/vocabulary";
import {
  type CloudFetch,
  HTTP_STATUS,
  positiveInteger,
  text,
  type WireRecord,
  withoutTrailingSlash,
} from "@sidecar/wire";
import { COMPACTION_POLICY } from "./compaction.js";
import {
  BRAIN_MAXIMUM_OUTPUT_TOKENS,
  BRAIN_REQUEST_TIMEOUT_MS,
  failed,
  RETRY_AFTER_HEADER,
  rateLimitWaitMs,
  requestFault,
  requestSignal,
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
  responsesCompactedWindow,
  responsesInputTokens,
  responsesModelAnswer,
  responsesToolDefinition,
} from "./responses-api.js";
import {
  type Admission,
  type PreparedOperation,
  type Quiet,
  RESPONSES_OPERATION,
  ResponsesModelAdapter,
  type ResponsesOperation,
  type ResponsesTransport,
} from "./responses-model-adapter.js";

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
  REQUEST_TIMEOUT_MS: BRAIN_REQUEST_TIMEOUT_MS,
  MAXIMUM_OUTPUT_TOKENS: BRAIN_MAXIMUM_OUTPUT_TOKENS,
} as const;

const OPENAI_PATH = {
  [RESPONSES_OPERATION.RESPOND]: BRAIN_RESPONSES_PATH,
  [RESPONSES_OPERATION.COUNT_TOKENS]: BRAIN_RESPONSES_INPUT_TOKENS_PATH,
  [RESPONSES_OPERATION.COMPACT]: BRAIN_RESPONSES_COMPACT_PATH,
} as const satisfies Record<ResponsesOperation, string>;

export interface OpenAiModelAdapterOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  reasoningEffort?: ReasoningEffort;
  fetch?: CloudFetch;
  now?: () => number;
  requestTimeoutMs?: number;
  report?: (message: string) => void;
}

export type OpenAiModelOptions = Omit<OpenAiModelAdapterOptions, "apiKey">;

const ADMITTED: Admission<undefined> = { admitted: undefined };

/**
 * The OpenAI Responses API on the developer's own key. It never asks the API
 * to retain a request, and nothing stands between the adapter and the
 * provider: every operation is admitted, and the key alone authorizes it.
 */
class OpenAiTransport implements ResponsesTransport<undefined> {
  readonly adapter = BUILTIN_MODEL_ADAPTER.OPENAI;
  readonly #model: string;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #reasoningEffort: ReasoningEffort;
  readonly #fetch: CloudFetch;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;

  constructor(options: OpenAiModelAdapterOptions) {
    const apiKey = text(options.apiKey);
    if (!apiKey) throw new Error("OpenAI API key must not be empty");
    this.#apiKey = apiKey;
    this.#model = text(options.model) ?? BRAIN_OPENAI_DEFAULTS.MODEL;
    this.#baseUrl = withoutTrailingSlash(text(options.baseUrl) ?? BRAIN_OPENAI_DEFAULTS.BASE_URL);
    this.#reasoningEffort = options.reasoningEffort ?? BRAIN_OPENAI_DEFAULTS.REASONING_EFFORT;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      BRAIN_OPENAI_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
  }

  model(): string {
    return this.#model;
  }

  admit(): Promise<Admission<undefined>> {
    return Promise.resolve(ADMITTED);
  }

  capabilitiesOf() {
    return {
      model: this.#model,
      countsInputTokens: true,
      compacts: true,
      maximumOutputTokens: BRAIN_OPENAI_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
      contextWindowTokens: COMPACTION_POLICY.DEFAULT_CONTEXT_WINDOW_TOKENS,
    };
  }

  respond(_: undefined, items: readonly WireRecord[], options: ModelRequestOptions) {
    return prepared(
      brainResponsesRequest(items, {
        model: this.#model,
        instructions: options.prompt,
        tools: options.tools.map(responsesToolDefinition),
        maximumOutputTokens: options.maximumOutputTokens,
        reasoningEffort: options.reasoningEffort ?? this.#reasoningEffort,
      }),
      (payload) =>
        responsesModelAnswer(payload) ??
        failed(MODEL_FAILURE.MALFORMED, "response carried no output"),
    );
  }

  countInputTokens(
    _: undefined,
    items: readonly WireRecord[],
    options: Pick<ModelRequestOptions, "prompt" | "tools">,
  ) {
    return prepared(
      brainInputTokensRequest(items, {
        model: this.#model,
        instructions: options.prompt,
        tools: options.tools.map(responsesToolDefinition),
      }),
      (payload) => {
        const inputTokens = responsesInputTokens(payload);
        return inputTokens === undefined
          ? failed(MODEL_FAILURE.MALFORMED, "count carried no input_tokens")
          : { outcome: MODEL_RESPONSE_OUTCOME.ANSWERED, inputTokens };
      },
    );
  }

  compact(
    _: undefined,
    items: readonly WireRecord[],
    options: Pick<ModelRequestOptions, "prompt">,
  ) {
    return prepared(
      brainCompactRequest(items, { model: this.#model, instructions: options.prompt }),
      (payload) => {
        const window = responsesCompactedWindow(payload);
        return window
          ? { outcome: MODEL_RESPONSE_OUTCOME.ANSWERED, items: window }
          : failed(MODEL_FAILURE.MALFORMED, "compaction carried no output");
      },
    );
  }

  async request(operation: ResponsesOperation, body: string, signal: AbortSignal | undefined) {
    try {
      return await this.#fetch(`${this.#baseUrl}${OPENAI_PATH[operation]}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body,
        signal: requestSignal(this.#requestTimeoutMs, signal),
      });
    } catch (error) {
      return requestFault(error instanceof Error ? error : undefined);
    }
  }

  quiet(response: Response): Promise<Quiet> {
    const waitMs = rateLimitWaitMs(response.headers.get(RETRY_AFTER_HEADER));
    return Promise.resolve({
      until: this.#now() + waitMs,
      message: `OpenAI brain turns are rate limited; pausing for ${Math.round(waitMs / 1000)}s`,
    });
  }

  /** Status alone diagnoses credentials or an outage, without writing the request, the key, or any session material to the log. */
  failureFor(response: Response) {
    const credential =
      response.status === HTTP_STATUS.UNAUTHORIZED || response.status === HTTP_STATUS.FORBIDDEN;
    return failed(
      credential ? MODEL_FAILURE.CREDENTIAL : MODEL_FAILURE.UPSTREAM,
      `request failed with status ${response.status}`,
    );
  }
}

function prepared<Result>(
  request: BrainResponsesRequest | BrainInputTokensRequest | BrainCompactRequest,
  read: PreparedOperation<Result>["read"],
): PreparedOperation<Result> {
  return { body: JSON.stringify(request), read };
}

/**
 * Carries inferences to the OpenAI Responses API on the developer's own key,
 * answered normalized: the items, text, and calls of an answer; a throttle
 * with the moment to resume; or a failure named by kind. Reading inside an
 * item is the context engine's job, and deciding what to do with a call is
 * the host's.
 */
export class OpenAiModelAdapter extends ResponsesModelAdapter<undefined> {
  readonly #transport: OpenAiTransport;

  constructor(options: OpenAiModelAdapterOptions) {
    const transport = new OpenAiTransport(options);
    super(transport, options);
    this.#transport = transport;
  }

  override get model(): string {
    return this.#transport.model();
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
