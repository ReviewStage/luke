import { RegistryContext } from "@effect/atom-react";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import type { AccountPreferencesLive } from "@repo/features/account-preferences-live";
import {
  type AgentBrowserTab,
  type BrowserTabsPlace,
  browserTabsPlaceId,
  browserTabsPlaceKind,
} from "@repo/features/agent-browser-tab-wire";
import {
  AGENT_CALL_FAILURE,
  type AgentTranscriptKey,
  PULL_REQUEST_PART,
  type PullRequestPart,
  type PullRequestPartParams,
} from "@repo/features/agent-view";
import { AUTOMATION_FOLLOW, type AutomationFollow } from "@repo/features/automation-view";
import type { GitHubRepositoriesAnswer } from "@repo/features/github-repositories-wire";
import type { IntegrationStatusesAnswer } from "@repo/features/integration-live";
import type { IntegrationToolsView } from "@repo/features/integration-view";
import type { IntegrationToolsAnswer } from "@repo/features/integration-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import type { ModelsAnswer } from "@repo/features/models-wire";
import { PAGE_OWNER, type PagePlace } from "@repo/features/page-wire";
import { IDLE_TASKS_VIEW, type TASK_CALL_FAILURE, type TasksView } from "@repo/features/tasks-view";
import {
  type AppAutomationReads,
  type AppBrowserTabs,
  type AppChapters,
  type AppDevicePresence,
  type AppGitHubToken,
  type AppHolderInboxes,
  type AppHolderPages,
  type AppHostRead,
  type AppHostReads,
  type AppInboxItems,
  type AppIntegrationTools,
  type AppPages,
  type AppDescriptionComments,
  type AppProviderKeyList,
  type AppPullRequestParts,
  type AppRepositoryLists,
  type AppSlackChannels,
  type AppStateDelivery,
  type AppStateSnapshot,
  type AppTokenRepositories,
  type AppTranscript,
  type AppTranscripts,
  type AppWorkspaceIntegrations,
  type AppWorkspaceInvitations,
  type AppWorkspaceMembers,
  type AppWorkspaceMembersRead,
  EVERY_WORKSPACE,
  NO_AGENT_ORIGINS,
  NO_BROWSER_TABS,
  NO_CHAPTERS,
  NO_HOLDER_INBOXES,
  NO_KEYS_HELD,
  NO_PAGES,
  NO_DESCRIPTION_COMMENTS,
  NO_TRANSCRIPTS,
  OWN_PULL_REQUEST,
  OWN_TRANSCRIPT,
  PULL_REQUEST_PART_READ,
  UNREAD,
} from "@repo/host/app-state";
import {
  ACCOUNT_ASK_ACT_KIND,
  AGENT_ACT_KIND,
  AUTOMATION_ACT_KIND,
  INTEGRATION_ACT_KIND,
  SETTINGS_ACT_KIND,
  TASKS_ACT_KIND,
  WORKSPACE_ACT_KIND,
} from "@repo/host/contract";
import { type ExperimentChoices, HOST_CAPABILITY, type HostCapability } from "@repo/settings";
import { MICROPHONE_STATUS } from "@repo/settings/microphone";
import { NOTIFICATIONS_STATUS } from "@repo/settings/settings-controls";
import { appSettingsWire, settingsView } from "@repo/settings/testing";
import { UPDATE_STATUS } from "@repo/settings/update";
import type { AppSettingsView } from "@repo/settings/wire";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import type * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createElement, useContext } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";
import type { IntegrationServer } from "../live-reads.js";
import { APP_SLICE } from "../use-app-state.js";
import {
  fakeActPort,
  fakeActPortCalls,
  fakeAppBridge,
  fakeAppBridgeCalls,
  heldUntilClosed,
  quietHold,
} from "./app-bridge.js";
import { holdAppStateForFile, writeAppState } from "./copy-feedback.js";

export const DESKTOP_CAPABILITIES: readonly HostCapability[] = Object.values(HOST_CAPABILITY);

