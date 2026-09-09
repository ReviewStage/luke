import type { WireValue } from "@sidecar/wire";
import { unavailableInvocation } from "./invocations.js";
import {
  GATEWAY_ERROR,
  type GatewayClientIdentity,
  type GatewayEvent,
  type GatewayRequest,
  type GatewayResponse,
  gatewayEventFromWire,
  gatewayRefusal,
  gatewayRequestFromWire,
  gatewayRequestToWire,
  gatewayResponseFromWire,
  gatewayResponseToWire,
  type NodeCapabilityResult,
  type NodeInvocation,
  nodeCapabilityResultFromWire,
  nodeCapabilityResultToWire,
  nodeInvocationFromWire,
  nodeInvocationToWire,
} from "./protocol.js";
import type { GatewayServer } from "./server.js";
import { eventToWire } from "./server.js";
import { ServerBoundTransport } from "./transport.js";

/**
 * The transport a test carries the protocol over. It is here rather than
 * beside the in-process transport because nothing this build ships composes
 * one: proving that the same protocol answers when every envelope goes
 * through text is the whole of what it is for.
 */

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
    const carried = gatewayRequestFromWire(throughText(gatewayRequestToWire(request)));
    if (!carried) {
      return gatewayRefusal(
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
    const parsed = gatewayResponseFromWire(throughText(gatewayResponseToWire(response)));
    return (
      parsed ??
      gatewayRefusal(
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
