/**
 * held-fetch.ts -- a read the host asks the service for on behalf of the windows that hold it, laid on its app-state slice and asked again whenever what it answers may have moved: a window holding it anew, a window coming forward, a wake that names it, its own schedule where it keeps one, and Try again.
 *
 * A fetch is a read nothing wakes of its own accord, as a live read is
 * woken: an agent's tools, or how long ago the account's devices beat. Each
 * key is one loop on the held lifetime (`heldSlice`): ask, lay what it
 * answered, then wait for the next cause to ask. So one ask at most is out
 * per key, and a cause that comes while one is out asks once more after it
 * lands, never beside it. An ask refused or unanswered keeps what the key
 * held, and fails a key that never answered. A write whose own answer is the
 * whole read lays it at once, and an ask out as it lands, asked before the
 * write, is dropped. A key let go stays among those let go lately, drawn at
 * once by a window holding it again, which asks it again; nothing else asks
 * a key no window holds.
 */

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

/** One key's loop as it stands: what it tells of its key, the cause it waits on next, each Try again waiting for its next ask to land, and whether an ask is out and a write's answer overtook it. */
interface FetchLoop<Rows> {
  readonly answers: HeldAnswers<Rows>;
  readonly again: Queue.Queue<void>;
  waiting: Deferred.Deferred<void>[];
  asking: boolean;
  overtaken: boolean;
}

/** The keys the windows hold of one fetched read, and what the host does for them. */
export interface HeldFetch<Key, Rows> {
  /** Holds `key`'s read for the caller's scope, asking it where no window held it. */
  readonly hold: (key: Key) => Effect.Effect<void, never, Scope.Scope>;
  /** Asks `key` again, as Try again or a write's read-back asks, telling it unread meanwhile where it had failed; answers once that ask has landed, or at once where nothing follows it. */
  readonly retry: (key: Key) => Effect.Effect<void>;
  /** Asks again every key a window holds that `named` picks, as a wake naming it asks; answers at once, each ask landing on its own. */
  readonly wake: (named: (key: Key) => boolean) => Effect.Effect<void>;
  /** Asks again every key a window holds that `named` picks, as `retry` asks one; answers once each of those asks has landed. */
  readonly reread: (named: (key: Key) => boolean) => Effect.Effect<void>;
  /** Lays `rows` as `key`'s answer where its read is followed, as a write whose own answer is the whole read does; nothing where it is not. */
  readonly answered: (key: Key, rows: Rows) => Effect.Effect<void>;
  /** Follows every held key anew, as the account gate opening asks. */
  readonly open: Effect.Effect<void>;
  /** Lets every key go and tells none held: the session ended. */
  readonly end: Effect.Effect<void>;
}

/** Answers each Try again in `waiting`, its ask having landed or never coming. */
const landed = (waiting: readonly Deferred.Deferred<void>[]) =>
  Effect.forEach(waiting, (each) => Deferred.succeed(each, undefined), { discard: true });

/**
 * A read the windows hold by key, fetched of the service as `fetch` asks it
 * and laid on its slice (`heldSlice`): asked as a window holds a key no
 * window held, again on every focus (`focus`), every `every` where it is
 * given, on `wake`, and on `retry`, each only while a window holds the key.
 */
