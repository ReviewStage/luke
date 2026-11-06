import { useAtomValue } from "@effect/atom-react/Hooks";
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

interface AppStateSource {
  subscribe: (onDelivered: (delivered: AppStateDelivery) => void) => () => void;
  read: () => Promise<AppStateSnapshot>;
}

type AppStateReading =
  | { readonly read: AppStateSnapshot }
  | { readonly delivered: AppStateDelivery }
  | typeof STAGE_MOVED;

const STAGE_MOVED = { stageMoved: true } as const;

class AppStateUnread extends Data.TaggedError("AppStateUnread")<{
  readonly cause: unknown;
}> {}

type AppStateUnavailable = AppStateUnread | Cause.NoSuchElementError;

const appStateSourceAtom: Atom.Writable<AppStateSource> = Atom.keepAlive(
  Atom.make({
    subscribe: (onDelivered: (delivered: AppStateDelivery) => void) =>
      appBridge().onAppState(onDelivered),
    read: () => appBridge().requestAppState(),
  }),
);

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

function adopt(held: AppStateSnapshot, delivery: AppStateDelivery): AppStateSnapshot {
  return delivery.version < held.version ? held : withAppStateDelivery(held, delivery);
}

interface Adopting {
  readonly held: Option.Option<AppStateSnapshot>;
  readonly early: readonly AppStateDelivery[];
}

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

function staged(state: AppStateSnapshot): Effect.Effect<AppStateSnapshot> {
  if (!state.run.fixtureMode) return Effect.succeed(state);
  return Effect.map(
    Effect.promise(loadTasksFixture),
    () => loadedTasksFixture()?.fixtureAppState(state) ?? state,
  );
}

const appStateAtom: Atom.Atom<AsyncResult.AsyncResult<AppStateSnapshot, AppStateUnavailable>> =
  Atom.keepAlive(
    rendererRuntime.atom((get) =>
      Stream.mapEffect(adopted(readings(get(appStateSourceAtom))), staged),
    ),
  );

export const appStateFirstRead: Effect.Effect<AppStateSnapshot, AppStateUnavailable> =
  AtomRegistry.getResult(rendererRegistry, appStateAtom);

export const appStateQuery = queryOptions({
  queryKey: [QUERY_ROOT.APP_STATE],
  queryFn: () => rendererPromise(appStateFirstRead),
  staleTime: Infinity,
  retry: false,
});

export function useAppStateSubscription(): void {
  const queryClient = useQueryClient();
  const registry = useContext(RegistryContext);
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

export function AppStateSubscription(): null {
  useAppStateSubscription();
  return null;
}

export function appStateNow(): AppStateSnapshot | undefined {
  return Option.getOrUndefined(AsyncResult.value(rendererRegistry.get(appStateAtom)));
}

export function appStateDerivedAtom<A>(
  derive: (state: AppStateSnapshot | undefined) => A,
): Atom.Atom<A> {
  return Atom.map(appStateAtom, (result) =>
    derive(Option.getOrUndefined(AsyncResult.value(result))),
  );
}

function sliceAtom<Key extends keyof AppStateSnapshot>(
  key: Key,
): Atom.Atom<AppStateSnapshot[Key] | undefined> {
  return appStateDerivedAtom((state) => state?.[key]);
}

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
  DESCRIPTION_COMMENTS: sliceAtom(LIVE_READ.DESCRIPTION_COMMENTS),
  HISTORY: sliceAtom(LIVE_READ.HISTORY),
  DESCRIPTION_DOCUMENT: sliceAtom(LIVE_READ.DESCRIPTION_DOCUMENT),
  MAC_COMMANDS: sliceAtom("macCommands"),
  NOTIFICATIONS: sliceAtom("notifications"),
  NETWORK: sliceAtom("network"),
  SESSION_REPLAY: sliceAtom("sessionReplay"),
  PORT_FORWARDING: sliceAtom("portForwarding"),
  WINDOW: sliceAtom("window"),
} as const;

export const APP_SETTINGS_VIEW: Atom.Atom<AppSettingsView | undefined> = Atom.map(
  APP_SLICE.SETTINGS,
  (settings) => (settings === undefined ? undefined : appSettingsView(settings)),
);

