import type { AccountSnapshot } from "@repo/credentials/snapshot";
import type { AccountFailedRun } from "@repo/features/account-inbox-wire";
import type { AccountPreferencesLive } from "@repo/features/account-preferences-live";
import {
  type AgentBrowserTab,
  BROWSER_TABS_PLACE,
  type BrowserTabsPlaceKind,
} from "@repo/features/agent-browser-tab-wire";
import {
  type AgentOverviewChecksAnswerView,
  type AgentOverviewConversationAnswerView,
  type AgentOverviewPullRequestAnswerView,
  type AgentPullRequestAnswerView,
  type AgentPullRequestViewedAnswerView,
  type AgentReviewOptionsAnswerView,
  type AgentTranscriptPage,
  INBOX_SCOPE_KIND,
  PULL_REQUEST_PART,
  type PullRequestPart,
} from "@repo/features/agent-view";
import type {
  AgentMessagesAnswer,
  AgentOrigin,
  AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import type {
  AutomationRunSummary,
  AutomationSummary,
  AutomationWorkspaceRun,
} from "@repo/features/automation-wire";
import type {
  GitHubRepositoriesAnswer,
  GitHubRepositoryIssueAnswer,
  GitHubRepositoryPullRequestAnswer,
  WorkspaceTokenRepository,
} from "@repo/features/github-repositories-wire";
import type { GitHubTokenSummary } from "@repo/features/github-token-wire";
import type { HostLine } from "@repo/features/host-live";
import type { InboxItem } from "@repo/features/inbox-wire";
import type { InstalledSkillSummary } from "@repo/features/installed-skill-route-wire";
import type { IntegrationStatusesAnswer } from "@repo/features/integration-live";
import type { IntegrationToolsAnswer } from "@repo/features/integration-wire";
import { LIVE_READ, type LiveRead } from "@repo/features/live-wire";
import type { McpClientsAnswer } from "@repo/features/mcp-client-wire";
import type { MemorySummary } from "@repo/features/memory-wire";
import type { ModelsAnswer } from "@repo/features/models-wire";
import { PAGE_OWNER, type PageLine } from "@repo/features/page-wire";
import type { DescriptionCommentThread } from "@repo/features/description-comment-wire";
import type { PortForwarding } from "@repo/features/port-forward-acts";
import type { ProviderKeysAnswer } from "@repo/features/provider-key-wire";
import type { PullRequestChaptersAnswer } from "@repo/features/pull-request-chapters-wire";
import type { SlackListedChannel } from "@repo/features/slack-bot-wire";
import type { DescriptionRevisionsAnswer } from "@repo/features/task-wire";
import {
  COMMENT_SUBJECT,
  type HeldDescriptionDocument,
  type TasksView,
} from "@repo/features/tasks-view";
import type { WorkspaceIntegrations } from "@repo/features/workspace-integrations-live";
import type { WorkspaceInvitation } from "@repo/features/workspace-invitation-wire";
import type { WorkspaceToolsAnswer } from "@repo/features/workspace-tools-wire";
import type { WorkspaceMembersAnswer } from "@repo/features/workspace-wire";
import type { SessionReplayBootstrap } from "@repo/gateway/window-session";
import { HOST_CAPABILITY, type HostCapability } from "@repo/settings";
import type { MicrophoneRoute, MicrophoneStatus } from "@repo/settings/microphone";
import type { NotificationsStatus } from "@repo/settings/settings-controls";
import type { BuildCommit, UpdateSnapshot } from "@repo/settings/update";
import type { AppSettings } from "@repo/settings/wire";
import { EXCESS_KEYS, keepIdentity, type UnparsedWireValue } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Equal, Result, Schema } from "effect";
import type { MacCommandAsk } from "./mac-command-ask.js";

export type { MacCommandAsk } from "./mac-command-ask.js";

export const RUN_PROFILE = {
  IDLE: "idle",
  TASKS: "tasks",
  TASKS_TRANSCRIPT: "tasks-transcript",
  TASKS_WORK: "tasks-work",
  TASKS_COMMENTS: "tasks-comments",
  INBOX: "inbox",
  PERSON: "person",
  AGENT_PULL_REQUEST: "agent-pull-request",
  AGENT_TRANSCRIPT: "agent-transcript",
  AGENT_LONG_RUN: "agent-long-run",
  AGENT_CHECKS: "agent-checks",
  AGENT_FILES: "agent-files",
  AGENT_CHAPTERS: "agent-chapters",
  AGENT_FILE: "agent-file",
  AGENT_TERMINAL: "agent-terminal",
  AGENT_TERMINAL_CONNECTING: "agent-terminal-connecting",
  AGENT_TERMINAL_RECONNECTING: "agent-terminal-reconnecting",
  AGENT_TERMINAL_IDLE: "agent-terminal-idle",
  AGENT_TERMINAL_EXITED: "agent-terminal-exited",
  AGENT_TERMINAL_STOPPED: "agent-terminal-stopped",
  AGENT_TERMINAL_STARTING: "agent-terminal-starting",
  AGENT_TERMINAL_UNREACHABLE: "agent-terminal-unreachable",
  AGENT_PAGE: "agent-page",
  SETTINGS_ACCOUNT: "settings-account",
  SETTINGS_WORKSPACE: "settings-workspace",
  SETTINGS_AGENTS: "settings-agents",
  SETTINGS_HOSTS: "settings-hosts",
  SETTINGS_INTEGRATIONS: "settings-integrations",
  SETTINGS_MCP: "settings-mcp",
  SETTINGS_SKILLS: "settings-skills",
  SETTINGS_MEMORY: "settings-memory",
  ADMIN: "admin",
  AUTOMATIONS: "automations",
  AUTOMATIONS_EDITOR: "automations-editor",
  AUTOMATIONS_RUNS: "automations-runs",
} as const;

