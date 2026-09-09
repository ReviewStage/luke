/**
 * The Gateway: the one boundary every client reaches the runtime through.
 * The protocol is the vocabulary — versioned envelopes, a fixed method
 * table, typed errors — and everything beside it is what carries that
 * vocabulary: the host's server, a client, the transports, and the node
 * registry an operator's capabilities are asked for through. The socket
 * binding keeps a door of its own (`./websocket`), because it reaches `ws`
 * and `node:http` and a client bundle that only wants the vocabulary must
 * not have to resolve them.
 */
export {
  ATTACH_RETRY_DEFAULTS,
  type AttachRetryPorts,
  retryAttachWhileDetached,
} from "./attachment.js";
export {
  type GatewayCallOptions,
  type GatewayCallResult,
  GatewayClient,
  type GatewayClientEventListener,
  type GatewayClientOptions,
  helloSequence,
} from "./client.js";
export {
  INVOCATION_MEMORY_DEFAULTS,
  InvocationMemory,
  NODE_INVOCATION_REFUSAL,
  type NodeInvocationHandler,
  PendingInvocations,
  unavailableInvocation,
  unknownInvocation,
} from "./invocations.js";
export {
  type NodeCapabilityHandler,
  type NodeRegistration,
  NodeRegistry,
  type NodeRegistryListener,
  type NodeSnapshot,
  nodeSnapshotToWire,
  type RemoteNodeInvoker,
  type RemoteNodeRegistration,
} from "./nodes.js";
export * from "./protocol.js";
export {
  eventToWire,
  GATEWAY_SERVER_DEFAULTS,
  type GatewayEventListener,
  type GatewayMethodContext,
  type GatewayMethodHandler,
  type GatewayMethodOutcome,
  type GatewayMethodTable,
  GatewayServer,
  type GatewayServerOptions,
  gatewayError,
  gatewayOk,
} from "./server.js";
export {
  GATEWAY_SHUTDOWN_DEFAULTS,
  type GatewayShutdownOptions,
  type GatewayShutdownReport,
  type GatewayShutdownSteps,
  shutdownGateway,
} from "./shutdown.js";
export {
  type GatewayEventSink,
  type GatewayHostConnection,
  type GatewayTransport,
  gatewayRefusal,
  InProcessTransport,
  ServerBoundTransport,
} from "./transport.js";
export { carried, gatewayEventReader, invalid } from "./wire.js";
