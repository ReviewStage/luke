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
  type NodeCapabilityResult,
  type NodeInvocation,
  nodeCapabilityResultFromWire,
  nodeCapabilityResultToWire,
  nodeInvocationFromWire,
  nodeInvocationToWire,
} from "@sidecar/runtime-contracts";
import type { WireValue } from "@sidecar/wire";
import {
  InvocationMemory,
  NODE_INVOCATION_REFUSAL,
  type NodeInvocationHandler,
  unavailableInvocation,
} from "./invocations.js";
import type { GatewayServer } from "./server.js";
import { eventToWire } from "./server.js";

export type GatewayEventSink = (event: GatewayEvent) => void;

/**
 * What a client holds to reach the host: a request that answers, and a
 * subscription to the events the host emits while the transport is up. A
 * transport that is down answers every request with a disconnected error
 * rather than hanging, and drops events, so the client's sequence shows the
 * gap on reconnection. A transport may also carry the host's asks the other
 * way — the invocations of the node capabilities this client registered —
 * on this same connection and no other; one that cannot serves none.
 */
export interface GatewayTransport {
  request(request: GatewayRequest): Promise<GatewayResponse>;
  events(sink: GatewayEventSink): () => void;
  connected(): boolean;
  /** Serves the host's invocations of this client's node capabilities, deduped by id before anything native runs. */
  serveInvocations?(handler: NodeInvocationHandler): () => void;
}

/**
 * The connection a request arrived on, as the host sees it: the one place the
 * host may send a node invocation back to, and the thing whose closing makes
 * every capability registered on it unavailable. A method handler that
 * registers a node keeps this, never the client's identity alone, so an
 * invocation is bound to the authenticated connection that offered the
 * capability and an answer from any other connection lands nowhere.
 */
export interface GatewayHostConnection {
  connectionId: string;
  invoke(invocation: NodeInvocation): Promise<NodeCapabilityResult>;
  onClosed(listener: () => void): () => void;
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
  /** This transport as the host sees it: the connection its requests arrive on and its node is asked through. */
  protected readonly hostConnection: GatewayHostConnection;
  readonly #sinks = new Set<GatewayEventSink>();
  readonly #closedListeners = new Set<() => void>();
  #memory: InvocationMemory | undefined;
  #unsubscribe: (() => void) | undefined;
  #connected = true;
  static #connections = 0;

  constructor(server: GatewayServer, identity: GatewayClientIdentity) {
    this.server = server;
    this.identity = identity;
    ServerBoundTransport.#connections += 1;
    this.hostConnection = {
      connectionId: `in-process-${ServerBoundTransport.#connections}`,
      invoke: (invocation) => this.#invoke(invocation),
      onClosed: (listener) => {
        this.#closedListeners.add(listener);
        return () => {
          this.#closedListeners.delete(listener);
        };
      },
    };
  }

  serveInvocations(handler: NodeInvocationHandler): () => void {
    const memory = new InvocationMemory(handler);
    this.#memory = memory;
    return () => {
      if (this.#memory === memory) this.#memory = undefined;
    };
  }

  async #invoke(invocation: NodeInvocation): Promise<NodeCapabilityResult> {
    if (!this.#connected) {
      return unavailableInvocation(invocation, NODE_INVOCATION_REFUSAL.DISCONNECTED);
    }
    const memory = this.#memory;
    if (!memory) return unavailableInvocation(invocation, NODE_INVOCATION_REFUSAL.NOT_SERVING);
    return this.carryInvocation(invocation, (carried) => memory.take(carried));
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

  /** Ends the transport for good: no request answers, no event is delivered, and the host hears the connection close. */
  close(): void {
    this.#connected = false;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#sinks.clear();
    for (const listener of [...this.#closedListeners]) listener();
    this.#closedListeners.clear();
  }

  /** Hands one event, already carried across, to every sink. */
  protected deliver(event: GatewayEvent): void {
    for (const held of [...this.#sinks]) held(event);
  }

  /** Carries a request the connected transport admitted to the server and answers what came back. */
  protected abstract carryRequest(request: GatewayRequest): Promise<GatewayResponse>;

  /** Carries one event the server emitted toward the sinks, or drops it as the wire would. */
  protected abstract carryEvent(event: GatewayEvent): void;

  /** Carries one invocation to the served node and its answer back, as the wire would. */
  protected abstract carryInvocation(
    invocation: NodeInvocation,
    take: (invocation: NodeInvocation) => Promise<{ result: NodeCapabilityResult }>,
  ): Promise<NodeCapabilityResult>;
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
    return this.server.handle(request, this.identity, this.hostConnection);
  }

  protected carryEvent(event: GatewayEvent): void {
    if (this.connected()) this.deliver(event);
  }

  protected async carryInvocation(
    invocation: NodeInvocation,
    take: (invocation: NodeInvocation) => Promise<{ result: NodeCapabilityResult }>,
  ): Promise<NodeCapabilityResult> {
    return (await take(invocation)).result;
  }
}

export interface TextLoopbackTransportOptions {
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
export class TextLoopbackTransport extends ServerBoundTransport {
  readonly #options: TextLoopbackTransportOptions;
  #dropNext = 0;
  #repeatNextInvocation = 0;
  /** The events the server emitted while the transport was down, or that were dropped: the gap the client must find. */
  #missed: GatewayEvent[] = [];

  constructor(
    server: GatewayServer,
    identity: GatewayClientIdentity,
    options: TextLoopbackTransportOptions = {},
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
    const response = await this.server.handle(carried, this.identity, this.hostConnection);
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

  protected async carryInvocation(
    invocation: NodeInvocation,
    take: (invocation: NodeInvocation) => Promise<{ result: NodeCapabilityResult }>,
  ): Promise<NodeCapabilityResult> {
    const carried = nodeInvocationFromWire(throughText(nodeInvocationToWire(invocation)));
    if (!carried) {
      return unavailableInvocation(invocation, "the invocation did not survive the wire");
    }
    // Delivered as many times as a test asked, so a node's dedupe is exercised
    // on a frame the wire repeated while the first was still performing.
    const takes = Array.from({ length: 1 + this.#repeatNextInvocation }, () => take(carried));
    this.#repeatNextInvocation = 0;
    const answered = (await Promise.all(takes))[0];
    if (!answered) return unavailableInvocation(invocation, "the node answered nothing");
    const parsed = nodeCapabilityResultFromWire(
      throughText(nodeCapabilityResultToWire(answered.result)),
    );
    return parsed ?? unavailableInvocation(invocation, "the answer did not survive the wire");
  }

  /** Delivers the next invocation `count` extra times, as a wire that repeated a frame would. */
  repeatNextInvocation(count: number): void {
    this.#repeatNextInvocation = count;
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