export type RunProfile = (typeof RUN_PROFILE)[keyof typeof RUN_PROFILE];

interface AppRunFacts {
  profile: string;
  packaged: boolean;
  platform: string;
  capabilities: readonly HostCapability[];
  appVersion: string;
  commit?: BuildCommit;
  instance?: string;
  captureMode: boolean;
  fixtureMode: boolean;
  accountRequired: boolean;
}

export interface AppAudioSlice {
  microphoneStatus: MicrophoneStatus;
  microphoneRoute?: MicrophoneRoute;
}

export interface SessionReplayState {
  permitted: boolean;
  accountId?: string;
  name?: string;
  email?: string;
}

interface AppSessionReplaySlice extends SessionReplayState {
  halted: boolean;
}

interface AppAgentsSlice {
  unseen: readonly string[];
}

export interface AppInboxWaitingItem {
  id: string;
  agentId: string;
  title: string;
  postedAt: number;
  asking?: boolean;
  remindAt?: number;
}

export interface AppInboxTask {
  taskId: string;
  items: readonly AppInboxWaitingItem[];
}

export interface AppInboxTaskHolding {
  taskId: string;
  items: number;
  toDo?: number;
  updatedAt: number;
}

export interface AppInboxTasklessItem extends AppInboxWaitingItem {
  updatedAt: number;
  agentTitle: string | null;
  agentModel: string;
  automationId: string | null;
  automationName: string | null;
  repository: string | null;
  workspaceId?: string;
  startedBy?: string;
  waitsOn?: string;
}

interface AppInboxAutomationHolding {
  automationId: string | null;
  items: number;
  updatedAt: number;
}

export type AppInboxAgentHolding = Pick<
  AppInboxTasklessItem,
  | "agentId"
  | "agentTitle"
  | "agentModel"
  | "automationId"
  | "automationName"
  | "repository"
  | "workspaceId"
  | "updatedAt"
> & {
  items: number;
  toDo: number;
};

export interface AppInboxSlice {
  waiting: readonly AppInboxTask[];
  tasks: readonly AppInboxTaskHolding[];
  taskless: readonly AppInboxTasklessItem[];
  automations: readonly AppInboxAutomationHolding[];
  agents: readonly AppInboxAgentHolding[];
  failedRuns: readonly AccountFailedRun[];
}

export interface AppHostRead<Rows> {
  rows?: Rows;
  failed?: true;
}

export const UNREAD: AppHostRead<never> = {};

type AppAgentOrigin = AppHostRead<AgentOrigin | null>;

export type AppAgentOrigins = Readonly<Record<string, AppAgentOrigin>>;

export const NO_AGENT_ORIGINS: AppAgentOrigins = {};

export const OWN_TRANSCRIPT = "own";

export type AppTranscriptWord = Omit<AgentMessagesAnswer, "messages" | "cursor"> & {
  readonly caughtUp: boolean;
  readonly queueRevision?: number;
};

export type AppTranscriptFailure = Extract<AgentTranscriptPage, { readonly failure: unknown }>;

export interface AppTranscript {
  readonly messages: readonly AgentTranscriptMessage[];
  readonly before?: string;
  readonly cursor?: string;
  readonly word?: AppTranscriptWord;
  readonly pages: number;
  readonly failure?: AppTranscriptFailure;
}

export type AppTranscripts = Readonly<
  Record<string, Readonly<Record<string, AppHostRead<AppTranscript>>>>
>;

export const NO_TRANSCRIPTS: AppTranscripts = {};

type ByInboxHolder<Value> = {
  readonly [Kind in InboxHolderKind]: Readonly<Record<string, Value>>;
};

export type AppInboxItems = ByInboxHolder<readonly InboxItem[]>;

type InboxHolderKind = (typeof INBOX_SCOPE_KIND)[keyof typeof INBOX_SCOPE_KIND];

export type AppHolderInbox = AppHostRead<readonly InboxItem[]>;

export type AppHolderInboxes = ByInboxHolder<AppHolderInbox>;

export const NO_HOLDER_INBOXES: AppHolderInboxes = {
  [INBOX_SCOPE_KIND.PLAN]: {},
  [INBOX_SCOPE_KIND.AGENT]: {},
};

type PageOwnerKind = (typeof PAGE_OWNER)[keyof typeof PAGE_OWNER];

export type AppHolderPages = AppHostRead<readonly PageLine[]>;

export type AppPages = {
  readonly [Kind in PageOwnerKind]: Readonly<Record<string, AppHolderPages>>;
};

export const NO_PAGES: AppPages = { [PAGE_OWNER.TASK]: {}, [PAGE_OWNER.AGENT]: {} };

export type AppBrowserTabs = {
  readonly [Kind in BrowserTabsPlaceKind]: Readonly<
    Record<string, AppHostRead<readonly AgentBrowserTab[]>>
  >;
};

export const NO_BROWSER_TABS: AppBrowserTabs = {
  [BROWSER_TABS_PLACE.TASK]: {},
  [BROWSER_TABS_PLACE.AGENT]: {},
};

export type AppPullRequestChapters = AppHostRead<PullRequestChaptersAnswer>;

export type AppChapters = Readonly<
  Record<string, Readonly<Record<string, AppPullRequestChapters>>>
>;

export const NO_CHAPTERS: AppChapters = {};

export type AppPullRequestPart<Part> = Readonly<
  Record<string, Readonly<Record<string, AppHostRead<Part>>>>
>;

export const OWN_PULL_REQUEST = "own";

