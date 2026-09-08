import { HOSTED_BRAIN_OPERATION, type HostedBrainOperation } from "@sidecar/hosted";
import {
  MODEL_RESPONSE_OUTCOME,
  type ModelAdapter,
  type ModelCapabilities,
  type ModelCapabilitiesAnswer,
  type ModelCompaction,
  type ModelRequestOptions,
  type ModelResponse,
  type ModelTokenCount,
} from "@sidecar/runtime-contracts";
import type { UnparsedWireValue, WireRecord } from "@sidecar/wire";
import {
  type Failure,
  HTTP_STATUS,
  type Normalized,
  payloadOf,
  throttled,
} from "./model-adapter-shared.js";
import { RESPONSES_ITEM_FORMAT } from "./responses-api.js";
import { TOOL_LOOP_RUNTIME } from "./runtime.js";

/**
 * One model adapter over the two transports that speak the Responses item
 * shapes: the developer's own key straight to OpenAI, and Luke's hosted
 * service on the signed-in account. What the two share is everything the
 * host relies on — an inference is held back while the adapter is quiet, a
 * rate limit stands it down for a bounded wait, a request that could not be
 * built or admitted is a failure named by kind, and an answer is read only
 * once its status has been — and what they differ in is the transport: how a
 * request is authorized and addressed, what it is admitted against, how its
 * body is composed, and how each answer is read.
 */

/** The three Responses operations, named as the hosted contract names them; the keyed transport addresses the same three on the provider. Embedding is the embedding adapters' own. */
export const RESPONSES_OPERATION = {
  RESPOND: HOSTED_BRAIN_OPERATION.RESPOND,
  COUNT_TOKENS: HOSTED_BRAIN_OPERATION.COUNT_TOKENS,
  COMPACT: HOSTED_BRAIN_OPERATION.COMPACT,
} as const satisfies Partial<Record<string, HostedBrainOperation>>;
export type ResponsesOperation = (typeof RESPONSES_OPERATION)[keyof typeof RESPONSES_OPERATION];

/** The checkpoint every Responses transport writes: the tool loop over the Responses input array. */
export const RESPONSES_CHECKPOINT = {
  runtime: TOOL_LOOP_RUNTIME.ID,
  runtimeVersion: TOOL_LOOP_RUNTIME.VERSION,
  format: RESPONSES_ITEM_FORMAT.FORMAT,
  formatVersion: RESPONSES_ITEM_FORMAT.VERSION,
} as const;

/** What an operation may be built against once the transport admits it, or the failure that stands in its way. */
export type Admission<Admitted> = { admitted: Admitted } | Failure;

/** One prepared operation: the serialized body to send, and how to read what comes back. */
export interface PreparedOperation<Result> {
  body: string;
  read: (payload: UnparsedWireValue | undefined) => Result;
}

/** How long a throttle stands the adapter down, and the words to report it with. */
export interface Quiet {
  until: number;
  message: string;
}

export interface ResponsesTransport<Admitted> {
  /** The adapter id the capabilities and the trace name. */
  readonly adapter: string;
  /** The model, when the transport knows it before any call. */
  model(): string | undefined;
  /**
   * What an operation is admitted against: nothing to read for a key, the
   * service's capabilities for the hosted tier. Asked without an operation,
   * it is the capabilities read itself.
   */
  admit(operation?: ResponsesOperation): Promise<Admission<Admitted>>;
  capabilitiesOf(admitted: Admitted): Omit<ModelCapabilities, "adapter" | "checkpoint">;
  respond(
    admitted: Admitted,
    items: readonly WireRecord[],
    options: ModelRequestOptions,
  ): PreparedOperation<ModelResponse> | Normalized;
  countInputTokens(
    admitted: Admitted,
    items: readonly WireRecord[],
    options: Pick<ModelRequestOptions, "prompt" | "tools">,
  ): PreparedOperation<ModelTokenCount> | Normalized;
  compact(
    admitted: Admitted,
    items: readonly WireRecord[],
    options: Pick<ModelRequestOptions, "prompt">,
  ): PreparedOperation<ModelCompaction> | Normalized;
  /** One request on the transport's own credential; a response is the adapter's to read, anything else is already an end. */
  request(
    operation: ResponsesOperation,
    body: string,
    signal: AbortSignal | undefined,
  ): Promise<Response | Normalized>;
  /** What a 429 means on this transport. */
  quiet(response: Response): Promise<Quiet>;
  /** A response that is neither ok nor a throttle, named by kind and never by its words. */
  failureFor(response: Response, operation: ResponsesOperation): Failure;
}

