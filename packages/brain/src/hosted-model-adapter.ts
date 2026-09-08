import {
  brainOutputReplayable,
  HOSTED_API_ERROR,
  HOSTED_BRAIN_CONTRACT_VERSION,
  HOSTED_BRAIN_OPERATION,
  HOSTED_BRAIN_REQUEST_REFUSAL,
  HOSTED_SERVICE_PATH,
  type HostedBrainCapabilities,
  type HostedBrainCompactRequest,
  type HostedBrainCountTokensRequest,
  type HostedBrainRespondRequest,
  hostedBrainCapabilitiesFromWire,
  hostedBrainCompactRequestFromWire,
  hostedBrainCountTokensAnswerFromWire,
  hostedBrainCountTokensRequestFromWire,
  hostedBrainRespondRequestFromWire,
  hostedQuotaFromWire,
  maximumHostedBrainRequestBytes,
  serializedRequestBytes,
} from "@sidecar/hosted";
import {
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type ModelAdapter,
  type ModelCapabilitiesAnswer,
  type ModelCompaction,
  type ModelRequestOptions,
  type ModelResponse,
  type ModelTokenCount,
} from "@sidecar/runtime-contracts";
import {
  positiveInteger,
  text,
  type UnparsedWireValue,
  unparsedWire,
  type WireRecord,
  wireRecord,
} from "@sidecar/wire";
import {
  type FetchLike,
  failed,
  RATE_LIMIT_STATUS,
  RETRY_AFTER_HEADER,
  rateLimitWaitMs,
  requestSignal,
  throttled,
  UNAUTHORIZED_STATUS,
  withoutTrailingSlash,
} from "./model-adapter-shared.js";
import { BRAIN_OPENAI_DEFAULTS } from "./openai-model-adapter.js";
import {
  RESPONSES_ITEM_FORMAT,
  responsesCompactedWindow,
  responsesModelAnswer,
} from "./responses-api.js";
import { TOOL_LOOP_RUNTIME } from "./runtime.js";

export const HOSTED_MODEL_ADAPTER_ID = "hosted-responses";

export interface HostedModelAdapterOptions {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  readAccessToken: () => Promise<string | undefined>;
  refreshAccount: () => Promise<void>;
  fetch?: FetchLike;
  now?: () => number;
  requestTimeoutMs?: number;
  report?: (message: string) => void;
}

type Normalized = ReturnType<typeof failed> | ReturnType<typeof throttled>;

/**
 * Carries inferences through Luke's hosted service on the signed-in account,
 * for a developer with no OpenAI key of their own, speaking the second
 * hosted brain contract and nothing older. Before the first call it reads
 * the service's capabilities — the model, the operations, the registered
 * tool names, the bounds — and every request is admitted against them here
 * exactly as the service admits it there, so a service that lacks the
 * contract, an operation, or a tool is an explicit compatibility failure
 * rather than a fall back to the shape an installed client still speaks.
 * A spent allowance stands the adapter down until the day's counters reset
 * rather than spending refusals on it.
 */
export class HostedModelAdapter implements ModelAdapter {
  readonly #baseUrl: string;
  readonly #readAccessToken: () => Promise<string | undefined>;
  readonly #refreshAccount: () => Promise<void>;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  readonly #report: (message: string) => void;
  #quietUntil = 0;
  #capabilities: HostedBrainCapabilities | undefined;

  constructor(options: HostedModelAdapterOptions) {
    const baseUrl = text(options.serviceBaseUrl);
    if (!baseUrl) throw new Error("Hosted service base URL must not be empty");
    this.#baseUrl = withoutTrailingSlash(baseUrl);
    this.#readAccessToken = options.readAccessToken;
    this.#refreshAccount = options.refreshAccount;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      BRAIN_OPENAI_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
    this.#report = options.report ?? ((message) => process.stderr.write(`${message}\n`));
  }

