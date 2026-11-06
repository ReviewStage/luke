import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { LIVE_READ } from "@repo/features/live-wire";
import {
  type AppStateDelivery,
  type AppStateSnapshot,
  withAppStateDelivery,
} from "@repo/host/app-state";
import {
  type Experiment,
  type ExperimentChoices,
  experimentOn,
  type HostCapability,
  NO_EXPERIMENTS,
} from "@repo/settings";
import { type AppSettingsView, appSettingsView } from "@repo/settings/wire";
import { type QueryClient, queryOptions, useQueryClient } from "@tanstack/react-query";
import { type Cause, Data, Effect, Option, Queue, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { useContext, useEffect } from "react";
import { appBridge } from "./app-bridge.js";
import { QUERY_ROOT } from "./query-keys.js";
import { rendererPromise, rendererRegistry, rendererRuntime } from "./renderer-runtime.js";
import { onFixtureMoved } from "./tasks/fixture-moves.js";
import {
  handFixtureClient,
  loadedTasksFixture,
  loadTasksFixture,
} from "./tasks/tasks-fixture-loader.js";

/** The two bridge calls a window reads its state through, and nothing else. */
interface AppStateSource {
  subscribe: (onDelivered: (delivered: AppStateDelivery) => void) => () => void;
  read: () => Promise<AppStateSnapshot>;
}

/** One reading of the document: the read that bootstraps the window, a delivery of what moved in it since, or a fixture run's stage moving on its own (`fixture-moves.ts`). */
type AppStateReading =
  | { readonly read: AppStateSnapshot }
  | { readonly delivered: AppStateDelivery }
  | typeof STAGE_MOVED;

/** A fixture run's stage moved, so the document held is staged again. */
const STAGE_MOVED = { stageMoved: true } as const;

/**
 * The bridge refused the one read, so this window has no document to draw.
 * Local to this module: what a reader outside it holds is `AppStateUnavailable`,
 * the union below, and the `_tag` is what tells the two arms apart.
 */
class AppStateUnread extends Data.TaggedError("AppStateUnread")<{
  readonly cause: unknown;
}> {}

/**
 * The two ways this window can be left without a document, which are one thing
 * to every reader: the bridge refused the read, or the deliveries ended before
 * one arrived — an atom over a stream that completes having emitted nothing
 * fails with `Cause.NoSuchElementError`, which is the same emptiness by
 * another name.
 */
type AppStateUnavailable = AppStateUnread | Cause.NoSuchElementError;

/**
 * Where the state is read from: the bridge this window holds. The two calls
 * are thunks read at each use rather than at module load, and the atom is kept
 * alive so the source stands in the registry for that registry's life rather
 * than being swept between the set and the read it was set for.
 */
const appStateSourceAtom: Atom.Writable<AppStateSource> = Atom.keepAlive(
  Atom.make({
    subscribe: (onDelivered: (delivered: AppStateDelivery) => void) =>
      appBridge().onAppState(onDelivered),
    read: () => appBridge().requestAppState(),
  }),
);

/**
 * Every reading the bridge has for this window, the subscription installed
 * before anything is asked for: a delivery landing while the read is in
 * flight is then kept rather than lost, which is what makes that read a
 * bootstrap and not a race. A fixture run's stage moving on its own is a
 * reading too, heard from the stage rather than the bridge
 * (`fixture-moves.ts`), which hands the document held on to be staged anew.
 */
const readings = (source: AppStateSource): Stream.Stream<AppStateReading, AppStateUnread> =>
  Stream.callback<AppStateReading, AppStateUnread>((queue) =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          source.subscribe((delivered) => {
            Queue.offerUnsafe(queue, { delivered });
          }),
        ),
        (stop) => Effect.sync(stop),
      );
      yield* Effect.acquireRelease(
        Effect.sync(() => onFixtureMoved(() => Queue.offerUnsafe(queue, STAGE_MOVED))),
        (stop) => Effect.sync(stop),
      );
      yield* Effect.forkScoped(
        Effect.matchEffect(
          Effect.tryPromise({
            try: () => source.read(),
            catch: (cause) => new AppStateUnread({ cause }),
          }),
          {
            onFailure: (refusal) => Queue.fail(queue, refusal),
            onSuccess: (read) => Queue.offer(queue, { read }),
          },
        ),
      );
    }),
  );