function snapshotWith(experiments: ExperimentChoices): AppStateSnapshot {
  return {
    version: 1,
    run: {
      profile: "test",
      packaged: false,
      platform: "darwin",
      capabilities: DESKTOP_CAPABILITIES,
      appVersion: "1.0.0",
      captureMode: false,
      fixtureMode: false,
      accountRequired: false,
    },
    settings: appSettingsWire(settingsView({ experiments })),
    account: {
      status: ACCOUNT_STATUS.SIGNED_IN,
      email: "dev@example.com",
      name: "Dev",
      provider: "github",
    },
    access: { admin: false },
    update: {
      status: UPDATE_STATUS.IDLE,
      currentVersion: "1.0.0",
      installSupported: true,
      upToDate: false,
    },
    audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED },
    tasks: IDLE_TASKS_VIEW,
    agents: { unseen: [] },
    inbox: { waiting: [], tasks: [], taskless: [], automations: [], agents: [], failedRuns: [] },
    [LIVE_READ.ACCOUNT_PREFERENCES]: NO_KEYS_HELD,
    [LIVE_READ.AGENT_ORIGINS]: NO_AGENT_ORIGINS,
    [LIVE_READ.INBOX_ITEMS]: UNREAD,
    [LIVE_READ.HOLDER_INBOX]: NO_HOLDER_INBOXES,
    [LIVE_READ.INSTALLED_SKILLS]: NO_KEYS_HELD,
    [LIVE_READ.INTEGRATIONS]: NO_KEYS_HELD,
    [LIVE_READ.INTEGRATION_TOOLS]: NO_KEYS_HELD,
    [LIVE_READ.LINK_STANDINGS]: NO_KEYS_HELD,
    [LIVE_READ.MEMORIES]: NO_KEYS_HELD,
    [LIVE_READ.MODELS]: NO_KEYS_HELD,
    [LIVE_READ.PAGES]: NO_PAGES,
    [LIVE_READ.PROVIDER_KEYS]: NO_KEYS_HELD,
    [LIVE_READ.PULL_REQUEST]: NO_KEYS_HELD,
    [LIVE_READ.REPOSITORY_LISTS]: NO_KEYS_HELD,
    [LIVE_READ.GITHUB_TOKEN]: NO_KEYS_HELD,
    [LIVE_READ.PULL_REQUEST_CHAPTERS]: NO_CHAPTERS,
    [LIVE_READ.BROWSER_TABS]: NO_BROWSER_TABS,
    [LIVE_READ.PULL_REQUEST_CHECKS]: NO_KEYS_HELD,
    [LIVE_READ.PULL_REQUEST_CONVERSATION]: NO_KEYS_HELD,
    [LIVE_READ.PULL_REQUEST_PUBLISHED]: NO_KEYS_HELD,
    [LIVE_READ.PULL_REQUEST_VIEWED]: NO_KEYS_HELD,
    [LIVE_READ.REVIEW_OPTIONS]: NO_KEYS_HELD,
    [LIVE_READ.DEVICE_PRESENCE]: NO_KEYS_HELD,
    [LIVE_READ.HOSTS]: NO_KEYS_HELD,
    [LIVE_READ.WORKSPACE_INVITATIONS]: NO_KEYS_HELD,
    [LIVE_READ.THIS_MAC_HOST]: NO_KEYS_HELD,
    [LIVE_READ.TRANSCRIPT]: NO_TRANSCRIPTS,
    [LIVE_READ.WORKSPACE_MEMBERS]: NO_KEYS_HELD,
    [LIVE_READ.WORKSPACE_INTEGRATIONS]: NO_KEYS_HELD,
    [LIVE_READ.SLACK_CHANNELS]: NO_KEYS_HELD,
    [LIVE_READ.TOKEN_REPOSITORIES]: NO_KEYS_HELD,
    [LIVE_READ.WORKSPACE_PHOTOS]: NO_KEYS_HELD,
    [LIVE_READ.WORKSPACE_TOOLS]: NO_KEYS_HELD,
    [LIVE_READ.MCP_CLIENTS]: NO_KEYS_HELD,
    [LIVE_READ.AUTOMATIONS]: NO_KEYS_HELD,
    [LIVE_READ.AUTOMATION_WORKSPACE_RUNS]: NO_KEYS_HELD,
    [LIVE_READ.AUTOMATION_RUNS]: NO_KEYS_HELD,
    [LIVE_READ.DESCRIPTION_COMMENTS]: NO_DESCRIPTION_COMMENTS,
    [LIVE_READ.HISTORY]: NO_KEYS_HELD,
    [LIVE_READ.DESCRIPTION_DOCUMENT]: NO_KEYS_HELD,
    macCommands: { asks: [] },
    notifications: { status: NOTIFICATIONS_STATUS.UNKNOWN },
    sessionReplay: { permitted: false, halted: false },
    portForwarding: null,
    network: { online: true, reachable: true },
    window: { fullScreen: false },
  };
}

export function deliveryOf(snapshot: AppStateSnapshot): AppStateDelivery {
  const { version, ...entries } = snapshot;
  return { version, entries };
}

export function stateWith(
  experiments: ExperimentChoices,
  patch: Partial<AppStateSnapshot>,
): AppStateSnapshot {
  return { ...snapshotWith(experiments), ...patch };
}

