import {
  GATEWAY_ERROR,
  GATEWAY_METHOD,
  GATEWAY_PROTOCOL_VERSION,
  GATEWAY_RECONNECT_KIND,
  type GatewayError,
  type GatewayEvent,
  type GatewayEventKind,
  type GatewayExpectedRevision,
  type GatewayMethod,
  type GatewayReconnectAnswer,
  type GatewayRequest,
  type GatewayResponse,
  gatewayReconnectAnswerFromWire,
  isMutatingGatewayMethod,
} from "@sidecar/runtime-contracts";
import { isRecord, isWireNumber, type WireRecord, type WireValue } from "@sidecar/wire";
import type { GatewayTransport } from "./transport.js";

export interface GatewayClientOptions {
  transport: GatewayTransport;
  createId: () => string;
  /** Adopts a whole snapshot the host handed back because the replay window had moved past what this client saw. */
  onSnapshot?: (snapshot: WireValue, sequence: number) => void;
  report?: (message: string) => void;
}

export interface GatewayCallOptions {
  /** The caller's own retry identifier for a mutation; minted here when the caller supplies none. */
  idempotencyKey?: string;
  expectedRevision?: GatewayExpectedRevision;
}

/** A call's answer as the client hands it on: the result, or the typed error. */
export type GatewayCallResult =
  | { ok: true; result: WireValue | undefined }
  | { ok: false; error: GatewayError };

export type GatewayClientEventListener = (event: GatewayEvent) => void;

/**
 * The client side of the protocol. It mints request ids, stamps the version,
 * supplies an idempotency key to every mutation the caller did not key
 * itself, and follows the event sequence: an event that does not follow the
 * last one by exactly one is a gap, and a gap is answered by asking the host
 * for a reconnection from the last sequence seen, which replays what was
 * missed or hands back a snapshot to adopt whole. Nothing is skipped
 * silently. The same reconnection runs when the transport comes back.
 */
export class GatewayClient {
  readonly #options: GatewayClientOptions;
  readonly #listeners = new Map<GatewayEventKind, Set<GatewayClientEventListener>>();
  readonly #everyListener = new Set<GatewayClientEventListener>();
  #lastSequence = 0;
  #reconnecting: Promise<void> | undefined;
  /** Events that arrived while a reconnection was in flight, taken again once it has settled. */
  #arrivedDuringReconnect: GatewayEvent[] = [];
  #unsubscribe: (() => void) | undefined;

  constructor(options: GatewayClientOptions) {
    this.#options = options;
    this.#unsubscribe = options.transport.events((event) => this.#take(event));
  }

  lastSequence(): number {
    return this.#lastSequence;
  }

  /** Ends the subscription; a client not listening reconnects nothing. */
  close(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }

  async call(
    method: GatewayMethod,
    params: WireRecord = {},
    options: GatewayCallOptions = {},
  ): Promise<GatewayCallResult> {
    const request: GatewayRequest = {
      protocolVersion: GATEWAY_PROTOCOL_VERSION,
      id: this.#options.createId(),
      method,
      params,
      ...(isMutatingGatewayMethod(method)
        ? { idempotencyKey: options.idempotencyKey ?? this.#options.createId() }
        : options.idempotencyKey !== undefined
          ? { idempotencyKey: options.idempotencyKey }
          : undefined),
      ...(options.expectedRevision ? { expectedRevision: options.expectedRevision } : undefined),
    };
    const response = await this.#options.transport.request(request);
    return response.ok
      ? { ok: true, result: response.result }
      : { ok: false, error: response.error };
  }

  /** Hears every event of one kind, in sequence, after any gap has been filled. */
  on(kind: GatewayEventKind, listener: GatewayClientEventListener): () => void {
    const held = this.#listeners.get(kind) ?? new Set<GatewayClientEventListener>();
    held.add(listener);
    this.#listeners.set(kind, held);
    return () => {
      held.delete(listener);
    };
  }

  onEvery(listener: GatewayClientEventListener): () => void {
    this.#everyListener.add(listener);
    return () => {
      this.#everyListener.delete(listener);
    };
  }

  /**
   * Asks the host for everything since the last sequence seen. Replayed
   * events are delivered in order as though they had never been missed; a
   * snapshot is adopted through the snapshot hook and the sequence moves to
   * where the host stands. Concurrent callers share one reconnection.
   */
  reconnect(): Promise<void> {
    this.#reconnecting ??= this.#reconnectOnce().finally(() => {
      this.#reconnecting = undefined;
      const arrived = this.#arrivedDuringReconnect
        .splice(0)
        .sort((a, b) => a.sequence - b.sequence);
      for (const event of arrived) this.#take(event);
    });
    return this.#reconnecting;
  }

  async #reconnectOnce(): Promise<void> {
    const response = await this.#options.transport.request({
      protocolVersion: GATEWAY_PROTOCOL_VERSION,
      id: this.#options.createId(),
      method: GATEWAY_METHOD.RECONNECT,
      params: { lastSequence: this.#lastSequence },
    });
    if (!response.ok) {
      if (response.error.code !== GATEWAY_ERROR.DISCONNECTED) {
        this.#options.report?.(`Gateway reconnection refused: ${response.error.message}`);
      }
      return;
    }
    const answer = gatewayReconnectAnswerFromWire(response.result);
    if (!answer) {
      this.#options.report?.("Gateway reconnection answered in a shape this client cannot read");
      return;
    }
    this.#adopt(answer);
  }

  #adopt(answer: GatewayReconnectAnswer): void {
    if (answer.kind === GATEWAY_RECONNECT_KIND.SNAPSHOT) {
      this.#lastSequence = answer.sequence;
      this.#options.onSnapshot?.(answer.snapshot, answer.sequence);
      return;
    }
    for (const event of answer.events) {
      if (event.sequence <= this.#lastSequence) continue;
      this.#deliver(event);
    }
  }

  #take(event: GatewayEvent): void {
    if (event.sequence <= this.#lastSequence) return;
    if (this.#reconnecting) {
      // The host answered the reconnection from where it stood when asked;
      // an event emitted since is not in that answer and must not wait for
      // a later gap to surface it.
      this.#arrivedDuringReconnect.push(event);
      return;
    }
    if (event.sequence !== this.#lastSequence + 1) {
      // The gap is filled first, from the host's own log; the event that
      // showed it arrives inside the replay, in its place.
      void this.reconnect();
      return;
    }
    this.#deliver(event);
  }

  #deliver(event: GatewayEvent): void {
    this.#lastSequence = event.sequence;
    for (const listener of [...(this.#listeners.get(event.kind) ?? [])]) listener(event);
    for (const listener of [...this.#everyListener]) listener(event);
  }
}

/** The answer of a `gateway.hello`, read for the sequence the client should start following from. */
export function helloSequence(result: WireValue | undefined): number | undefined {
  return isRecord(result) && isWireNumber(result.sequence) ? result.sequence : undefined;
}

export function unwrapResponse(response: GatewayResponse): GatewayCallResult {
  return response.ok ? { ok: true, result: response.result } : { ok: false, error: response.error };
}