export function useAppSlice<A>(slice: Atom.Atom<A>): A {
  return useAtomValue(slice);
}

const experimentChoicesAtom = Atom.map(
  APP_SLICE.SETTINGS,
  (settings): ExperimentChoices => settings?.experiments ?? NO_EXPERIMENTS,
);

export function useExperimentChoices(): ExperimentChoices {
  return useAtomValue(experimentChoicesAtom);
}

const ADMIN_ACCESS: Atom.Atom<boolean> = Atom.map(
  APP_SLICE.ACCESS,
  (access) => access?.admin === true,
);

const ADMIN_ACCESS_PENDING: Atom.Atom<boolean> = Atom.map(
  APP_SLICE.ACCESS,
  (access) => access === undefined || access.pending === true,
);

export function useAdminAccess(): boolean {
  return useAtomValue(ADMIN_ACCESS);
}

export function useAdminAccessPending(): boolean {
  return useAtomValue(ADMIN_ACCESS_PENDING);
}

export function capabilityNow(capability: HostCapability): boolean {
  return appStateNow()?.run.capabilities.includes(capability) === true;
}

export const selectRun = (state: AppStateSnapshot) => state.run;
export const selectSettings = (state: AppStateSnapshot) => state.settings;
export const selectAccount = (state: AppStateSnapshot) => state.account;

export interface SignedInAccount {
  readonly id: string | undefined;
  readonly email: string;
}

export const selectSignedIn = (state: AppStateSnapshot | undefined): SignedInAccount | undefined =>
  state?.account.status === ACCOUNT_STATUS.SIGNED_IN
    ? { id: state.account.id, email: state.account.email }
    : undefined;

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
export const selectDescriptionComments = (state: AppStateSnapshot) =>
  state[LIVE_READ.DESCRIPTION_COMMENTS];
export const selectHistory = (state: AppStateSnapshot) => state[LIVE_READ.HISTORY];
export const selectDescriptionDocument = (state: AppStateSnapshot) =>
  state[LIVE_READ.DESCRIPTION_DOCUMENT];
export const selectMacCommands = (state: AppStateSnapshot) => state.macCommands;
export const selectNotifications = (state: AppStateSnapshot) => state.notifications;
export const selectNetwork = (state: AppStateSnapshot) => state.network;
export const selectSessionReplay = (state: AppStateSnapshot) => state.sessionReplay;
export const selectWindow = (state: AppStateSnapshot) => state.window;
export const selectPortForwarding = (state: AppStateSnapshot) => state.portForwarding;

export const selectWorkspaces = (state: AppStateSnapshot) => state.tasks.workspaces;

export const selectSettingsHeld = (state: AppStateSnapshot): boolean =>
  state.settings !== undefined;

export const selectAppSettingsView = (state: AppStateSnapshot): AppSettingsView | undefined =>
  state.settings === undefined ? undefined : appSettingsView(state.settings);

export const selectExperimentChoices = (state: AppStateSnapshot): ExperimentChoices =>
  state.settings?.experiments ?? NO_EXPERIMENTS;

export const selectAdminAccess = (state: AppStateSnapshot): boolean => state.access.admin === true;

export const selectAdminAccessPending = (state: AppStateSnapshot): boolean =>
  state.access.pending === true;

const experimentSelects = new Map<Experiment, (state: AppStateSnapshot) => boolean>();

export function selectExperiment(experiment: Experiment): (state: AppStateSnapshot) => boolean {
  const held = experimentSelects.get(experiment);
  if (held !== undefined) return held;
  const select = (state: AppStateSnapshot): boolean =>
    experimentOn(selectExperimentChoices(state), experiment);
  experimentSelects.set(experiment, select);
  return select;
}

const capabilitySelects = new Map<HostCapability, (state: AppStateSnapshot) => boolean>();

export function selectCapability(capability: HostCapability): (state: AppStateSnapshot) => boolean {
  const held = capabilitySelects.get(capability);
  if (held !== undefined) return held;
  const select = (state: AppStateSnapshot): boolean => state.run.capabilities.includes(capability);
  capabilitySelects.set(capability, select);
  return select;
}

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
