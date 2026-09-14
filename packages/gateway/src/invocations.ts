import { Deferred, Effect, Exit, FiberSet, Ref, type Scope } from "effect";
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
  return {
    status: NODE_CAPABILITY_STATUS.UNAVAILABLE,
    capability: invocation.capability,
    reason,
  };
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
    { capability: string; deferred: Deferred.Deferred<NodeCapabilityResult> }
  >();
  #closed = false;

  get size(): number {
    return this.#pending.size;
  }

  /**
   * Puts one ask on the ledger as it is called and answers with the effect
   * that waits for it, so the caller holds the ask before it puts the frame
   * on the wire and an answer arriving between the two settles the deferred
   * this already keeps. A ledger already closed answers unavailable at once.
   */
  open(invocation: NodeInvocation): Effect.Effect<NodeCapabilityResult> {
    if (this.#closed) {
      return Effect.succeed(
        unavailableInvocation(invocation, NODE_INVOCATION_REFUSAL.DISCONNECTED),
      );
    }
    const deferred = Deferred.makeUnsafe<NodeCapabilityResult>();
    this.#pending.set(invocation.invocationId, {
      capability: invocation.capability,
      deferred,
    });
    return Deferred.await(deferred);
  }

  /** Settles the ask of that id; an id this ledger never opened, or already settled, is ignored. */
  answer(answer: NodeInvocationAnswer): boolean {
    const held = this.#pending.get(answer.invocationId);
    if (!held) return false;
    this.#pending.delete(answer.invocationId);
    Deferred.doneUnsafe(held.deferred, Exit.succeed(answer.result));
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
      Deferred.doneUnsafe(
        held.deferred,
        Exit.succeed(unknownInvocation({ capability: held.capability })),
      );
    }
  }
}

export type NodeInvocationHandler = (
  invocation: NodeInvocation,
) => Effect.Effect<NodeCapabilityResult>;

export const INVOCATION_MEMORY_DEFAULTS = {
  /** How many settled invocation ids a node remembers, so a late duplicate frame is answered rather than performed. */
  SETTLED_CAPACITY: 256,
} as const;

export interface InvocationMemoryOptions {
  readonly handler: NodeInvocationHandler;
  readonly capacity?: number;
}

/**
 * The node's ledger: one entry per invocation id, holding the answer that id
 * is performing or has already performed, and the ids answered oldest first,
 * which is the order the memory forgets them in. An id it still holds is
 * never performed a second time, whether its answer is out or already in.
 */
interface InvocationLedger {
  readonly held: ReadonlyMap<string, Deferred.Deferred<NodeCapabilityResult>>;
  readonly answered: readonly string[];
}

/** The one entry an arriving frame names, and whether this frame is what opened it. */
interface OpenedInvocation {
  readonly answer: Deferred.Deferred<NodeCapabilityResult>;
  readonly first: boolean;
}

export interface InvocationMemory {
  /**
   * The answer to that invocation: the performance this frame opens, or the
   * one an earlier frame of the same id opened, whether it is still out or
   * already in.
   */
  readonly take: (invocation: NodeInvocation) => Effect.Effect<NodeInvocationAnswer>;
}

function openInvocation(
  ledger: InvocationLedger,
  invocationId: string,
): readonly [OpenedInvocation, InvocationLedger] {
  const standing = ledger.held.get(invocationId);
  if (standing) return [{ answer: standing, first: false }, ledger];
  const answer = Deferred.makeUnsafe<NodeCapabilityResult>();
  const held = new Map(ledger.held);
  held.set(invocationId, answer);
  return [
    { answer, first: true },
    { held, answered: ledger.answered },
  ];
}

/**
 * The node's side: performs each distinct invocation once, for the scope it
 * is served in. A duplicate that arrives while the first is still performing
 * awaits that same performance; one that arrives after it settled is
 * answered what it answered. The native effect therefore runs at most once
 * per id on this process, whatever the wire did; a process that crashed
 * between the effect and its answer cannot be asked again, because the
 * host's ledger has already closed that id.
 *
 * A performance is a fiber of this memory's own set rather than of whoever
 * the frame arrived on, so a caller that gives up on its own await does not
 * take the performance the duplicates are joined to; the scope that served
 * the handler is what ends them all.
 */
export const invocationMemory = /* @__PURE__ */ Effect.fn("invocationMemory")(function* (
  options: InvocationMemoryOptions,
): Effect.fn.Return<InvocationMemory, never, Scope.Scope> {
  const capacity = options.capacity ?? INVOCATION_MEMORY_DEFAULTS.SETTLED_CAPACITY;
  const ledger = yield* Ref.make<InvocationLedger>({
    held: new Map(),
    answered: [],
  });
  const performances = yield* FiberSet.make<void>();

  /** Writes the id down as answered and forgets the oldest the memory no longer holds room for. */
  const remember = (invocationId: string): Effect.Effect<void> =>
    Ref.update(ledger, (standing) => {
      const answered = [...standing.answered, invocationId];
      if (answered.length <= capacity) return { held: standing.held, answered };
      const held = new Map(standing.held);
      for (const forgotten of answered.splice(0, answered.length - capacity)) {
        held.delete(forgotten);
      }
      return { held, answered };
    });

  const perform = (
    invocation: NodeInvocation,
    answer: Deferred.Deferred<NodeCapabilityResult>,
  ): Effect.Effect<void> =>
    Effect.ensuring(
      Effect.gen(function* () {
        // A handler that died answers failed on this node rather than
        // taking the connection down with it; the host reads a typed
        // refusal either way.
        const result = yield* Effect.catchDefect(options.handler(invocation), (defect) =>
          Effect.succeed<NodeCapabilityResult>({
            status: NODE_CAPABILITY_STATUS.FAILED,
            capability: invocation.capability,
            reason: defect instanceof Error ? defect.message : String(defect),
          }),
        );
        yield* Deferred.succeed(answer, result);
        yield* remember(invocation.invocationId);
      }),
      Deferred.interrupt(answer),
    );

  const take = (invocation: NodeInvocation): Effect.Effect<NodeInvocationAnswer> =>
    // The frame that opened an id is the frame that performs it: the ledger
    // is read and written and the performance forked in one step nothing
    // interrupts, so no duplicate finds the id unopened and performs it a
    // second time.
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const opened = yield* Ref.modify(ledger, (standing) =>
          openInvocation(standing, invocation.invocationId),
        );
        if (opened.first) {
          yield* FiberSet.run(performances, perform(invocation, opened.answer));
        }
        const result = yield* restore(Deferred.await(opened.answer));
        return { invocationId: invocation.invocationId, result };
      }),
    );

  return { take };
});
