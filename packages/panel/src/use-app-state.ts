import { useAtomValue } from "@effect/atom-react/Hooks";
import {
  type AppStateDelivery,
  type AppStateSnapshot,
  withAppStateDelivery,
} from "@luke/host/app-state";
import {
  type Experiment,
  type ExperimentChoices,
  experimentOn,
  type HostCapability,
  NO_EXPERIMENTS,
} from "@luke/settings";
import { type AppSettingsView, appSettingsView } from "@luke/settings/wire";
import { type Cause, Data, Effect, Option, Queue, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { appBridge } from "./app-bridge.js";
import { rendererRegistry, rendererRuntime } from "./renderer-runtime.js";
import { loadedTasksFixture, loadTasksFixture } from "./tasks/tasks-fixture-loader.js";

/** The two bridge calls a window reads its state through, and nothing else. */
interface AppStateSource {
  subscribe: (onDelivered: (delivered: AppStateDelivery) => void) => () => void;
  read: () => Promise<AppStateSnapshot>;
}

/** One reading of the document: the read that bootstraps the window, or a delivery of what moved in it since. */
type AppStateReading =
  | { readonly read: AppStateSnapshot }
  | { readonly delivered: AppStateDelivery };

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
 * bootstrap and not a race.
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
 * installed for. Every later reading arrives on that subscription. Run at
 * the window root (`window-root.tsx`) and nowhere else.
 */
export const appStateFirstRead: Effect.Effect<AppStateSnapshot, AppStateUnavailable> =
  AtomRegistry.getResult(rendererRegistry, appStateAtom);

/**
 * The snapshot as it stands, for a callback that cannot wait a render: two
 * acts asked in one breath arrive as two calls in one turn, and the second
 * has to read what the first left. Not a hook, so nothing redraws for it.
 */
export function appStateNow(): AppStateSnapshot | undefined {
  return Option.getOrUndefined(AsyncResult.value(rendererRegistry.get(appStateAtom)));
}

/** This window's snapshot, absent only before the first read has answered. */
export function useAppState(): AppStateSnapshot | undefined {
  return Option.getOrUndefined(AsyncResult.value(useAtomValue(appStateAtom)));
}

/**
 * An atom of what `derive` makes of this window's snapshot, computed once per
 * delivery for every reader rather than once per reader, over the one
 * subscription. `derive` is handed the snapshot `useAppState` answers, so
 * a hook reading the atom and one reading the snapshot cannot disagree.
 */
export function appStateDerivedAtom<A>(
  derive: (state: AppStateSnapshot | undefined) => A,
): Atom.Atom<A> {
  return Atom.map(appStateAtom, (result) =>
    derive(Option.getOrUndefined(AsyncResult.value(result))),
  );
}

/**
 * One top-level slice of the snapshot, none before the first read. It tells
 * its readers only when the slice is a new object, which a delivery that did
 * not move it never makes (`adopted`), so a reader of one slice is not drawn
 * again for a patch to another.
 */
function sliceAtom<Key extends keyof AppStateSnapshot>(
  key: Key,
): Atom.Atom<AppStateSnapshot[Key] | undefined> {
  return appStateDerivedAtom((state) => state?.[key]);
}

/**
 * Every slice of the document, each its own atom, read with `useAppSlice`.
 * A surface reads the narrowest it draws from, so a patch to the settings
 * draws the settings' readers again and leaves the tasks' alone; the whole
 * snapshot (`useAppState`) is for the few readers that hand it on whole.
 */
export const APP_SLICE = {
  RUN: sliceAtom("run"),
  SETTINGS: sliceAtom("settings"),
  ACCOUNT: sliceAtom("account"),
  ACCESS: sliceAtom("access"),
  UPDATE: sliceAtom("update"),
  AUDIO: sliceAtom("audio"),
  VOICE: sliceAtom("voice"),
  CALL_TRANSCRIPT: sliceAtom("callTranscript"),
  TASKS: sliceAtom("tasks"),
  CODING_AGENTS: sliceAtom("codingAgents"),
  INBOX: sliceAtom("inbox"),
  MAC_COMMANDS: sliceAtom("macCommands"),
  NOTIFICATIONS: sliceAtom("notifications"),
  NETWORK: sliceAtom("network"),
  SESSION_REPLAY: sliceAtom("sessionReplay"),
  WINDOW: sliceAtom("window"),
} as const;

/** Whether the first read has answered at all, which redraws its reader once, as it does. */
export const APP_STATE_HELD: Atom.Atom<boolean> = appStateDerivedAtom(
  (state) => state !== undefined,
);

/**
 * Whether the first read has answered with settings: nothing is drawn over
 * a document without them, and the window reports itself painted on the
 * first that holds them.
 */
export const SETTINGS_HELD: Atom.Atom<boolean> = Atom.map(
  APP_SLICE.SETTINGS,
  (settings) => settings !== undefined,
);

/** The settings as the panel draws them, made once per change to the settings slice for every reader. */
export const APP_SETTINGS_VIEW: Atom.Atom<AppSettingsView | undefined> = Atom.map(
  APP_SLICE.SETTINGS,
  (settings) => (settings === undefined ? undefined : appSettingsView(settings)),
);

/** Whether the runtime offers voice at all, which redraws its reader only as it turns. */
export const VOICE_AVAILABLE: Atom.Atom<boolean> = Atom.map(
  APP_SLICE.SETTINGS,
  (settings) => settings?.status.voiceAvailable === true,
);

/**
 * One slice of this window's snapshot, or one field of one (`APP_SLICE`,
 * or an atom built over one), redrawn only as that moves.
 */
export function useAppSlice<A>(slice: Atom.Atom<A>): A {
  return useAtomValue(slice);
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

/** Whether the account has one experiment on, an atom per experiment, which tells its readers only as that one turns. */
const experimentAtom = Atom.family((experiment: Experiment) =>
  Atom.map(APP_SLICE.SETTINGS, (settings) =>
    experimentOn(settings?.experiments ?? NO_EXPERIMENTS, experiment),
  ),
);

/**
 * Whether the signed-in account has an experiment on, redrawn as it moves:
 * the one way a gated feature's row, command, and place ask, so each appears
 * and goes as its switch in Settings › Experimental does. Signed out, or
 * before the first read, every experiment is off.
 */
export function useExperiment(experiment: Experiment): boolean {
  return useAtomValue(experimentAtom(experiment));
}

/** Every experiment the account chose, which tells its readers as any of them turns: for a list that filters entries tagged with their experiment as it is built. */
const experimentChoicesAtom = Atom.map(
  APP_SLICE.SETTINGS,
  (settings): ExperimentChoices => settings?.experiments ?? NO_EXPERIMENTS,
);

/**
 * The signed-in account's experiment choices, redrawn as they move: what a
 * list gating its entries by a tag on their declaration filters by, such as
 * the Settings pages (`settingsPageShown`). Signed out, every one is off.
 */
export function useExperimentChoices(): ExperimentChoices {
  return useAtomValue(experimentChoicesAtom);
}

/**
 * The same answer for a callback that cannot wait a render.
 *
 * @public The door `AGENTS.md`'s "Experiments" names for a gated callback, kept for the next one.
 */
export function experimentOnNow(experiment: Experiment): boolean {
  return experimentOn(appStateNow()?.settings?.experiments ?? NO_EXPERIMENTS, experiment);
}

/** Whether the platform offers one capability, an atom per capability, which tells its readers only as that one turns. */
const capabilityAtom = Atom.family((capability: HostCapability) =>
  Atom.map(APP_SLICE.RUN, (run) => run?.capabilities.includes(capability) === true),
);

/** Whether the signed-in account is an admin, which tells its readers only as it turns. */
const ADMIN_ACCESS: Atom.Atom<boolean> = Atom.map(
  APP_SLICE.ACCESS,
  (access) => access?.admin === true,
);

/** Whether the account's access is not read yet, before the first read of the document among it. */
const ADMIN_ACCESS_PENDING: Atom.Atom<boolean> = Atom.map(
  APP_SLICE.ACCESS,
  (access) => access === undefined || access.pending === true,
);

/**
 * Whether the signed-in account is an admin, redrawn as it moves: what the
 * sidebar offers the Admin place by, and what the window's history and shell
 * let it stand by. Signed out, before the first read,
 * or where the host's read of it failed, no account is. It only draws: the
 * dashboard's own gate on the service decides every admin read.
 */
export function useAdminAccess(): boolean {
  return useAtomValue(ADMIN_ACCESS);
}

/**
 * Whether the signed-in account's access is still being read, as it is for
 * a moment after a sign-in or a launch: what an admin alone may reach waits
 * on it rather than being refused, a reloaded Admin address among it.
 */
export function useAdminAccessPending(): boolean {
  return useAtomValue(ADMIN_ACCESS_PENDING);
}

/**
 * Whether the platform this window runs on offers a capability, redrawn as
 * the document arrives: the one way a platform feature's tab, command, or
 * button asks whether to stand at all. Before the first read nothing is
 * offered, as no experiment is on.
 */
export function useCapability(capability: HostCapability): boolean {
  return useAtomValue(capabilityAtom(capability));
}

/** The same answer for a callback that cannot wait a render. */
export function capabilityNow(capability: HostCapability): boolean {
  return appStateNow()?.run.capabilities.includes(capability) === true;
}
