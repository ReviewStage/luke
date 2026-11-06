import { Effect, MutableHashMap, Option, Queue, Stream } from "effect";

export interface FollowedDependencies<Scope, Changed, Value, Key = string> {
  readonly keyOf: (scope: Scope) => Key;
  readonly follow: (scope: Scope) => Effect.Effect<void>;
  readonly unfollow: (scope: Scope) => Effect.Effect<void>;
  readonly onChanged: (listener: (changed: Changed) => void) => () => void;
  readonly valueOf: (changed: Changed, scope: Scope) => Option.Option<Value>;
}

interface Held<Value> {
  readonly streams: number;
  readonly last: Option.Option<Value>;
}

export type OpenFollows<Value, Key = string> = MutableHashMap.MutableHashMap<Key, Held<Value>>;

export function followedStream<Scope, Changed, Value, Key = string>(
  dependencies: FollowedDependencies<Scope, Changed, Value, Key>,
  open: OpenFollows<Value, Key>,
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
