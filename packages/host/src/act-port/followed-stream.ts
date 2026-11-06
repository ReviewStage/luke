import { Effect, MutableHashMap, Option, Stream } from "effect";

/**
 * followed-stream.ts -- a follow the host holds at the Gateway, as the stream one window's procedure answers while the window holds it open.
 *
 * A window opens a stream of what it follows; the host follows it at the
 * Gateway as the first stream of it opens and lets it go once the last one
 * closes, so two panels drawing the same thing share one follow. Nothing is
 * heard down the stream, since what the host holds reaches the panel on app
 * state; the stream stands only for how long the window holds it.
 */

export interface FollowedDependencies<Scope, Key = string> {
  /** The key two scopes naming the same thing share, compared by structure. */
  readonly keyOf: (scope: Scope) => Key;
  readonly follow: (scope: Scope) => Effect.Effect<void>;
  readonly unfollow: (scope: Scope) => Effect.Effect<void>;
}

/** How many streams stand open of each followed thing, by its key, so the host lets one go only with the last stream of it. */
export type OpenFollows<Key = string> = MutableHashMap.MutableHashMap<Key, number>;

/** One stream a window holds open of `scope`, followed at the host while any stream of it stands. */
export function followedStream<Scope, Key = string>(
  dependencies: FollowedDependencies<Scope, Key>,
  open: OpenFollows<Key>,
  scope: Scope,
): Stream.Stream<never> {
  const key = dependencies.keyOf(scope);
  const streams = (): number => Option.getOrElse(MutableHashMap.get(open, key), () => 0);
  return Stream.callback<never>(() =>
    Effect.acquireRelease(
      Effect.suspend(() => {
        const standing = streams();
        MutableHashMap.set(open, key, standing + 1);
        return standing === 0 ? dependencies.follow(scope) : Effect.void;
      }),
      () =>
        Effect.suspend(() => {
          const standing = streams();
          if (standing > 1) {
            MutableHashMap.set(open, key, standing - 1);
            return Effect.void;
          }
          MutableHashMap.remove(open, key);
          return dependencies.unfollow(scope);
        }),
    ),
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
