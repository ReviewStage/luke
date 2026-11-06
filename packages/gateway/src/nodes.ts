import type { WireRecord } from "@repo/wire";
import { Effect } from "effect";
import { NODE_CAPABILITY_STATUS, type NodeCapabilityResult } from "./protocol.js";

export type RemoteNodeInvoker = (
  capability: string,
  params: WireRecord,
) => Effect.Effect<NodeCapabilityResult>;

export interface RemoteNodeRegistration {
  nodeId: string;
  capabilities: readonly string[];
  invoke: RemoteNodeInvoker;
}

interface HeldNode {
  nodeId: string;
  capabilities: readonly string[];
  perform: (capability: string, params: WireRecord) => Effect.Effect<NodeCapabilityResult>;
  connected: boolean;
}

export interface NodeSnapshot {
  nodeId: string;
  capabilities: readonly string[];
  connected: boolean;
}

export type NodeRegistryListener = (nodes: readonly NodeSnapshot[]) => void;

export class NodeRegistry {
  readonly #nodes = new Map<string, HeldNode>();
  readonly #listeners = new Set<NodeRegistryListener>();

  registerRemote(registration: RemoteNodeRegistration): void {
    this.#nodes.set(registration.nodeId, {
      nodeId: registration.nodeId,
      capabilities: [...registration.capabilities],
      perform: (capability, params) =>
        registration.capabilities.includes(capability)
          ? registration.invoke(capability, params)
          : Effect.succeed(this.#unknown(capability)),
      connected: true,
    });
    this.#changed();
  }

  unregister(nodeId: string): boolean {
    const removed = this.#nodes.delete(nodeId);
    if (removed) this.#changed();
    return removed;
  }

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

  invoke(capability: string, params: WireRecord = {}): Effect.Effect<NodeCapabilityResult> {
    return Effect.suspend(() => {
      const provider = this.#provider(capability);
      if (!provider) {
        const known = [...this.#nodes.values()].some((node) =>
          node.capabilities.includes(capability),
        );
        return Effect.succeed<NodeCapabilityResult>({
          status: NODE_CAPABILITY_STATUS.UNAVAILABLE,
          capability,
          reason: known
            ? "the node offering that capability is not connected"
            : "no node offers that capability",
        });
      }
      return provider.perform(capability, params);
    });
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
