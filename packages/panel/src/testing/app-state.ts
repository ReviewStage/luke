/**
 * app-state.ts -- what a test of a surface gated by an experiment or a platform capability, or one that names the signed-in account or draws a call, stands on: main's document as the bridge hands it, with the account's experiments, the platform's capabilities, its identity, and its call as given.
 */

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
  INBOX_SCOPE_KIND,
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
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import {
  type AppAutomationReads,
  type AppBrowserTabs,
  type AppChapters,
  type AppDescriptionComments,
  type AppDevicePresence,
  type AppGitHubToken,
  type AppHolderInboxes,
  type AppHolderPages,
  type AppHostRead,
  type AppHostReads,
  type AppInboxItems,
  type AppIntegrationTools,
  type AppPages,
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
  type AppWorkspaceTools,
  EVERY_WORKSPACE,
  NO_AGENT_ORIGINS,
  NO_BROWSER_TABS,
  NO_CHAPTERS,
  NO_DESCRIPTION_COMMENTS,
  NO_HOLDER_INBOXES,
  NO_KEYS_HELD,
  NO_PAGES,
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
import {
  type ExperimentChoices,
  HOST_CAPABILITY,
  type HostCapability,
  WORKSPACE_EXPERIMENT_LIST,
} from "@repo/settings";
import { MICROPHONE_STATUS } from "@repo/settings/microphone";
import { NOTIFICATIONS_STATUS } from "@repo/settings/settings-controls";
import { appSettingsWire, settingsView } from "@repo/settings/testing";
import { UPDATE_STATUS } from "@repo/settings/update";
import type { AppSettingsView } from "@repo/settings/wire";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import type { ReactElement, ReactNode } from "react";
import type { IntegrationServer } from "../live-reads.js";
import {
  fakeActPort,
  fakeActPortCalls,
  fakeAppBridge,
  fakeAppBridgeCalls,
  heldUntilClosed,
  quietHold,
} from "./app-bridge.js";
import { holdAppStateForFile, withQueryClient, writeAppState } from "./copy-feedback.js";

/** What the desktop offers: every capability there is. */
export const DESKTOP_CAPABILITIES: readonly HostCapability[] = Object.values(HOST_CAPABILITY);

/**
 * The workspaces the panel's test builders file their tasks under, by the ids
 * and slugs they write: listed in main's document wherever a case turns a
 * workspace experiment on, so a surface about a task of any of them draws as
 * one in a workspace that chose it.
 */
const CASE_WORKSPACES: readonly { readonly id: string; readonly slug?: string }[] = [
  { id: "workspace-personal", slug: "personal" },
  // Note that the mention cases name the workspace of their place `acme` and read its repositories through `workspace-1`.
  { id: "workspace-1", slug: "acme" },
  { id: "workspace-acme" },
  { id: "workspace-listed", slug: "listed" },
  { id: "workspace-stage", slug: "stage" },
];

/**
 * A tasks' view with the workspace experiments among `experiments` on in
 * every workspace it lists that chose none of its own, and in each of
 * `CASE_WORKSPACES` it does not list: as it stands where none of them is on.
 */
function withWorkspaceExperiments(view: TasksView, experiments: ExperimentChoices): TasksView {
  const chosen = WORKSPACE_EXPERIMENT_LIST.filter((experiment) => experiments[experiment] === true);
  if (chosen.length === 0) return view;
  const on = chosen.map((experiment) => ({
    experiment,
    on: true,
    changedBy: null,
    changedAt: 0,
  }));
  const unlisted = CASE_WORKSPACES.filter(
    ({ id }) => !view.workspaces.some((listed) => listed.id === id),
  );
  return {
    ...view,
    workspaces: [
      ...view.workspaces.map((listed) => ({ ...listed, experiments: listed.experiments ?? on })),
      ...unlisted.map(({ id, slug }) => ({
        id,
        ...(slug === undefined ? undefined : { slug }),
        name: slug ?? id,
        role: WORKSPACE_ROLE.OWNER,
        github: null,
        experiments: on,
      })),
    ],
  };
}

/** Main's document for a signed-in account in a panel on the desktop, idle, the account's experiments as given on its settings. */
function idleDocument(experiments: ExperimentChoices): AppStateSnapshot {
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
    mirrors: {},
    network: { online: true, reachable: true },
    window: { fullScreen: false },
  };
}

/**
 * Main's document as a case that turns a workspace experiment on stands in
 * it: the workspaces it files tasks under listed with that experiment on,
 * and what a surface about a task of theirs reads of them, the account's
 * feed and each one's automations, read and holding nothing where the case
 * lays none of its own.
 */
