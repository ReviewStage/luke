/**
 * One effect run once, however many fibers ask for it and whenever they ask.
 * What the brain needs it for is work a caller's own fiber must not own: the
 * generation's context open and the agent's restore are each begun by
 * whichever fiber asks first and then belong to neither it nor its
 * successors — a turn interrupted while it waits must leave the work
 * standing for the turn behind it, and two turns reaching a fresh generation
 * must open one context between them.
 *
 * The fiber is a daemon for that reason, and it is interruptible whatever
 * the asking fiber's own status. v3 required saying so: a fork inherited the
 * runtime flags of the fiber that made it, so begun inside an uninterruptible
 * region — the wake capture is one — the work would have held every race and
 * every scope of its own open forever, waiting on children it could not
 * interrupt. v4 forks interruptible by default and inherits only on
 * `uninterruptible: "inherit"`, so the wrapper is redundant now. Nothing holds
 * the fiber, so what the flag admits is the runtime going down and nothing
 * else.
 *
 * The decision to start it is
 * taken in the suspension itself, where nothing suspends between reading the
 * cell and writing it, so the second fiber to arrive finds the first's wait
 * rather than forking a second run of the same work. What every caller holds
 * is that one `Deferred`, completed with the fiber's own exit, so a run the
 * runtime interrupted on its way down ends every wait of it rather than
 * leaving one standing on a fiber that will never finish.
 */
import { Deferred, Effect, MutableRef } from "effect";

export const joinedOnce = <Value>(work: Effect.Effect<Value>): Effect.Effect<Value> => {
  const standing = MutableRef.make<Effect.Effect<Value> | undefined>(undefined);
  return Effect.suspend(() => {
    const held = MutableRef.get(standing);
    if (held) return held;
    const settled = Deferred.makeUnsafe<Value>();
    const wait = Deferred.await(settled);
    MutableRef.set(standing, wait);
    return Effect.flatMap(
      Effect.forkDetach(Effect.onExit(work, (exit) => Deferred.done(settled, exit))),
      () => wait,
    );
  });
};
