import { valueFromJsonText } from "@sidecar/wire";
import type { Effect } from "effect";
import { Runtime } from "effect";
import {
  InvocationMemory,
  NODE_INVOCATION_REFUSAL,
  type NodeInvocationHandler,
  unavailableInvocation,
} from "./invocations.js";
import {
  GATEWAY_ERROR,
  type GatewayClientIdentity,
  type GatewayEvent,
  type GatewayRequest,
  type GatewayResponse,
  gatewayRefusal,
  gatewayRequestToWire,
  gatewayResponseFromWire,
  type NodeCapabilityResult,
  type NodeInvocation,
} from "./protocol.js";
import type { GatewayInProcessConnection, GatewayInProcessHost } from "./server.js";

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

/**
 * What every transport bound to the server's own layers in this process
 * shares: the in-process host, the client identity every request is handled
 * under, the one door the host admitted that client through, the sinks, one
 * listener on the host's event log, and a connected flag a test flips as a
 * socket closing and reopening would. What differs is how a request and an
 * event cross: directly, or through text.
 */
export abstract class ServerBoundTransport implements GatewayTransport {
  protected readonly host: GatewayInProcessHost;
  protected readonly identity: GatewayClientIdentity;
  /** This transport as the host sees it: the connection its requests arrive on and its node is asked through. */
  protected readonly hostConnection: GatewayHostConnection;
  readonly #sinks = new Set<GatewayEventSink>();
  readonly #closedListeners = new Set<() => void>();
  #door: Promise<GatewayInProcessConnection> | undefined;
  #memory: InvocationMemory | undefined;
  #unsubscribe: (() => void) | undefined;
  #connected = true;
  static #connections = 0;

  constructor(host: GatewayInProcessHost, identity: GatewayClientIdentity) {
    this.host = host;
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
        gatewayRefusal(request.id, GATEWAY_ERROR.DISCONNECTED, "the transport is not connected"),
      );
    }
    return this.carryRequest(request);
  }

  events(sink: GatewayEventSink): () => void {
    this.#sinks.add(sink);
    this.#unsubscribe ??= this.host.log.listen((event: GatewayEvent) => this.carryEvent(event));
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
    const door = this.#door;
    this.#door = undefined;
    if (door) void door.then((admitted) => this.run(admitted.close));
  }

  /**
   * Carries one request envelope through the door this client was admitted
   * through, as the text a socket would carry, and reads the answer back
   * with the protocol's own reader.
   */
  protected async handle(request: GatewayRequest): Promise<GatewayResponse> {
    const door = await this.open();
    const frame = await this.run(door.carry(JSON.stringify(gatewayRequestToWire(request))));
    return (
      gatewayResponseFromWire(valueFromJsonText(frame)) ??
      gatewayRefusal(
        request.id,
        GATEWAY_ERROR.INTERNAL,
        "the answer did not survive the wire",
        this.host.log.revision(),
      )
    );
  }

  /**
   * The one door this transport's client is admitted through, opened at the
   * first request and held for the transport's life, so every request of
   * this client arrives on the connection its node was registered on.
   */
  protected open(): Promise<GatewayInProcessConnection> {
    this.#door ??= this.run(
      this.host.protocol.connect({ identity: this.identity, connection: this.hostConnection }),
    );
    return this.#door;
  }

  /**
   * Runs one of the host's own effects on the runtime its layers were built
   * on. This is the boundary: what a transport answers its client with is a
   * promise, so the effects behind it are run here and nowhere deeper.
   *
   * @deprecated A strangler shim on the ADR's allowlist, deleted by P12-09,
   * which decides the edge rule: either `GatewayTransport` answers effects
   * by then and its caller runs them, or this door is recorded there as the
   * boundary it is.
   */
  protected run<A>(effect: Effect.Effect<A>): Promise<A> {
    return Runtime.runPromise(this.host.runtime)(effect);
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
 * the request handed to the protocol's own door and every event delivered on
 * the same tick it is emitted. The loopback transport beside it carries each
 * envelope through the protocol's own readers on both sides as well, which
 * is what proves the two answer alike.
 */
export class InProcessTransport extends ServerBoundTransport {
  protected carryRequest(request: GatewayRequest): Promise<GatewayResponse> {
    return this.handle(request);
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
