import type { Carry } from "./effect/carry.js";
import type { Generation } from "./generation.js";
import type { BrainRequestLedger } from "./ledger.js";
import type { ScheduledTimer } from "./scheduled-timer.js";
import type { BrainTurnTrigger, RunControl } from "./turn.js";

export type { ScheduledTimer } from "./scheduled-timer.js";

/**
 * What every collaborator of {@link BrainAgent} reads of the conversation's
 * standing, and nothing more. The agent owns the generation, the queue, the
 * lease, and the stop; a collaborator reaches them only through here, so no
 * collaborator holds the agent and none of them can own the standing twice.
 */
export interface AgentSeam {
  readonly now: () => number;
  /**
   * Carries one of this conversation's effects to the promise a caller still
   * holds, on the runtime the host handed the agent. A turn is a fiber of
   * that runtime from here inward.
   */
  readonly carry: Carry;
  readonly schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  readonly cancel: (timer: ScheduledTimer) => void;
  readonly report: (message: string) => void;
  readonly ledger: BrainRequestLedger;
  /** The generation that stands, or nothing before the first load. */
  generation(): Generation | undefined;
  stopped(): boolean;
  ready(): Promise<void>;
  /** The door check every entry point runs before it reads a generation. */
  expireIfDue(): void;
  /** Reports an unrunnable checkpoint once per generation id. */
  reportIncompatible(generation: Generation, reason: string): void;
  runRevoked(run: RunControl): boolean;
  /** The conversation's serial queue, under the host's lane for the trigger. */
  queueTurn<T>(trigger: BrainTurnTrigger, work: () => Promise<T>): Promise<T>;
  /** The serial queue with no lane, for the maintenance a turn leaves behind. */
  enqueue<T>(work: () => Promise<T>): Promise<T>;
}
