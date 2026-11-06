import { createHash } from "node:crypto";
import type { SyncTopic } from "@repo/database/sync/notification";
import { Clock, Duration, Effect, Option } from "effect";
import { Sync } from "../sync/watch.js";

const CURSOR_CHARS = 32;

export interface CursorStamp {
  readonly id: string;
  readonly revision: number;
  readonly status: string;
  readonly updatedAt: number;
  readonly unread?: boolean;
  readonly waitsOn?: string;
}

export function cursorOf(stamps: readonly CursorStamp[]): string {
  const standing = stamps
    .map((stamp) => [
      stamp.id,
      stamp.revision,
      stamp.status,
      stamp.updatedAt,
      ...(stamp.unread === undefined ? [] : [stamp.unread]),
      ...(stamp.waitsOn === undefined ? [] : [stamp.waitsOn]),
    ])
    .toSorted(([a], [b]) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(standing)).digest("hex").slice(0, CURSOR_CHARS);
}

export interface Held<A> {
  readonly read: A;
  readonly txids: readonly string[];
  readonly heardAt: Option.Option<number>;
}

type ClockEdge<A> = (read: A) => number | undefined;

const NO_CLOCK_EDGE: ClockEdge<unknown> = () => undefined;

const NO_TXIDS: readonly string[] = [];

export function heldUntil<A, E, R>(
  read: Effect.Effect<A, E, R>,
  moved: (read: A) => boolean,
  topics: readonly SyncTopic[],
  poll: Duration.Duration,
  hold: Duration.Duration,
  edge: ClockEdge<A> = NO_CLOCK_EDGE,
): Effect.Effect<Option.Option<Held<A>>, E, R> {
  return Effect.scoped(
    Effect.gen(function* () {
      const watch = yield* (yield* Sync).watch(topics, poll);
      const woken = new Set<string>();
      let heardAt = Option.none<number>();
      let standing = yield* read;
      while (!moved(standing)) {
        const at = edge(standing);
        const wait =
          at === undefined
            ? Effect.map(watch.next, Option.some)
            : Effect.flatMap(Clock.currentTimeMillis, (now) =>
                Effect.timeoutOption(watch.next, Duration.millis(Math.max(0, at - now))),
              );
        const heard = yield* wait;
        for (const txid of Option.getOrElse(heard, () => NO_TXIDS)) woken.add(txid);
        heardAt = Option.isSome(heard) ? yield* watch.heardAt : Option.none();
        standing = yield* read;
      }
      return { read: standing, txids: [...woken], heardAt };
    }),
  ).pipe(Effect.timeoutOption(hold));
}

export function heldUntilMoved<E, R>(
  stamps: Effect.Effect<readonly CursorStamp[], E, R>,
  after: string,
  topics: readonly SyncTopic[],
  poll: Duration.Duration,
  hold: Duration.Duration,
): Effect.Effect<void, E, R> {
  return Effect.asVoid(
    heldUntil(stamps, (standing) => cursorOf(standing) !== after, topics, poll, hold),
  );
}
