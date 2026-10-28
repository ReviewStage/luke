/**
 * sync-woken.ts -- a wait held on Luke Sync's hub over the test's database, held to answering within a coalesce window of the write that settles it.
 */

import assert from "node:assert/strict";
import { Clock, Context, Duration, Effect, Fiber, Layer, Queue } from "effect";
import { syncHub } from "../sync/hub.js";
import { Sync, type SyncShape } from "../sync/watch.js";
import { announcingClock, driven } from "./clock-driven.js";

/** The hub's coalesce window: how long a woken watch gathers before it answers. */
const COALESCE = Duration.millis(100);

/**
 * Forks the wait on the hub, on a clock that announces each wait, makes the
 * write once the wait's first look found nothing and it waits on its watch,
 * and answers what each answered, failing unless the wait answered within
 * a coalesce window of the write. A wait on the wrong topics, or on its
 * clock alone, is never woken inside that window, so the test fails on its
 * timeout. Note that the waits announced before the write count for
 * nothing, so the clock moves only for the wake the write made.
 */
export const wokenOnHub = <A, E, R, W, WE, WR>(
  wait: Effect.Effect<A, E, R>,
  write: Effect.Effect<W, WE, WR>,
) =>
  Effect.gen(function* () {
    const hub = Context.get(yield* Layer.build(syncHub), Sync);
    const looking = yield* Queue.unbounded<void>();
    const announcing: SyncShape = {
      watch: (topics, fallback) =>
        Effect.map(hub.watch(topics, fallback), (watch) => ({
          ...watch,
          next: Effect.andThen(Queue.offer(looking, undefined), watch.next),
        })),
    };
    const { clock, asleep } = yield* announcingClock;
    const fiber = yield* Effect.forkChild(
      wait.pipe(Effect.provideService(Clock.Clock, clock), Effect.provideService(Sync, announcing)),
      { startImmediately: true },
    );
    const held = yield* Effect.raceFirst(
      Effect.as(Queue.take(looking), true),
      Effect.as(Fiber.await(fiber), false),
    );
    assert.ok(held, "the wait held, rather than answering at its first look");
    yield* Queue.clear(asleep);
    const from = yield* Clock.currentTimeMillis;
    const written = yield* write;
    const answered = yield* driven({ fiber, asleep }, COALESCE);
    assert.ok(
      (yield* Clock.currentTimeMillis) - from <= Duration.toMillis(COALESCE),
      "the wait answered within a coalesce window of the write",
    );
    return { written, answered };
  });
