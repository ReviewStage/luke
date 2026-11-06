import { useAtomValue } from "@effect/atom-react/Hooks";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
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
import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { type Cause, Data, Effect, Option, Queue, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { useContext, useEffect } from "react";
import { appBridge } from "./app-bridge.js";
import { QUERY_ROOT } from "./query-keys.js";
import { rendererPromise, rendererRegistry, rendererRuntime } from "./renderer-runtime.js";
import { onFixtureMoved } from "./tasks/fixture-moves.js";
import { loadedTasksFixture, loadTasksFixture } from "./tasks/tasks-fixture-loader.js";

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
  useEffect(
    () =>
      registry.subscribe(
        appStateAtom,
        (result) => {
          const state = AsyncResult.value(result);
          if (Option.isSome(state)) queryClient.setQueryData(appStateQuery.queryKey, state.value);
        },
        { immediate: true },
      ),
    [queryClient, registry],
  );
}

/** `useAppStateSubscription` as an element, for a root to mount beside the surface it draws. */
export function AppStateSubscription(): null {
  useAppStateSubscription();
  return null;
}

/**
 * The snapshot as it stands, for a callback that cannot wait a render: two
 * acts asked in one breath arrive as two calls in one turn, and the second
 * has to read what the first left. Not a hook, so nothing redraws for it.
 */
export function appStateNow(): AppStateSnapshot | undefined {
  return Option.getOrUndefined(AsyncResult.value(rendererRegistry.get(appStateAtom)));
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
  TASKS: sliceAtom("tasks"),
  AGENTS: sliceAtom("agents"),
  INBOX: sliceAtom("inbox"),
  ACCOUNT_PREFERENCES: sliceAtom(LIVE_READ.ACCOUNT_PREFERENCES),
  AGENT_ORIGINS: sliceAtom(LIVE_READ.AGENT_ORIGINS),
  INBOX_ITEMS: sliceAtom(LIVE_READ.INBOX_ITEMS),
  HOLDER_INBOX: sliceAtom(LIVE_READ.HOLDER_INBOX),
  INSTALLED_SKILLS: sliceAtom(LIVE_READ.INSTALLED_SKILLS),
  INTEGRATIONS: sliceAtom(LIVE_READ.INTEGRATIONS),
  INTEGRATION_TOOLS: sliceAtom(LIVE_READ.INTEGRATION_TOOLS),
  LINK_STANDINGS: sliceAtom(LIVE_READ.LINK_STANDINGS),
  MEMORIES: sliceAtom(LIVE_READ.MEMORIES),
  MODELS: sliceAtom(LIVE_READ.MODELS),
  PAGES: sliceAtom(LIVE_READ.PAGES),
  PROVIDER_KEYS: sliceAtom(LIVE_READ.PROVIDER_KEYS),
  PULL_REQUEST: sliceAtom(LIVE_READ.PULL_REQUEST),
  REPOSITORY_LISTS: sliceAtom(LIVE_READ.REPOSITORY_LISTS),
  GITHUB_TOKEN: sliceAtom(LIVE_READ.GITHUB_TOKEN),
  PULL_REQUEST_CHAPTERS: sliceAtom(LIVE_READ.PULL_REQUEST_CHAPTERS),
  PULL_REQUEST_CHECKS: sliceAtom(LIVE_READ.PULL_REQUEST_CHECKS),
  PULL_REQUEST_CONVERSATION: sliceAtom(LIVE_READ.PULL_REQUEST_CONVERSATION),
  PULL_REQUEST_PUBLISHED: sliceAtom(LIVE_READ.PULL_REQUEST_PUBLISHED),
  PULL_REQUEST_VIEWED: sliceAtom(LIVE_READ.PULL_REQUEST_VIEWED),
  REVIEW_OPTIONS: sliceAtom(LIVE_READ.REVIEW_OPTIONS),
  BROWSER_TABS: sliceAtom(LIVE_READ.BROWSER_TABS),
  DEVICE_PRESENCE: sliceAtom(LIVE_READ.DEVICE_PRESENCE),
  HOSTS: sliceAtom(LIVE_READ.HOSTS),
  WORKSPACE_INVITATIONS: sliceAtom(LIVE_READ.WORKSPACE_INVITATIONS),
  THIS_MAC_HOST: sliceAtom(LIVE_READ.THIS_MAC_HOST),
  TRANSCRIPT: sliceAtom(LIVE_READ.TRANSCRIPT),
  WORKSPACE_MEMBERS: sliceAtom(LIVE_READ.WORKSPACE_MEMBERS),
  WORKSPACE_INTEGRATIONS: sliceAtom(LIVE_READ.WORKSPACE_INTEGRATIONS),
  SLACK_CHANNELS: sliceAtom(LIVE_READ.SLACK_CHANNELS),
  TOKEN_REPOSITORIES: sliceAtom(LIVE_READ.TOKEN_REPOSITORIES),
  WORKSPACE_PHOTOS: sliceAtom(LIVE_READ.WORKSPACE_PHOTOS),
  WORKSPACE_TOOLS: sliceAtom(LIVE_READ.WORKSPACE_TOOLS),
  MCP_CLIENTS: sliceAtom(LIVE_READ.MCP_CLIENTS),
  AUTOMATIONS: sliceAtom(LIVE_READ.AUTOMATIONS),
  AUTOMATION_WORKSPACE_RUNS: sliceAtom(LIVE_READ.AUTOMATION_WORKSPACE_RUNS),
  AUTOMATION_RUNS: sliceAtom(LIVE_READ.AUTOMATION_RUNS),
  PLAN_COMMENTS: sliceAtom(LIVE_READ.PLAN_COMMENTS),
  HISTORY: sliceAtom(LIVE_READ.HISTORY),
  PLAN_DOCUMENT: sliceAtom(LIVE_READ.PLAN_DOCUMENT),
  MAC_COMMANDS: sliceAtom("macCommands"),
  NOTIFICATIONS: sliceAtom("notifications"),
  NETWORK: sliceAtom("network"),
  SESSION_REPLAY: sliceAtom("sessionReplay"),
  PORT_FORWARDING: sliceAtom("portForwarding"),
  WINDOW: sliceAtom("window"),
} as const;

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