  /** The service's model, once capabilities have been read; the service's to know until then. */
  get model(): string | undefined {
    return this.#capabilities?.model;
  }

  quietUntil(): number | undefined {
    return this.#quietUntil > this.#now() ? this.#quietUntil : undefined;
  }

  async capabilities(): Promise<ModelCapabilitiesAnswer> {
    const read = await this.#discover();
    if (!("contract" in read)) return read;
    return {
      outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
      capabilities: {
        adapter: HOSTED_MODEL_ADAPTER_ID,
        model: read.model,
        checkpoint: {
          runtime: TOOL_LOOP_RUNTIME.ID,
          runtimeVersion: TOOL_LOOP_RUNTIME.VERSION,
          format: RESPONSES_ITEM_FORMAT.FORMAT,
          formatVersion: RESPONSES_ITEM_FORMAT.VERSION,
        },
        countsInputTokens: read.operations.includes(HOSTED_BRAIN_OPERATION.COUNT_TOKENS),
        compacts: read.operations.includes(HOSTED_BRAIN_OPERATION.COMPACT),
        maximumOutputTokens: read.bounds.maximumOutputTokens,
        tools: read.tools,
      },
    };
  }

  async respond(
    items: readonly WireRecord[],
    options: ModelRequestOptions,
  ): Promise<ModelResponse> {
    const quietUntil = this.quietUntil();
    if (quietUntil !== undefined) return throttled(quietUntil);
    const capabilities = await this.#discover();
    if (!("contract" in capabilities)) return capabilities;
    if (!capabilities.operations.includes(HOSTED_BRAIN_OPERATION.RESPOND)) {
      return unsupported(HOSTED_BRAIN_OPERATION.RESPOND);
    }
    const catalog = new Set(capabilities.tools);
    const read = hostedBrainRespondRequestFromWire(
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
      catalog,
    );
    if (!read.ok) return refusedLocally(read.refusal);
    const answer = await this.#send(
      HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2,
      read.request,
      options.signal,
    );
    if (!("payload" in answer)) return answer;
    // An answer is refused whole before the host acts on any call in it or
    // keeps any item of it, when it carries an item this path could not send
    // back next turn: kept, it would poison every later hosted turn of the
    // generation, and the service has already refused to answer such a thing.
    if (!brainOutputReplayable(answer.payload)) {
      return failed(
        MODEL_FAILURE.MALFORMED,
        "response carried an item the hosted service cannot replay",
      );
    }
    return (
      responsesModelAnswer(answer.payload) ??
      failed(MODEL_FAILURE.MALFORMED, "response carried no output")
    );
  }

  async countInputTokens(
    items: readonly WireRecord[],
    options: Pick<ModelRequestOptions, "prompt" | "tools" | "signal">,
  ): Promise<ModelTokenCount> {
    const quietUntil = this.quietUntil();
    if (quietUntil !== undefined) return throttled(quietUntil);
    const capabilities = await this.#discover();
    if (!("contract" in capabilities)) return capabilities;
    if (!capabilities.operations.includes(HOSTED_BRAIN_OPERATION.COUNT_TOKENS)) {
      return unsupported(HOSTED_BRAIN_OPERATION.COUNT_TOKENS);
    }
    const read = hostedBrainCountTokensRequestFromWire(
      {
        contract: HOSTED_BRAIN_CONTRACT_VERSION,
        prompt: options.prompt,
        tools: options.tools.map((tool) => tool.name),
        input: items,
      },
      new Set(capabilities.tools),
    );
    if (!read.ok) return refusedLocally(read.refusal);
    const answer = await this.#send(
      HOSTED_SERVICE_PATH.BRAIN_COUNT_TOKENS,
      read.request,
      options.signal,
    );
    if (!("payload" in answer)) return answer;
    const count = hostedBrainCountTokensAnswerFromWire(answer.payload);
    return count
      ? { outcome: MODEL_RESPONSE_OUTCOME.ANSWERED, inputTokens: count.inputTokens }
      : failed(MODEL_FAILURE.MALFORMED, "count carried no inputTokens");
  }

  async compact(
    items: readonly WireRecord[],
    options: Pick<ModelRequestOptions, "prompt" | "signal">,
  ): Promise<ModelCompaction> {
    const quietUntil = this.quietUntil();
    if (quietUntil !== undefined) return throttled(quietUntil);
    const capabilities = await this.#discover();
    if (!("contract" in capabilities)) return capabilities;
    if (!capabilities.operations.includes(HOSTED_BRAIN_OPERATION.COMPACT)) {
      return unsupported(HOSTED_BRAIN_OPERATION.COMPACT);
    }
    const read = hostedBrainCompactRequestFromWire({
      contract: HOSTED_BRAIN_CONTRACT_VERSION,
      prompt: options.prompt,
      input: items,
    });
    if (!read.ok) return refusedLocally(read.refusal);
    const answer = await this.#send(
      HOSTED_SERVICE_PATH.BRAIN_COMPACT,
      read.request,
      options.signal,
    );
    if (!("payload" in answer)) return answer;
    if (!brainOutputReplayable(answer.payload)) {
      return failed(
        MODEL_FAILURE.MALFORMED,
        "compaction carried an item the hosted service cannot replay",
      );
    }
    const window = responsesCompactedWindow(answer.payload);
    return window
      ? { outcome: MODEL_RESPONSE_OUTCOME.ANSWERED, items: window }
      : failed(MODEL_FAILURE.MALFORMED, "compaction carried no output");
  }

  /** Reads the capabilities once per adapter; a service that has none, or names another contract, is incompatible. */
  async #discover(): Promise<HostedBrainCapabilities | ReturnType<typeof failed>> {
    if (this.#capabilities) return this.#capabilities;
    const token = await this.#readAccessToken();
    if (!token) return failed(MODEL_FAILURE.CREDENTIAL, "no account token");
    let response = await this.#request(HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES, "GET", token);
    if (response?.status === UNAUTHORIZED_STATUS) {
      response = await this.#retryRefreshed(
        token,
        (refreshed) => this.#request(HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES, "GET", refreshed),
        response,
      );
    }
    if (!response) return failed(MODEL_FAILURE.NETWORK, "capabilities request did not complete");
    if (response.status === 404 || response.status === 405) {
      return failed(
        MODEL_FAILURE.COMPATIBILITY,
        `the hosted service does not offer brain contract ${HOSTED_BRAIN_CONTRACT_VERSION}`,
      );
    }
    if (response.status === UNAUTHORIZED_STATUS) {
      return failed(MODEL_FAILURE.CREDENTIAL, "the account token was refused");
    }
    if (!response.ok) {
      return failed(MODEL_FAILURE.UPSTREAM, `capabilities failed with status ${response.status}`);
    }
    const capabilities = hostedBrainCapabilitiesFromWire(await payloadOf(response));
    if (!capabilities) {
      return failed(
        MODEL_FAILURE.COMPATIBILITY,
        `the hosted service's capabilities are not brain contract ${HOSTED_BRAIN_CONTRACT_VERSION}`,
      );
    }
    this.#capabilities = capabilities;
    return capabilities;
  }

  async #send(
    path: string,
    request: HostedBrainRespondRequest | HostedBrainCountTokensRequest | HostedBrainCompactRequest,
    signal: AbortSignal | undefined,
  ): Promise<{ payload: UnparsedWireValue } | Normalized> {
    // The same admission the service runs, before the token is even read: an
    // oversized request is an explicit bounded failure here rather than a
    // truncation or a retry, so the host reports it and rolls the turn back.
    const serialized = JSON.stringify(request);
    if (serializedRequestBytes(serialized) > maximumHostedBrainRequestBytes) {
      return failed(MODEL_FAILURE.BOUNDS, "request exceeds the hosted request size bound");
    }
    const token = await this.#readAccessToken();
    if (!token) return failed(MODEL_FAILURE.CREDENTIAL, "no account token");
    let response = await this.#request(path, "POST", token, serialized, signal);
    if (response?.status === UNAUTHORIZED_STATUS) {
      response = await this.#retryRefreshed(
        token,
        (refreshed) => this.#request(path, "POST", refreshed, serialized, signal),
        response,
      );
    }
    if (!response) return failed(MODEL_FAILURE.NETWORK, "request did not complete");
    if (response.status === RATE_LIMIT_STATUS) return this.#quiet(response);
    if (response.status === UNAUTHORIZED_STATUS) {
      return failed(MODEL_FAILURE.CREDENTIAL, "the account token was refused");
    }
    if (response.status === 404 || response.status === 405) {
      return failed(MODEL_FAILURE.COMPATIBILITY, `the hosted service does not serve ${path}`);
    }
    if (!response.ok) {
      return failed(
        MODEL_FAILURE.UPSTREAM,
        `hosted brain call failed with status ${response.status}`,
      );
    }
    return { payload: await payloadOf(response) };
  }

  /** Routine expiry of an hour-lived token inside a day-lived app: refresh and retry once, like the hosted mint. */
  async #retryRefreshed(
    token: string,
    retry: (refreshed: string) => Promise<Response | undefined>,
    original: Response,
  ): Promise<Response | undefined> {
    await this.#refreshAccount().catch(() => undefined);
    const refreshed = await this.#readAccessToken();
    if (refreshed && refreshed !== token) return retry(refreshed);
    return original;
  }

  async #request(
    path: string,
    method: "GET" | "POST",
    token: string,
    body?: string,
    signal?: AbortSignal,
  ): Promise<Response | undefined> {
    try {
      return await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "content-type": "application/json" } : undefined),
        },
        ...(body !== undefined ? { body } : undefined),
        signal: requestSignal(this.#requestTimeoutMs, signal),
      });
    } catch {
      return undefined;
    }
  }

  /**
   * Two quiets wear the same status. A spent allowance names the day's reset
   * in its quota and stands the adapter down until then; the provider rate
   * limiting behind the service names a bounded wait in `Retry-After`, or
   * earns the same fixed cooldown the keyed adapter takes, so a hosted
   * developer and a keyed one wait the same way for the same limit.
   */
  async #quiet(response: Response) {
    const record = wireRecord(unparsedWire(await payloadOf(response)));
    const quota =
      record?.error === HOSTED_API_ERROR.QUOTA_EXHAUSTED
        ? hostedQuotaFromWire(unparsedWire(record.quota))
        : undefined;
    const resetsAt = quota?.resetsAt;
    if (resetsAt !== undefined && resetsAt > this.#now()) {
      this.#quietUntil = resetsAt;
      this.#report(
        `Hosted brain turns are out of today's allowance; pausing for ${Math.round((resetsAt - this.#now()) / 1000)}s`,
      );
      return throttled(this.#quietUntil);
    }
    const waitMs = rateLimitWaitMs(response.headers.get(RETRY_AFTER_HEADER));
    this.#quietUntil = this.#now() + waitMs;
    this.#report(`Hosted brain turns are rate limited; pausing for ${Math.round(waitMs / 1000)}s`);
    return throttled(this.#quietUntil);
  }
}

function unsupported(operation: string) {
  return failed(
    MODEL_FAILURE.COMPATIBILITY,
    `the hosted service does not offer the ${operation} operation`,
  );
}

/** A request this adapter itself would not send: worded as the service would refuse it. */
function refusedLocally(refusal: string) {
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

async function payloadOf(response: Response): Promise<UnparsedWireValue> {
  try {
    // SAFETY: response.json returns a runtime value; every reader validates it as wire.
    return (await response.json()) as UnparsedWireValue;
  } catch {
    return undefined;
  }
}