export function signedInAs(account: {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}): AppStateSnapshot {
  const snapshot = snapshotWith({});
  return { ...snapshot, account: { ...snapshot.account, ...account } };
}

export function handState(
  experiments: ExperimentChoices,
  patch: Partial<AppStateSnapshot> = {},
): void {
  const snapshot = stateWith(experiments, patch);
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    onAppState: () => () => undefined,
    requestAppState: () => Promise.resolve(snapshot),
  });
}

function defaultRegistry(): AtomRegistry.AtomRegistry {
  let held: AtomRegistry.AtomRegistry | undefined;
  const Probe = () => {
    held = useContext(RegistryContext);
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  if (held === undefined) throw new Error("No default registry was drawn.");
  return held;
}

export async function readExperiments(
  experiments: ExperimentChoices,
  registry: AtomRegistry.AtomRegistry = defaultRegistry(),
): Promise<void> {
  handState(experiments);
  holdAppStateForFile(stateWith(experiments, {}));
  const release = registry.mount(APP_SLICE.SETTINGS);
  await vi.waitFor(
    () => {
      if (registry.get(APP_SLICE.SETTINGS) === undefined)
        throw new Error("The document is unread.");
    },
    { interval: 1 },
  );
  release();
}

export function registryWith(
  experiments: ExperimentChoices,
  initialValues: Iterable<readonly [Atom.Atom<unknown>, unknown]> = [],
): AtomRegistry.AtomRegistry {
  const snapshot = snapshotWith(experiments);
  const { settings } = snapshot;
  writeAppState(snapshot);
  return AtomRegistry.make({
    initialValues: [[APP_SLICE.SETTINGS, settings], ...initialValues],
  });
}

export function handCapabilities(
  capabilities: readonly HostCapability[],
  experiments: ExperimentChoices = {},
): void {
  const snapshot = snapshotWith({});
  handState(experiments, { run: { ...snapshot.run, capabilities } });
}

export function handSettings(
  settings: Partial<AppSettingsView> = {},
  patch: Partial<AppStateSnapshot> = {},
): void {
  let view: AppSettingsView = Object.assign(settingsView(), settings);
  const listeners = new Set<(delivery: AppStateDelivery) => void>();
  const snapshot = () => stateWith({}, { ...patch, settings: appSettingsWire(view) });
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    requestAppState: () => Promise.resolve(snapshot()),
    onAppState: (listener: (delivery: AppStateDelivery) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  fakeActPort({
    ...fakeActPortCalls(),
    [SETTINGS_ACT_KIND.SETTING_UPDATE]: (payload) => {
      view = Object.assign({ ...view }, { [payload.field]: payload.value });
      const next = deliveryOf(snapshot());
      for (const listener of listeners) listener(next);
      return Promise.resolve({
        status: ACTION_RESULT_STATUS.ACCEPTED,
        settings: appSettingsWire(view),
      });
    },
  });
}

export interface HostReadsHanded {
  readonly deliverItems: (next: AppHostRead<AppInboxItems>) => void;
  readonly deliverHolders: (next: AppHolderInboxes) => void;
  readonly deliverPages: (next: AppPages) => void;
  readonly deliverChapters: (next: AppChapters) => void;
  readonly deliverBrowserTabs: (next: AppBrowserTabs) => void;
  readonly deliverAutomations: (next: Partial<AppAutomationReads>) => void;
  readonly deliverComments: (next: AppDescriptionComments) => void;
  readonly deliverTools: (next: AppIntegrationTools) => void;
  readonly deliverParts: (next: Partial<AppPullRequestParts>) => void;
  readonly deliverKeys: (next: AppHostRead<AppProviderKeyList>) => void;
  readonly deliverModels: (next: AppHostRead<ModelsAnswer>) => void;
  readonly deliverPreferences: (next: AppHostRead<AccountPreferencesLive>) => void;
  readonly deliverRepositoryLists: (next: AppRepositoryLists) => void;
  readonly deliverMembers: (next: AppWorkspaceMembers) => void;
  readonly deliverIntegrations: (next: AppWorkspaceIntegrations) => void;
  readonly deliverSlackChannels: (next: AppSlackChannels) => void;
  readonly deliverInvitations: (next: AppWorkspaceInvitations) => void;
  readonly deliverTokenRepositories: (next: AppTokenRepositories) => void;
  readonly deliverTranscripts: (next: AppTranscripts) => void;
  readonly deliverTasks: (next: TasksView) => void;
}

const HELD_ACCOUNT_ID = "user-held";

function withAccountId(snapshot: AppStateSnapshot): AppStateSnapshot {
  const { account } = snapshot;
  if (account.status !== ACCOUNT_STATUS.SIGNED_IN || account.id !== undefined) return snapshot;
  return { ...snapshot, account: { ...account, id: HELD_ACCOUNT_ID } };
}

export function handHostReads(first: {
  readonly items?: AppHostRead<AppInboxItems>;
  readonly holders?: AppHolderInboxes;
  readonly chapters?: AppChapters;
  readonly tools?: AppIntegrationTools;
  readonly keys?: AppHostRead<AppProviderKeyList>;
  readonly preferences?: AppHostRead<AccountPreferencesLive>;
  readonly models?: AppHostRead<ModelsAnswer>;
  readonly members?: AppWorkspaceMembers;
  readonly tokenRepositories?: AppTokenRepositories;
  readonly transcripts?: AppTranscripts;
}): HostReadsHanded {
  const handed = fakeAppBridgeCalls().requestAppState;
  const earlier = fakeAppBridgeCalls().onAppState;
  const listeners = new Set<(delivery: AppStateDelivery) => void>();
  let laid: AppStateDelivery["entries"] = {};
  let version = 1;
  let account = HELD_ACCOUNT_ID;
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    requestAppState: async () => {
      const asked = version;
      const snapshot = withAccountId(handed === undefined ? snapshotWith({}) : await handed());
      if (snapshot.account.status === ACCOUNT_STATUS.SIGNED_IN && snapshot.account.id) {
        account = snapshot.account.id;
      }
      return {
        ...snapshot,
        version: asked,
        ...(first.items === undefined ? undefined : { [LIVE_READ.INBOX_ITEMS]: first.items }),
        ...(first.holders === undefined ? undefined : { [LIVE_READ.HOLDER_INBOX]: first.holders }),
        ...(first.chapters === undefined
          ? undefined
          : { [LIVE_READ.PULL_REQUEST_CHAPTERS]: first.chapters }),
        ...(first.tools === undefined ? undefined : { [LIVE_READ.INTEGRATION_TOOLS]: first.tools }),
        ...(first.keys === undefined
          ? undefined
          : { [LIVE_READ.PROVIDER_KEYS]: { [account]: first.keys } }),
        ...(first.preferences === undefined
          ? undefined
          : { [LIVE_READ.ACCOUNT_PREFERENCES]: { [account]: first.preferences } }),
        ...(first.models === undefined
          ? undefined
          : { [LIVE_READ.MODELS]: { [account]: first.models } }),
        ...(first.members === undefined
          ? undefined
          : { [LIVE_READ.WORKSPACE_MEMBERS]: first.members }),
        ...(first.tokenRepositories === undefined
          ? undefined
          : { [LIVE_READ.TOKEN_REPOSITORIES]: first.tokenRepositories }),
        ...(first.transcripts === undefined
          ? undefined
          : { [LIVE_READ.TRANSCRIPT]: first.transcripts }),
      };
    },
    onAppState: (listener: (delivery: AppStateDelivery) => void) => {
      listeners.add(listener);
      const off = earlier?.((delivery) => {
        version += 1;
        listener({ version, entries: { ...delivery.entries, ...laid } });
      });
      return () => {
        listeners.delete(listener);
        off?.();
      };
    },
  });
  const deliver = (entries: AppStateDelivery["entries"]) => {
    laid = { ...laid, ...entries };
    version += 1;
    for (const listener of [...listeners]) listener({ version, entries });
  };
  return {
    deliverItems: (next) => deliver({ [LIVE_READ.INBOX_ITEMS]: next }),
    deliverHolders: (next) => deliver({ [LIVE_READ.HOLDER_INBOX]: next }),
    deliverPages: (next) => deliver({ [LIVE_READ.PAGES]: next }),
    deliverChapters: (next) => deliver({ [LIVE_READ.PULL_REQUEST_CHAPTERS]: next }),
    deliverBrowserTabs: (next) => deliver({ [LIVE_READ.BROWSER_TABS]: next }),
    deliverAutomations: (next) => deliver(next),
    deliverComments: (next) => deliver({ [LIVE_READ.DESCRIPTION_COMMENTS]: next }),
    deliverTools: (next) => deliver({ [LIVE_READ.INTEGRATION_TOOLS]: next }),
    deliverParts: (next) => deliver(next),
    deliverKeys: (next) => deliver({ [LIVE_READ.PROVIDER_KEYS]: { [account]: next } }),
    deliverModels: (next) => deliver({ [LIVE_READ.MODELS]: { [account]: next } }),
    deliverPreferences: (next) => deliver({ [LIVE_READ.ACCOUNT_PREFERENCES]: { [account]: next } }),
    deliverRepositoryLists: (next) => deliver({ [LIVE_READ.REPOSITORY_LISTS]: next }),
    deliverMembers: (next) => deliver({ [LIVE_READ.WORKSPACE_MEMBERS]: next }),
    deliverIntegrations: (next) => deliver({ [LIVE_READ.WORKSPACE_INTEGRATIONS]: next }),
    deliverSlackChannels: (next) => deliver({ [LIVE_READ.SLACK_CHANNELS]: next }),
    deliverInvitations: (next) => deliver({ [LIVE_READ.WORKSPACE_INVITATIONS]: next }),
    deliverTokenRepositories: (next) => deliver({ [LIVE_READ.TOKEN_REPOSITORIES]: next }),
    deliverTranscripts: (next) => deliver({ [LIVE_READ.TRANSCRIPT]: next }),
    deliverTasks: (next) => deliver({ tasks: next }),
  };
}

