import {
  GATEWAY_ERROR,
  type GatewayClientIdentity,
  type GatewayEvent,
  type GatewayRequest,
  type GatewayResponse,
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

function disconnected(id: string): GatewayResponse {
  return {
    id,
    ok: false,
    error: { code: GATEWAY_ERROR.DISCONNECTED, message: "the transport is not connected" },
    revision: { configuration: 0, sequence: 0 },
  };
}

/**
 * The transport this build ships: the client and the host in one process,
 * the request handed to the server directly and every event delivered on the
 * same tick it is emitted. Nothing is serialized; the envelopes are already
 * the shapes a socket would carry, and the loopback transport below proves
 * that by carrying them through text.
 */
export class InProcessTransport implements GatewayTransport {
  readonly #server: GatewayServer;
  readonly #identity: GatewayClientIdentity;
  readonly #sinks = new Set<GatewayEventSink>();
  #unsubscribe: (() => void) | undefined;
  #connected = true;

  constructor(server: GatewayServer, identity: GatewayClientIdentity) {
    this.#server = server;
    this.#identity = identity;
  }

  request(request: GatewayRequest): Promise<GatewayResponse> {
    if (!this.#connected) return Promise.resolve(disconnected(request.id));
    return this.#server.handle(request, this.#identity);
  }

  events(sink: GatewayEventSink): () => void {
    this.#sinks.add(sink);
    this.#unsubscribe ??= this.#server.subscribe((event) => {
      if (!this.#connected) return;
      for (const held of [...this.#sinks]) held(event);
    });
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
export class LoopbackTransport implements GatewayTransport {
  readonly #server: GatewayServer;
  readonly #identity: GatewayClientIdentity;
  readonly #options: LoopbackTransportOptions;
  readonly #sinks = new Set<GatewayEventSink>();
  #unsubscribe: (() => void) | undefined;
  #connected = true;
  #dropNext = 0;
  /** The events the server emitted while the transport was down, or that were dropped: the gap the client must find. */
  #missed: GatewayEvent[] = [];

  constructor(
    server: GatewayServer,
    identity: GatewayClientIdentity,
    options: LoopbackTransportOptions = {},
  ) {
    this.#server = server;
    this.#identity = identity;
    this.#options = options;
  }

  async request(request: GatewayRequest): Promise<GatewayResponse> {
    if (!this.#connected) return disconnected(request.id);
    const carried = gatewayRequestFromWire(throughText(requestToWire(request)));
    if (!carried) {
      return {
        id: request.id,
        ok: false,
        error: {
          code: GATEWAY_ERROR.INVALID_PARAMS,
          message: "the request did not survive the wire",
        },
        revision: { configuration: 0, sequence: 0 },
      };
    }
    const response = await this.#server.handle(carried, this.#identity);
    const delay = this.#options.responseDelayMs ?? 0;
    if (delay > 0) {
      const schedule = this.#options.schedule ?? ((work, ms) => setTimeout(work, ms));
      await new Promise<void>((resolve) => schedule(resolve, delay));
    }
    const parsed = gatewayResponseFromWire(throughText(responseToWire(response)));
    if (!parsed) {
      return {
        id: request.id,
        ok: false,
        error: { code: GATEWAY_ERROR.INTERNAL, message: "the answer did not survive the wire" },
        revision: response.revision,
      };
    }
    return parsed;
  }

  events(sink: GatewayEventSink): () => void {
    this.#sinks.add(sink);
    this.#unsubscribe ??= this.#server.subscribe((event) => {
      if (!this.#connected || this.#dropNext > 0) {
        if (this.#dropNext > 0) this.#dropNext -= 1;
        this.#missed.push(event);
        return;
      }
      const carried = gatewayEventFromWire(throughText(eventToWire(event)));
      if (!carried) return;
      for (const held of [...this.#sinks]) held(carried);
    });
    return () => {
      this.#sinks.delete(sink);
    };
  }

  connected(): boolean {
    return this.#connected;
  }

  setConnected(connected: boolean): void {
    this.#connected = connected;
  }

  close(): void {
    this.#connected = false;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#sinks.clear();
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
