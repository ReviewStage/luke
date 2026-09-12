import type { WireValue } from "@sidecar/wire";
import { Effect, Exit, Runtime, Scope } from "effect";
import { unavailableInvocation } from "./invocations.js";
import {
  GATEWAY_ERROR,
  type GatewayClientIdentity,
  type GatewayEvent,
  type GatewayEventKind,
  type GatewayRequest,
  type GatewayResponse,
  gatewayEventFromWire,
  gatewayEventToWire,
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
import {
  type GatewayInProcessHost,
  type GatewayServerLayerOptions,
  gatewayInProcessHost,
} from "./server.js";
import { ServerBoundTransport } from "./transport.js";

/** What a test composes an in-process host over: the server's own layer options, with the method table a host writes. */
export type GatewayTestHostOptions = GatewayServerLayerOptions;

/** An in-process host a test holds, and the close of the scope its layers were built in. */
export interface GatewayTestHost extends GatewayInProcessHost {
  /** Appends one event to the log, as the host's own callback surfaces do, and answers what was numbered. */
  readonly emit: (
    kind: GatewayEventKind,
    payload: WireValue,
    identity?: { sessionKey?: string; runId?: string },
  ) => GatewayEvent;
  /** Closes the door to new work, as the quit does: every mutation but the shutdown is refused from here on. */
  readonly closeAdmissions: () => void;
  /** Lets the layers and the server's fiber go; nothing answers after this. */
  readonly dispose: () => Promise<void>;
}

/**
 * The in-process host a test composes: `layerGatewayInProcess` built in a
 * scope of this harness's own, so a test holds the log, the admissions door,
 * and the protocol's door without a process that owns them.
 *
 * @deprecated A strangler shim on the ADR's allowlist, deleted by P12-09:
 * the runs here are the test's own edge while this package's suites are
 * plain `test` bodies, and they go when those suites are written on
 * `it.effect` and build the layers in the test's own scope.
 */
export async function gatewayTestHost(options: GatewayTestHostOptions): Promise<GatewayTestHost> {
  const scope = Effect.runSync(Scope.make());
  const host = await Effect.runPromise(
    Effect.provideService(gatewayInProcessHost(options), Scope.Scope, scope),
  );
  return {
    ...host,
    emit: (kind, payload, identity) =>
      Runtime.runSync(host.runtime)(host.log.emit(kind, payload, identity)),
    closeAdmissions: () => Runtime.runSync(host.runtime)(host.admissions.close),
    dispose: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
}

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
    host: GatewayInProcessHost,
    identity: GatewayClientIdentity,
    options: TextLoopbackTransportOptions = {},
  ) {
    super(host, identity);
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
    const response = await this.handle(carried);
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
    const carried = gatewayEventFromWire(throughText(gatewayEventToWire(event)));
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