const AUTOMATIONS_READ_OF = {
  [AUTOMATION_FOLLOW.WORKSPACE]: LIVE_READ.AUTOMATIONS,
  [AUTOMATION_FOLLOW.RUNS]: LIVE_READ.AUTOMATION_RUNS,
  [AUTOMATION_FOLLOW.WORKSPACE_RUNS]: LIVE_READ.AUTOMATION_WORKSPACE_RUNS,
} as const satisfies Record<AutomationFollow["kind"], keyof AppAutomationReads>;

export type AutomationReadsOf = {
  readonly [Kind in AutomationFollow["kind"]]?: (
    id: string,
  ) => AppAutomationReads[(typeof AUTOMATIONS_READ_OF)[Kind]][string] | undefined;
};

export interface AutomationsHold {
  readonly held: AutomationFollow;
  closed: boolean;
}

export function holdAutomations(
  deliver: HostReadsHanded["deliverAutomations"],
  readsOf: AutomationReadsOf,
): {
  readonly holds: readonly AutomationsHold[];
  readonly asked: readonly AutomationFollow[];
  readonly lay: () => void;
} {
  const holds: AutomationsHold[] = [];
  const asked: AutomationFollow[] = [];
  const laid: Record<keyof AppAutomationReads, Readonly<Record<string, object>>> = {
    [LIVE_READ.AUTOMATIONS]: {},
    [LIVE_READ.AUTOMATION_RUNS]: {},
    [LIVE_READ.AUTOMATION_WORKSPACE_RUNS]: {},
  };
  const layKey = ({ kind, id }: AutomationFollow) => {
    const read = readsOf[kind]?.(id);
    if (read === undefined) return false;
    const slice = AUTOMATIONS_READ_OF[kind];
    const held: { readonly rows?: unknown } | undefined = laid[slice][id];
    if (read.rows === undefined && held?.rows !== undefined) return false;
    laid[slice] = { ...laid[slice], [id]: read };
    return true;
  };
  const delivered = () => deliver({ ...laid } as Partial<AppAutomationReads>);
  fakeActPort({
    ...fakeActPortCalls(),
    [AUTOMATION_ACT_KIND.AUTOMATIONS_FOLLOW]: (held) => {
      const hold: AutomationsHold = { held, closed: false };
      holds.push(hold);
      asked.push(held);
      if (layKey(held)) void Promise.resolve().then(delivered);
      return heldUntilClosed(() => {
        hold.closed = true;
      });
    },
    [AUTOMATION_ACT_KIND.AUTOMATIONS_RETRY]: (held) => {
      asked.push(held);
      if (layKey(held)) delivered();
      return Promise.resolve();
    },
  });
  return {
    holds,
    asked,
    lay: () => {
      for (const { held } of holds) layKey(held);
      delivered();
    },
  };
}

