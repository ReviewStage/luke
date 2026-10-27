/**
 * watch.ts -- what a wait on the database waits through: a watch on topics, woken by Luke Sync or by its own clock.
 *
 * A reader that waits for rows to change opens a watch on the topics those
 * rows notify (`@luke/database/sync/notification`), then reads, then waits on
 * the watch's `next` before each read after. A watch registers before the
 * first read, so a write that commits while that read runs still wakes the
 * next `next`. Where nothing can wake it (Luke Sync off, its listener down,
 * or a watch on no topics) `next` waits the watch's fallback, the caller's
 * own poll, which is how every wait behaved before Luke Sync.
 *
 * `Sync` is the instance's hub (`hub.ts`) where the deployment provides one,
 * and the clock where it does not, so a runtime or a test that provides
 * nothing waits as it always has.
 */
import type { SyncTopic } from "@luke/database/sync/notification";
import { Context, type Duration, Effect, type Scope } from "effect";

/** The topics a watch with none names: it waits its fallback alone. */
export const NO_TOPICS: readonly SyncTopic[] = [];

/** What a `next` woken by no write answers. */
const NO_TXIDS: readonly string[] = [];

/** One reader's watch, standing for as long as the scope it was opened in. */
export interface SyncWatch {
  /**
   * Completes once a write on the watch's topics has committed since the
   * previous `next` returned, or since the watch was opened, answering the
   * ids of the transactions it saw; or after the fallback, answering none,
   * where the hub cannot wake it.
   */
  readonly next: Effect.Effect<readonly string[]>;
}

export interface SyncShape {
  /**
   * Opens a watch on the topics, answering once the listener hears them, so
   * a read made after it misses no commit; `fallback` is how long its `next`
   * waits where nothing wakes it.
   */
  readonly watch: (
    topics: readonly SyncTopic[],
    fallback: Duration.Duration,
  ) => Effect.Effect<SyncWatch, never, Scope.Scope>;
}

/** A watch only its clock wakes. */
export const clockWatch = (fallback: Duration.Duration): SyncWatch => ({
  next: Effect.as(Effect.sleep(fallback), NO_TXIDS),
});

/** Luke Sync turned off: every watch waits on its clock. */
export const CLOCK_SYNC: SyncShape = {
  watch: (_topics, fallback) => Effect.succeed(clockWatch(fallback)),
};

/** Luke Sync as one runtime has it: the hub where the deployment turned it on, the clock otherwise. */
export const Sync = Context.Reference<SyncShape>("@luke/service/Sync", {
  defaultValue: () => CLOCK_SYNC,
});