export interface ResponsesModelAdapterOptions {
  now?: () => number;
  report?: (message: string) => void;
}

export class ResponsesModelAdapter<Admitted> implements ModelAdapter {
  readonly #transport: ResponsesTransport<Admitted>;
  readonly #now: () => number;
  readonly #report: (message: string) => void;
  #quietUntil = 0;

  constructor(transport: ResponsesTransport<Admitted>, options: ResponsesModelAdapterOptions = {}) {
    this.#transport = transport;
    this.#now = options.now ?? Date.now;
    this.#report = options.report ?? ((message) => process.stderr.write(`${message}\n`));
  }

  get model(): string | undefined {
    return this.#transport.model();
  }

  quietUntil(): number | undefined {
    return this.#quietUntil > this.#now() ? this.#quietUntil : undefined;
  }

  async capabilities(): Promise<ModelCapabilitiesAnswer> {
    const admission = await this.#transport.admit();
    if ("outcome" in admission) return admission;
    return {
      outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
      capabilities: {
        adapter: this.#transport.adapter,
        checkpoint: RESPONSES_CHECKPOINT,
        ...this.#transport.capabilitiesOf(admission.admitted),
      },
    };
  }

  respond(items: readonly WireRecord[], options: ModelRequestOptions): Promise<ModelResponse> {
    return this.#operation(RESPONSES_OPERATION.RESPOND, options.signal, (admitted) =>
      this.#transport.respond(admitted, items, options),
    );
  }

  countInputTokens(
    items: readonly WireRecord[],
    options: Pick<ModelRequestOptions, "prompt" | "tools" | "signal">,
  ): Promise<ModelTokenCount> {
    return this.#operation(RESPONSES_OPERATION.COUNT_TOKENS, options.signal, (admitted) =>
      this.#transport.countInputTokens(admitted, items, options),
    );
  }

  /** The explicit compaction: the whole window the transport answers is the next context, adopted as it came. */
  compact(
    items: readonly WireRecord[],
    options: Pick<ModelRequestOptions, "prompt" | "signal">,
  ): Promise<ModelCompaction> {
    return this.#operation(RESPONSES_OPERATION.COMPACT, options.signal, (admitted) =>
      this.#transport.compact(admitted, items, options),
    );
  }

  async #operation<Result>(
    operation: ResponsesOperation,
    signal: AbortSignal | undefined,
    prepare: (admitted: Admitted) => PreparedOperation<Result> | Normalized,
  ): Promise<Result | Normalized> {
    const quietUntil = this.quietUntil();
    if (quietUntil !== undefined) return throttled(quietUntil);
    const admission = await this.#transport.admit(operation);
    if ("outcome" in admission) return admission;
    const prepared = prepare(admission.admitted);
    if ("outcome" in prepared) return prepared;
    const response = await this.#transport.request(operation, prepared.body, signal);
    if (!(response instanceof Response)) return response;
    if (response.status === HTTP_STATUS.TOO_MANY_REQUESTS) return this.#quiet(response);
    if (!response.ok) return this.#transport.failureFor(response, operation);
    return prepared.read(await payloadOf(response));
  }

  async #quiet(response: Response) {
    const { until, message } = await this.#transport.quiet(response);
    this.#quietUntil = until;
    this.#report(message);
    return throttled(until);
  }
}
