import {
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayEventKind,
  type GatewayMethodContext,
  type GatewayMethodHandler,
  type GatewayMethodTable,
  type GatewayRefusal,
  invalid,
  NODE_CAPABILITY_STATUS,
  NodeRegistry,
  nodeSnapshotToWire,
  RefusedRefusal,
} from "@sidecar/gateway";
import {
  type GatewayInProcessHost,
  type GatewayServerLayerOptions,
  gatewayInProcessHost,
} from "@sidecar/gateway/server";
import { isIdentifier } from "@sidecar/runtime/vocabulary";
import { isRecord, isWireString, type WireRecord, type WireValue } from "@sidecar/wire";
import { Effect, type Scope } from "effect";

/**
 * The host side of the Gateway: the node vocabulary, answered over the
 * registry that owns it, and the door every other concern's methods are
 * merged into. The service composes nothing of its own about the host; it is
 * the one boundary a client crosses to reach the composers, and the one
 * place their changes become numbered events. Today the client is the same
 * process over the in-process transport; the seams are drawn so the process
 * split that follows moves the transport and nothing here.
 */
export interface GatewayServiceDependencies {
  nodes?: NodeRegistry;
  now: () => number;
  createId: () => string;
  /**
   * The host's methods, beside the node ones this service answers itself:
   * the settings, account, integration, and client-fact vocabulary the
   * composers own. A method both name is the host's.
   */
  methods?: GatewayMethodTable;
}

export interface GatewayService {
  /** The in-process host every transport in this process is bound to: the protocol's door, the log, and the admissions door. */
  readonly gateway: GatewayInProcessHost;
  /**
   * What its own server was built over, so a transport that composes a server
   * of its own — the socket binding, which provides the `Protocol` a server is
   * built on rather than attaching to one already built — answers the same
   * methods over the same readers.
   */
  readonly layerOptions: GatewayServerLayerOptions;
  /**
   * Closes the door to new work: every mutating method but the shutdown
   * itself answers shutting-down from here on, while reads, hellos, and
   * reconnections still answer, so a client can see the host leaving rather
   * than lose it. Nothing under way is touched; that is the coordinator's.
   */
  readonly closeAdmissions: Effect.Effect<void>;
  /** Appends one event to the log, for a host concern with no narrower report of its own below. */
  readonly emit: (kind: GatewayEventKind, payload: WireValue) => void;
  readonly nodes: NodeRegistry;
}

/** A parameter that is not the shape its method takes; the reading handler answers it as an invalid-params refusal. */
class ParamRefusal extends Error {}

/**
 * Reads one request's parameters by name. A required read answers the value
 * or refuses; an optional read answers nothing for an absent parameter and
 * refuses one present in the wrong shape. Every refusal is worded the same
 * way, so a handler says what it needs and nothing else.
 */
class ParamReader {
  readonly #params: WireRecord;

  constructor(params: WireRecord) {
    this.#params = params;
  }

  identifier(name: string): string {
    const value = this.#params[name];
    if (isIdentifier(value)) return value;
    throw new ParamRefusal(`${name} must be a non-empty string`);
  }

  string(name: string): string {
    const value = this.#params[name];
    if (isWireString(value)) return value;
    throw new ParamRefusal(`${name} must be a string`);
  }

  stringList(name: string): readonly string[] {
    const value = this.#params[name];
    if (Array.isArray(value) && value.every(isWireString)) return value;
    throw new ParamRefusal(`${name} must be a list of strings`);
  }

  optionalRecord(name: string): WireRecord | undefined {
    const value = this.#params[name];
    if (value === undefined || isRecord(value)) return value;
    throw new ParamRefusal(`${name} must be a record`);
  }
}

/** A handler that reads its parameters through the reader, answering a read's refusal as the method's. */
function reading(
  handle: (
    read: ParamReader,
    context: GatewayMethodContext,
  ) => Effect.Effect<WireValue | undefined, GatewayRefusal>,
): GatewayMethodHandler {
  return (params, context) =>
    Effect.suspend(() => handle(new ParamReader(params), context)).pipe(
      Effect.catchAllDefect((defect) =>
        defect instanceof ParamRefusal ? invalid(defect.message) : Effect.die(defect),
      ),
    );
}