/**
 * The one rule a window adopts a delivery by. A delivery older than the one
 * held is dropped and nothing else is: the version rises with the document,
 * and a delivery that repeats it is this window's own facts having moved — its
 * mode, or the display under it — which the document does not number.
 */
function adopt(held: AppStateSnapshot, delivery: AppStateDelivery): AppStateSnapshot {
  return delivery.version < held.version ? held : withAppStateDelivery(held, delivery);
}

/** The document as this window holds it, and the deliveries heard before the read that bootstraps it answered. */
interface Adopting {
  readonly held: Option.Option<AppStateSnapshot>;
  readonly early: readonly AppStateDelivery[];
}

/**
 * The document this window draws, one reading at a time. A delivery is what
 * moved since the last its stream sent, so one heard before the read answered
 * waits for it and is laid over it then, by the same rule as any later one.
 *
 * What is adopted keeps the identity of every part of the held document a
 * delivery did not move (`withAppStateDelivery`): an entry it does not name
 * is the very object held, and one it names keeps every part of it that
 * said nothing new. A delivery crossed into this window as text, so without
 * that every memo and comparison keyed on what it carried would miss, and
 * every reader redraw, whatever moved.
 */
const adopted = (
  read: Stream.Stream<AppStateReading, AppStateUnread>,
): Stream.Stream<AppStateSnapshot, AppStateUnread> =>
  Stream.mapAccum(
    read,
    (): Adopting => ({ held: Option.none(), early: [] }),
    (state, reading): [Adopting, AppStateSnapshot[]] => {
      if ("read" in reading) {
        const held = state.early.reduce(adopt, reading.read);
        return [{ held: Option.some(held), early: [] }, [held]];
      }
      // Note that a stage that moved hands the document held on again, to be staged anew (`staged`).
      if ("stageMoved" in reading) {
        return [state, Option.isSome(state.held) ? [state.held.value] : []];
      }
      if (Option.isNone(state.held)) {
        return [{ ...state, early: [...state.early, reading.delivered] }, []];
      }
      const next = adopt(state.held.value, reading.delivered);
      if (next === state.held.value) return [state, []];
      return [{ held: Option.some(next), early: [] }, [next]];
    },
  );

/**
 * The document as this window draws it: main's, but in a fixture run, which
 * signs in to nothing, with what its profile stages laid over it, such as a
 * synthetic account signed in (`tasks-fixture.ts`'s `fixtureAppState`). Note
 * that the fixture is imported before the run's first document is handed
 * on, because no reader may draw that document unstaged first.
 */
function staged(state: AppStateSnapshot): Effect.Effect<AppStateSnapshot> {
  if (!state.run.fixtureMode) return Effect.succeed(state);
  return Effect.map(
    Effect.promise(loadTasksFixture),
    () => loadedTasksFixture()?.fixtureAppState(state) ?? state,
  );
}

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
const appStateAtom: Atom.Atom<AsyncResult.AsyncResult<AppStateSnapshot, AppStateUnavailable>> =
  Atom.keepAlive(
    rendererRuntime.atom((get) =>
      Stream.mapEffect(adopted(readings(get(appStateSourceAtom))), staged),
    ),
  );

/**
 * The document as main holds it, read before anything is drawn over it: the
 * first reading the atom answers with, which is the read the subscription was
 * installed for. Every later reading arrives on that subscription, or, in a
 * fixture run, from its stage moving. Run at the window root
 * (`window-root.tsx`) and nowhere else.
 */
export const appStateFirstRead: Effect.Effect<AppStateSnapshot, AppStateUnavailable> =
  AtomRegistry.getResult(rendererRegistry, appStateAtom);

/**
 * The document as one TanStack Query query, which a surface reads its part of
 * with `useQuery({ ...appStateQuery, select })` and a callback that cannot
 * wait a render with `getQueryData(appStateQuery.queryKey)` on the client
 * `useQueryClient` hands it. Its `queryFn` is the first read, and every
 * later reading is written into the cache as it arrives
 * (`useAppStateSubscription`), so it is never stale (`staleTime: Infinity`,
 * as the docs' guide to data pushed over a socket has it) and never read
 * again. A first read the bridge refused is not tried again, since the
 * window shows that failure at once.
 */