export const PULL_REQUEST_PART_READ = {
  [PULL_REQUEST_PART.PULL_REQUEST]: LIVE_READ.PULL_REQUEST,
  [PULL_REQUEST_PART.CHECKS]: LIVE_READ.PULL_REQUEST_CHECKS,
  [PULL_REQUEST_PART.CONVERSATION]: LIVE_READ.PULL_REQUEST_CONVERSATION,
  [PULL_REQUEST_PART.PUBLISHED]: LIVE_READ.PULL_REQUEST_PUBLISHED,
  [PULL_REQUEST_PART.REVIEW_OPTIONS]: LIVE_READ.REVIEW_OPTIONS,
  [PULL_REQUEST_PART.VIEWED]: LIVE_READ.PULL_REQUEST_VIEWED,
} as const satisfies Record<PullRequestPart, LiveRead>;
interface AppDeviceBeat {
  deviceId: string;
  beatAt: number;
}

export interface AppDevicePresence {
  beats: readonly AppDeviceBeat[];
  askedAt: number;
  stale?: true;
}

export type AppDevicePresences = Readonly<Record<string, AppHostRead<AppDevicePresence>>>;

export interface AppHostsHeld {
  hosts: readonly HostLine[];
  installScriptUrl: string;
}

export type AppHosts = Readonly<Record<string, AppHostRead<AppHostsHeld>>>;

export type AppWorkspaceInvitations = Readonly<
  Record<string, AppHostRead<readonly WorkspaceInvitation[]>>
>;

export interface AppThisMacHost {
  deviceId?: string;
  machineId?: string;
  enrolled?: boolean;
  agentFolders?: number;
}

export type AppThisMacHosts = Readonly<Record<string, AppHostRead<AppThisMacHost>>>;

export type AppWorkspaceMembersRead = AppHostRead<WorkspaceMembersAnswer>;

export type AppWorkspaceMembers = Readonly<Record<string, AppWorkspaceMembersRead>>;

export type AppWorkspaceIntegrations = AppHeldById<WorkspaceIntegrations>;

export type AppSlackChannels = AppHeldById<readonly SlackListedChannel[]>;

export interface AppWorkspacePhoto {
  version: string;
  url: string;
}

export type AppWorkspacePhotos = Readonly<Record<string, AppHostRead<AppWorkspacePhoto>>>;

export type AppWorkspaceTools = Readonly<Record<string, AppHostRead<WorkspaceToolsAnswer>>>;

export type AppIntegrations = Readonly<Record<string, AppHostRead<IntegrationStatusesAnswer>>>;

export type AppMcpClients = Readonly<Record<string, AppHostRead<McpClientsAnswer>>>;
export type AppIntegrationTools = Readonly<Record<string, AppHostRead<IntegrationToolsAnswer>>>;

export type AppProviderKeyList = Pick<ProviderKeysAnswer, "keys" | "subscriptions">;

export type AppProviderKeys = Readonly<Record<string, AppHostRead<AppProviderKeyList>>>;

export type AppModels = Readonly<Record<string, AppHostRead<ModelsAnswer>>>;

export type AppAccountPreferences = Readonly<Record<string, AppHostRead<AccountPreferencesLive>>>;

export type AppLinkStanding = GitHubRepositoryPullRequestAnswer | GitHubRepositoryIssueAnswer;

export type AppLinkStandings = Readonly<
  Record<string, Readonly<Record<string, AppHostRead<AppLinkStanding>>>>
>;

export type AppRepositoryLists = Readonly<Record<string, AppHostRead<GitHubRepositoriesAnswer>>>;

export const EVERY_WORKSPACE = "every-workspace";

export interface AppGitHubToken {
  token: GitHubTokenSummary | null;
}

export type AppGitHubTokens = Readonly<Record<string, AppHostRead<AppGitHubToken>>>;

export type AppTokenRepositories = Readonly<
  Record<string, AppHostRead<readonly WorkspaceTokenRepository[]>>
>;

export const NO_KEYS_HELD: Readonly<Record<string, never>> = {};

export type AppHeldById<Rows> = Readonly<Record<string, AppHostRead<Rows>>>;

export type AppMemories = AppHeldById<readonly MemorySummary[]>;

export type AppInstalledSkills = AppHeldById<readonly InstalledSkillSummary[]>;

export type AppDescriptionDocuments = AppHeldById<HeldDescriptionDocument>;

export type AppHistories = AppHeldById<DescriptionRevisionsAnswer>;

export type AppAutomationReads = Pick<
  AppState,
  | typeof LIVE_READ.AUTOMATIONS
  | typeof LIVE_READ.AUTOMATION_WORKSPACE_RUNS
  | typeof LIVE_READ.AUTOMATION_RUNS
>;

export type AppPullRequestParts = Pick<
  AppState,
  (typeof PULL_REQUEST_PART_READ)[keyof typeof PULL_REQUEST_PART_READ]
>;

type CommentSubjectKind = (typeof COMMENT_SUBJECT)[keyof typeof COMMENT_SUBJECT];

type AppSubjectComments = AppHostRead<readonly DescriptionCommentThread[]>;

export type AppDescriptionComments = {
  readonly [Kind in CommentSubjectKind]: Readonly<Record<string, AppSubjectComments>>;
};

export const NO_DESCRIPTION_COMMENTS: AppDescriptionComments = {
  [COMMENT_SUBJECT.DESCRIPTION]: {},
  [COMMENT_SUBJECT.PAGE]: {},
};