function inCaseWorkspaces(
  snapshot: AppStateSnapshot,
  experiments: ExperimentChoices,
  patch: Partial<AppStateSnapshot>,
): AppStateSnapshot {
  const tasks = withWorkspaceExperiments(snapshot.tasks, experiments);
  if (tasks === snapshot.tasks) return snapshot;
  const automations = Object.fromEntries(tasks.workspaces.map(({ id }) => [id, { rows: [] }]));
  return {
    ...snapshot,
    tasks,
    ...(patch[LIVE_READ.INBOX_ITEMS] === undefined
      ? {
          [LIVE_READ.INBOX_ITEMS]: {
            rows: { [INBOX_SCOPE_KIND.PLAN]: {}, [INBOX_SCOPE_KIND.AGENT]: {} },
          },
        }
      : undefined),
    ...(patch[LIVE_READ.AUTOMATIONS] === undefined
      ? { [LIVE_READ.AUTOMATIONS]: automations }
      : undefined),
  };
}

/** Main's document for a signed-in account in a panel on the desktop, idle, its experiments as given: the account's own on its settings, a workspace's on the workspaces cases file tasks under. */
function snapshotWith(experiments: ExperimentChoices): AppStateSnapshot {
  return inCaseWorkspaces(idleDocument(experiments), experiments, {});
}

/** A document as main's push delivers it to a window that holds none of it yet: every entry. */
export function deliveryOf(snapshot: AppStateSnapshot): AppStateDelivery {
  const { version, ...entries } = snapshot;
  return { version, entries };
}

/** Main's document with the account's experiments as given and the slices patched, the window's facts among them. */
export function stateWith(
  experiments: ExperimentChoices,
  patch: Partial<AppStateSnapshot>,
): AppStateSnapshot {
  return inCaseWorkspaces({ ...idleDocument(experiments), ...patch }, experiments, patch);
}

/** Main's document for the account signed in as given, no experiment on. */
export function signedInAs(account: {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}): AppStateSnapshot {
  const snapshot = snapshotWith({});
  return { ...snapshot, account: { ...snapshot.account, ...account } };
}

/** Hands the window main's document with the account's experiments as given and the slices patched, beside whatever else the bridge already holds. */
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

/**
 * Hands the window main's document with the account's experiments as given,
 * as `handState` does, and starts every test's Query client of this file on
 * that document: for a suite whose draws are synchronous, so a surface an
 * experiment gates stands in its first frame.
 */
export function readExperiments(experiments: ExperimentChoices): void {
  handState(experiments);
  holdAppStateForFile(stateWith(experiments, {}));
}

/**
 * Writes a document whose settings hold these experiments into the test's
 * Query client, `patch` over its slices as `stateWith` lays it, for a case
 * that draws synchronously and must find them in its first frame. Note that
 * the document is read again once main's lands, so the bridge must hand the
 * same experiments (`handState`, `readExperiments`) for them to stand.
 */
export function writeExperiments(
  experiments: ExperimentChoices,
  patch: Partial<AppStateSnapshot> = {},
): void {
  writeAppState(stateWith(experiments, patch));
}

/** `element` on the test's Query client (`withQueryClient`), its document holding these experiments from the first frame (`writeExperiments`). */
export function withExperiments(experiments: ExperimentChoices, element: ReactNode): ReactElement {
  writeExperiments(experiments);
  return withQueryClient(element);
}

/** Hands the window main's document on a platform offering `capabilities`, the experiments given on and no other, beside whatever else the bridge already holds. */
export function handCapabilities(
  capabilities: readonly HostCapability[],
  experiments: ExperimentChoices = {},
): void {
  const snapshot = snapshotWith({});
  handState(experiments, { run: { ...snapshot.run, capabilities } });
}

/**
 * Hands the window main's document with its settings as given, its other
 * slices patched, and answers each settings write as main does: stored,
 * then the document delivered again to every listener, so a surface draws
 * the setting it wrote and the next surface drawn reads it. Every other act
 * and procedure is answered as the window's fakes answered it before. The
 * write is answered as accepted.
 */
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