export const appStateQuery = queryOptions({
  queryKey: [QUERY_ROOT.APP_STATE],
  queryFn: () => rendererPromise(appStateFirstRead),
  staleTime: Infinity,
  retry: false,
});

/**
 * Writes every reading of the document into the window's Query client with
 * `setQueryData`, as the docs' guide to data pushed over a socket does from
 * a hook mounted once: the readings are the one subscription's
 * (`appStateAtom`), so `app:state` is still subscribed to once however many
 * readers the cache and the registry have. `AppStateSubscription` mounts it
 * beside each root's `QueryProvider`, and beside a test's own client
 * (`testing/copy-feedback.ts`).
 */
export function useAppStateSubscription(): void {
  const queryClient = useQueryClient();
  const registry = useContext(RegistryContext);
  // Note that the reading held now is written as the hook mounts (`immediate`), because a
  // delivery adopted between the root's first read and this mount would otherwise wait for the next.
  useEffect(() => {
    // Note that the client written into is handed to the fixture, whose staged acts read the run
    // from it (`act.ts`); the task that feeds the document straight into the cache rewrites this
    // subscription, and that hand-off must survive it.
    const takeBack = handFixtureClient(queryClient);
    const stop = registry.subscribe(
      appStateAtom,
      (result) => {
        const state = AsyncResult.value(result);
        if (Option.isSome(state)) queryClient.setQueryData(appStateQuery.queryKey, state.value);
      },
      { immediate: true },
    );
    return () => {
      stop();
      takeBack();
    };
  }, [queryClient, registry]);
}

/** `useAppStateSubscription` as an element, for a root to mount beside the surface it draws. */
export function AppStateSubscription(): null {
  useAppStateSubscription();
  return null;
}

/**
 * The document as `client` holds it, for a callback that cannot wait a
 * render: two acts asked in one breath arrive as two calls in one turn, and
 * the second has to read what the first left. The client is the caller's,
 * `useQueryClient`'s in a component and the one a test drew with in a test,
 * read with `getQueryData` as the docs' guide to reading the cache outside a
 * component does. Not a hook, so nothing redraws for it.
 */
export function appStateIn(client: QueryClient): AppStateSnapshot | undefined {
  return client.getQueryData(appStateQuery.queryKey);
}

/**
 * What a surface reads of the document, each a `select` for
 * `useQuery({ ...appStateQuery, select })`: one top-level slice, or one
 * answer made from one. Each is a module-level function, so its reference
 * stands still from render to render and Query runs it again only when the
 * document moves, as the docs' Render Optimizations guide asks of `select`.
 */
export const selectRun = (state: AppStateSnapshot) => state.run;
export const selectSettings = (state: AppStateSnapshot) => state.settings;
export const selectAccount = (state: AppStateSnapshot) => state.account;

/** Who is signed in, by the id and the address main's document names; none while none is. */
export interface SignedInAccount {
  readonly id: string | undefined;
  readonly email: string;
}

/** The account signed in, read for a `select` or from the document as it stands; none while none is. */
export const selectSignedIn = (state: AppStateSnapshot | undefined): SignedInAccount | undefined =>
  state?.account.status === ACCOUNT_STATUS.SIGNED_IN
    ? { id: state.account.id, email: state.account.email }
    : undefined;

/**
 * Whether two readings name one account: by id where both name one, else by
 * address. Note that an account signed in before its id is read names only
 * its address, so a refresh that brings the id is still that account.
 */
export function sameAccount(
  one: SignedInAccount | undefined,
  other: SignedInAccount | undefined,
): boolean {
  if (one === undefined || other === undefined) return one === other;
  return one.id !== undefined && other.id !== undefined
    ? one.id === other.id
    : one.email === other.email;
}
export const selectAccess = (state: AppStateSnapshot) => state.access;
export const selectUpdate = (state: AppStateSnapshot) => state.update;
export const selectAudio = (state: AppStateSnapshot) => state.audio;
export const selectTasks = (state: AppStateSnapshot) => state.tasks;
export const selectAgents = (state: AppStateSnapshot) => state.agents;
export const selectInbox = (state: AppStateSnapshot) => state.inbox;
export const selectPullRequestPublished = (state: AppStateSnapshot) =>
  state[LIVE_READ.PULL_REQUEST_PUBLISHED];
