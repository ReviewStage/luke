import {
  Deferred,
  type Duration,
  Effect,
  FiberHandle,
  MutableHashMap,
  Option,
  Queue,
  Schedule,
  type Scope,
  Stream,
} from "effect";
import type { AppHostReads, AppState, HostReadKeyPath } from "./app-state.js";
import { type HeldAnswers, type HeldSlice, heldSlice, type SliceKeyed } from "./live-collection.js";
import type { WindowFocus } from "./window-focus.js";

interface FetchLoop<Rows> {
  readonly answers: HeldAnswers<Rows>;
  readonly again: Queue.Queue<void>;
  waiting: Deferred.Deferred<void>[];
  asking: boolean;
  overtaken: boolean;
}

export interface HeldFetch<Key, Rows> {
  readonly hold: (key: Key) => Effect.Effect<void, never, Scope.Scope>;
  readonly retry: (key: Key) => Effect.Effect<void>;
  readonly wake: (named: (key: Key) => boolean) => Effect.Effect<void>;
  readonly reread: (named: (key: Key) => boolean) => Effect.Effect<void>;
  readonly answered: (key: Key, rows: Rows) => Effect.Effect<void>;
  readonly open: Effect.Effect<void>;
  readonly end: Effect.Effect<void>;
}

const landed = (waiting: readonly Deferred.Deferred<void>[]) =>
  Effect.forEach(waiting, (each) => Deferred.succeed(each, undefined), { discard: true });

export function heldFetch<Slice extends SliceKeyed, Key>(options: {
  readonly empty: AppState[Slice];
  readonly path: (key: Key) => HostReadKeyPath<Slice>;
  readonly gate: () => boolean;
  readonly focus: WindowFocus;
  readonly fetch: (
    key: Key,
    held: AppHostReads[Slice] | undefined,
  ) => Effect.Effect<Option.Option<AppHostReads[Slice]>>;
  readonly every?: Duration.Input;
  readonly tell: (slice: AppState[Slice]) => void;
}): Effect.Effect<HeldFetch<Key, AppHostReads[Slice]>, never, Scope.Scope> {
  return Effect.gen(function* () {
    type Rows = AppHostReads[Slice];
    const loops = MutableHashMap.empty<Key, FetchLoop<Rows>>();
    const askAgain = (key: Key) =>
      Option.match(MutableHashMap.get(loops, key), {
        onNone: () => Effect.void,
        onSome: (loop) => Effect.asVoid(Queue.offer(loop.again, undefined)),
      });
    const follow = (key: Key, answers: HeldAnswers<Rows>): Effect.Effect<void> =>
      Effect.scoped(
        Effect.gen(function* () {
          const loop: FetchLoop<Rows> = {
            answers,
            again: yield* Queue.sliding<void>(1),
            waiting: [],
            asking: false,
            overtaken: false,
          };
          MutableHashMap.set(loops, key, loop);
          yield* Effect.addFinalizer(() =>
            Effect.suspend(() => {
              if (Option.getOrUndefined(MutableHashMap.get(loops, key)) === loop) {
                MutableHashMap.remove(loops, key);
              }
              return landed(loop.waiting);
            }),
          );
          const ask = Effect.suspend(() => {
            const landing = loop.waiting;
            loop.waiting = [];
            loop.asking = true;
            loop.overtaken = false;
            return Effect.gen(function* () {
              const rows = yield* options.fetch(key, answers.rows());
              loop.asking = false;
              if (loop.overtaken) loop.overtaken = false;
              else if (Option.isSome(rows)) answers.answered(rows.value);
              else answers.unanswered();
            }).pipe(Effect.ensuring(landed(landing)));
          });
          const ticks: Stream.Stream<unknown> =
            options.every === undefined
              ? Stream.empty
              : Stream.fromSchedule(Schedule.spaced(options.every)).pipe(
                  Stream.filter(() => slice.held(key)),
                );
          yield* Stream.make(undefined).pipe(
            Stream.concat(Stream.merge(Stream.fromQueue(loop.again), ticks)),
            Stream.runForEach(() => ask),
          );
        }),
      );
    const slice: HeldSlice<Key> = yield* heldSlice<Slice, Key>({
      empty: options.empty,
      path: options.path,
      gate: options.gate,
      follow,
      tell: options.tell,
    });
    const heldKeys = (named: (key: Key) => boolean) =>
      [...MutableHashMap.keys(loops)].filter((key) => slice.held(key) && named(key));
    const wake = (named: (key: Key) => boolean) =>
      Effect.suspend(() => Effect.forEach(heldKeys(named), askAgain, { discard: true }));
    const retry = (key: Key) =>
      Effect.suspend(() => {
        const loop = Option.getOrUndefined(MutableHashMap.get(loops, key));
        if (loop === undefined) return Effect.void;
        return Effect.gen(function* () {
          const asked = yield* Deferred.make<void>();
          loop.waiting.push(asked);
          loop.answers.retried();
          yield* Queue.offer(loop.again, undefined);
          yield* Deferred.await(asked);
        });
      });
    yield* Effect.forkScoped(Stream.runForEach(yield* options.focus.heard, () => wake(() => true)));
    return {
      hold: (key) =>
        Effect.gen(function* () {
          const again = !slice.held(key) && MutableHashMap.has(loops, key);
          yield* slice.hold(key);
          if (again) yield* askAgain(key);
        }),
      retry,
      wake,
      reread: (named) =>
        Effect.suspend(() =>
          Effect.forEach(heldKeys(named), retry, { concurrency: "unbounded", discard: true }),
        ),
      answered: (key, rows) =>
        Effect.sync(() => {
          const loop = Option.getOrUndefined(MutableHashMap.get(loops, key));
          if (loop === undefined) return;
          loop.answers.answered(rows);
          if (loop.asking) loop.overtaken = true;
        }),
      open: slice.open,
      end: slice.end,
    };
  });
}

export interface AccountHeld {
  readonly follow: Effect.Effect<void>;
  readonly unfollow: Effect.Effect<void>;
  readonly open: Effect.Effect<void>;
}

export function accountHeld(
  read: Pick<HeldFetch<string, unknown>, "hold">,
  accountId: () => string | undefined,
): Effect.Effect<AccountHeld, never, Scope.Scope> {
  return Effect.gen(function* () {
    const hold = yield* FiberHandle.make<void>();
    let held = false;
    const take = Effect.suspend(() => {
      const userId = accountId();
      return userId === undefined
        ? FiberHandle.clear(hold)
        : FiberHandle.run(hold, Effect.scoped(Effect.andThen(read.hold(userId), Effect.never)));
    });
    return {
      follow: Effect.suspend(() => {
        held = true;
        return take;
      }),
      unfollow: Effect.suspend(() => {
        held = false;
        return FiberHandle.clear(hold);
      }),
      open: Effect.suspend(() => (held ? take : Effect.void)),
    };
  });
}