type PartAnswerOf<Part extends PullRequestPart> =
  AppHostReads[(typeof PULL_REQUEST_PART_READ)[Part]];

export type PullRequestPartAnswers = {
  readonly [Part in PullRequestPart]?: (
    agentId: string,
    number?: number,
  ) => Promise<PartAnswerOf<Part>>;
};

export function holdPullRequestParts(
  deliver: HostReadsHanded["deliverParts"],
  answers: PullRequestPartAnswers,
): readonly PullRequestPartParams[] {
  const asked: PullRequestPartParams[] = [];
  let held: AppPullRequestParts = {
    [LIVE_READ.PULL_REQUEST]: NO_KEYS_HELD,
    [LIVE_READ.PULL_REQUEST_CHECKS]: NO_KEYS_HELD,
    [LIVE_READ.PULL_REQUEST_CONVERSATION]: NO_KEYS_HELD,
    [LIVE_READ.PULL_REQUEST_PUBLISHED]: NO_KEYS_HELD,
    [LIVE_READ.PULL_REQUEST_VIEWED]: NO_KEYS_HELD,
    [LIVE_READ.REVIEW_OPTIONS]: NO_KEYS_HELD,
  };
  const ask = async (params: PullRequestPartParams) => {
    const answer = answers[params.part];
    if (answer === undefined) return;
    asked.push(params);
    const read = PULL_REQUEST_PART_READ[params.part];
    const number = params.number === undefined ? OWN_PULL_REQUEST : String(params.number);
    const landed: object = await answer(params.agentId, params.number).catch(() => ({
      failure: AGENT_CALL_FAILURE.UNANSWERED,
    }));
    const slice: Readonly<Record<string, Readonly<Record<string, AppHostRead<object>>>>> =
      held[read];
    const was = slice[params.agentId]?.[number]?.rows;
    const kept =
      params.part !== PULL_REQUEST_PART.VIEWED &&
      "failure" in landed &&
      was !== undefined &&
      !("failure" in was);
    if (kept) return;
    held = {
      ...held,
      [read]: {
        ...slice,
        [params.agentId]: { ...slice[params.agentId], [number]: { rows: landed } },
      },
    } as AppPullRequestParts;
    deliver(held);
  };
  fakeActPort({
    ...fakeActPortCalls(),
    [AGENT_ACT_KIND.AGENTS_PULL_REQUEST_PART_FOLLOW]: (params) => {
      void Promise.resolve().then(() => ask(params));
      return quietHold();
    },
    [AGENT_ACT_KIND.AGENTS_PULL_REQUEST_PART_RETRY]: (params) => ask(params),
  });
  return asked;
}