export interface AppHostReads {
  [LIVE_READ.ACCOUNT_PREFERENCES]: AccountPreferencesLive;
  [LIVE_READ.AGENT_ORIGINS]: AgentOrigin | null;
  [LIVE_READ.INBOX_ITEMS]: AppInboxItems;
  [LIVE_READ.HOLDER_INBOX]: readonly InboxItem[];
  [LIVE_READ.INSTALLED_SKILLS]: readonly InstalledSkillSummary[];
  [LIVE_READ.INTEGRATIONS]: IntegrationStatusesAnswer;
  [LIVE_READ.INTEGRATION_TOOLS]: IntegrationToolsAnswer;
  [LIVE_READ.LINK_STANDINGS]: AppLinkStanding;
  [LIVE_READ.MEMORIES]: readonly MemorySummary[];
  [LIVE_READ.MODELS]: ModelsAnswer;
  [LIVE_READ.PAGES]: readonly PageLine[];
  [LIVE_READ.PROVIDER_KEYS]: AppProviderKeyList;
  [LIVE_READ.PULL_REQUEST]: AgentOverviewPullRequestAnswerView;
  [LIVE_READ.REPOSITORY_LISTS]: GitHubRepositoriesAnswer;
  [LIVE_READ.GITHUB_TOKEN]: AppGitHubToken;
  [LIVE_READ.PULL_REQUEST_CHAPTERS]: PullRequestChaptersAnswer;
  [LIVE_READ.BROWSER_TABS]: readonly AgentBrowserTab[];
  [LIVE_READ.PULL_REQUEST_CHECKS]: AgentOverviewChecksAnswerView;
  [LIVE_READ.PULL_REQUEST_CONVERSATION]: AgentOverviewConversationAnswerView;
  [LIVE_READ.PULL_REQUEST_PUBLISHED]: AgentPullRequestAnswerView;
  [LIVE_READ.PULL_REQUEST_VIEWED]: AgentPullRequestViewedAnswerView;
  [LIVE_READ.REVIEW_OPTIONS]: AgentReviewOptionsAnswerView;
  [LIVE_READ.DEVICE_PRESENCE]: AppDevicePresence;
  [LIVE_READ.HOSTS]: AppHostsHeld;
  [LIVE_READ.WORKSPACE_INVITATIONS]: readonly WorkspaceInvitation[];
  [LIVE_READ.THIS_MAC_HOST]: AppThisMacHost;
  [LIVE_READ.TRANSCRIPT]: AppTranscript;
  [LIVE_READ.WORKSPACE_MEMBERS]: WorkspaceMembersAnswer;
  [LIVE_READ.WORKSPACE_INTEGRATIONS]: WorkspaceIntegrations;
  [LIVE_READ.SLACK_CHANNELS]: readonly SlackListedChannel[];
  [LIVE_READ.TOKEN_REPOSITORIES]: readonly WorkspaceTokenRepository[];
  [LIVE_READ.WORKSPACE_PHOTOS]: AppWorkspacePhoto;
  [LIVE_READ.WORKSPACE_TOOLS]: WorkspaceToolsAnswer;
  [LIVE_READ.MCP_CLIENTS]: McpClientsAnswer;
  [LIVE_READ.AUTOMATIONS]: readonly AutomationSummary[];
  [LIVE_READ.AUTOMATION_WORKSPACE_RUNS]: readonly AutomationWorkspaceRun[];
  [LIVE_READ.AUTOMATION_RUNS]: readonly AutomationRunSummary[];
  [LIVE_READ.DESCRIPTION_COMMENTS]: readonly DescriptionCommentThread[];
  [LIVE_READ.HISTORY]: DescriptionRevisionsAnswer;
  [LIVE_READ.DESCRIPTION_DOCUMENT]: HeldDescriptionDocument;
}

interface AppMacCommandsSlice {
  asks: readonly MacCommandAsk[];
}

interface AppNotificationsSlice {
  status: NotificationsStatus;
}

interface AppNetworkSlice {
  online: boolean;
  reachable: boolean;
  offlineRefused?: number;
}

export function networkConnected(network: Pick<AppNetworkSlice, "online" | "reachable">): boolean {
  return network.online && network.reachable;
}

export interface AppAccessSlice {
  admin: boolean;
  supportAccessUntil?: number;
  pending?: true;
}

