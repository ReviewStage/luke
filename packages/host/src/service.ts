/**
 * service.ts -- the host's side of the Gateway: the folded method table
 * dispatched to the one operator this process is, and the door every
 * composer's change becomes an event through.
 */
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  type GatewayEventKind,
  type GatewayHost,
  type GatewayMethodTable,
  gatewayHost,
  NodeRegistry,
  nodeSnapshotToWire,
} from "@sidecar/gateway";
import type { WireValue } from "@sidecar/wire";
import { HOST_OPERATOR_CLIENT_ID } from "./node-capabilities.js";

export interface GatewayServiceDependencies {
  nodes?: NodeRegistry;
  /** The host's methods: the settings, account, integration, and client-fact vocabulary the composers own, already folded. */
  methods?: GatewayMethodTable;
}

export interface GatewayService {
  /** The one boundary the desktop reaches this host through. */
  readonly gateway: GatewayHost;
  /** Hands one event to every listener of its kind, for a host concern with no narrower report of its own. */
  readonly emit: (kind: GatewayEventKind, payload: WireValue) => void;
  readonly nodes: NodeRegistry;
}

/**
 * The service composes nothing of its own about the host; it is the one
 * boundary the operator crosses to reach the composers, and the one place
 * their changes become events. The node registry's own changes are reported
 * here so the operator hears which capabilities stand.
 */
export function createGatewayService(dependencies: GatewayServiceDependencies): GatewayService {
  const nodes = dependencies.nodes ?? new NodeRegistry();
  const gateway = gatewayHost({
    methods: dependencies.methods ?? {},
    client: { clientId: HOST_OPERATOR_CLIENT_ID, role: GATEWAY_CLIENT_ROLE.OPERATOR },
  });
  nodes.onChange((list) => {
    gateway.emit(GATEWAY_EVENT.NODE_CHANGED, { nodes: list.map(nodeSnapshotToWire) });
  });
  return { gateway, emit: gateway.emit, nodes };
}