type ToolsAnswer = (
  server: IntegrationServer,
) => IntegrationToolsView | Promise<IntegrationToolsView> | undefined;

export function holdIntegrationTools(
  deliver: HostReadsHanded["deliverTools"],
  toolsOf: ToolsAnswer,
): readonly string[] {
  const asked: string[] = [];
  let held: AppIntegrationTools = NO_KEYS_HELD;
  const ask = async (server: IntegrationServer) => {
    const name = server.connection ?? server.provider;
    asked.push(name);
    const answering = toolsOf(server);
    if (answering === undefined) return;
    const answer = await Promise.resolve(answering).catch(() => undefined);
    const was = held[name];
    const read: AppHostRead<IntegrationToolsAnswer> =
      answer !== undefined && !("failure" in answer)
        ? { rows: answer }
        : was?.rows !== undefined
          ? was
          : { failed: true };
    held = { ...held, [name]: read };
    deliver(held);
  };
  fakeActPort({
    ...fakeActPortCalls(),
    [INTEGRATION_ACT_KIND.INTEGRATIONS_TOOLS_FOLLOW]: (server) => {
      void Promise.resolve().then(() => ask(server));
      return quietHold();
    },
    [INTEGRATION_ACT_KIND.INTEGRATIONS_TOOLS_RETRY]: async (server) => {
      const name = server.connection ?? server.provider;
      if (held[name]?.failed === true) {
        held = { ...held, [name]: UNREAD };
        deliver(held);
      }
      await ask(server);
    },
  });
  return asked;
}

export type RepositoriesRead =
  | { readonly repositories: GitHubRepositoriesAnswer }
  | { readonly failure: typeof TASK_CALL_FAILURE.UNANSWERED };

type RepositoriesAnswer = (
  workspace: string,
) => RepositoriesRead | Promise<RepositoriesRead> | undefined;

export function holdRepositoryLists(
  deliver: HostReadsHanded["deliverRepositoryLists"],
  listOf: RepositoriesAnswer,
): { readonly asked: readonly string[]; readonly again: () => Promise<void> } {
  const asked: string[] = [];
  const scopes = new Map<string, { readonly workspaceId?: string }>();
  let held: AppRepositoryLists = NO_KEYS_HELD;
  const ask = async ({ workspaceId }: { readonly workspaceId?: string }) => {
    const key = workspaceId ?? EVERY_WORKSPACE;
    asked.push(key);
    const answering = listOf(key);
    if (answering === undefined) return;
    const answer = await Promise.resolve(answering).catch(() => undefined);
    const was = held[key];
    const read: AppHostRead<GitHubRepositoriesAnswer> =
      answer !== undefined && "repositories" in answer
        ? { rows: answer.repositories }
        : was?.rows !== undefined
          ? was
          : { failed: true };
    held = { ...held, [key]: read };
    deliver(held);
  };
  fakeActPort({
    ...fakeActPortCalls(),
    [TASKS_ACT_KIND.TASKS_REPOSITORIES_FOLLOW]: (scope) => {
      scopes.set(scope.workspaceId ?? EVERY_WORKSPACE, scope);
      void Promise.resolve().then(() => ask(scope));
      return quietHold();
    },
    [TASKS_ACT_KIND.TASKS_REPOSITORIES_RETRY]: async (scope) => {
      const key = scope.workspaceId ?? EVERY_WORKSPACE;
      if (held[key]?.failed === true) {
        held = { ...held, [key]: UNREAD };
        deliver(held);
      }
      await ask(scope);
    },
  });
  return {
    asked,
    again: async () => {
      for (const scope of scopes.values()) await ask(scope);
    },
  };
}