export interface AppState {
  readonly version: number;
  run: AppRunFacts;
  settings?: AppSettings;
  account: AccountSnapshot;
  access: AppAccessSlice;
  update: UpdateSnapshot;
  audio: AppAudioSlice;
  tasks: TasksView;
  agents: AppAgentsSlice;
  inbox: AppInboxSlice;
  [LIVE_READ.AGENT_ORIGINS]: AppAgentOrigins;
  [LIVE_READ.ACCOUNT_PREFERENCES]: AppAccountPreferences;
  [LIVE_READ.INBOX_ITEMS]: AppHostRead<AppInboxItems>;
  [LIVE_READ.HOLDER_INBOX]: AppHolderInboxes;
  [LIVE_READ.INSTALLED_SKILLS]: AppInstalledSkills;
  [LIVE_READ.INTEGRATIONS]: AppIntegrations;
  [LIVE_READ.INTEGRATION_TOOLS]: AppIntegrationTools;
  [LIVE_READ.LINK_STANDINGS]: AppLinkStandings;
  [LIVE_READ.MEMORIES]: AppMemories;
  [LIVE_READ.MODELS]: AppModels;
  [LIVE_READ.PAGES]: AppPages;
  [LIVE_READ.PROVIDER_KEYS]: AppProviderKeys;
  [LIVE_READ.REPOSITORY_LISTS]: AppRepositoryLists;
  [LIVE_READ.GITHUB_TOKEN]: AppGitHubTokens;
  [LIVE_READ.PULL_REQUEST_CHAPTERS]: AppChapters;
  [LIVE_READ.BROWSER_TABS]: AppBrowserTabs;
  [LIVE_READ.PULL_REQUEST]: AppPullRequestPart<AgentOverviewPullRequestAnswerView>;
  [LIVE_READ.PULL_REQUEST_CHECKS]: AppPullRequestPart<AgentOverviewChecksAnswerView>;
  [LIVE_READ.PULL_REQUEST_CONVERSATION]: AppPullRequestPart<AgentOverviewConversationAnswerView>;
  [LIVE_READ.PULL_REQUEST_PUBLISHED]: AppPullRequestPart<AgentPullRequestAnswerView>;
  [LIVE_READ.PULL_REQUEST_VIEWED]: AppPullRequestPart<AgentPullRequestViewedAnswerView>;
  [LIVE_READ.REVIEW_OPTIONS]: AppPullRequestPart<AgentReviewOptionsAnswerView>;
  [LIVE_READ.DEVICE_PRESENCE]: AppDevicePresences;
  [LIVE_READ.HOSTS]: AppHosts;
  [LIVE_READ.WORKSPACE_INVITATIONS]: AppWorkspaceInvitations;
  [LIVE_READ.THIS_MAC_HOST]: AppThisMacHosts;
  [LIVE_READ.TRANSCRIPT]: AppTranscripts;
  [LIVE_READ.WORKSPACE_MEMBERS]: AppWorkspaceMembers;
  [LIVE_READ.WORKSPACE_INTEGRATIONS]: AppWorkspaceIntegrations;
  [LIVE_READ.SLACK_CHANNELS]: AppSlackChannels;
  [LIVE_READ.TOKEN_REPOSITORIES]: AppTokenRepositories;
  [LIVE_READ.WORKSPACE_PHOTOS]: AppWorkspacePhotos;
  [LIVE_READ.WORKSPACE_TOOLS]: AppWorkspaceTools;
  [LIVE_READ.MCP_CLIENTS]: AppMcpClients;
  [LIVE_READ.AUTOMATIONS]: AppHeldById<readonly AutomationSummary[]>;
  [LIVE_READ.AUTOMATION_WORKSPACE_RUNS]: AppHeldById<readonly AutomationWorkspaceRun[]>;
  [LIVE_READ.AUTOMATION_RUNS]: AppHeldById<readonly AutomationRunSummary[]>;
  [LIVE_READ.DESCRIPTION_COMMENTS]: AppDescriptionComments;
  [LIVE_READ.HISTORY]: AppHistories;
  [LIVE_READ.DESCRIPTION_DOCUMENT]: AppDescriptionDocuments;
  macCommands: AppMacCommandsSlice;
  notifications: AppNotificationsSlice;
  network: AppNetworkSlice;
  sessionReplay: AppSessionReplaySlice;
  portForwarding: PortForwarding;
}

export interface AppWindowFacts {
  fullScreen: boolean;
  buildLabelHidden?: boolean;
}

export type AppStateSnapshot = AppState & { window: AppWindowFacts };

const appStateSnapshotSchema = Schema.Struct({
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  run: Schema.Struct({
    capabilities: Schema.Array(Schema.Literals(Object.values(HOST_CAPABILITY))),
  }),
  window: Schema.Struct({ fullScreen: Schema.Boolean }),
});

const readAppStateSnapshot = readEither(appStateSnapshotSchema, { excess: EXCESS_KEYS.DROP });

export function isAppStateSnapshot(value: UnparsedWireValue): boolean {
  return Result.isSuccess(readAppStateSnapshot(value));
}

type AppStateEntry = Exclude<keyof AppStateSnapshot, "version">;

export const READ_KEYS = {
  ONE: "one",
  TWO: "two",
  PARTS: "parts",
} as const;

export const KEYS_ON = {
  SLICE: "slice",
  ROWS: "rows",
} as const;

type TasksRows<Part extends keyof TasksView> = NonNullable<TasksView[Part]>;

interface HostReadSliceEntry {
  readonly keys: (typeof READ_KEYS)[keyof typeof READ_KEYS];
  readonly on: (typeof KEYS_ON)[keyof typeof KEYS_ON];
  readonly rowId?: string;
  readonly rowIds?: { readonly [part: string]: string };
  readonly rowsAt?: string;
}

