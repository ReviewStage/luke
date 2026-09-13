import type { Effect } from "effect";
import type { Generation } from "./generation.js";
import type { BrainRequestLedger } from "./ledger.js";
import type { BrainTurnTrigger, RunControl } from "./turn.js";

/**
 * What every collaborator of {@link BrainAgent} reads of the conversation's
 * standing, and nothing more. The agent owns the generation, the queue, the
 * lease, and the stop; a collaborator reaches them only through here, so no
 * collaborator holds the agent and none of them can own the standing twice.
 */
export interface AgentSeam {
  /** This conversation's own instant, read off the `Clock` the agent was built on. */
  readonly now: () => number;
  /**
   * Runs one of this conversation's effects on a fiber of its own, for an
   * edge that holds nothing open while it runs: the queue's own drain, and
   * the wake window's flush, each a callback a timer calls with nowhere to
   * answer. The fiber is the agent's, so what it detaches is still a turn of
   * the runtime every turn of this conversation is one of, and it is begun on
   * the calling stack, so the turn is standing in the conversation's queue,
   * counted busy, by the time this returns.
   */
  readonly detach: (work: Effect.Effect<unknown>) => void;
  /**
   * Waits `delayMs` on this conversation's own `Clock` and then runs `work`,
   * on a fiber forked into the agent's own scope. The stop that closes that
   * scope ends every wait standing on it, so nothing fires into a
   * conversation that is gone, and what this answers is the disarm, which
   * interrupts the fiber before its wait is out. Disarming a wait already
   * run changes nothing.
   */
  readonly arm: (delayMs: number, work: Effect.Effect<void>) => () => void;
  readonly report: (message: string) => void;
  readonly ledger: BrainRequestLedger;
  /** The generation that stands, or nothing before the first load. */
  generation(): Generation | undefined;
  stopped(): boolean;
  ready(): Effect.Effect<void>;
  /** The door check every entry point runs before it reads a generation. */
  expireIfDue(): void;
  /** Reports an unrunnable checkpoint once per generation id. */
  reportIncompatible(generation: Generation, reason: string): void;
  runRevoked(run: RunControl): boolean;
  /** The conversation's serial queue, under the host's lane for the trigger. */
  queueTurn<A>(trigger: BrainTurnTrigger, work: Effect.Effect<A>): Effect.Effect<A>;
  /** The serial queue with no lane, for the maintenance a turn leaves behind. */
  enqueue<A>(work: Effect.Effect<A>): Effect.Effect<A>;
}
