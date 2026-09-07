import type { BrainAgent } from "@sidecar/brain";

/**
 * Who owns the standing brain agent through a transition. A key or account
 * change retires the agent that stands and, once the new capability is known,
 * builds another; two transitions can overlap — an account landing while a
 * key is still being removed — and the older one must never install an agent
 * after the newer has decided. So retirement is synchronous and immediate,
 * withdrawing the old agent's execution before the transition's first await,
 * and building is serialized behind every earlier retirement and coalesced to
 * the latest transition: when the queue reaches a build, only the newest
 * request still owns the outcome, and every older one installs nothing.
 */
export interface BrainHostDependencies {
  /** Follows a newly installed agent; answers the unfollow, which settles once its publication has drained. */
  follow: (agent: BrainAgent) => () => Promise<void>;
  /** Tells every window what stands when no agent does: no runs at all. */
  publishEmpty: () => void;
}

type RetirementOutcome = { ok: true } | { ok: false; error: Error };

function settledOutcome(drain: Promise<unknown>): Promise<RetirementOutcome> {
  return drain.then(
    () => ({ ok: true }),
    (error: Error) => ({ ok: false, error }),
  );
}

export class BrainHost {
  readonly #dependencies: BrainHostDependencies;
  #agent: BrainAgent | undefined;
  #unfollow: (() => Promise<void>) | undefined;
  /**
   * Each retirement's drain, captured as it settles rather than as it runs: a
   * drain that rejects has a handler from the moment it is queued, since the
   * transition that awaits it may begin only after a slow credential apply,
   * and its failure is kept for that transition to answer with.
   */
  #retiring: Promise<RetirementOutcome>[] = [];
  #transitions = 0;
  #chain: Promise<void> = Promise.resolve();

  constructor(dependencies: BrainHostDependencies) {
    this.#dependencies = dependencies;
  }

  current(): BrainAgent | undefined {
    return this.#agent;
  }

  /**
   * Withdraws the standing agent now: nothing may ask it anything more, and
   * its `stop` — which revokes every run and observation turn synchronously
   * before it awaits — is begun at once. Its follower relays the stop's own
   * interruptions and retires when the stop settles. The stop's settling is
   * awaited by the next build, never by the caller.
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
      if (unfollow) this.#retiring.push(settledOutcome(unfollow()));
      return;
    }
    // The follower stays through the stop, so the runs the stop interrupts
    // still reach the windows and the thread, and its publication of them
    // drains before anything succeeds this agent: the next build, and the
    // store's lease, wait on it.
    this.#retiring.push(
      settledOutcome(
        previous
          .stop()
          .catch(() => undefined)
          .then(() => unfollow?.()),
      ),
    );
  }

  /**
   * Retires whatever stands and, once every retirement has settled, installs
   * what `build` answers — unless a newer transition has been asked for since,
   * in which case this one installs nothing and the newer one decides. A
   * build answering nothing stands the host down and says so to the windows.
   */
  replace(build: () => BrainAgent | undefined): Promise<void> {
    this.retire();
    const transition = ++this.#transitions;
    const step = this.#chain.then(async () => {
      // Every retirement drains before a successor stands, whichever way each
      // settles: a drain that rejected has still ended, and the others must
      // not be left outstanding behind a first rejection. A rejected drain
      // fails this transition, as it always has, once every drain has ended.
      const outcomes = await Promise.all(this.#retiring.splice(0));
      const failed = outcomes.find((outcome) => !outcome.ok);
      if (failed && !failed.ok) throw failed.error;
      if (transition !== this.#transitions) return;
      const agent = build();
      if (transition !== this.#transitions) {
        // Decided too late: a newer transition owns the outcome, and an
        // agent built for this one must not stand beside its successor.
        if (agent) await agent.stop().catch(() => undefined);
        return;
      }
      this.#agent = agent;
      if (agent) this.#unfollow = this.#dependencies.follow(agent);
      else this.#dependencies.publishEmpty();
    });
    // The caller of this transition sees its failure; the queue does not. A
    // build that threw leaves nothing installed, and the next transition must
    // still be able to install, so the chain continues from a settled step
    // rather than carrying the rejection to every replacement after it.
    this.#chain = step.then(
      () => undefined,
      () => undefined,
    );
    return step;
  }

  /** Settles once every transition asked for so far has decided; never rejects. */
  settled(): Promise<void> {
    return this.#chain;
  }
}