/** How the host's reads are delivered again as each moves, as the host tells them. */
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
  /** The signed-in account's keys, held under its id. */
  readonly deliverKeys: (next: AppHostRead<AppProviderKeyList>) => void;
  /** The models the signed-in account is offered and its devices, held under its id. */
  readonly deliverModels: (next: AppHostRead<ModelsAnswer>) => void;
  /** The signed-in account's preferences row, held under its id. */
  readonly deliverPreferences: (next: AppHostRead<AccountPreferencesLive>) => void;
  readonly deliverRepositoryLists: (next: AppRepositoryLists) => void;
  readonly deliverMembers: (next: AppWorkspaceMembers) => void;
  readonly deliverIntegrations: (next: AppWorkspaceIntegrations) => void;
  readonly deliverSlackChannels: (next: AppSlackChannels) => void;
  readonly deliverInvitations: (next: AppWorkspaceInvitations) => void;
  readonly deliverTokenRepositories: (next: AppTokenRepositories) => void;
  readonly deliverTranscripts: (next: AppTranscripts) => void;
  /** The account's task list, as the host lays it whole. */
  readonly deliverTasks: (next: TasksView) => void;
}

/** The id the signed-in account of a test's document goes by where the document names none, since the host holds the account's own reads by it. */
const HELD_ACCOUNT_ID = "user-held";

/** The document with its signed-in account given an id where it names none. */
function withAccountId(snapshot: AppStateSnapshot): AppStateSnapshot {
  const { account } = snapshot;
  if (account.status !== ACCOUNT_STATUS.SIGNED_IN || account.id !== undefined) return snapshot;
  return { ...snapshot, account: { ...account, id: HELD_ACCOUNT_ID } };
}

/**
 * Lays the host's reads as given, the account's feed of every item, the
 * holders' own inboxes, the pull requests' chapters, the servers' tools, the
 * signed-in account's keys, preferences, and models, the workspaces' people and token
 * repositories, the agents' transcripts and where their `run_on_mac` stands, over whatever document the window was handed, its
 * experiments and the reads handed before among it, and answers with how
 * each is delivered again as it moves, as the host tells it; what the bridge
 * delivered before still reaches the window. The account is given an id
 * where the document names none, since the host holds its keys by it.
 */
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
  readonly workspaceTools?: AppWorkspaceTools;
}): HostReadsHanded {
  const handed = fakeAppBridgeCalls().requestAppState;
  const earlier = fakeAppBridgeCalls().onAppState;
  const listeners = new Set<(delivery: AppStateDelivery) => void>();
  /** Everything delivered here, which what the bridge delivered before never takes back. */
  let laid: AppStateDelivery["entries"] = {};
  let version = 1;
  let account = HELD_ACCOUNT_ID;
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    // Note that the document answers at the version it was asked at, so a read delivered while the handed one was awaited stands over it.
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
        ...(first.workspaceTools === undefined
          ? undefined
          : { [LIVE_READ.WORKSPACE_TOOLS]: first.workspaceTools }),
      };
    },
    onAppState: (listener: (delivery: AppStateDelivery) => void) => {
      listeners.add(listener);
      // Note that what the bridge delivered before, a test's settings among it, still reaches the window, stamped as newer than all delivered here, with what was delivered here laid over it.
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

/** The automations' read each kind of hold names, by the kind. */
const AUTOMATIONS_READ_OF = {
  [AUTOMATION_FOLLOW.WORKSPACE]: LIVE_READ.AUTOMATIONS,
  [AUTOMATION_FOLLOW.RUNS]: LIVE_READ.AUTOMATION_RUNS,
  [AUTOMATION_FOLLOW.WORKSPACE_RUNS]: LIVE_READ.AUTOMATION_WORKSPACE_RUNS,
} as const satisfies Record<AutomationFollow["kind"], keyof AppAutomationReads>;

/** What a test's host reads of each of the automations' holds, by its kind: the key's read, none while it answers nothing. */
export type AutomationReadsOf = {
  readonly [Kind in AutomationFollow["kind"]]?: (
    id: string,
  ) => AppAutomationReads[(typeof AUTOMATIONS_READ_OF)[Kind]][string] | undefined;
};

/** One hold the window asked of the automations' reads, and whether it has let it go. */
export interface AutomationsHold {
  readonly held: AutomationFollow;
  closed: boolean;
}

/**
 * Answers the window's holds on the automations' reads as the host does,
 * beside whatever acts the test answers by now: each key `readsOf`
 * answers laid on the document through `deliver` as it is held, as a
 * window opened anew draws it where it stands, and again as Try again
 * reads it, and every key held since laid again as `lay` asks, as the host
 * lays a read that moved, each staying laid once let go; a read that
 * fails over rows keeps them, as the host keeps them. Answers with every
 * hold asked for, in order, and every read asked for, by a hold or a Try
 * again, in order.
 */
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
  /** Lays the key's read as the test's host reads it now, answering whether it read any. */
  const layKey = ({ kind, id }: AutomationFollow) => {
    const read = readsOf[kind]?.(id);
    if (read === undefined) return false;
    const slice = AUTOMATIONS_READ_OF[kind];
    const held: { readonly rows?: unknown } | undefined = laid[slice][id];
    if (read.rows === undefined && held?.rows !== undefined) return false;
    laid[slice] = { ...laid[slice], [id]: read };
    return true;
  };
  // SAFETY: each read's keys hold what its kind's `readsOf` answered, which is that read's (`AutomationReadsOf`).
  const delivered = () => deliver({ ...laid } as Partial<AppAutomationReads>);
  fakeActPort({
    ...fakeActPortCalls(),
    [AUTOMATION_ACT_KIND.AUTOMATIONS_FOLLOW]: (held) => {
      const hold: AutomationsHold = { held, closed: false };
      holds.push(hold);
      asked.push(held);
      // Note that the host lays what it read once the hold is taken, never inside it.
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

/** What a test's service answers one part of a pull request with, by the part, as the read it replaces did. */
type PartAnswerOf<Part extends PullRequestPart> =
  AppHostReads[(typeof PULL_REQUEST_PART_READ)[Part]];

/** How a test's service answers each part of a pull request, by the part, for the agent and the number the tab names; a part it does not answer is held quietly. */
export type PullRequestPartAnswers = {
  readonly [Part in PullRequestPart]?: (
    agentId: string,
    number?: number,
  ) => Promise<PartAnswerOf<Part>>;
};

/**
 * Answers the window's holds on the parts of a pull request, and its Try
 * again on one, as the host does, beside whatever acts the test answers by
 * now: each part asked of `answers` as it is first held and again on Try
 * again, which settles once its answer is laid, and laid on the document
 * through `deliver`; an answer that is a failure keeps an answer the part
 * held, but for the viewed marks, which hold every answer as the host's do,
 * and one that rejects is a failure. Answers with every ask made, in order.
 */
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
    // SAFETY: what lands for a part is that part's read (`PartAnswerOf`), laid at its key's path.
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
      // Note that the host lays what it read once the hold is taken, never inside it.
      void Promise.resolve().then(() => ask(params));
      return quietHold();
    },
    [AGENT_ACT_KIND.AGENTS_PULL_REQUEST_PART_RETRY]: (params) => ask(params),
  });
  return asked;
}