/**
 * One slice of this window's snapshot, or one field of one (`APP_SLICE`,
 * or an atom built over one), redrawn only as that moves.
 */
export function useAppSlice<A>(slice: Atom.Atom<A>): A {
  return useAtomValue(slice);
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
 * `navigation-history.ts` alone reads it here, until the cleanup PR; a surface
 * reads the same answer through `appStateQuery` and its `select`.
 */
export function useExperimentChoices(): ExperimentChoices {
  return useAtomValue(experimentChoicesAtom);
}

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
 * `navigation-history.ts` alone reads it here, until the cleanup PR; a surface
 * reads the same answer through `appStateQuery` and its `select`.
 */
export function useAdminAccess(): boolean {
  return useAtomValue(ADMIN_ACCESS);
}

/**
 * Whether the signed-in account's access is still being read, as it is for
 * a moment after a sign-in or a launch: what an admin alone may reach waits
 * on it rather than being refused, a reloaded Admin address among it.
 * `navigation-history.ts` alone reads it here, until the cleanup PR; a surface
 * reads the same answer through `appStateQuery` and its `select`.
 */
export function useAdminAccessPending(): boolean {
  return useAtomValue(ADMIN_ACCESS_PENDING);
}

/** The same answer for a callback that cannot wait a render. */
export function capabilityNow(capability: HostCapability): boolean {
  return appStateNow()?.run.capabilities.includes(capability) === true;
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
export const selectAccess = (state: AppStateSnapshot) => state.access;
export const selectUpdate = (state: AppStateSnapshot) => state.update;
export const selectAudio = (state: AppStateSnapshot) => state.audio;
export const selectTasks = (state: AppStateSnapshot) => state.tasks;
export const selectAgents = (state: AppStateSnapshot) => state.agents;
export const selectInbox = (state: AppStateSnapshot) => state.inbox;
export const selectAccountPreferences = (state: AppStateSnapshot) =>
  state[LIVE_READ.ACCOUNT_PREFERENCES];
export const selectAgentOrigins = (state: AppStateSnapshot) => state[LIVE_READ.AGENT_ORIGINS];
export const selectInboxItems = (state: AppStateSnapshot) => state[LIVE_READ.INBOX_ITEMS];
export const selectHolderInbox = (state: AppStateSnapshot) => state[LIVE_READ.HOLDER_INBOX];
export const selectInstalledSkills = (state: AppStateSnapshot) => state[LIVE_READ.INSTALLED_SKILLS];
export const selectIntegrations = (state: AppStateSnapshot) => state[LIVE_READ.INTEGRATIONS];
export const selectIntegrationTools = (state: AppStateSnapshot) =>
  state[LIVE_READ.INTEGRATION_TOOLS];
export const selectLinkStandings = (state: AppStateSnapshot) => state[LIVE_READ.LINK_STANDINGS];
export const selectMemories = (state: AppStateSnapshot) => state[LIVE_READ.MEMORIES];
export const selectModels = (state: AppStateSnapshot) => state[LIVE_READ.MODELS];
export const selectPages = (state: AppStateSnapshot) => state[LIVE_READ.PAGES];
export const selectProviderKeys = (state: AppStateSnapshot) => state[LIVE_READ.PROVIDER_KEYS];
export const selectPullRequest = (state: AppStateSnapshot) => state[LIVE_READ.PULL_REQUEST];
export const selectRepositoryLists = (state: AppStateSnapshot) => state[LIVE_READ.REPOSITORY_LISTS];
export const selectGithubToken = (state: AppStateSnapshot) => state[LIVE_READ.GITHUB_TOKEN];
export const selectPullRequestChapters = (state: AppStateSnapshot) =>
  state[LIVE_READ.PULL_REQUEST_CHAPTERS];
export const selectPullRequestChecks = (state: AppStateSnapshot) =>
  state[LIVE_READ.PULL_REQUEST_CHECKS];
export const selectPullRequestConversation = (state: AppStateSnapshot) =>
  state[LIVE_READ.PULL_REQUEST_CONVERSATION];
export const selectPullRequestPublished = (state: AppStateSnapshot) =>
  state[LIVE_READ.PULL_REQUEST_PUBLISHED];
export const selectPullRequestViewed = (state: AppStateSnapshot) =>
  state[LIVE_READ.PULL_REQUEST_VIEWED];
export const selectReviewOptions = (state: AppStateSnapshot) => state[LIVE_READ.REVIEW_OPTIONS];
export const selectBrowserTabs = (state: AppStateSnapshot) => state[LIVE_READ.BROWSER_TABS];
export const selectDevicePresence = (state: AppStateSnapshot) => state[LIVE_READ.DEVICE_PRESENCE];
export const selectHosts = (state: AppStateSnapshot) => state[LIVE_READ.HOSTS];
export const selectWorkspaceInvitations = (state: AppStateSnapshot) =>
  state[LIVE_READ.WORKSPACE_INVITATIONS];
export const selectThisMacHost = (state: AppStateSnapshot) => state[LIVE_READ.THIS_MAC_HOST];
export const selectTranscript = (state: AppStateSnapshot) => state[LIVE_READ.TRANSCRIPT];
export const selectWorkspaceMembers = (state: AppStateSnapshot) =>
  state[LIVE_READ.WORKSPACE_MEMBERS];
export const selectWorkspaceIntegrations = (state: AppStateSnapshot) =>
  state[LIVE_READ.WORKSPACE_INTEGRATIONS];
export const selectSlackChannels = (state: AppStateSnapshot) => state[LIVE_READ.SLACK_CHANNELS];
export const selectTokenRepositories = (state: AppStateSnapshot) =>
  state[LIVE_READ.TOKEN_REPOSITORIES];
export const selectWorkspacePhotos = (state: AppStateSnapshot) => state[LIVE_READ.WORKSPACE_PHOTOS];
export const selectWorkspaceTools = (state: AppStateSnapshot) => state[LIVE_READ.WORKSPACE_TOOLS];
export const selectMcpClients = (state: AppStateSnapshot) => state[LIVE_READ.MCP_CLIENTS];
export const selectAutomations = (state: AppStateSnapshot) => state[LIVE_READ.AUTOMATIONS];
export const selectAutomationWorkspaceRuns = (state: AppStateSnapshot) =>
  state[LIVE_READ.AUTOMATION_WORKSPACE_RUNS];
export const selectAutomationRuns = (state: AppStateSnapshot) => state[LIVE_READ.AUTOMATION_RUNS];
export const selectPlanComments = (state: AppStateSnapshot) => state[LIVE_READ.PLAN_COMMENTS];
export const selectHistory = (state: AppStateSnapshot) => state[LIVE_READ.HISTORY];
export const selectPlanDocument = (state: AppStateSnapshot) => state[LIVE_READ.PLAN_DOCUMENT];
export const selectMacCommands = (state: AppStateSnapshot) => state.macCommands;
export const selectNotifications = (state: AppStateSnapshot) => state.notifications;
export const selectNetwork = (state: AppStateSnapshot) => state.network;
export const selectSessionReplay = (state: AppStateSnapshot) => state.sessionReplay;
export const selectWindow = (state: AppStateSnapshot) => state.window;

/** Whether the document holds settings: nothing is drawn over one without them (`SETTINGS_HELD`). */
export const selectSettingsHeld = (state: AppStateSnapshot): boolean =>
  state.settings !== undefined;

/** The settings as the panel draws them (`APP_SETTINGS_VIEW`). */
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
