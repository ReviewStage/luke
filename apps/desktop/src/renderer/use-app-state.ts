import * as Atom from "@effect-atom/atom/Atom";
import * as Registry from "@effect-atom/atom/Registry";
import * as Result from "@effect-atom/atom/Result";
import { useAtomValue } from "@effect-atom/atom-react/Hooks";
import { type AppSettingsView, appSettingsView } from "@sidecar/settings/wire";
import { Data, Effect, identity, Option, Stream } from "effect";
import type { AppStateSnapshot } from "#shared/messages/app-state";
import { rendererRegistry, rendererRuntime } from "./renderer-runtime";

/** The two bridge calls a window reads its state through, and nothing else. */
export interface AppStateSource {
  subscribe: (onDelivered: (delivered: AppStateSnapshot) => void) => () => void;
  read: () => Promise<AppStateSnapshot>;
}

/** The bridge refused the one read, so this window has no document to draw. */
export class AppStateUnread extends Data.TaggedError("AppStateUnread")<{
  readonly cause: unknown;
}> {}

/**
 * Where the state is read from. The bridge is what a window holds; a test
 * holds a source of its own, in a registry of its own, which is why the source
 * is an atom rather than a module constant.
 *
 * The two calls are thunks read at each use rather than at module load: this
 * module is imported by the tests that exercise the rule below, which have no
 * bridge. It is kept alive so a source set into a registry stands there for
 * that registry's life, rather than being swept between the set and the read
 * it was set for.
 */
export const appStateSourceAtom: Atom.Writable<AppStateSource> = Atom.keepAlive(
  Atom.make({
    subscribe: (onDelivered: (delivered: AppStateSnapshot) => void) =>
      window.sidecar.onAppState(onDelivered),
    read: () => window.sidecar.requestAppState(),
  }),
);

/**
 * Every reading the bridge has for this window, the subscription installed
 * before anything is asked for: a delivery landing while the read is in
 * flight is then kept rather than lost, which is what makes that read a
 * bootstrap and not a race.
 */
const deliveries = (source: AppStateSource): Stream.Stream<AppStateSnapshot, AppStateUnread> =>
  Stream.asyncPush<AppStateSnapshot, AppStateUnread>((emit) =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          source.subscribe((delivered) => {
            emit.single(delivered);
          }),
        ),
        (stop) => Effect.sync(stop),
      );
      yield* Effect.forkScoped(
        Effect.matchEffect(
          Effect.tryPromise({
            try: () => source.read(),
            catch: (cause) => new AppStateUnread({ cause }),
          }),
          {
            onFailure: (refusal) =>
              Effect.sync(() => {
                emit.fail(refusal);
              }),
            onSuccess: (answered) =>
              Effect.sync(() => {
                emit.single(answered);
              }),
          },
        ),
      );
    }),
  );

/**
 * The one rule a window adopts a delivery by. A delivery older than the one
 * held is dropped and nothing else is: the version rises with the document,
 * and a delivery that repeats it is this window's own facts having moved — its
 * mode, or the display under it — which the document does not number and
 * every reader still has to be told.
 */
const adopted = (
  delivered: Stream.Stream<AppStateSnapshot, AppStateUnread>,
): Stream.Stream<AppStateSnapshot, AppStateUnread> =>
  Stream.filterMap(
    Stream.mapAccum(delivered, Option.none<AppStateSnapshot>(), (held, delivery) =>
      Option.isSome(held) && delivery.version < held.value.version
        ? [held, Option.none<AppStateSnapshot>()]
        : [Option.some(delivery), Option.some(delivery)],
    ),
    identity,
  );

/**
 * This window's copy of the one document main holds, and the one subscription
 * behind it.
 *
 * Every reader shares it, so `app:state` is subscribed to exactly once however
 * many components read state, and a component that mounts late is handed what
 * already arrived rather than asking again. It is kept alive because the
 * subscription is every reader's: a component unmounting is no reason to stop
 * listening, and the window going away is the whole of its life.
 */
export const appStateAtom: Atom.Atom<Result.Result<AppStateSnapshot, AppStateUnread>> =
  Atom.keepAlive(rendererRuntime.atom((get) => adopted(deliveries(get(appStateSourceAtom)))));

/**
 * The document as main holds it, read before anything is drawn over it: the
 * first reading the atom answers with, which is the read the subscription was
 * installed for. Every later reading arrives on that subscription. Run at a
 * renderer root and nowhere else.
 */
export const appStateFirstRead: Effect.Effect<AppStateSnapshot, AppStateUnread> =
  Registry.getResult(rendererRegistry, appStateAtom);

/**
 * The snapshot as it stands, for a callback that cannot wait a render: two
 * acts asked in one breath arrive as two calls in one turn, and the second
 * has to read what the first left. Not a hook, so nothing redraws for it.
 */
export function appStateNow(): AppStateSnapshot | undefined {
  return Option.getOrUndefined(Result.value(rendererRegistry.get(appStateAtom)));
}

/** This window's snapshot, absent only before the first read has answered. */
export function useAppState(): AppStateSnapshot | undefined {
  return Option.getOrUndefined(Result.value(useAtomValue(appStateAtom)));
}

/**
 * The settings as the document holds them, for a callback that cannot wait a
 * render: two actions asked in one breath arrive as two calls in one turn, and
 * the second has to compose against what the first stored.
 */
export function appSettingsNow(): AppSettingsView | undefined {
  const stored = appStateNow()?.settings;
  return stored ? appSettingsView(stored) : undefined;
}
