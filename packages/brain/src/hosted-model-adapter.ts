import {
  brainOutputReplayable,
  HOSTED_API_ERROR,
  HOSTED_BRAIN_CONTRACT_VERSION,
  HOSTED_BRAIN_REQUEST_REFUSAL,
  HOSTED_SERVICE_PATH,
  type HostedBrainCapabilities,
  type HostedBrainRequestRead,
  hostedBrainCompactRequestFromWire,
  hostedBrainCountTokensAnswerFromWire,
  hostedBrainCountTokensRequestFromWire,
  hostedBrainRespondRequestFromWire,
  hostedQuotaSchema,
  maximumHostedBrainRequestBytes,
  serializedRequestBytes,
} from "@sidecar/hosted";
import {
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type ModelCompaction,
  type ModelRequestOptions,
  type ModelResponse,
  type ModelTokenCount,
} from "@sidecar/runtime-contracts";
import {
  type CloudFetch,
  HTTP_STATUS,
  type UnparsedWireValue,
  unparsedWire,
  type WireRecord,
  wireRecord,
} from "@sidecar/wire";
import { COMPACTION_POLICY } from "./compaction.js";
import {
  type Failure,
  failed,
  HostedServiceCalls,
  HTTP_METHOD,
  type Normalized,
  notServed,
  payloadOf,
  RETRY_AFTER_HEADER,
  rateLimitWaitMs,
} from "./model-adapter-shared.js";
import { responsesCompactedWindow, responsesModelAnswer } from "./responses-api.js";
import {
  type Admission,
  type PreparedOperation,
  type Quiet,
  RESPONSES_OPERATION,
  ResponsesModelAdapter,
  type ResponsesOperation,
  type ResponsesTransport,
} from "./responses-model-adapter.js";

export const HOSTED_MODEL_ADAPTER_ID = "hosted-responses";

export interface HostedModelAdapterOptions {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  readAccessToken: () => Promise<string | undefined>;
  refreshAccount: () => Promise<void>;
  fetch?: CloudFetch;
  now?: () => number;
  requestTimeoutMs?: number;
  report?: (message: string) => void;
}

const HOSTED_PATH = {
  [RESPONSES_OPERATION.RESPOND]: HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2,
  [RESPONSES_OPERATION.COUNT_TOKENS]: HOSTED_SERVICE_PATH.BRAIN_COUNT_TOKENS,
  [RESPONSES_OPERATION.COMPACT]: HOSTED_SERVICE_PATH.BRAIN_COMPACT,
} as const satisfies Record<ResponsesOperation, string>;

/**
 * Luke's hosted service on the signed-in account, speaking the second hosted
 * brain contract and nothing older. It reads the service's capabilities once
 * and admits every request against them here exactly as the service admits
 * it there, so a service that lacks the contract, an operation, or a tool is
 * an explicit compatibility failure rather than a fall back to the shape an
 * installed client still speaks.
 */
class HostedTransport implements ResponsesTransport<HostedBrainCapabilities> {
  readonly adapter = HOSTED_MODEL_ADAPTER_ID;
  readonly #calls: HostedServiceCalls;
  readonly #now: () => number;
  #capabilities: HostedBrainCapabilities | undefined;

  constructor(options: HostedModelAdapterOptions) {
    this.#calls = new HostedServiceCalls(options);
    this.#now = options.now ?? Date.now;
  }

  /** The service's model, once capabilities have been read; the service's to know until then. */
  model(): string | undefined {
    return this.#capabilities?.model;
  }

  async admit(operation?: ResponsesOperation): Promise<Admission<HostedBrainCapabilities>> {
    const capabilities = this.#capabilities ?? (await this.#discover());
    if ("outcome" in capabilities) return capabilities;
    if (operation && !capabilities.operations.includes(operation)) {
      return failed(
        MODEL_FAILURE.COMPATIBILITY,
        `the hosted service does not offer the ${operation} operation`,
      );
    }
    return { admitted: capabilities };
  }