export function holdMembers(
  deliver: HostReadsHanded["deliverMembers"],
  membersOf: (workspaceId: string) => AppWorkspaceMembersRead | undefined,
): readonly string[] {
  const asked: string[] = [];
  let held: AppWorkspaceMembers = NO_KEYS_HELD;
  fakeActPort({
    ...fakeActPortCalls(),
    [WORKSPACE_ACT_KIND.WORKSPACE_MEMBERS_FOLLOW]: ({ workspaceId }) => {
      asked.push(workspaceId);
      const read = membersOf(workspaceId);
      if (read !== undefined && held[workspaceId] === undefined) {
        held = { ...held, [workspaceId]: read };
        const laid = held;
        void Promise.resolve().then(() => deliver(laid));
      }
      return quietHold();
    },
  });
  return asked;
}

export function handMembers(
  membersOf: (workspaceId: string) => AppWorkspaceMembersRead | undefined,
): readonly string[] {
  return holdMembers(handHostReads({}).deliverMembers, membersOf);
}

export function holdPages(
  deliver: HostReadsHanded["deliverPages"],
  pagesOf: (place: PagePlace) => AppHolderPages | undefined,
): readonly PagePlace[] {
  const asked: PagePlace[] = [];
  let held: AppPages = NO_PAGES;
  fakeActPort({
    ...fakeActPortCalls(),
    [TASKS_ACT_KIND.TASKS_PAGES_FOLLOW]: (place) => {
      asked.push(place);
      const read = pagesOf(place);
      const kind = "taskId" in place ? PAGE_OWNER.TASK : PAGE_OWNER.AGENT;
      const id = "taskId" in place ? place.taskId : place.agentId;
      if (read !== undefined && held[kind][id] === undefined) {
        held = { ...held, [kind]: { ...held[kind], [id]: read } };
        const laid = held;
        void Promise.resolve().then(() => deliver(laid));
      }
      return quietHold();
    },
  });
  return asked;
}

export function holdBrowserTabs(
  deliver: HostReadsHanded["deliverBrowserTabs"],
  tabsOf: (place: BrowserTabsPlace) => readonly AgentBrowserTab[],
): (place: BrowserTabsPlace, tabs: readonly AgentBrowserTab[]) => void {
  let held: AppBrowserTabs = NO_BROWSER_TABS;
  const lay = (place: BrowserTabsPlace, tabs: readonly AgentBrowserTab[]) => {
    const kind = browserTabsPlaceKind(place);
    held = { ...held, [kind]: { ...held[kind], [browserTabsPlaceId(place)]: { rows: tabs } } };
    deliver(held);
  };
  fakeActPort({
    ...fakeActPortCalls(),
    [TASKS_ACT_KIND.TASKS_BROWSER_TABS_FOLLOW]: (place) => {
      const tabs = tabsOf(place);
      void Promise.resolve().then(() => lay(place, tabs));
      return quietHold();
    },
  });
  return lay;
}

export interface TranscriptsHeld {
  readonly lay: (transcript: AgentTranscriptKey, read: AppHostRead<AppTranscript>) => void;
  readonly asked: readonly AgentTranscriptKey[];
  readonly closed: readonly AgentTranscriptKey[];
}

export function holdTranscripts(
  deliver: HostReadsHanded["deliverTranscripts"],
  transcriptOf: (transcript: AgentTranscriptKey) => AppHostRead<AppTranscript> | undefined,
): TranscriptsHeld {
  const asked: AgentTranscriptKey[] = [];
  const closed: AgentTranscriptKey[] = [];
  let held: AppTranscripts = NO_TRANSCRIPTS;
  const lay = (transcript: AgentTranscriptKey, read: AppHostRead<AppTranscript>) => {
    const { agentId } = transcript;
    const id = transcript.callId ?? OWN_TRANSCRIPT;
    held = { ...held, [agentId]: { ...held[agentId], [id]: read } };
    deliver(held);
  };
  fakeActPort({
    ...fakeActPortCalls(),
    [AGENT_ACT_KIND.AGENTS_TRANSCRIPT]: (transcript) => {
      asked.push(transcript);
      const read = transcriptOf(transcript);
      if (read !== undefined) void Promise.resolve().then(() => lay(transcript, read));
      return heldUntilClosed(() => closed.push(transcript));
    },
  });
  return { lay, asked, closed };
}

