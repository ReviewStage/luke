import {
  GATEWAY_ERROR,
  type GatewayClientIdentity,
  type GatewayErrorCode,
  type GatewayEvent,
  type GatewayRequest,
  type GatewayResponse,
  type GatewayRevision,
  gatewayEventFromWire,
  gatewayRequestFromWire,
  gatewayResponseFromWire,
} from "@sidecar/runtime-contracts";
import type { WireValue } from "@sidecar/wire";
import { eventToWire, type GatewayServer } from "./server.js";

export type GatewayEventSink = (event: GatewayEvent) => void;

/**
 * What a client holds to reach the host: a request that answers, and a
 * subscription to the events the host emits while the transport is up. A
 * transport that is down answers every request with a disconnected error
 * rather than hanging, and drops events, so the client's sequence shows the
 * gap on reconnection.
 */
export interface GatewayTransport {
  request(request: GatewayRequest): Promise<GatewayResponse>;
  events(sink: GatewayEventSink): () => void;
  connected(): boolean;
}

function refusal(
  id: string,
  code: GatewayErrorCode,
  message: string,
  revision: GatewayRevision = { configuration: 0, sequence: 0 },
): GatewayResponse {
  return { id, ok: false, error: { code, message }, revision };
}

/**
 * What every transport bound to a server in this process shares: the
 * server, the client identity every request is handled under, the sinks, one
 * subscription to the server's events, and a connected flag a test flips as
 * a socket closing and reopening would. What differs is how a request and
 * an event cross: directly, or through text.
 */
abstract class ServerBoundTransport implements GatewayTransport {
  protected readonly server: GatewayServer;
  protected readonly identity: GatewayClientIdentity;
  readonly #sinks = new Set<GatewayEventSink>();
  #unsubscribe: (() => void) | undefined;
  #connected = true;

  constructor(server: GatewayServer, identity: GatewayClientIdentity) {
    this.server = server;
    this.identity = identity;
  }

  request(request: GatewayRequest): Promise<GatewayResponse> {
    if (!this.#connected) {
      return Promise.resolve(
        refusal(request.id, GATEWAY_ERROR.DISCONNECTED, "the transport is not connected"),
      );
    }
    return this.carryRequest(request);
  }

  events(sink: GatewayEventSink): () => void {
    this.#sinks.add(sink);
    this.#unsubscribe ??= this.server.subscribe((event) => this.carryEvent(event));
    return () => {
      this.#sinks.delete(sink);
    };
  }

  connected(): boolean {
    return this.#connected;
  }

  /** Takes the transport down or brings it back, as a socket closing and reopening would. */
  setConnected(connected: boolean): void {
    this.#connected = connected;
  }

  /** Ends the transport for good: no request answers and no event is delivered again. */
  close(): void {
    this.#connected = false;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#sinks.clear();
  }

  /** Hands one event, already carried across, to every sink. */
  protected deliver(event: GatewayEvent): void {
    for (const held of [...this.#sinks]) held(event);
  }

  /** Carries a request the connected transport admitted to the server and answers what came back. */
  protected abstract carryRequest(request: GatewayRequest): Promise<GatewayResponse>;

  /** Carries one event the server emitted toward the sinks, or drops it as the wire would. */
  protected abstract carryEvent(event: GatewayEvent): void;
}

/**
 * The transport this build ships: the client and the host in one process,
 * the request handed to the server directly and every event delivered on the
 * same tick it is emitted. Nothing is serialized; the envelopes are already
 * the shapes a socket would carry, and the loopback transport below proves
 * that by carrying them through text.
 */
export class InProcessTransport extends ServerBoundTransport {
  protected carryRequest(request: GatewayRequest): Promise<GatewayResponse> {
    return this.server.handle(request, this.identity);
  }

  protected carryEvent(event: GatewayEvent): void {
    if (this.connected()) this.deliver(event);
  }
}

export interface LoopbackTransportOptions {
  /** Delays each response by this many milliseconds, on the clock given, so a late answer can be tested. */
  responseDelayMs?: number;
  schedule?: (work: () => void, delayMs: number) => void;
}

function throughText(value: WireValue): WireValue {
  // SAFETY: the text is this transport's own serialization of a wire value; parsing it back yields one.
  return JSON.parse(JSON.stringify(value)) as WireValue;
}

/**
 * A test transport that carries every envelope through JSON text and back,
 * exactly as a socket would, and re-parses it with the protocol's own
 * readers on each side: a request the server would not recognize on the
 * wire is refused here too, an answer the client could not read is a
 * malformed answer, and an event that does not parse is dropped. It can be
 * taken down and brought back, and told to drop the next events, so a
 * client's gap detection and reconnection can be exercised.
 */
export class LoopbackTransport extends ServerBoundTransport {
  readonly #options: LoopbackTransportOptions;
  #dropNext = 0;
  /** The events the server emitted while the transport was down, or that were dropped: the gap the client must find. */
  #missed: GatewayEvent[] = [];

  constructor(
    server: GatewayServer,
    identity: GatewayClientIdentity,
    options: LoopbackTransportOptions = {},
  ) {
    super(server, identity);
    this.#options = options;
  }

  protected async carryRequest(request: GatewayRequest): Promise<GatewayResponse> {
    const carried = gatewayRequestFromWire(throughText(requestToWire(request)));
    if (!carried) {
      return refusal(
        request.id,
        GATEWAY_ERROR.INVALID_PARAMS,
        "the request did not survive the wire",
      );
    }
    const response = await this.server.handle(carried, this.identity);
    const delay = this.#options.responseDelayMs ?? 0;
    if (delay > 0) {
      const schedule = this.#options.schedule ?? ((work, ms) => setTimeout(work, ms));
      await new Promise<void>((resolve) => schedule(resolve, delay));
    }
    const parsed = gatewayResponseFromWire(throughText(responseToWire(response)));
    return (
      parsed ??
      refusal(
        request.id,
        GATEWAY_ERROR.INTERNAL,
        "the answer did not survive the wire",
        response.revision,
      )
    );
  }

  protected carryEvent(event: GatewayEvent): void {
    if (!this.connected() || this.#dropNext > 0) {
      if (this.#dropNext > 0) this.#dropNext -= 1;
      this.#missed.push(event);
      return;
    }
    const carried = gatewayEventFromWire(throughText(eventToWire(event)));
    if (carried) this.deliver(carried);
  }

  /** Loses the next `count` events on the wire, as a socket that closed mid-stream would. */
  dropNextEvents(count: number): void {
    this.#dropNext = count;
  }

  /** The events the wire lost, for a test to check the client recovered every one. */
  missed(): readonly GatewayEvent[] {
    return [...this.#missed];
  }
}

function requestToWire(request: GatewayRequest): WireValue {
  return {
    protocolVersion: request.protocolVersion,
    id: request.id,
    method: request.method,
    params: request.params,
    ...(request.idempotencyKey !== undefined
      ? { idempotencyKey: request.idempotencyKey }
      : undefined),
    ...(request.expectedRevision !== undefined
      ? { expectedRevision: { ...request.expectedRevision } }
      : undefined),
  };
}

function responseToWire(response: GatewayResponse): WireValue {
  const revision = {
    configuration: response.revision.configuration,
    sequence: response.revision.sequence,
  };
  return response.ok
    ? {
        id: response.id,
        ok: true,
        ...(response.result !== undefined ? { result: response.result } : undefined),
        revision,
      }
    : { id: response.id, ok: false, error: { ...response.error }, revision };
}