export const HOST_READ_SLICE = {
  [LIVE_READ.ACCOUNT_PREFERENCES]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
  [LIVE_READ.AGENT_ORIGINS]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
  [LIVE_READ.INBOX_ITEMS]: {
    keys: READ_KEYS.TWO,
    on: KEYS_ON.ROWS,
    rowId: "id" satisfies keyof InboxItem,
  },
  [LIVE_READ.HOLDER_INBOX]: {
    keys: READ_KEYS.TWO,
    on: KEYS_ON.SLICE,
    rowId: "id" satisfies keyof InboxItem,
  },
  [LIVE_READ.INSTALLED_SKILLS]: {
    keys: READ_KEYS.ONE,
    on: KEYS_ON.SLICE,
    rowId: "id" satisfies keyof InstalledSkillSummary,
  },
  [LIVE_READ.INTEGRATIONS]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
  [LIVE_READ.INTEGRATION_TOOLS]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
  [LIVE_READ.MEMORIES]: {
    keys: READ_KEYS.ONE,
    on: KEYS_ON.SLICE,
    rowId: "id" satisfies keyof MemorySummary,
  },
  [LIVE_READ.MODELS]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
  [LIVE_READ.PAGES]: { keys: READ_KEYS.TWO, on: KEYS_ON.SLICE },
  [LIVE_READ.PROVIDER_KEYS]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
  [LIVE_READ.LINK_STANDINGS]: { keys: READ_KEYS.TWO, on: KEYS_ON.SLICE },
  [LIVE_READ.REPOSITORY_LISTS]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
  [LIVE_READ.GITHUB_TOKEN]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
  [LIVE_READ.PULL_REQUEST_CHAPTERS]: { keys: READ_KEYS.TWO, on: KEYS_ON.SLICE },
  [LIVE_READ.PULL_REQUEST]: { keys: READ_KEYS.TWO, on: KEYS_ON.SLICE },
  [LIVE_READ.PULL_REQUEST_CHECKS]: { keys: READ_KEYS.TWO, on: KEYS_ON.SLICE },
  [LIVE_READ.PULL_REQUEST_CONVERSATION]: { keys: READ_KEYS.TWO, on: KEYS_ON.SLICE },
  [LIVE_READ.PULL_REQUEST_PUBLISHED]: { keys: READ_KEYS.TWO, on: KEYS_ON.SLICE },
  [LIVE_READ.PULL_REQUEST_VIEWED]: { keys: READ_KEYS.TWO, on: KEYS_ON.SLICE },
  [LIVE_READ.REVIEW_OPTIONS]: { keys: READ_KEYS.TWO, on: KEYS_ON.SLICE },
  [LIVE_READ.DESCRIPTION_COMMENTS]: {
    keys: READ_KEYS.TWO,
    on: KEYS_ON.SLICE,
    rowId: "id" satisfies keyof DescriptionCommentThread,
  },
  [LIVE_READ.HISTORY]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
  tasks: {
    keys: READ_KEYS.PARTS,
    on: KEYS_ON.SLICE,
    rowIds: {
      tasks: "id" satisfies keyof TasksRows<"tasks">[number],
      taskAgents: "id" satisfies keyof TasksRows<"taskAgents">[number],
      tasklessAgents: "id" satisfies keyof TasksRows<"tasklessAgents">[number],
      taskPullRequests: "taskId" satisfies keyof TasksRows<"taskPullRequests">[number],
      agentPullRequests: "agentId" satisfies keyof TasksRows<"agentPullRequests">[number],
    } satisfies { readonly [Part in keyof TasksView]?: string },
  },
  [LIVE_READ.BROWSER_TABS]: { keys: READ_KEYS.TWO, on: KEYS_ON.SLICE },
  [LIVE_READ.DEVICE_PRESENCE]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
  [LIVE_READ.HOSTS]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
  [LIVE_READ.WORKSPACE_INVITATIONS]: {
    keys: READ_KEYS.ONE,
    on: KEYS_ON.SLICE,
    rowId: "id" satisfies keyof WorkspaceInvitation,
  },
  [LIVE_READ.THIS_MAC_HOST]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
  [LIVE_READ.TRANSCRIPT]: {
    keys: READ_KEYS.TWO,
    on: KEYS_ON.SLICE,
    rowId: "id" satisfies keyof AgentTranscriptMessage,
    rowsAt: "messages" satisfies keyof AppTranscript,
  },
  [LIVE_READ.WORKSPACE_MEMBERS]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
  [LIVE_READ.WORKSPACE_INTEGRATIONS]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
  [LIVE_READ.SLACK_CHANNELS]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
  [LIVE_READ.TOKEN_REPOSITORIES]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
  [LIVE_READ.WORKSPACE_PHOTOS]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
  [LIVE_READ.WORKSPACE_TOOLS]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
  [LIVE_READ.MCP_CLIENTS]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
  [LIVE_READ.AUTOMATIONS]: {
    keys: READ_KEYS.ONE,
    on: KEYS_ON.SLICE,
    rowId: "id" satisfies keyof AutomationSummary,
  },
  [LIVE_READ.AUTOMATION_WORKSPACE_RUNS]: {
    keys: READ_KEYS.ONE,
    on: KEYS_ON.SLICE,
    rowId: "id" satisfies keyof AutomationWorkspaceRun,
  },
  [LIVE_READ.AUTOMATION_RUNS]: {
    keys: READ_KEYS.ONE,
    on: KEYS_ON.SLICE,
    rowId: "id" satisfies keyof AutomationRunSummary,
  },
  [LIVE_READ.DESCRIPTION_DOCUMENT]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
} as const satisfies { readonly [Slice in keyof AppState]?: HostReadSliceEntry };

export type HostReadSlice = keyof typeof HOST_READ_SLICE;

export type HostReadKeyPath<Slice extends HostReadSlice> =
  (typeof HOST_READ_SLICE)[Slice]["keys"] extends typeof READ_KEYS.TWO
    ? readonly [kind: string, id: string]
    : readonly [id: string];

const HOST_READ_SLICES = Object.keys(HOST_READ_SLICE) as HostReadSlice[];

type KeyMoved =
  | { readonly key: readonly string[]; readonly value: unknown }
  | {
      readonly key: readonly string[];
      readonly rows: readonly object[];
      readonly ids?: readonly string[];
      readonly beside?: Keyed;
    };

export interface AppStateDelivery {
  readonly version: number;
  readonly entries: { readonly [Entry in AppStateEntry]?: AppStateSnapshot[Entry] };
  readonly gone?: readonly AppStateEntry[];
  readonly moved?: { readonly [Slice in HostReadSlice]?: readonly KeyMoved[] };
}

type Keyed = Readonly<Record<string, unknown>>;

function ownValue(keyed: Keyed, id: string): unknown {
  return Object.hasOwn(keyed, id) ? keyed[id] : undefined;
}

function keyedOf(entry: HostReadSliceEntry, slice: object | undefined): Keyed | undefined {
  return entry.on === KEYS_ON.SLICE
    ? (slice as Keyed | undefined)
    : (slice as AppHostRead<Keyed> | undefined)?.rows;
}

