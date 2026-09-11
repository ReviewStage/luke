import type * as HttpClient from "@effect/platform/HttpClient";
import {
  type AccountCallEffects,
  type AccountToken,
  accountBearer,
  accountCall,
  CALL_FAULT,
  type CallAnswer,
  type CallCredential,
  callAnswered,
  fixedBearer,
  HOSTED_API_ERROR,
  HOSTED_BRAIN_CONTRACT_VERSION,
  HOSTED_SERVICE_PATH,
  type HostedBrainCapabilities,
  hostedBrainCapabilitiesFromWire,
  hostedQuotaSchema,
} from "@sidecar/hosted";
import { MODEL_FAILURE } from "@sidecar/runtime/vocabulary";
import {
  type CloudFetch,
  HTTP_METHOD,
  HTTP_STATUS,
  type HttpMethod,
  text,
  type UnparsedWireValue,
  unparsedWire,
  wireRecord,
} from "@sidecar/wire";
import { layerFromCloudFetch } from "@sidecar/wire/effect";
import { Cause, Effect, Exit, type Layer } from "effect";
import {
  BRAIN_REQUEST_TIMEOUT_MS,
  type Failure,
  failed,
  notServed,
  payloadOf,
  RETRY_AFTER_HEADER,
  rateLimitWaitMs,
  requestFault,
} from "./model-adapter-shared.js";
import type { Quiet } from "./responses-model-adapter.js";

/** What every call out of the brain is addressed and bounded by, whatever authorizes it. */
export interface BrainTransportOptions {
  /** The origin the calls are addressed to; any trailing separator is trimmed. */
  baseUrl: string;
  fetch?: CloudFetch;
  now?: () => number;
  requestTimeoutMs?: number;
}

/** The error's kind alone, as a caller's own cancellation names it, never its words. */
function errorName(cause: unknown): string | undefined {
  return cause instanceof Error ? cause.name : undefined;
}

/**
 * Runs a call effect to its promise answer, over the transport's own
 * `HttpClient`. The caller's cancellation is the run's own interruption
 * rather than a value in the request, so its end is read back here, named by
 * the reason their signal carried, exactly as an aborted fetch named it.
 *
 * @deprecated `BrainTransport#send` is a promise-facing strangler shim on the
 * `Effect.runPromise` allowlist in `docs/adr/0001-effect.md`: it runs the
 * call effect here because every caller still holds a promise, not a fiber.
 * P5-14 moves a turn onto the brain's own runtime, at which point this
 * request runs there instead and `runCall` goes with it.
 */
async function runCall(
  effect: Effect.Effect<CallAnswer, never, HttpClient.HttpClient>,
  client: Layer.Layer<HttpClient.HttpClient>,
  signal: AbortSignal | undefined,
): Promise<CallAnswer> {
  const exit = await Effect.runPromiseExit(Effect.provide(effect, client), {
    ...(signal === undefined ? undefined : { signal }),
  });
  if (Exit.isSuccess(exit)) return exit.value;
  if (signal?.aborted === true && Cause.isInterruptedOnly(exit.cause)) {
    const name = errorName(signal.reason);
    return { fault: CALL_FAULT.NETWORK, ...(name === undefined ? undefined : { errorName: name }) };
  }
  throw Cause.squash(exit.cause);
}

/**
 * One call out of the brain, whatever authorizes it: the account call's own
 * bearer header, renewal, and single retry, with the two readings that are
 * the brain's alone — a fault named as the failure kind the host reads, and
 * what a 429 means. What a factory below supplies is the credential — a key
 * the developer typed, or the signed-in account's token — and the words a
 * quiet is reported with.
 */
export class BrainTransport {
  readonly #call: AccountCallEffects;
  readonly #client: Layer.Layer<HttpClient.HttpClient>;
  readonly #label: string;
  readonly #now: () => number;