export function heldFetch<Slice extends SliceKeyed, Key>(options: {
  /** The slice with no key held, as the host stands before any window holds one and after the session ends. */
  readonly empty: AppState[Slice];
  readonly path: (key: Key) => HostReadKeyPath<Slice>;
  /** Whether the account gate stands open, so a key may be asked. */
  readonly gate: () => boolean;
  /** The windows coming forward, on each of which every key a window holds is asked again. */
  readonly focus: WindowFocus;
  /** One ask of `key`'s read, given what it holds now: what it answered, or none where it was refused or not answered. */
  readonly fetch: (
    key: Key,
    held: AppHostReads[Slice] | undefined,
  ) => Effect.Effect<Option.Option<AppHostReads[Slice]>>;
  /** How often a key a window holds is asked again besides; never where it is not given. */
  readonly every?: Duration.Input;
  readonly tell: (slice: AppState[Slice]) => void;
}): Effect.Effect<HeldFetch<Key, AppHostReads[Slice]>, never, Scope.Scope> {
  return Effect.gen(function* () {
    type Rows = AppHostReads[Slice];
    const loops = MutableHashMap.empty<Key, FetchLoop<Rows>>();
    /** `key`'s loop asked once more, after any ask out now lands; nothing where nothing follows it. */
    const askAgain = (key: Key) =>
      Option.match(MutableHashMap.get(loops, key), {
        onNone: () => Effect.void,
        onSome: (loop) => Effect.asVoid(Queue.offer(loop.again, undefined)),
      });
    /** `key` asked now and again on each cause after, until let go. */
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
          // Note that a Try again waiting on an ask this loop will never make is answered as it ends, so none waits for good.
          yield* Effect.addFinalizer(() =>
            Effect.suspend(() => {
              if (Option.getOrUndefined(MutableHashMap.get(loops, key)) === loop) {
                MutableHashMap.remove(loops, key);
              }
              return landed(loop.waiting);
            }),
          );
          // Note that each Try again this ask took is answered however it ends, an interruption as the key is let go among them, so none waits for good.
          const ask = Effect.suspend(() => {
            const landing = loop.waiting;
            loop.waiting = [];
            loop.asking = true;
            loop.overtaken = false;
            return Effect.gen(function* () {
              const rows = yield* options.fetch(key, answers.rows());
              loop.asking = false;
              // Note that an answer asked before a write that answered the read whole is older than what that write laid.
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
    /** The keys a window holds that `named` picks. */
    const heldKeys = (named: (key: Key) => boolean) =>
      [...MutableHashMap.keys(loops)].filter((key) => slice.held(key) && named(key));
    const wake = (named: (key: Key) => boolean) =>
      Effect.suspend(() => Effect.forEach(heldKeys(named), askAgain, { discard: true }));
    /** `key` asked again, telling it unread meanwhile where it had failed, answering once that ask has landed. */
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
          // Note that a key let go lately stands with its last answer, which a window holding it again draws while it is asked again.
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

/** A fetched read keyed by the account signed in, as the windows hold it: one hold for all of them. */
export interface AccountHeld {
  /** The windows' hold, taken under the account signed in now; none while nobody is. */
  readonly follow: Effect.Effect<void>;
  /** The windows' hold let go. */
  readonly unfollow: Effect.Effect<void>;
  /** One window's hold for the caller's scope: the windows' hold taken with the first and let go with the last, as a live follow's stream stands for it. */
  readonly hold: Effect.Effect<void, never, Scope.Scope>;
  /** The hold taken anew under the account signed in now, where the windows hold it, as the account gate opening asks. */
  readonly open: Effect.Effect<void>;
}

/**
 * The windows' hold on `read`, a fetched read or any held one, keyed by
 * the account `accountId` names, taken under the account signed in as they
 * take it and taken anew, in place of the one before, each time the gate
 * opens, so whoever signs in next is the one read rather than the account it
 * was held for.
 */
export function accountHeld(
  read: Pick<HeldFetch<string, unknown>, "hold">,
  accountId: () => string | undefined,
): Effect.Effect<AccountHeld, never, Scope.Scope> {
  return Effect.gen(function* () {
    const hold = yield* FiberHandle.make<void>();
    let held = false;
    /** How many windows' scopes stand on the hold (`hold`). */
    let holders = 0;
    const take = Effect.suspend(() => {
      const userId = accountId();
      return userId === undefined
        ? FiberHandle.clear(hold)
        : FiberHandle.run(hold, Effect.scoped(Effect.andThen(read.hold(userId), Effect.never)));
    });
    const follow = Effect.suspend(() => {
      held = true;
      return take;
    });
    const unfollow = Effect.suspend(() => {
      held = false;
      return FiberHandle.clear(hold);
    });
    return {
      follow,
      unfollow,
      hold: Effect.acquireRelease(
        Effect.suspend(() => {
          holders += 1;
          return holders === 1 ? follow : Effect.void;
        }),
        () =>
          Effect.suspend(() => {
            holders -= 1;
            return holders === 0 ? unfollow : Effect.void;
          }),
      ),
      open: Effect.suspend(() => (held ? take : Effect.void)),
    };
  });
}