function rowIdOf(entry: HostReadSliceEntry, key: readonly string[]): string | undefined {
  if (entry.keys !== READ_KEYS.PARTS) return entry.rowId;
  const [part] = key;
  return part === undefined || entry.rowIds === undefined || !Object.hasOwn(entry.rowIds, part)
    ? undefined
    : entry.rowIds[part];
}

function rowsAreValue(entry: HostReadSliceEntry): boolean {
  return entry.on === KEYS_ON.ROWS || entry.keys === READ_KEYS.PARTS;
}

function recordOf(entry: HostReadSliceEntry, value: unknown): Keyed | undefined {
  if (entry.rowsAt === undefined || typeof value !== "object" || value === null) return undefined;
  const rows: unknown = Reflect.get(value, "rows");
  return typeof rows === "object" && rows !== null ? (rows as Keyed) : undefined;
}

function rowsOf(entry: HostReadSliceEntry, value: unknown): readonly object[] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const rows: unknown =
    entry.rowsAt === undefined
      ? rowsAreValue(entry)
        ? value
        : Reflect.get(value, "rows")
      : recordOf(entry, value)?.[entry.rowsAt];
  return Array.isArray(rows) ? rows : undefined;
}

function besideOf(entry: HostReadSliceEntry, value: unknown): Keyed | undefined {
  const record = recordOf(entry, value);
  if (record === undefined) return undefined;
  return Object.fromEntries(Object.entries(record).filter(([field]) => field !== entry.rowsAt));
}

function idOf(rowId: string, row: object): string {
  return Reflect.get(row, rowId) as string;
}

function keyMoved(
  entry: HostReadSliceEntry,
  key: readonly string[],
  sent: unknown,
  next: unknown,
): KeyMoved {
  const rowId = rowIdOf(entry, key);
  const [before, after] = [rowsOf(entry, sent), rowsOf(entry, next)];
  if (rowId === undefined || before === undefined || after === undefined) {
    return { key, value: next };
  }
  const sentRows = new Map(before.map((row) => [idOf(rowId, row), row]));
  const sentIds = [...sentRows.keys()];
  const ids = after.map((row) => idOf(rowId, row));
  if (sentRows.size !== before.length || new Set(ids).size !== ids.length) {
    return { key, value: next };
  }
  const reordered = ids.length !== sentIds.length || ids.some((id, at) => id !== sentIds[at]);
  const beside = besideOf(entry, next);
  return {
    key,
    rows: after.filter((row) => sentRows.get(idOf(rowId, row)) !== row),
    ...(reordered ? { ids } : undefined),
    ...(beside === undefined ? undefined : { beside }),
  };
}

function idsMoved(
  entry: HostReadSliceEntry,
  path: readonly string[],
  before: Keyed,
  after: Keyed,
): KeyMoved[] {
  if (before === after) return [];
  return [
    ...Object.entries(after).flatMap(([id, value]) => {
      const sent = ownValue(before, id);
      return sent === value ? [] : [keyMoved(entry, [...path, id], sent, value)];
    }),
    ...Object.keys(before)
      .filter((id) => !Object.hasOwn(after, id))
      .map((id) => ({ key: [...path, id], value: null })),
  ];
}

function keysMoved(entry: HostReadSliceEntry, before: Keyed, after: Keyed): KeyMoved[] {
  if (entry.keys !== READ_KEYS.TWO) return idsMoved(entry, [], before, after);
  const kinds = new Set([...Object.keys(before), ...Object.keys(after)]);
  const ofKind = (keyed: Keyed, kind: string) => (ownValue(keyed, kind) ?? {}) as Keyed;
  return [...kinds].flatMap((kind) =>
    idsMoved(entry, [kind], ofKind(before, kind), ofKind(after, kind)),
  );
}

function valueLaid(entry: HostReadSliceEntry, held: unknown, move: KeyMoved): unknown {
  if ("value" in move) {
    if (move.value === null) return undefined;
    return held === undefined ? move.value : keepIdentity(held, move.value);
  }
  const rowId = rowIdOf(entry, move.key);
  if (rowId === undefined) return held;
  const heldList = rowsOf(entry, held) ?? [];
  const heldRows = new Map(heldList.map((row) => [idOf(rowId, row), row]));
  const movedRows = new Map(
    move.rows.map((row) => {
      const was = heldRows.get(idOf(rowId, row));
      return [idOf(rowId, row), was === undefined ? row : keepIdentity(was, row)];
    }),
  );
  const rows =
    move.ids === undefined
      ? heldList.map((row) => movedRows.get(idOf(rowId, row)) ?? row)
      : move.ids.flatMap((id) => movedRows.get(id) ?? heldRows.get(id) ?? []);
  const listKept = rows.length === heldList.length && rows.every((row, at) => row === heldList[at]);
  if (entry.rowsAt !== undefined) {
    return recordLaid(entry.rowsAt, held, listKept ? heldList : rows, move.beside);
  }
  if (listKept) return held;
  if (rowsAreValue(entry)) return rows;
  return typeof held === "object" && held !== null ? { ...held, rows } : { rows };
}

