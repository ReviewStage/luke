import { Effect, MutableHashMap, Option, Queue, Stream } from "effect";

/**
 * followed-stream.ts -- a follow the host holds at the Gateway, as the stream of changes one window's procedure answers while the window holds it open.
 *
 * A window opens a stream of what it follows; the host follows it at the
 * Gateway as the first stream of it opens and lets it go once the last one
 * closes, so two panels drawing the same thing share one follow. Every change
 * the host tells of it reaches every stream of it, and a stream that opens
 * on one already followed is told its last change at once.
 */

export interface FollowedDependencies<Scope, Changed, Value> {
  /** The key two scopes naming the same thing share. */
  readonly keyOf: (scope: Scope) => string;
  readonly follow: (scope: Scope) => Effect.Effect<void>;
  readonly unfollow: (scope: Scope) => Effect.Effect<void>;
  readonly onChanged: (listener: (changed: Changed) => void) => () => void;
  /** What a change the host told says of `scope`, none where it is another's. */
  readonly valueOf: (changed: Changed, scope: Scope) => Option.Option<Value>;
}

/** One followed thing: how many streams stand open of it, and its last change, once there is one. */
interface Held<Value> {
  readonly streams: number;
  readonly last: Option.Option<Value>;
}

/** Everything followed, by its key, so the host lets one go only with the last stream of it. */
export type OpenFollows<Value> = MutableHashMap.MutableHashMap<string, Held<Value>>;

/** The changes of `scope` for one stream a window holds open, followed at the host while any stream of it stands. */
export function followedStream<Scope, Changed, Value>(
  dependencies: FollowedDependencies<Scope, Changed, Value>,
  open: OpenFollows<Value>,
  scope: Scope,
): Stream.Stream<Value> {
  const key = dependencies.keyOf(scope);
  const held = (): Held<Value> =>
    Option.getOrElse(MutableHashMap.get(open, key), () => ({ streams: 0, last: Option.none() }));
  return Stream.callback<Value>((queue) =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          dependencies.onChanged((changed) => {
            const value = dependencies.valueOf(changed, scope);
            if (Option.isNone(value)) return;
            MutableHashMap.set(open, key, { ...held(), last: value });
            Queue.offerUnsafe(queue, value.value);
          }),
        ),
        (stop) => Effect.sync(stop),
      );
      yield* Effect.acquireRelease(
        Effect.suspend(() => {
          const standing = held();
          MutableHashMap.set(open, key, { ...standing, streams: standing.streams + 1 });
          if (standing.streams === 0) return dependencies.follow(scope);
          if (Option.isSome(standing.last)) Queue.offerUnsafe(queue, standing.last.value);
          return Effect.void;
        }),
        () =>
          Effect.suspend(() => {
            const standing = held();
            if (standing.streams > 1) {
              MutableHashMap.set(open, key, { ...standing, streams: standing.streams - 1 });
              return Effect.void;
            }
            MutableHashMap.remove(open, key);
            return dependencies.unfollow(scope);
          }),
      );
    }),
  );
}

/**
 * An async iterable as the iterator oRPC streams. Note that its end is
 * handed straight to the iterable's own, rather than through an async
 * generator, which would queue the end behind a read still waiting for the
 * next change and so never close the stream.
 */
export function streamed<A>(
  iterable: AsyncIterable<A>,
): AsyncIteratorObject<A, undefined, unknown> {
  const iterator = iterable[Symbol.asyncIterator]();
  const ended = async (): Promise<IteratorReturnResult<undefined>> => {
    await iterator.return?.();
    return { done: true, value: undefined };
  };
  const self: AsyncIteratorObject<A, undefined, unknown> = {
    next: async () => {
      const read = await iterator.next();
      return read.done === true ? { done: true, value: undefined } : read;
    },
    return: ended,
    [Symbol.asyncIterator]: () => self,
    [Symbol.asyncDispose]: async () => {
      await ended();
    },
  };
  return self;
}
