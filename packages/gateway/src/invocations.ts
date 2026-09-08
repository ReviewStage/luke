import {
  NODE_CAPABILITY_STATUS,
  type NodeCapabilityResult,
  type NodeInvocation,
  type NodeInvocationAnswer,
} from "./protocol.js";

/**
 * The two ledgers a node invocation crosses. The host's ledger holds every
 * ask it has sent one connection and not yet heard answered, by id, and
 * closes them all as unavailable when that connection goes: the answer never
 * comes, and the effect the node may already have made stays uncertain rather
 * than being asked for again. The node's ledger dedupes what it is asked
 * before anything native runs: an ask heard twice, whether still pending or
 * already answered, is answered from the first performance and performed
 * once. Neither ledger claims the effect happened exactly once; what they
 * bound is what this side will do about a frame it has already seen.
 */
export const NODE_INVOCATION_REFUSAL = {
  /** The connection was already gone when the ask was made: nothing was dispatched. */
  DISCONNECTED: "the node's connection is closed; the action was not dispatched",
  /** The ask reached the connection and the connection closed before an answer: the effect is uncertain. */
  ANSWER_LOST:
    "the node's connection closed before it answered; whether the action took effect is unknown",
  NOT_SERVING: "the connection serves no node capabilities",
} as const;

/** Never dispatched: the action did not happen and may be asked again. */
export function unavailableInvocation(
  invocation: Pick<NodeInvocation, "capability">,
  reason: string,
): NodeCapabilityResult {
  return { status: NODE_CAPABILITY_STATUS.UNAVAILABLE, capability: invocation.capability, reason };
}

/** Dispatched and unanswered: the action may have happened and is never repeated on that account. */
export function unknownInvocation(
  invocation: Pick<NodeInvocation, "capability">,
): NodeCapabilityResult {
  return {
    status: NODE_CAPABILITY_STATUS.UNKNOWN,
    capability: invocation.capability,
    reason: NODE_INVOCATION_REFUSAL.ANSWER_LOST,
  };
}

/** The host's side: the asks out on one connection, settled by an answer of the same id or by the connection's end. */
export class PendingInvocations {
  readonly #pending = new Map<
    string,
    { capability: string; resolve: (result: NodeCapabilityResult) => void }
  >();
  #closed = false;

  get size(): number {
    return this.#pending.size;
  }

  /** Holds one ask until it is answered; a ledger already closed answers unavailable at once. */
  open(invocation: NodeInvocation): Promise<NodeCapabilityResult> {
    if (this.#closed) {
      return Promise.resolve(
        unavailableInvocation(invocation, NODE_INVOCATION_REFUSAL.DISCONNECTED),
      );
    }
    return new Promise((resolve) => {
      this.#pending.set(invocation.invocationId, { capability: invocation.capability, resolve });
    });
  }

  /** Settles the ask of that id; an id this ledger never opened, or already settled, is ignored. */
  answer(answer: NodeInvocationAnswer): boolean {
    const held = this.#pending.get(answer.invocationId);
    if (!held) return false;
    this.#pending.delete(answer.invocationId);
    held.resolve(answer.result);
    return true;
  }

  /**
   * The connection is gone. Every ask still out was dispatched and answers
   * unknown, its effect uncertain; any ask after answers unavailable, never
   * having been dispatched at all. The two are different words on purpose.
   */
  close(): void {
    this.#closed = true;
    for (const [id, held] of [...this.#pending]) {
      this.#pending.delete(id);
      held.resolve(unknownInvocation({ capability: held.capability }));
    }
  }
}

export type NodeInvocationHandler = (invocation: NodeInvocation) => Promise<NodeCapabilityResult>;

export const INVOCATION_MEMORY_DEFAULTS = {
  /** How many settled invocation ids a node remembers, so a late duplicate frame is answered rather than performed. */
  SETTLED_CAPACITY: 256,
} as const;

/**
 * The node's side: performs each distinct invocation once. A duplicate that
 * arrives while the first is still performing awaits that same performance;
 * one that arrives after it settled is answered what it answered. The native
 * effect therefore runs at most once per id on this process, whatever the
 * wire did; a process that crashed between the effect and its answer cannot
 * be asked again, because the host's ledger has already closed that id.
 */
export class InvocationMemory {
  readonly #handler: NodeInvocationHandler;
  readonly #inFlight = new Map<string, Promise<NodeCapabilityResult>>();
  readonly #settled = new Map<string, NodeCapabilityResult>();
  readonly #capacity: number;

  constructor(
    handler: NodeInvocationHandler,
    capacity = INVOCATION_MEMORY_DEFAULTS.SETTLED_CAPACITY,
  ) {
    this.#handler = handler;
    this.#capacity = capacity;
  }

  async take(invocation: NodeInvocation): Promise<NodeInvocationAnswer> {
    const { invocationId } = invocation;
    const settled = this.#settled.get(invocationId);
    if (settled) return { invocationId, result: settled };
    let performance = this.#inFlight.get(invocationId);
    if (!performance) {
      performance = this.#perform(invocation);
      this.#inFlight.set(invocationId, performance);
    }
    const result = await performance;
    return { invocationId, result };
  }

  async #perform(invocation: NodeInvocation): Promise<NodeCapabilityResult> {
    let result: NodeCapabilityResult;
    try {
      result = await this.#handler(invocation);
    } catch (error) {
      result = {
        status: NODE_CAPABILITY_STATUS.FAILED,
        capability: invocation.capability,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    this.#inFlight.delete(invocation.invocationId);
    this.#settled.set(invocation.invocationId, result);
    if (this.#settled.size > this.#capacity) {
      const oldest = this.#settled.keys().next().value;
      if (oldest !== undefined) this.#settled.delete(oldest);
    }
    return result;
  }
}