function recordLaid(
  rowsAt: string,
  held: unknown,
  list: readonly object[],
  beside: Keyed | undefined,
): unknown {
  const read = (typeof held === "object" && held !== null ? held : {}) as Keyed;
  const was = read.rows;
  const heldRecord = (typeof was === "object" && was !== null ? was : {}) as Keyed;
  const fields =
    beside === undefined
      ? Object.entries(heldRecord).filter(([field]) => field !== rowsAt)
      : Object.entries(beside).map(([field, value]) => {
          const kept = field !== rowsAt && Object.hasOwn(heldRecord, field);
          return [field, kept ? keepIdentity(heldRecord[field], value) : value] as const;
        });
  const record: Keyed = { ...Object.fromEntries(fields), [rowsAt]: list };
  const entries = Object.entries(record);
  const kept =
    entries.length === Object.keys(heldRecord).length &&
    entries.every(([field, value]) => ownValue(heldRecord, field) === value);
  return kept ? held : { ...read, rows: record };
}

function withIdsMoved(
  entry: HostReadSliceEntry,
  held: Keyed | undefined,
  moves: readonly KeyMoved[],
): Keyed {
  const next: Record<string, unknown> = { ...held };
  for (const move of moves) {
    const id = move.key[move.key.length - 1] ?? "";
    const laid = valueLaid(entry, ownValue(next, id), move);
    if (laid === undefined) Reflect.deleteProperty(next, id);
    else next[id] = laid;
  }
  return next;
}

function withKindsMoved(
  entry: HostReadSliceEntry,
  held: Keyed | undefined,
  moves: readonly KeyMoved[],
): Keyed {
  const next: Record<string, unknown> = { ...held };
  for (const kind of new Set(moves.map((move) => move.key[0] ?? ""))) {
    const ofKind = (held === undefined ? undefined : ownValue(held, kind)) as Keyed | undefined;
    next[kind] = withIdsMoved(
      entry,
      ofKind,
      moves.filter((move) => move.key[0] === kind),
    );
  }
  return next;
}

function withSliceMoved(
  entry: HostReadSliceEntry,
  held: object | undefined,
  moves: readonly KeyMoved[],
): object {
  const keyed = keyedOf(entry, held);
  const laid =
    entry.keys === READ_KEYS.TWO
      ? withKindsMoved(entry, keyed, moves)
      : withIdsMoved(entry, keyed, moves);
  return entry.on === KEYS_ON.SLICE ? laid : { ...held, rows: laid };
}

export function appStateDelivery(
  sent: AppStateSnapshot | undefined,
  next: AppStateSnapshot,
): AppStateDelivery | undefined {
  const names = [...new Set([...Object.keys(sent ?? {}), ...Object.keys(next)])].filter(
    (name) => name !== "version",
  ) as AppStateEntry[];
  const patched = HOST_READ_SLICES.flatMap((slice) => {
    const entry: HostReadSliceEntry = HOST_READ_SLICE[slice];
    const [before, after] = [keyedOf(entry, sent?.[slice]), keyedOf(entry, next[slice])];
    return before === undefined || after === undefined
      ? []
      : [[slice, keysMoved(entry, before, after)] as const];
  });
  const crossing = new Set<string>(patched.map(([slice]) => slice));
  const moved = names.filter(
    (name) => !crossing.has(name) && (sent === undefined || !Equal.equals(sent[name], next[name])),
  );
  const keys = patched.filter(([, keysOf]) => keysOf.length > 0);
  const gone = moved.filter((name) => next[name] === undefined);
  if (sent !== undefined && moved.length === 0 && keys.length === 0) return undefined;
  return {
    version: next.version,
    entries: Object.fromEntries(
      moved.filter((name) => next[name] !== undefined).map((name) => [name, next[name]]),
    ),
    ...(gone.length === 0 ? undefined : { gone }),
    ...(keys.length === 0 ? undefined : { moved: Object.fromEntries(keys) }),
  };
}

export function withAppStateDelivery(
  held: AppStateSnapshot,
  delivery: AppStateDelivery,
): AppStateSnapshot {
  const entries = Object.fromEntries(
    Object.entries(delivery.entries).map(([name, value]) => [
      name,
      keepIdentity(held[name as AppStateEntry], value),
    ]),
  );
  const slices = HOST_READ_SLICES.flatMap((slice) => {
    const moves = delivery.moved?.[slice];
    return moves === undefined
      ? []
      : [[slice, withSliceMoved(HOST_READ_SLICE[slice], held[slice], moves)] as const];
  });
  const next: AppStateSnapshot = {
    ...held,
    ...entries,
    ...Object.fromEntries(slices),
    version: delivery.version,
  };
  for (const name of delivery.gone ?? []) Reflect.deleteProperty(next, name);
  return next;
}

const appStateDeliverySchema = Schema.Struct({
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  entries: Schema.Struct({
    run: Schema.optional(
      Schema.Struct({
        capabilities: Schema.Array(Schema.Literals(Object.values(HOST_CAPABILITY))),
      }),
    ),
    window: Schema.optional(Schema.Struct({ fullScreen: Schema.Boolean })),
  }),
  gone: Schema.optional(Schema.Array(Schema.String)),
});

const readAppStateDelivery = readEither(appStateDeliverySchema, { excess: EXCESS_KEYS.DROP });

export function isAppStateDelivery(value: UnparsedWireValue): boolean {
  return Result.isSuccess(readAppStateDelivery(value));
}

export function sessionReplayBootstrap(
  state: Pick<AppState, "run" | "sessionReplay">,
): SessionReplayBootstrap {
  return {
    permitted: state.run.packaged && state.sessionReplay.permitted && !state.sessionReplay.halted,
    appVersion: state.run.appVersion,
    packaged: state.run.packaged,
    ...(state.sessionReplay.accountId ? { accountId: state.sessionReplay.accountId } : undefined),
    ...(state.sessionReplay.name ? { name: state.sessionReplay.name } : undefined),
    ...(state.sessionReplay.email ? { email: state.sessionReplay.email } : undefined),
  };
}

export const NO_ACCESS: AppAccessSlice = { admin: false, pending: true };