  capabilitiesOf(capabilities: HostedBrainCapabilities) {
    return {
      model: capabilities.model,
      countsInputTokens: capabilities.operations.includes(RESPONSES_OPERATION.COUNT_TOKENS),
      compacts: capabilities.operations.includes(RESPONSES_OPERATION.COMPACT),
      maximumOutputTokens: capabilities.bounds.maximumOutputTokens,
      tools: capabilities.tools,
      contextWindowTokens: COMPACTION_POLICY.DEFAULT_CONTEXT_WINDOW_TOKENS,
      maximumRequestBytes: capabilities.bounds.requestBytes,
    };
  }

  respond(
    capabilities: HostedBrainCapabilities,
    items: readonly WireRecord[],
    options: ModelRequestOptions,
  ): PreparedOperation<ModelResponse> | Normalized {
    return prepared(
      hostedBrainRespondRequestFromWire(
        {
          contract: HOSTED_BRAIN_CONTRACT_VERSION,
          prompt: options.prompt,
          tools: options.tools.map((tool) => tool.name),
          options: {
            maximumOutputTokens: options.maximumOutputTokens,
            ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : undefined),
          },
          input: items,
        },
        new Set(capabilities.tools),
      ),
      (payload) =>
        replayable(payload, "response") ??
        responsesModelAnswer(payload) ??
        failed(MODEL_FAILURE.MALFORMED, "response carried no output"),
    );
  }

  countInputTokens(
    capabilities: HostedBrainCapabilities,
    items: readonly WireRecord[],
    options: Pick<ModelRequestOptions, "prompt" | "tools">,
  ): PreparedOperation<ModelTokenCount> | Normalized {
    return prepared(
      hostedBrainCountTokensRequestFromWire(
        {
          contract: HOSTED_BRAIN_CONTRACT_VERSION,
          prompt: options.prompt,
          tools: options.tools.map((tool) => tool.name),
          input: items,
        },
        new Set(capabilities.tools),
      ),
      (payload) => {
        const count = hostedBrainCountTokensAnswerFromWire(payload);
        return count
          ? { outcome: MODEL_RESPONSE_OUTCOME.ANSWERED, inputTokens: count.inputTokens }
          : failed(MODEL_FAILURE.MALFORMED, "count carried no inputTokens");
      },
    );
  }

  compact(
    _: HostedBrainCapabilities,
    items: readonly WireRecord[],
    options: Pick<ModelRequestOptions, "prompt">,
  ): PreparedOperation<ModelCompaction> | Normalized {
    return prepared(
      hostedBrainCompactRequestFromWire({
        contract: HOSTED_BRAIN_CONTRACT_VERSION,
        prompt: options.prompt,
        input: items,
      }),
      (payload) => {
        const window = responsesCompactedWindow(payload);
        return (
          replayable(payload, "compaction") ??
          (window
            ? { outcome: MODEL_RESPONSE_OUTCOME.ANSWERED, items: window }
            : failed(MODEL_FAILURE.MALFORMED, "compaction carried no output"))
        );
      },
    );
  }

  async request(
    operation: ResponsesOperation,
    body: string,
    signal: AbortSignal | undefined,
  ): Promise<Response | Normalized> {
    const response = await this.#calls.request(
      HOSTED_PATH[operation],
      HTTP_METHOD.POST,
      body,
      signal,
    );
    if (!response) return failed(MODEL_FAILURE.NETWORK, "request did not complete");
    return response;
  }

  /**
   * Two quiets wear the same status. A spent allowance names the day's reset
   * in its quota and stands the adapter down until then; the provider rate
   * limiting behind the service names a bounded wait in `Retry-After`, or
   * earns the same fixed cooldown the keyed adapter takes, so a hosted
   * developer and a keyed one wait the same way for the same limit.
   */
  async quiet(response: Response): Promise<Quiet> {
    const record = wireRecord(unparsedWire(await payloadOf(response)));
    const quota =
      record?.error === HOSTED_API_ERROR.QUOTA_EXHAUSTED
        ? hostedQuotaSchema.parse(unparsedWire(record.quota))
        : undefined;
    const resetsAt = quota?.resetsAt;
    if (resetsAt !== undefined && resetsAt > this.#now()) {
      return {
        until: resetsAt,
        message: `Hosted brain turns are out of today's allowance; pausing for ${Math.round((resetsAt - this.#now()) / 1000)}s`,
      };
    }
    const waitMs = rateLimitWaitMs(response.headers.get(RETRY_AFTER_HEADER));
    return {
      until: this.#now() + waitMs,
      message: `Hosted brain turns are rate limited; pausing for ${Math.round(waitMs / 1000)}s`,
    };
  }

  failureFor(response: Response, operation: ResponsesOperation): Failure {
    if (response.status === HTTP_STATUS.UNAUTHORIZED) {
      return failed(MODEL_FAILURE.CREDENTIAL, "the account token was refused");
    }
    if (notServed(response)) {
      return failed(
        MODEL_FAILURE.COMPATIBILITY,
        `the hosted service does not serve ${HOSTED_PATH[operation]}`,
      );
    }
    return failed(
      MODEL_FAILURE.UPSTREAM,
      `hosted brain call failed with status ${response.status}`,
    );
  }

  /** Reads the capabilities once per adapter; a service that has none, or names another contract, is incompatible. */
  async #discover(): Promise<HostedBrainCapabilities | Failure> {
    const capabilities = await this.#calls.capabilities();
    if (!("outcome" in capabilities)) this.#capabilities = capabilities;
    return capabilities;
  }
}