export const selectMacCommands = (state: AppStateSnapshot) => state.macCommands;
export const selectNotifications = (state: AppStateSnapshot) => state.notifications;
export const selectNetwork = (state: AppStateSnapshot) => state.network;
export const selectSessionReplay = (state: AppStateSnapshot) => state.sessionReplay;
export const selectWindow = (state: AppStateSnapshot) => state.window;
export const selectPortForwarding = (state: AppStateSnapshot) => state.portForwarding;

/** The account's workspaces, which tell their readers only as the list moves, not as the tasks beside it do. */
export const selectWorkspaces = (state: AppStateSnapshot) => state.tasks.workspaces;

/**
 * Whether the first read has answered with settings: nothing is drawn over
 * a document without them, and the window reports itself painted on the
 * first that holds them.
 */
export const selectSettingsHeld = (state: AppStateSnapshot): boolean =>
  state.settings !== undefined;

/** The settings as the panel draws them. */
export const selectAppSettingsView = (state: AppStateSnapshot): AppSettingsView | undefined =>
  state.settings === undefined ? undefined : appSettingsView(state.settings);

/** Every experiment the account chose; signed out, every one is off. */
export const selectExperimentChoices = (state: AppStateSnapshot): ExperimentChoices =>
  state.settings?.experiments ?? NO_EXPERIMENTS;

/** Whether the signed-in account is an admin; signed out, or where the host's read of it failed, none is. */
export const selectAdminAccess = (state: AppStateSnapshot): boolean => state.access.admin === true;

/** Whether the account's access is still being read, as it is for a moment after a sign-in or a launch. */
export const selectAdminAccessPending = (state: AppStateSnapshot): boolean =>
  state.access.pending === true;

const experimentSelects = new Map<Experiment, (state: AppStateSnapshot) => boolean>();

/**
 * Whether the signed-in account has one experiment on: the one way a gated
 * feature's row, command, and place ask. One function per experiment, made
 * once and kept, so the `select` a surface hands Query stands still from
 * render to render. Signed out, every experiment is off.
 */
export function selectExperiment(experiment: Experiment): (state: AppStateSnapshot) => boolean {
  const held = experimentSelects.get(experiment);
  if (held !== undefined) return held;
  const select = (state: AppStateSnapshot): boolean =>
    experimentOn(selectExperimentChoices(state), experiment);
  experimentSelects.set(experiment, select);
  return select;
}

const capabilitySelects = new Map<HostCapability, (state: AppStateSnapshot) => boolean>();

/**
 * Whether the platform this window runs on offers one capability: the one
 * way a platform feature's tab, command, or button asks whether to stand at
 * all. One function per capability, made once and kept, as
 * `selectExperiment`'s are.
 */
export function selectCapability(capability: HostCapability): (state: AppStateSnapshot) => boolean {
  const held = capabilitySelects.get(capability);
  if (held !== undefined) return held;
  const select = (state: AppStateSnapshot): boolean => state.run.capabilities.includes(capability);
  capabilitySelects.set(capability, select);
  return select;
}

/**
 * A `select` whose answer is made once per change to the parts of the
 * document it reads, for every reader: `inputs` names those parts, and
 * `derive` is run again only when one of them is a new object. Note that
 * the last answer is kept rather than one per reader, because every reader
 * of a window reads the one document, so a delivery that moved none of the
 * parts hands each the same object. For an answer Query's structural
 * sharing cannot keep, such as a `Map` or a `Set`, which would otherwise be
 * made anew, and redraw its reader, on every delivery to any slice.
 */
export function memoizedSelect<Inputs extends unknown[], A>(
  inputs: (state: AppStateSnapshot) => [...Inputs],
  derive: (...inputs: Inputs) => A,
): (state: AppStateSnapshot) => A {
  let held: { readonly inputs: Inputs; readonly answer: A } | undefined;
  return (state) => {
    const next = inputs(state);
    if (held !== undefined && next.every((input, at) => input === held?.inputs[at])) {
      return held.answer;
    }
    held = { inputs: next, answer: derive(...next) };
    return held.answer;
  };
}