/** What a test's service answers a server's tools read with, as the act it replaces did; nothing for a read that never answers. */
type ToolsAnswer = (
  server: IntegrationServer,
) => IntegrationToolsView | Promise<IntegrationToolsView> | undefined;

/**
 * Answers the window's holds on each server's tools, and its Try again on
 * one, as the host does, beside whatever acts the test answers by now: each
 * server asked of `toolsOf` as it is first held and again on Try again, and
 * laid on the document through `deliver`; an answer that is no list keeps
 * what the server held, and fails one that never answered. Answers with
 * every server asked, by its name, in order.
 */
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
      // Note that the host lays what it read once the hold is taken, never inside it.
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

/** What a test's service answers a workspace's repositories read with: the list whole, or that it did not answer. */
export type RepositoriesRead =
  | { readonly repositories: GitHubRepositoriesAnswer }
  | { readonly failure: typeof TASK_CALL_FAILURE.UNANSWERED };

/** What a test's service answers each list's read with, by the list's key; nothing for a read that never answers. */
type RepositoriesAnswer = (
  workspace: string,
) => RepositoriesRead | Promise<RepositoriesRead> | undefined;

/**
 * Answers the window's holds on each workspace's repositories, and its Try
 * again on one, as the host does, beside whatever acts the test answers by
 * now: each list asked of `listOf` by the workspace it names, or
 * `EVERY_WORKSPACE` where it names none, as it is first held, again on Try
 * again, and again with every list held as `again` asks, as the host asks
 * as a window comes forward, and laid on the document through `deliver`;
 * an answer that is no list keeps what the list held, and fails one that
 * never answered. Answers with every list asked, by its key, in order.
 */
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
      // Note that the host lays what it read once the hold is taken, never inside it.
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

/**
 * Answers the window's holds on a workspace's people as the host does,
 * beside whatever acts the test answers by now: where `membersOf` holds
 * them, their read laid on the document through `deliver` as they are first
 * held, and staying there once let go, as `holdPages` lays pages. Answers
 * with every workspace held, in order.
 */
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
      // Note that the host pushes what it read once the hold is taken, never inside it.
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

/**
 * Lays each workspace's people as `membersOf` holds them, as the host lays
 * them once the window holds them (`holdMembers`), over whatever document
 * and acts the test handed the window by now. Answers with every workspace
 * held, in order.
 */