/**
 * An answer carrying an item this path could not send back next turn is
 * refused whole before the host acts on any call in it or keeps any item of
 * it: kept, it would poison every later hosted turn of the generation.
 */
function replayable(payload: UnparsedWireValue | undefined, answer: string): Failure | undefined {
  return brainOutputReplayable(payload)
    ? undefined
    : failed(MODEL_FAILURE.MALFORMED, `${answer} carried an item the hosted service cannot replay`);
}

/**
 * A request the contract's own reader admitted, serialized and held to the
 * same byte bound the service enforces, before the token is even read: an
 * oversized request is an explicit bounded failure here rather than a
 * truncation or a retry, so the host reports it and rolls the turn back.
 */
function prepared<Request, Result>(
  read: HostedBrainRequestRead<Request>,
  readAnswer: (payload: UnparsedWireValue | undefined) => Result,
): PreparedOperation<Result> | Normalized {
  if (!read.ok) return refusedLocally(read.refusal);
  const body = JSON.stringify(read.request);
  if (serializedRequestBytes(body) > maximumHostedBrainRequestBytes) {
    return failed(MODEL_FAILURE.BOUNDS, "request exceeds the hosted request size bound");
  }
  return { body, read: readAnswer };
}

/** A request this adapter itself would not send: worded as the service would refuse it. */
function refusedLocally(refusal: string): Failure {
  switch (refusal) {
    case HOSTED_BRAIN_REQUEST_REFUSAL.PROMPT_TOO_LARGE:
      return failed(MODEL_FAILURE.BOUNDS, "the prepared prompt exceeds the hosted prompt envelope");
    case HOSTED_BRAIN_REQUEST_REFUSAL.UNKNOWN_TOOL:
      return failed(
        MODEL_FAILURE.COMPATIBILITY,
        "a tool this turn offers is not registered with the hosted service",
      );
    case HOSTED_BRAIN_REQUEST_REFUSAL.OPTIONS_OUT_OF_BOUNDS:
      return failed(MODEL_FAILURE.BOUNDS, "the request options exceed the hosted bounds");
    default:
      return failed(
        MODEL_FAILURE.BOUNDS,
        "input carries an item the hosted service does not replay",
      );
  }
}

/**
 * Carries inferences through Luke's hosted service on the signed-in account.
 * A spent allowance stands the adapter down until the day's counters reset
 * rather than spending refusals on it.
 */
export class HostedModelAdapter extends ResponsesModelAdapter<HostedBrainCapabilities> {
  constructor(options: HostedModelAdapterOptions) {
    super(new HostedTransport(options), options);
  }
}