  constructor(
    options: BrainTransportOptions & {
      credential: CallCredential;
      /** The words a quiet is reported with, which name the transport the developer is on. */
      label: string;
    },
  ) {
    this.#call = accountCall({
      baseUrl: options.baseUrl,
      credential: options.credential,
      // A turn may read a transcript, reason over it, and act, so the brain
      // asks for its own deadline rather than the ten seconds a settings row
      // would wait.
      requestTimeoutMs: options.requestTimeoutMs ?? BRAIN_REQUEST_TIMEOUT_MS,
    });
    this.#client = layerFromCloudFetch(options.fetch ?? ((input, init) => fetch(input, init)));
    this.#label = options.label;
    this.#now = options.now ?? Date.now;
  }

  /** The deadline every request of this transport is under. */
  get requestTimeoutMs(): number {
    return this.#call.requestTimeoutMs;
  }

  /**
   * One authorized request. A call that never reached the service is already
   * an end, named by kind; every status is the caller's to read, including
   * the refusal that outlived a renewed credential.
   */
  async send(
    path: string,
    method: HttpMethod,
    body?: string,
    signal?: AbortSignal,
  ): Promise<Response | Failure> {
    const answer = await runCall(this.#call.send({ path, method, body }), this.#client, signal);
    if (callAnswered(answer)) return answer.response;
    switch (answer.fault) {
      case CALL_FAULT.NO_CREDENTIAL:
        return failed(MODEL_FAILURE.CREDENTIAL, "no account token");
      case CALL_FAULT.HOLDER_CHANGED:
        return failed(MODEL_FAILURE.CREDENTIAL, "the account changed mid-call");
      case CALL_FAULT.NETWORK:
        return requestFault(answer.errorName);
    }
  }

  /**
   * What a 429 means. The bounded `Retry-After` wait is the floor every
   * transport takes, so a hosted developer and a keyed one wait the same way
   * for the same provider limit; a body naming a later reset — a spent daily
   * allowance — stands the transport down until then instead.
   */
  quietUntil(response: Response, body?: UnparsedWireValue): Quiet {
    const record = wireRecord(unparsedWire(body));
    const quota =
      record?.error === HOSTED_API_ERROR.QUOTA_EXHAUSTED
        ? hostedQuotaSchema.parse(unparsedWire(record.quota))
        : undefined;
    const resetsAt = quota?.resetsAt;
    if (resetsAt !== undefined && resetsAt > this.#now()) {
      return {
        until: resetsAt,
        message: `${this.#label} are out of today's allowance; pausing for ${Math.round((resetsAt - this.#now()) / 1000)}s`,
      };
    }
    const waitMs = rateLimitWaitMs(response.headers.get(RETRY_AFTER_HEADER));
    return {
      until: this.#now() + waitMs,
      message: `${this.#label} are rate limited; pausing for ${Math.round(waitMs / 1000)}s`,
    };
  }

  /** Reads the service's capabilities; a service that has none, or names another contract, is incompatible. */
  async capabilities(): Promise<HostedBrainCapabilities | Failure> {
    const response = await this.send(HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES, HTTP_METHOD.GET);
    if (!(response instanceof Response)) return response;
    if (notServed(response)) {
      return failed(
        MODEL_FAILURE.COMPATIBILITY,
        `the hosted service does not offer brain contract ${HOSTED_BRAIN_CONTRACT_VERSION}`,
      );
    }
    if (response.status === HTTP_STATUS.UNAUTHORIZED) {
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
    return capabilities;
  }
}

/** The developer's own key straight to the provider: one header, one attempt, nothing to renew. */
export function keyedBrainTransport(
  options: BrainTransportOptions & { apiKey: string },
): BrainTransport {
  // Destructured rather than spread: the key travels no further than the one
  // credential that holds it.
  const { apiKey, ...addressed } = options;
  const key = text(apiKey);
  if (!key) throw new Error("OpenAI API key must not be empty");
  return new BrainTransport({
    ...addressed,
    credential: fixedBearer(key),
    label: "OpenAI brain turns",
  });
}

/**
 * Luke's hosted service on the signed-in account, shared by every adapter
 * that speaks to it: the token read fresh per attempt and refreshed once when
 * the first is refused, and the capabilities read that admits an operation.
 */
export function hostedBrainTransport(
  options: BrainTransportOptions & AccountToken,
): BrainTransport {
  return new BrainTransport({
    ...options,
    credential: accountBearer(options),
    label: "Hosted brain turns",
  });
}
