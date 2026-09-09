import {
  Emitter,
  type Event,
  type IDisposable,
  isRecord,
  isWireNumber,
  type WireRecord,
  type WireValue,
} from "@sidecar/wire";
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
} from "./protocol.js";
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
  readonly #byKind = new Map<GatewayEventKind, Emitter<GatewayEvent>>();
  readonly #every = new Emitter<GatewayEvent>();
  /** Hears every event of every kind, in sequence, after any gap has been filled. */
  readonly onEvery: Event<GatewayEvent> = this.#every.event;
  #lastSequence = 0;
  /**
   * Whether this client has a baseline in the host's numbering: adopted from
   * a hello, or established by hearing the host's very first event. Without
   * one, a gap is not something to replay — the window before it is the
   * host's past, offers and all, and a client that was not there for it must
   * take the host as it stands now rather than hear it again.
   */
  #baselined = false;
  #reconnecting: Promise<void> | undefined;
  /**
   * Which adoption or reconnection stands. Each begins a new generation and
   * every answer is checked against it when it lands, so a reply from a host
   * since replaced, or a reconnection the adoption superseded, installs
   * nothing.
   */
  #generation = 0;
  /** Events that arrived while a reconnection was in flight, taken again once it has settled. */
  #arrivedDuringReconnect: GatewayEvent[] = [];
  #transportEvents: IDisposable | undefined;

  constructor(options: GatewayClientOptions) {
    this.#options = options;
    this.#transportEvents = options.transport.events((event) => this.#take(event));
  }

  lastSequence(): number {
    return this.#lastSequence;
  }

  /** Ends the subscription; a client not listening reconnects nothing. */
  close(): void {
    this.#transportEvents?.dispose();
    this.#transportEvents = undefined;
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
  on(kind: GatewayEventKind, listener: (event: GatewayEvent) => void): IDisposable {
    const held = this.#byKind.get(kind) ?? new Emitter<GatewayEvent>();
    this.#byKind.set(kind, held);
    return held.event(listener);
  }

  /**
   * Adopts the host now on the other side of the transport as a new stream:
   * a hello reads its sequence and its whole snapshot, the snapshot is handed
   * to the hook, and the cursor moves to that sequence whatever it was
   * before. A replaced host numbers its events from one again, so a cursor
   * carried over from the old host would drop every event of the new one
   * until it caught up; adopting fences that. Events arriving while the hello
   * is out are taken after it, and any at or below the adopted sequence are
   * already in the snapshot. Concurrent callers share one adoption.
   */
  adoptHost(): Promise<void> {
    // An adoption supersedes a reconnection still out: that one was asked of
    // the host this client is leaving, and its answer, whenever it lands,
    // installs nothing.
    this.#generation += 1;
    const generation = this.#generation;
    const adoption: Promise<void> = this.#adoptHostOnce(generation).finally(() => {
      if (this.#reconnecting === adoption) this.#settleReconnect();
    });
    this.#reconnecting = adoption;
    return adoption;
  }

  async #adoptHostOnce(generation: number): Promise<void> {
    const response = await this.#options.transport.request({
      protocolVersion: GATEWAY_PROTOCOL_VERSION,
      id: this.#options.createId(),
      method: GATEWAY_METHOD.HELLO,
      params: {},
    });
    if (generation !== this.#generation) return;
    if (!response.ok) {
      if (response.error.code !== GATEWAY_ERROR.DISCONNECTED) {
        this.#options.report?.(`Gateway hello refused: ${response.error.message}`);
      }
      return;
    }
    const sequence = helloSequence(response.result);
    if (sequence === undefined || !isRecord(response.result)) {
      this.#options.report?.("Gateway hello answered in a shape this client cannot read");
      return;
    }
    this.#lastSequence = sequence;
    this.#baselined = true;
    this.#options.onSnapshot?.(response.result.snapshot ?? {}, sequence);
  }

  /**
   * Asks the host for everything since the last sequence seen. Replayed
   * events are delivered in order as though they had never been missed; a
   * snapshot is adopted through the snapshot hook and the sequence moves to
   * where the host stands. Concurrent callers share one reconnection.
   */
  reconnect(): Promise<void> {
    if (this.#reconnecting) return this.#reconnecting;
    this.#generation += 1;
    const reconnection: Promise<void> = this.#reconnectOnce(this.#generation).finally(() => {
      if (this.#reconnecting === reconnection) this.#settleReconnect();
    });
    this.#reconnecting = reconnection;
    return reconnection;
  }

  /** The adoption or reconnection that stood is over: what arrived meanwhile is taken now, in order. */
  #settleReconnect(): void {
    this.#reconnecting = undefined;
    const arrived = this.#arrivedDuringReconnect.splice(0).sort((a, b) => a.sequence - b.sequence);
    for (const event of arrived) this.#take(event);
  }

  async #reconnectOnce(generation: number): Promise<void> {
    const response = await this.#options.transport.request({
      protocolVersion: GATEWAY_PROTOCOL_VERSION,
      id: this.#options.createId(),
      method: GATEWAY_METHOD.RECONNECT,
      params: { lastSequence: this.#lastSequence },
    });
    if (generation !== this.#generation) return;
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
    if (this.#reconnecting) {
      // Held until the adoption or reconnection settles, whatever its number:
      // during an adoption the cursor is the old host's, and an event of the
      // new host numbered below it is not stale, it is the first of the new
      // stream. Whether it is already in the answer is decided after, against
      // the adopted cursor.
      this.#arrivedDuringReconnect.push(event);
      return;
    }
    if (event.sequence <= this.#lastSequence) return;
    if (event.sequence !== this.#lastSequence + 1) {
      // With a baseline, the gap is filled from the host's own log and the
      // event that showed it arrives inside the replay, in its place. Without
      // one, the host is adopted as it stands: nothing before this client's
      // arrival is replayed to it.
      void (this.#baselined ? this.reconnect() : this.adoptHost());
      return;
    }
    this.#baselined = true;
    this.#deliver(event);
  }

  #deliver(event: GatewayEvent): void {
    this.#lastSequence = event.sequence;
    this.#byKind.get(event.kind)?.fire(event);
    this.#every.fire(event);
  }
}

/** The answer of a `gateway.hello`, read for the sequence the client should start following from. */
export function helloSequence(result: WireValue | undefined): number | undefined {
  return isRecord(result) && isWireNumber(result.sequence) ? result.sequence : undefined;
}

export function unwrapResponse(response: GatewayResponse): GatewayCallResult {
  return response.ok ? { ok: true, result: response.result } : { ok: false, error: response.error };
}
