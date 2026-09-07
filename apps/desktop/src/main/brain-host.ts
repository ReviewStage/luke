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
  /** Follows a newly installed agent; answers the unfollow. */
  follow: (agent: BrainAgent) => () => void;
  /** Tells every window what stands when no agent does: no runs at all. */
  publishEmpty: () => void;
}

export class BrainHost {
  readonly #dependencies: BrainHostDependencies;
  #agent: BrainAgent | undefined;
  #unfollow: (() => void) | undefined;
  #retiring: Promise<unknown>[] = [];
  #transitions = 0;
  #chain: Promise<void> = Promise.resolve();

  constructor(dependencies: BrainHostDependencies) {
    this.#dependencies = dependencies;
  }

  current(): BrainAgent | undefined {
    return this.#agent;
  }

  /**
   * Withdraws the standing agent now: nothing may ask it anything more, its
   * follower stops relaying, and its `stop` — which revokes every run and
   * observation turn synchronously before it awaits — is begun at once. The
   * stop's settling is awaited by the next build, never by the caller.
   */
  retire(): void {
    const previous = this.#agent;
    this.#agent = undefined;
    this.#unfollow?.();
    this.#unfollow = undefined;
    if (previous) this.#retiring.push(previous.stop().catch(() => undefined));
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
    this.#chain = this.#chain.then(async () => {
      await Promise.all(this.#retiring.splice(0));
      if (transition !== this.#transitions) return;
      const agent = build();
      if (transition !== this.#transitions) {
        // Decided too late: a newer transition owns the outcome, and an
        // agent built for this one must not stand beside its successor.
        if (agent) await agent.stop();
        return;
      }
      this.#agent = agent;
      if (agent) this.#unfollow = this.#dependencies.follow(agent);
      else this.#dependencies.publishEmpty();
    });
    return this.#chain;
  }

  /** Settles once every transition asked for so far has decided. */
  settled(): Promise<void> {
    return this.#chain;
  }
}