export function handInboxItems(
  first: AppHostRead<AppInboxItems>,
): (next: AppHostRead<AppInboxItems>) => void {
  return handHostReads({ items: first }).deliverItems;
}

const BEATING_ACCOUNT_ID = "user-beating";

export function handBeats(
  ages: Readonly<Record<string, number>> | undefined,
  { askedAgoMs = 0, ...options }: { readonly stale?: true; readonly askedAgoMs?: number } = {},
): void {
  const handed = fakeAppBridgeCalls().requestAppState;
  const now = Date.now();
  const read: AppHostRead<AppDevicePresence> =
    ages === undefined
      ? { failed: true }
      : {
          rows: {
            beats: Object.entries(ages).map(([deviceId, ageMs]) => ({
              deviceId,
              beatAt: now - ageMs,
            })),
            askedAt: now - askedAgoMs,
            ...options,
          },
        };
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    onAppState: fakeAppBridgeCalls().onAppState ?? (() => () => undefined),
    requestAppState: async () => {
      const snapshot = handed === undefined ? snapshotWith({}) : await handed();
      const { account } = snapshot;
      if (account.status !== ACCOUNT_STATUS.SIGNED_IN) return snapshot;
      const id = account.id ?? BEATING_ACCOUNT_ID;
      return {
        ...snapshot,
        account: { ...account, id },
        [LIVE_READ.DEVICE_PRESENCE]: { [id]: read },
      };
    },
  });
}

const HELD_FOR_ACCOUNT_ID = "user-integrations";

export interface IntegrationsHeld {
  readonly lay: () => void;
  readonly holds: () => number;
  readonly retries: () => number;
}

export type AccountReadHeld = IntegrationsHeld;

function heldForAccount<Rows>(
  sliceOf: (held: Readonly<Record<string, AppHostRead<Rows>>>) => Partial<AppStateSnapshot>,
  readOf: () => AppHostRead<Rows> | undefined,
): () => void {
  const handed = fakeAppBridgeCalls().requestAppState;
  const listening = fakeAppBridgeCalls().onAppState;
  const listeners = new Set<(delivery: AppStateDelivery) => void>();
  let accountId = HELD_FOR_ACCOUNT_ID;
  let version = 0;
  const laid = () => {
    const read = readOf();
    return sliceOf(read === undefined ? NO_KEYS_HELD : { [accountId]: read });
  };
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    requestAppState: async () => {
      const snapshot = handed === undefined ? snapshotWith({}) : await handed();
      version = Math.max(version, snapshot.version);
      const { account } = snapshot;
      if (account.status !== ACCOUNT_STATUS.SIGNED_IN) return snapshot;
      accountId = account.id ?? HELD_FOR_ACCOUNT_ID;
      return { ...snapshot, account: { ...account, id: accountId }, ...laid() };
    },
    onAppState: (listener: (delivery: AppStateDelivery) => void) => {
      listeners.add(listener);
      const before = listening?.((delivery) => {
        version = Math.max(version, delivery.version);
        listener(delivery);
      });
      return () => {
        listeners.delete(listener);
        before?.();
      };
    },
  });
  return () => {
    for (const listener of [...listeners]) listener({ version, entries: laid() });
  };
}

export function holdIntegrations(
  readOf: () => AppHostRead<IntegrationStatusesAnswer> | undefined,
): IntegrationsHeld {
  let holds = 0;
  let retries = 0;
  const lay = heldForAccount((held) => ({ [LIVE_READ.INTEGRATIONS]: held }), readOf);
  fakeActPort({
    ...fakeActPortCalls(),
    [INTEGRATION_ACT_KIND.INTEGRATIONS_FOLLOW]: () => {
      holds += 1;
      return quietHold();
    },
    [INTEGRATION_ACT_KIND.INTEGRATIONS_RETRY]: () => {
      retries += 1;
      lay();
      return Promise.resolve();
    },
  });
  return { lay, holds: () => holds, retries: () => retries };
}

export function holdGitHubToken(
  readOf: () => AppHostRead<AppGitHubToken> | undefined,
): AccountReadHeld {
  let holds = 0;
  let retries = 0;
  const lay = heldForAccount((held) => ({ [LIVE_READ.GITHUB_TOKEN]: held }), readOf);
  fakeActPort({
    ...fakeActPortCalls(),
    [ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_FOLLOW]: () => {
      holds += 1;
      return quietHold();
    },
    [ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_RETRY]: () => {
      retries += 1;
      lay();
      return Promise.resolve();
    },
  });
  return { lay, holds: () => holds, retries: () => retries };
}
