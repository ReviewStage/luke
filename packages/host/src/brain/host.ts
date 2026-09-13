import type { BrainAgent, Detach } from "@sidecar/brain";
import { Cause, Effect, Fiber } from "effect";

/**
 * Who owns the standing brain agent through a transition. A key or account
 * change retires the agent that stands and, once the new capability is known,
 * builds another; two transitions can overlap — an account landing while a
 * key is still being removed — and the older one must never install an agent
 * after the newer has decided. So retirement is synchronous and immediate,
 * withdrawing the old agent's execution before the transition's first
 * suspension, and building is serialized behind every earlier retirement and
 * coalesced to the latest transition: when the queue reaches a build, only the
 * newest request still owns the outcome, and every older one installs nothing.
 */
interface BrainHostDependencies {
  /** Follows a newly installed agent; answers the unfollow, which settles once its publication has drained. */
  follow: (agent: BrainAgent) => Effect.Effect<Effect.Effect<void>>;
  /** Tells every window what stands when no agent does: no runs at all. */
  publishEmpty: () => void;
  /**
   * Begins a retirement's drain on a fiber of its own, on the runtime the
   * host handed the brain. The stop's first step revokes every run, and it
   * must stand in the step that asked for it rather than in a scheduler task
   * later, so the drain is begun here rather than forked into whatever fiber
   * happened to call `retire`.
   */
  detach: Detach;
}

type RetirementOutcome = { ok: true } | { ok: false; error: Error };

/**
 * Each retirement's drain as it settles rather than as it runs: a drain that
 * failed carries its error as this outcome, since the transition that awaits
 * it may begin only after a slow credential apply, and its failure is kept
 * for that transition to answer with.
 */
function settledOutcome(drain: Effect.Effect<void>): Effect.Effect<RetirementOutcome> {
  return Effect.catchAllCause(
    Effect.as(drain, { ok: true } as const),
    (cause): Effect.Effect<RetirementOutcome> => {
      const squashed = Cause.squash(cause);
      return Effect.succeed({
        ok: false,
        error: squashed instanceof Error ? squashed : new Error(String(squashed)),
      });
    },
  );
}

export class BrainHost {
  readonly #dependencies: BrainHostDependencies;
  readonly #detach: Detach;
  #agent: BrainAgent | undefined;
  #unfollow: Effect.Effect<void> | undefined;
  #retiring: Fiber.Fiber<RetirementOutcome>[] = [];
  #transitions = 0;
  /**
   * One permit held for the whole of a transition, handed to the transitions
   * in the order they asked for it. A transition that fails gives the permit
   * back like any other, so a build that threw leaves nothing installed and
   * the next transition still installs.
   */
  readonly #queue = Effect.unsafeMakeSemaphore(1);

  constructor(dependencies: BrainHostDependencies) {
    this.#dependencies = dependencies;
    this.#detach = dependencies.detach;
  }

  current(): BrainAgent | undefined {
    return this.#agent;
  }

  /**
   * Withdraws the standing agent now: nothing may ask it anything more, and
   * its `stop` — whose own first step revokes every run and observation turn,
   * before the effect suspends — is begun at once on the runtime the host
   * handed the brain. Its follower relays the stop's own interruptions and
   * retires when the stop settles. The stop's settling is awaited by the next
   * build, never by the caller.
   */
  retire(): void {
    // Retiring is itself a transition: a build already queued for an earlier
    // one must not install after this withdrawal, or a source that has gone
    // away would gain an agent.
    this.#transitions += 1;
    const previous = this.#agent;
    const unfollow = this.#unfollow;
    this.#agent = undefined;
    this.#unfollow = undefined;
    if (!previous) {
      if (unfollow) this.#retiring.push(this.#detach(settledOutcome(unfollow)));
      return;
    }
    // The follower stays through the stop, so the runs the stop interrupts
    // still reach the windows and the thread, and its publication of them
    // drains before anything succeeds this agent: the next build, and the
    // store's lease, wait on it. A stop that failed is the agent's own end and
    // not the follower's, so only the drain's failure is kept.
    this.#retiring.push(
      this.#detach(
        settledOutcome(
          Effect.andThen(
            Effect.catchAllCause(previous.stop(), () => Effect.void),
            unfollow ?? Effect.void,
          ),
        ),
      ),
    );
  }

  /**
   * Retires whatever stands and, once every retirement has settled, installs
   * what `build` answers — unless a newer transition has been asked for since,
   * in which case this one installs nothing and the newer one decides. A
   * build answering nothing stands the host down and says so to the windows.
   */
  replace(build: () => Effect.Effect<BrainAgent | undefined>): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.retire();
      const transition = ++this.#transitions;
      return this.#queue.withPermits(1)(
        Effect.gen({ self: this }, function* () {
          // Every retirement queued so far drains before a successor stands. A
          // drain that failed has still ended, and its failure is this
          // transition's to answer with, as it always was.
          const outcomes = yield* Effect.all(
            this.#retiring.splice(0).map((fiber) => Fiber.join(fiber)),
            { concurrency: "unbounded" },
          );
          const failed = outcomes.find((outcome) => !outcome.ok);
          if (failed && !failed.ok) return yield* Effect.die(failed.error);
          if (transition !== this.#transitions) return;
          const agent = yield* build();
          if (transition !== this.#transitions) {
            // Decided too late: a newer transition owns the outcome, and an
            // agent built for this one must not stand beside its successor.
            if (agent) yield* agent.stop();
            return;
          }
          this.#agent = agent;
          if (agent) this.#unfollow = yield* this.#dependencies.follow(agent);
          else this.#dependencies.publishEmpty();
        }),
      );
    });
  }

  /** Settles once every transition begun so far has decided; never fails. */
  settled(): Effect.Effect<void> {
    return this.#queue.withPermits(1)(Effect.void);
  }
}
