import {
  type AccountToken,
  brainOutputReplayable,
  HOSTED_BRAIN_CONTRACT_VERSION,
  HOSTED_BRAIN_PREFETCH_KIND,
  HOSTED_BRAIN_REQUEST_REFUSAL,
  HOSTED_SERVICE_PATH,
  type HostedBrainCapabilities,
  type HostedBrainRequestRead,
  hostedBrainCountTokensAnswerFromWire,
  hostedBrainCountTokensRequestFromWire,
  hostedBrainPrefetchRequestFromWire,
  hostedBrainRespondRequestFromWire,
  maximumHostedBrainRequestBytes,
  serializedRequestBytes,
} from "@sidecar/hosted";
import { BUILTIN_MODEL_ADAPTER } from "@sidecar/runtime";
import {
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type ModelRequestOptions,
  type ModelResponse,
  type ModelTokenCount,
} from "@sidecar/runtime/vocabulary";
import {
  type CloudFetch,
  HTTP_METHOD,
  HTTP_STATUS,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { type BrainTransport, hostedBrainTransport } from "./client.js";
import { COMPACTION_POLICY } from "./compaction.js";
import {
  type Failure,
  failed,
  type Normalized,
  notServed,
  payloadOf,
} from "./model-adapter-shared.js";
import { responsesModelAnswer } from "./responses-api.js";
import {
  type Admission,
  type PreparedOperation,
  type Quiet,
  RESPONSES_OPERATION,
  type RespondOperation,
  ResponsesModelAdapter,
  type ResponsesOperation,
  type ResponsesTransport,
} from "./responses-model-adapter.js";

export interface HostedModelAdapterOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  fetch?: CloudFetch;
  now?: () => number;
  requestTimeoutMs?: number;
  report?: (message: string) => void;
  /** Which operation this adapter's inferences are: a turn's unless it is built for the prefetch. */
  respondOperation?: RespondOperation;
}

const HOSTED_PATH = {
  [RESPONSES_OPERATION.RESPOND]: HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2,
  [RESPONSES_OPERATION.COUNT_TOKENS]: HOSTED_SERVICE_PATH.BRAIN_COUNT_TOKENS,
  [RESPONSES_OPERATION.PREFETCH]: HOSTED_SERVICE_PATH.BRAIN_PREFETCH,
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
  readonly adapter = BUILTIN_MODEL_ADAPTER.HOSTED;
  readonly #client: BrainTransport;
  readonly #respondOperation: RespondOperation;
  #capabilities: HostedBrainCapabilities | undefined;

  constructor(options: HostedModelAdapterOptions) {
    this.#client = hostedBrainTransport({ ...options, baseUrl: options.serviceBaseUrl });
    this.#respondOperation = options.respondOperation ?? RESPONSES_OPERATION.RESPOND;
  }

  /** The service's model for this adapter's inferences, once capabilities have been read; the service's to know until then. */
  model(): string | undefined {
    return this.#modelOf(this.#capabilities);
  }

  #modelOf(capabilities: HostedBrainCapabilities | undefined): string | undefined {
    if (!capabilities) return undefined;
    return this.#respondOperation === RESPONSES_OPERATION.PREFETCH
      ? capabilities.prefetch?.model
      : capabilities.model;
  }

  /**
   * The prefetch is advertised by its own capabilities field rather than the
   * operations list, so a shipped desktop's fixed reading of that list keeps
   * decoding; a service without the field offers no prefetch, and the
   * incompatibility is answered here, where the planner reads it as no
   * planner rather than as a failure of the brain.
   */
  async admit(operation?: ResponsesOperation): Promise<Admission<HostedBrainCapabilities>> {
    const capabilities = this.#capabilities ?? (await this.#discover());
    if ("outcome" in capabilities) return capabilities;
    const offered =
      operation === RESPONSES_OPERATION.PREFETCH
        ? capabilities.prefetch !== undefined
        : operation === undefined || capabilities.operations.includes(operation);
    if (!offered) {
      return failed(
        MODEL_FAILURE.COMPATIBILITY,
        `the hosted service does not offer the ${operation} operation`,
      );
    }
    return { admitted: capabilities };
  }

  capabilitiesOf(capabilities: HostedBrainCapabilities) {
    return {
      model: this.#modelOf(capabilities) ?? capabilities.model,
      countsInputTokens: capabilities.operations.includes(RESPONSES_OPERATION.COUNT_TOKENS),
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
    operation: RespondOperation,
  ): PreparedOperation<ModelResponse> | Normalized {
    if (operation === RESPONSES_OPERATION.PREFETCH) return this.#prefetch(items, options);
    return prepared(
      hostedBrainRespondRequestFromWire(
        {
          contract: HOSTED_BRAIN_CONTRACT_VERSION,
          prompt: options.prompt,
          tools: options.tools.map((tool) => tool.name),
          options: {
            maximumOutputTokens: options.maximumOutputTokens,
            ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : undefined),
            ...(options.promptCacheKey !== undefined
              ? { promptCacheKey: options.promptCacheKey }
              : undefined),
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

  /**
   * A prefetch inference names its kind and no tool: a forced tool choice is
   * the plan, whose one tool the service selects itself, and no choice is the
   * summary, which the service runs tool-free. Nothing the desktop sends can
   * widen either.
   */
  #prefetch(
    items: readonly WireRecord[],
    options: ModelRequestOptions,
  ): PreparedOperation<ModelResponse> | Normalized {
    return prepared(
      hostedBrainPrefetchRequestFromWire({
        contract: HOSTED_BRAIN_CONTRACT_VERSION,
        kind:
          options.toolChoice === undefined
            ? HOSTED_BRAIN_PREFETCH_KIND.SUMMARIZE
            : HOSTED_BRAIN_PREFETCH_KIND.PLAN,
        prompt: options.prompt,
        options: { maximumOutputTokens: options.maximumOutputTokens },
        input: items,
      }),
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

  request(
    operation: ResponsesOperation,
    body: string,
    signal: AbortSignal | undefined,
  ): Promise<Response | Normalized> {
    return this.#client.send(HOSTED_PATH[operation], HTTP_METHOD.POST, body, signal);
  }

  /**
   * Two quiets wear the same status, so the answer's own body is what tells
   * a spent daily allowance from the provider rate limiting behind the
   * service. Reading it is the transport's.
   */
  async quiet(response: Response): Promise<Quiet> {
    return this.#client.quietUntil(response, await payloadOf(response));
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
    const capabilities = await this.#client.capabilities();
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