/**
 * The host's side of the Gateway, composed in the caller's own `Scope`: the
 * method table this service answers, and the in-process host the server's
 * layers were built into, which every transport in this process is bound to
 * and whose event log each change below becomes a numbered event in.
 */
export function createGatewayService(
  dependencies: GatewayServiceDependencies,
): Effect.Effect<GatewayService, never, Scope.Scope> {
  const nodes = dependencies.nodes ?? new NodeRegistry();

  /** What a hello or a reconnection is handed in place of the events it missed: the nodes as they stand. */
  const snapshot = (): WireRecord => ({
    nodes: nodes.list().map(nodeSnapshotToWire),
  });

  /** Which connection a remote node was last registered on, so only that connection's closing disconnects it. */
  const nodeOwners = new Map<string, string>();

  const methods: GatewayMethodTable = {
    ...dependencies.methods,
    // A registration names the capabilities the host may ask the registering
    // connection for. Each ask travels back on that connection alone, bound
    // to it by the invocation id its ledger holds; the connection closing
    // marks the node disconnected, so the next ask answers unavailable, and
    // a later registration from a new connection takes the node over whole.
    [GATEWAY_METHOD.NODE_REGISTER]: reading((read, context) => {
      const nodeId = read.identifier("nodeId");
      const capabilities = read.stringList("capabilities");
      if (capabilities.length === 0) {
        return invalid("capabilities must name at least one capability");
      }
      const connection = context.connection;
      if (!connection) {
        if (nodes.has(nodeId)) {
          nodes.setConnected(nodeId, true);
          return Effect.succeed({ nodeId, connected: true, clientId: context.client.clientId });
        }
        return Effect.fail(
          new RefusedRefusal({
            message: "a node's capabilities are registered by the process that performs them",
          }),
        );
      }
      nodeOwners.set(nodeId, connection.connectionId);
      nodes.registerRemote({
        nodeId,
        capabilities,
        invoke: (capability, params) =>
          connection.invoke({
            invocationId: dependencies.createId(),
            nodeId,
            capability,
            params,
          }),
      });
      connection.onClosed(() => {
        if (nodeOwners.get(nodeId) !== connection.connectionId) return;
        nodes.setConnected(nodeId, false);
      });
      return Effect.succeed({ nodeId, connected: true, clientId: context.client.clientId });
    }),
    [GATEWAY_METHOD.NODE_UNREGISTER]: reading((read) =>
      Effect.succeed({ disconnected: nodes.setConnected(read.identifier("nodeId"), false) }),
    ),
    [GATEWAY_METHOD.NODE_INVOKE]: reading((read) => {
      const capability = read.string("capability");
      const params = read.optionalRecord("params") ?? {};
      return Effect.map(nodes.invoke(capability, params), (result) =>
        result.status === NODE_CAPABILITY_STATUS.OK
          ? {
              status: result.status,
              ...(result.value !== undefined ? { value: result.value } : undefined),
            }
          : { status: result.status, capability: result.capability, reason: result.reason },
      );
    }),
  };

  const layerOptions: GatewayServerLayerOptions = {
    methods,
    // The host numbers no configuration and no conversation generation: the
    // brain those revisions fenced is the service's, so a request expecting
    // either is measured against a host that holds none.
    configurationRevision: () => 0,
    sessionRevision: () => undefined,
    snapshot,
    now: dependencies.now,
    createEventId: dependencies.createId,
  };

  return Effect.map(gatewayInProcessHost(layerOptions), (gateway) => {
    /**
     * The log's own append, where the composers ask for it: every change is
     * reported to this service synchronously, from a collaborator's own
     * callback rather than from an effect — the live session's, the node
     * registry's — so the append is the log's synchronous one, and an
     * in-process transport delivers what it appended on the same tick.
     */
    const emit = (kind: GatewayEventKind, payload: WireValue): void => {
      gateway.log.publish(kind, payload);
    };

    nodes.onChange((list) => {
      emit(GATEWAY_EVENT.NODE_CHANGED, { nodes: list.map(nodeSnapshotToWire) });
    });

    return {
      gateway,
      layerOptions,
      emit,
      closeAdmissions: gateway.admissions.close,
      nodes,
    };
  });
}
