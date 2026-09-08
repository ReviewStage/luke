import type { MaybePromise } from "@sidecar/runtime/vocabulary";
import type { WireRecord, WireValue } from "@sidecar/wire";
import { NODE_CAPABILITY_STATUS, type NodeCapabilityResult } from "./protocol.js";

export type NodeCapabilityHandler = (params: WireRecord) => MaybePromise<WireValue | undefined>;

export interface NodeRegistration {
  nodeId: string;
  capabilities: Readonly<Record<string, NodeCapabilityHandler>>;
}

/** A node on the other side of a connection: what it offers, and the one connection its asks travel on. */
export type RemoteNodeInvoker = (
  capability: string,
  params: WireRecord,
) => Promise<NodeCapabilityResult>;

export interface RemoteNodeRegistration {
  nodeId: string;
  capabilities: readonly string[];
  invoke: RemoteNodeInvoker;
}

interface HeldNode {
  nodeId: string;
  capabilities: readonly string[];
  /** Performs one capability in this process, or asks the connection the node registered on. */
  perform: (capability: string, params: WireRecord) => Promise<NodeCapabilityResult>;
  connected: boolean;
}

export interface NodeSnapshot {
  nodeId: string;
  capabilities: readonly string[];
  connected: boolean;
}

export type NodeRegistryListener = (nodes: readonly NodeSnapshot[]) => void;

/**
 * The nodes connected to the host and what each can do. A native capability
 * — opening an address on this machine, carrying an action to a panel — is the
 * client's to perform and the host's to ask for, and the host asks here by
 * name. A capability no connected node offers answers a typed unavailable,
 * never a success and never a throw, so the action that needed it is left undone
 * and recorded as such. A node that disconnects keeps its registration and
 * loses its availability, so its capabilities read unavailable rather than
 * unknown until it comes back.
 */
export class NodeRegistry {
  readonly #nodes = new Map<string, HeldNode>();
  readonly #listeners = new Set<NodeRegistryListener>();

  register(registration: NodeRegistration): void {
    this.#nodes.set(registration.nodeId, {
      nodeId: registration.nodeId,
      capabilities: Object.keys(registration.capabilities),
      perform: async (capability, params) => {
        const handler = registration.capabilities[capability];
        if (!handler) return this.#unknown(capability);
        try {
          return { status: NODE_CAPABILITY_STATUS.OK, value: await handler(params) };
        } catch (error) {
          return {
            status: NODE_CAPABILITY_STATUS.FAILED,
            capability,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      },
      connected: true,
    });
    this.#changed();
  }

  /**
   * Registers a node whose capabilities are performed on the connection that
   * offered them. A registration under an id already held replaces the
   * invoker whole — the client reconnected — so an ask made after this
   * reaches the new connection, and one made before it was answered by the
   * old connection's own closing, never by the new one.
   */
  registerRemote(registration: RemoteNodeRegistration): void {
    this.#nodes.set(registration.nodeId, {
      nodeId: registration.nodeId,
      capabilities: [...registration.capabilities],
      perform: (capability, params) =>
        registration.capabilities.includes(capability)
          ? registration.invoke(capability, params)
          : Promise.resolve(this.#unknown(capability)),
      connected: true,
    });
    this.#changed();
  }

  unregister(nodeId: string): boolean {
    const removed = this.#nodes.delete(nodeId);
    if (removed) this.#changed();
    return removed;
  }

  /** Whether a node of that id is registered, connected or not. */
  has(nodeId: string): boolean {
    return this.#nodes.has(nodeId);
  }

  setConnected(nodeId: string, connected: boolean): boolean {
    const held = this.#nodes.get(nodeId);
    if (!held || held.connected === connected) return false;
    held.connected = connected;
    this.#changed();
    return true;
  }

  connected(nodeId: string): boolean {
    return this.#nodes.get(nodeId)?.connected === true;
  }

  /** Whether some connected node offers the capability now. */
  available(capability: string): boolean {
    return this.#provider(capability) !== undefined;
  }

  list(): readonly NodeSnapshot[] {
    return [...this.#nodes.values()].map(({ nodeId, capabilities, connected }) => ({
      nodeId,
      capabilities: [...capabilities],
      connected,
    }));
  }

  async invoke(capability: string, params: WireRecord = {}): Promise<NodeCapabilityResult> {
    const provider = this.#provider(capability);
    if (!provider) {
      const known = [...this.#nodes.values()].some((node) =>
        node.capabilities.includes(capability),
      );
      return {
        status: NODE_CAPABILITY_STATUS.UNAVAILABLE,
        capability,
        reason: known
          ? "the node offering that capability is not connected"
          : "no node offers that capability",
      };
    }
    return provider.perform(capability, params);
  }

  onChange(listener: NodeRegistryListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #provider(capability: string): HeldNode | undefined {
    for (const node of this.#nodes.values()) {
      if (node.connected && node.capabilities.includes(capability)) return node;
    }
    return undefined;
  }

  #unknown(capability: string): NodeCapabilityResult {
    return {
      status: NODE_CAPABILITY_STATUS.UNAVAILABLE,
      capability,
      reason: "no node offers that capability",
    };
  }

  #changed(): void {
    const nodes = this.list();
    for (const listener of [...this.#listeners]) listener(nodes);
  }
}

export function nodeSnapshotToWire(node: NodeSnapshot): WireRecord {
  return { nodeId: node.nodeId, capabilities: [...node.capabilities], connected: node.connected };
}
