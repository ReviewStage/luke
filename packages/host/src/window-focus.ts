/**
 * window-focus.ts -- the one signal that a window came forward, raised where the panel's focus already reaches the host, which every read the host asks again on focus hears.
 *
 * The desktop's panel window coming forward, and the web's tab shown again,
 * reach the host as the workspaces' refresh (`client/client-notices.ts`),
 * and that is where this is raised, so no window listens for focus itself
 * and no read adds a door of its own for it. A read of something nothing
 * wakes, a GitHub repository list or an agent's tools, asks again as it is
 * heard (`held-fetch.ts`). Each listener hears every raise from the moment
 * it listens until its scope closes, and a raise nobody listens for is lost,
 * which is all focus means: the reads held as it comes are the ones asked.
 */

import { Effect, PubSub, type Scope, Stream } from "effect";

/** A window coming forward, raised once and heard by every listener. */
export interface WindowFocus {
  /** A window came forward. */
  readonly raise: Effect.Effect<void>;
  /** Each window coming forward from now until the caller's scope closes, heard by the caller alone. */
  readonly heard: Effect.Effect<Stream.Stream<void>, never, Scope.Scope>;
}

/** The host's focus signal, for as long as the scope that made it stands. */
export const windowFocus: Effect.Effect<WindowFocus, never, Scope.Scope> = Effect.map(
  Effect.acquireRelease(PubSub.unbounded<void>(), PubSub.shutdown),
  (raised) => ({
    raise: Effect.asVoid(PubSub.publish(raised, undefined)),
    // Note that the subscription is taken as the caller listens, never as its stream first runs, so a raise right after is heard.
    heard: Effect.map(PubSub.subscribe(raised), Stream.fromSubscription),
  }),
);