export function handMembers(
  membersOf: (workspaceId: string) => AppWorkspaceMembersRead | undefined,
): readonly string[] {
  return holdMembers(handHostReads({}).deliverMembers, membersOf);
}

/**
 * Answers the window's holds on a task's or an agent's pages as the host
 * does, beside whatever acts the test answers by now: where `pagesOf` holds
 * each, its rows or that the host was refused them, laid on the document
 * through `deliver` as it is first held, and staying there once let go.
 * Answers with every hold asked for, in order.
 */
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
      // Note that the host pushes what it read once the hold is taken, never inside it.
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

/**
 * Answers the window's holds on a task's or an agent's cloud Browser tabs
 * as the host does, beside whatever acts the test answers by now: where
 * `tabsOf` names a place's tabs, laid on the document through `deliver` as
 * it is first held, and staying there once let go. Answers with how the
 * test's host lays a place's tabs anew, as the host does when they move.
 */
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
      // Note that the host lays what it read once the hold is taken, never inside it.
      void Promise.resolve().then(() => lay(place, tabs));
      return quietHold();
    },
  });
  return lay;
}

/** How a test's host lays one transcript anew, as the host does as its read moves, every hold the window asked, and every hold it let go, each in order. */
export interface TranscriptsHeld {
  readonly lay: (transcript: AgentTranscriptKey, read: AppHostRead<AppTranscript>) => void;
  readonly asked: readonly AgentTranscriptKey[];
  readonly closed: readonly AgentTranscriptKey[];
}

/**
 * Answers the window's holds on an agent's or a worker's transcript as the
 * host does, beside whatever acts the test answers by now: where
 * `transcriptOf` names a transcript's read, laid on the document through
 * `deliver` each time it is held, and staying there once let go. Answers
 * with how the test's host lays a transcript anew, and the holds asked and
 * let go.
 */
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
      // Note that the host lays what it read once the hold is taken, never inside it.
      if (read !== undefined) void Promise.resolve().then(() => lay(transcript, read));
      return heldUntilClosed(() => closed.push(transcript));
    },
  });
  return { lay, asked, closed };
}

/** Lays the account's feed of every item as given over the window's document, and answers with how it is delivered again as it moves. */
export function handInboxItems(
  first: AppHostRead<AppInboxItems>,
): (next: AppHostRead<AppInboxItems>) => void {
  return handHostReads({ items: first }).deliverItems;
}

/** The id the account a test's beats are held for goes by, where the document handed names none. */
const BEATING_ACCOUNT_ID = "user-beating";

/**
 * Lays the signed-in account's beats as the host holds them over whatever
 * document the window was handed: each device named having beat `ageMs` ago
 * on the window's clock, by a read that landed `askedAgoMs` ago (now where
 * not given), the latest ask failed after it as `stale` says, or, where none
 * are given, the read failed before it ever answered. The account
 * is given an id where the document names none, since the beats are held by
 * it.
 */
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

/** The id the account a test's own reads are held for goes by, where the document handed names none. */
const HELD_FOR_ACCOUNT_ID = "user-integrations";

/** The window's hold on a read keyed by the account signed in, as a test's host answers it. */
export interface IntegrationsHeld {
  /** Lays the read as the test's host reads it now, as the host lays a read that moved. */
  readonly lay: () => void;
  /** How many holds the window took. */
  readonly holds: () => number;
  /** How many Try agains the window asked. */
  readonly retries: () => number;
}

/** A read keyed by the account signed in, as a test's host holds it. */
export type AccountReadHeld = IntegrationsHeld;

/**
 * Lays the read `readOf` answers on the document under the account signed
 * in, given an id where the document names none, as the window first asks
 * for the document, and again as the answered `lay` asks, as the host lays
 * a read that moved; none is laid while it answers none. Note that each read
 * is laid under the newest version the window was handed, by the document or
 * a delivery of the helpers beneath this one, which a delivery repeating it
 * is adopted at, so it never puts another helper's later delivery behind it.
 */
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

/**
 * Answers the window's hold on the account's integrations as the host does,
 * beside whatever acts the test answers by now: the read `readOf` answers
 * laid on the document under the account signed in (`heldForAccount`), as
 * the window first asks for the document, again as Try again asks, and
 * again as `lay` asks.
 */
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

/**
 * Answers the window's hold on the account's GitHub token as the host does,
 * beside whatever acts the test answers by now: the read `readOf` answers
 * laid on the document under the account signed in (`heldForAccount`), as
 * the window first asks for the document, again as Try again asks, and
 * again as `lay` asks, as the host lays a save's or a removal's answer.
 */
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
