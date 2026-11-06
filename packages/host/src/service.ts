import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  type GatewayEventKind,
  type GatewayHost,
  type GatewayMethodTable,
  gatewayHost,
  NodeRegistry,
  nodeSnapshotToWire,
} from "@repo/gateway";
import type { WireValue } from "@repo/wire";
import { HOST_OPERATOR_CLIENT_ID } from "./node-capabilities.js";

export interface GatewayServiceDependencies {
  nodes?: NodeRegistry;
  methods?: GatewayMethodTable;
}

export interface GatewayService {
  readonly gateway: GatewayHost;
  readonly emit: (kind: GatewayEventKind, payload: WireValue) => void;
  readonly nodes: NodeRegistry;
}

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
