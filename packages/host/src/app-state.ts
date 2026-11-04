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
import type { PlanCommentThread } from "@repo/features/plan-comment-wire";
import type { ProviderKeysAnswer } from "@repo/features/provider-key-wire";
import type { PullRequestChaptersAnswer } from "@repo/features/pull-request-chapters-wire";
import type { SlackListedChannel } from "@repo/features/slack-bot-wire";
import type { PlanRevisionsAnswer } from "@repo/features/task-wire";
import { COMMENT_SUBJECT, type HeldPlanDocument, type TasksView } from "@repo/features/tasks-view";
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

/**
 * The launch profiles a window answers to. A fixture run stages the panel's
 * Tasks tab over a synthetic task, or over its synthetic coding agent and
 * that agent's tabs; or a synthetic account signed in, on a page of
 * Settings, on Admin, on Automations, or with its Inbox and its own page
 * filled. Any other word — the default included — stages nothing.
 */
export const RUN_PROFILE = {
  IDLE: "idle",
  /** The panel's Tasks tab, opened at launch over a synthetic task. */
  TASKS: "tasks",
  /** The same task mid-call, opened at launch on the transcript of what was said on its calls. */
  TASKS_TRANSCRIPT: "tasks-transcript",
  /** The same task mid-call, opened at launch on the work its agent did on its calls. */
  TASKS_WORK: "tasks-work",
  /** The same task beside its coding agent, opened at launch on its plan, whose words hold comment threads: one answered, one its agent started, one on a whole block, and one resolved. */
  TASKS_COMMENTS: "tasks-comments",
  /** A synthetic account signed in, its tasks holding Inbox items: an ask of each kind, a form, a notice with code, a long thread, an answered item, and a closed one. */
  INBOX: "inbox",
  /** The same account and items, its tasks assigned to it and its agents at work, which its own page lists. */
  PERSON: "person",
  /** The same task on its coding agent, its Pull request tab beside it: checks, reviews, and a merge queued. */
  AGENT_PULL_REQUEST: "agent-pull-request",
  /** The same agent and Pull request tab, the agent's turn long enough that its transcript scrolls. */
  AGENT_TRANSCRIPT: "agent-transcript",
  /** The same agent as an orchestrator days into its run, its transcript thousands of entries long and written to while it is open. */
  AGENT_LONG_RUN: "agent-long-run",
  /** The same agent, its Pull request tab on the checks. */
  AGENT_CHECKS: "agent-checks",
  /** The same agent, its Pull request tab on Files changed. */
  AGENT_FILES: "agent-files",
  /** The same agent, its Pull request tab on Chapters. */
  AGENT_CHAPTERS: "agent-chapters",
  /** The same agent beside a file of its repository opened in a tab of its own. */
  AGENT_FILE: "agent-file",
  /** The same agent beside its Terminal, attached to a shell: one profile per state the tab draws. */
  AGENT_TERMINAL: "agent-terminal",
  AGENT_TERMINAL_CONNECTING: "agent-terminal-connecting",
  AGENT_TERMINAL_RECONNECTING: "agent-terminal-reconnecting",
  AGENT_TERMINAL_IDLE: "agent-terminal-idle",
  AGENT_TERMINAL_EXITED: "agent-terminal-exited",
  AGENT_TERMINAL_STOPPED: "agent-terminal-stopped",
  AGENT_TERMINAL_STARTING: "agent-terminal-starting",
  AGENT_TERMINAL_UNREACHABLE: "agent-terminal-unreachable",
  /** The same agent beside a page it showed, open in a tab of its own. */
  AGENT_PAGE: "agent-page",
  /** A synthetic account signed in, Settings opened at launch on its Account page. */
  SETTINGS_ACCOUNT: "settings-account",
  /** The same account, Settings on its team's workspace: its members and an invitation waiting. */
  SETTINGS_WORKSPACE: "settings-workspace",
  /** The same account, Settings on Agents: its Claude plan connected and its ChatGPT sign-in expired. */
  SETTINGS_AGENTS: "settings-agents",
  /** The same account, Settings on Hosts: a server online, one to upgrade, and one offline. */
  SETTINGS_HOSTS: "settings-hosts",
  /** The same account, Settings on Integrations: some connected, some with their sign-in expired. */
  SETTINGS_INTEGRATIONS: "settings-integrations",
  /** The same account, Settings on Skills: its team's and its own. */
  SETTINGS_SKILLS: "settings-skills",
  /** The same account, Settings on its team's memory. */
  SETTINGS_MEMORY: "settings-memory",
  /** The same account, an admin, opened at launch on Admin's Overview. */
  ADMIN: "admin",
  /** The same account, opened at launch on its Automations: three, the last run of one failed. */
  AUTOMATIONS: "automations",
  /** The same account on one automation's editor, its runs beside it. */
  AUTOMATIONS_EDITOR: "automations-editor",
  /** The same account on the automation whose run failed, that run marked among its runs. */
  AUTOMATIONS_RUNS: "automations-runs",
} as const;

export type RunProfile = (typeof RUN_PROFILE)[keyof typeof RUN_PROFILE];

/**
 * What this launch is, as every window is told it and no event ever changes.
 */
interface AppRunFacts {
  /** The `--profile` argument as given, which is {@link RUN_PROFILE.IDLE} when absent. */
  profile: string;
  packaged: boolean;
  platform: string;
  /** What this platform offers, which every control of a platform feature is drawn by. */
  capabilities: readonly HostCapability[];
  appVersion: string;
  /** The commit the build was cut from, for the Updates row to name. */
  commit?: BuildCommit;
  /** The named development instance this run is (`run.sh --instance`); none for the plain one or a release. */
  instance?: string;
  captureMode: boolean;
  fixtureMode: boolean;
  accountRequired: boolean;
}

export interface AppAudioSlice {
  microphoneStatus: MicrophoneStatus;
  microphoneRoute?: MicrophoneRoute;
}

/**
 * What the host answers about recording: whether this run may record, and
 * the signed-in account a recording is filed under, by its opaque id with the
 * name and email the person is shown by. All three are absent while signed
 * out, and are read off one snapshot of the session, so they never name two
 * accounts at once.
 */
export interface SessionReplayState {
  permitted: boolean;
  accountId?: string;
  name?: string;
  email?: string;
}

/**
 * What this run may record, as its two halves: what the host answered, and
 * whether an action that ended the account it files under has stood recording
 * down for the rest of the run.
 */
interface AppSessionReplaySlice extends SessionReplayState {
  halted: boolean;
}

/**
 * The coding agents whose turn ended while the developer was not looking at
 * the agent's tab, each until that tab is shown: what the tab's unseen dot
 * is drawn from. Main's, because main is what watches the agents while no
 * tab does, and so a reload of the window does not lose the dots.
 */
interface AppAgentsSlice {
  unseen: readonly string[];
}

/** One inbox item waiting on the developer: the item, the agent that posted it, what it asks, and when the agent first posted it, by the service's clock. */
export interface AppInboxWaitingItem {
  id: string;
  agentId: string;
  title: string;
  postedAt: number;
  /** Whether it holds an ask open rather than being a notice; absent from a service before it, which counts it as asking. */
  asking?: boolean;
  /** Until when the developer snoozed it, while nothing has woken it since; absent where it is not snoozed. The window leaves it uncounted until then. */
  snoozedUntil?: number;
}

/** One task with inbox items waiting on the developer: the task, and its open items, the latest changed first. */
export interface AppInboxTask {
  taskId: string;
  items: readonly AppInboxWaitingItem[];
}

/** One task holding inbox items, waiting or settled: the task, how many, how many are the reader's to do, and when the latest changed, by the service's clock. */
export interface AppInboxTaskHolding {
  taskId: string;
  items: number;
  /** How many of its items are questions waiting on the reader: open asks that wait on them; absent from a service before it, which the sidebar counts by the open items alone. */
  toDo?: number;
  updatedAt: number;
}

/**
 * One inbox item of an agent an automation started with no task, waiting on
 * the developer: the item as a task's are, the agent as its row names it
 * now, and the automation and repository standing where a task would; the
 * automation, and its name, null where the reader may not read it or none
 * stands, and the repository null for an agent that works in none.
 */
export interface AppInboxTasklessItem extends AppInboxWaitingItem {
  /** When the item last changed, by the service's clock, which a follow of its agent's inbox is current once it holds. */
  updatedAt: number;
  agentTitle: string | null;
  agentModel: string;
  automationId: string | null;
  automationName: string | null;
  repository: string | null;
  /** The workspace the agent belongs to, whose Inbox lists the item; absent from a service before it. */
  workspaceId?: string;
  /** The account that started the agent, whom the item waits on; absent where the service does not say, when it is the reader's own. */
  startedBy?: string;
  /** The account the item waits on: the member its agent addressed it to, else its starter; absent from a service before it, which reads as waiting on `startedBy`. */
  waitsOn?: string;
}

/** One automation holding items of its runs' agents with no task, waiting or settled, as a task holding items is listed: how many, and when the latest changed; null for the agents no automation the reader may read names. */
interface AppInboxAutomationHolding {
  automationId: string | null;
  items: number;
  updatedAt: number;
}

/**
 * One agent with no task holding inbox items, waiting or settled, as a task
 * holding items is listed: how many, how many are the reader's to do, and
 * when the latest changed, by the service's clock; and the agent as an item
 * of it names it, since one whose items are all settled has none waiting.
 */
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

/**
 * What waits on the developer across the account's tasks, as main's own
 * read of it last answered (`@repo/host/agent-notices`): each task with an
 * open inbox item, the task whose item changed latest first. What the
 * sidebar's Inbox counts. Main's, because main holds that read whichever task is
 * open, and empty while nobody is signed in.
 */
export interface AppInboxSlice {
  waiting: readonly AppInboxTask[];
  /** Every task holding an inbox item, waiting or settled, the task whose item changed latest first: what the window's Inbox lists. */
  tasks: readonly AppInboxTaskHolding[];
  /** The open items of agents with no task in the account's workspaces, every member's, the latest changed first, as the window's Inbox lists them; those of the reader's own agents (`startedBy`) alone wait on it and count with the tasks'. */
  taskless: readonly AppInboxTasklessItem[];
  /** Every automation holding items of its agents with no task, as `tasks` lists the tasks. */
  automations: readonly AppInboxAutomationHolding[];
  /** Every agent with no task holding an inbox item, waiting or settled, as `tasks` lists the tasks; none from a service before it. */
  agents: readonly AppInboxAgentHolding[];
  /** The newest run of each of the account's own automations that failed to start lately, the latest first, which marks the window's Automations until that automation is opened. */
  failedRuns: readonly AccountFailedRun[];
}

/**
 * One read the host holds for the panel (`live-collection.ts`), as every
 * window draws it: its rows as it last answered, absent until it first
 * does, and whether it said it could not answer before it ever had. A read
 * that stops answering once it has keeps its rows, since its next answer
 * brings them up to date. What the panel reads through `useHostRead`.
 */
export interface AppHostRead<Rows> {
  rows?: Rows;
  failed?: true;
}

/** A read that has not answered yet, as every read stands as a session opens. */
export const UNREAD: AppHostRead<never> = {};

/** The run of an automation that started one agent, as the host's read of it stands: null for an agent no run started, once it answered. */
type AppAgentOrigin = AppHostRead<AgentOrigin | null>;

/**
 * Each agent's origin the host holds for the windows (`compose-agents.ts`):
 * those an agent's page chose, and the few let go lately, by the agent's
 * id, each as its own read stands. One absent is held by nobody.
 */
export type AppAgentOrigins = Readonly<Record<string, AppAgentOrigin>>;

/** No origin held, as the host stands before any window shows an agent's page and after the session ends. */
export const NO_AGENT_ORIGINS: AppAgentOrigins = {};

/** The key an agent's own transcript stands under beside its workers', which stand under the call that started each. */
export const OWN_TRANSCRIPT = "own";

/**
 * What a transcript's last readable page said beside its messages: where
 * the agent, or the worker, stands, why its turn failed, what it cost, who
 * pays, what its context holds, when its run began, its titles, its
 * workers, its queue, where its launch stands, and the rewind it was read
 * at; whether that page came back short, so every message written by then
 * is held; and the agent's queue revision the page's queue is at least as
 * new as, none from a service older than the queue and before the live read
 * first stood.
 */
export type AppTranscriptWord = Omit<AgentMessagesAnswer, "messages" | "cursor"> & {
  readonly caughtUp: boolean;
  readonly queueRevision?: number;
};

/** A page that said a transcript could not be read, with what failed beneath it where it says. */
export type AppTranscriptFailure = Extract<AgentTranscriptPage, { readonly failure: unknown }>;

/**
 * One transcript as the host holds it for the windows
 * (`transcript-follow.ts`): its messages, oldest first, the newest page's
 * and every page past it joined on by id, with every older page a window
 * read laid before them; where the page older than them is read below; the
 * cursor the host reads on from; what the last readable page said; how many
 * readable pages were told; and the page that said it could not be read,
 * standing until a readable one is told or it is read again. A transcript
 * the account no longer reaches holds no messages.
 */
export interface AppTranscript {
  readonly messages: readonly AgentTranscriptMessage[];
  /** Where the page older than the oldest message held is read below; none where nothing older stands. */
  readonly before?: string;
  /** Where the host's follow reads on from: the newest page's cursor, moved past each message told since; none before a readable page, and where the service refused it. */
  readonly cursor?: string;
  /** What the last readable page said; none before one was told. */
  readonly word?: AppTranscriptWord;
  /** How many readable pages were told, which an ask counts from to know a page landed after it. */
  readonly pages: number;
  readonly failure?: AppTranscriptFailure;
}

/**
 * Each transcript the host holds for the windows: those a tab shows, and
 * the few let go lately, which stop following while no window holds them,
 * by the agent's id and then the worker's call or `OWN_TRANSCRIPT`, never
 * by a key built from both, each as its own read stands. One absent is held
 * by nobody.
 */
export type AppTranscripts = Readonly<
  Record<string, Readonly<Record<string, AppHostRead<AppTranscript>>>>
>;

/** No transcript held, as the host stands before any tab shows one and after the session ends. */
export const NO_TRANSCRIPTS: AppTranscripts = {};

/** One value for each holder of inbox items, a plan or an agent, by its kind and then its id, never by a key built from both. */
type ByInboxHolder<Value> = {
  readonly [Kind in InboxHolderKind]: Readonly<Record<string, Value>>;
};

/**
 * Every inbox item the account reaches, settled ones of the read's window
 * among them, by the plan each is on, or its agent where that has no task,
 * each holder's in the order its own read answers them. A holder it holds
 * nothing of holds nothing now.
 */
export type AppInboxItems = ByInboxHolder<readonly InboxItem[]>;

/** The kind of holder an inbox item is on: a plan, or an agent with no task. */
type InboxHolderKind = (typeof INBOX_SCOPE_KIND)[keyof typeof INBOX_SCOPE_KIND];

/** One plan's or agent's own inbox, as the host's read of it stands: its items whole, every open one and the latest settled, once it answered. */
export type AppHolderInbox = AppHostRead<readonly InboxItem[]>;

/**
 * Each plan's or agent's inbox the host holds for the windows
 * (`scope-inbox-follow.ts`): the holders a window chose, and the few let go
 * lately, by kind and then by id, each as its own read stands. A holder
 * absent is held by nobody, so a surface draws it from the account's feed.
 */
export type AppHolderInboxes = ByInboxHolder<AppHolderInbox>;

/** No holder's inbox held, as the host stands before any window chooses one and after the session ends. */
export const NO_HOLDER_INBOXES: AppHolderInboxes = {
  [INBOX_SCOPE_KIND.PLAN]: {},
  [INBOX_SCOPE_KIND.AGENT]: {},
};

/** What pages stand on: a task, or an agent with no task. */
type PageOwnerKind = (typeof PAGE_OWNER)[keyof typeof PAGE_OWNER];

/** One task's or agent's pages, as the host's read of them stands: each page by its newest version, the most recently written first, once it answered. */
export type AppHolderPages = AppHostRead<readonly PageLine[]>;

/**
 * Each task's or agent's pages the host holds for the windows
 * (`compose-tasks.ts`): those a window chose, and the few let go lately, by
 * what they stand on and then its id, each as its own read stands. One
 * absent is held by nobody.
 */
export type AppPages = {
  readonly [Kind in PageOwnerKind]: Readonly<Record<string, AppHolderPages>>;
};

/** No pages held, as the host stands before any window chooses a task or an agent and after the session ends. */
export const NO_PAGES: AppPages = { [PAGE_OWNER.TASK]: {}, [PAGE_OWNER.AGENT]: {} };

/**
 * Each task's or agent's cloud Browser tabs the host holds for the windows
 * (`compose-tasks.ts`): those a window's side panel lists, and the few let
 * go lately, by what they are listed for and then its id, each as its own
 * read stands, the oldest tab first, every takeover as it stands at the
 * host's instant. One absent is held by nobody.
 */
export type AppBrowserTabs = {
  readonly [Kind in BrowserTabsPlaceKind]: Readonly<
    Record<string, AppHostRead<readonly AgentBrowserTab[]>>
  >;
};

/** No tabs held, as the host stands before any window's side panel lists them and after the session ends. */
export const NO_BROWSER_TABS: AppBrowserTabs = {
  [BROWSER_TABS_PLACE.TASK]: {},
  [BROWSER_TABS_PLACE.AGENT]: {},
};

/** One agent's pull request's newest chapters, as the host's read of them stands: with whether the reader can generate them, once it answered. */
export type AppPullRequestChapters = AppHostRead<PullRequestChaptersAnswer>;

/**
 * Each agent's pull request's chapters the host holds for the windows
 * (`compose-agents.ts`): those a window's Pull request tab chose, and the
 * few let go lately, by the agent's id and then the pull request's number,
 * each as its own read stands. One absent is held by nobody.
 */
export type AppChapters = Readonly<
  Record<string, Readonly<Record<string, AppPullRequestChapters>>>
>;

/** No chapters held, as the host stands before any window shows a pull request's and after the session ends. */
export const NO_CHAPTERS: AppChapters = {};

/**
 * One part of each agent's pull request the windows hold for their Pull
 * request tabs (`pull-request-parts.ts`), by the agent's id and then the
 * pull request's number, or `OWN_PULL_REQUEST` for the agent's own, each as
 * the host's read of it stands: the part, or why there is none. One absent
 * is held by nobody.
 */
export type AppPullRequestPart<Part> = Readonly<
  Record<string, Readonly<Record<string, AppHostRead<Part>>>>
>;

/** The key the agent's own pull request's parts stand under, beside those of the pull requests its tabs name by number; no number's. */
export const OWN_PULL_REQUEST = "own";

/** The read each part of a Pull request tab's pull request is held as, by the part. */
export const PULL_REQUEST_PART_READ = {
  [PULL_REQUEST_PART.PULL_REQUEST]: LIVE_READ.PULL_REQUEST,
  [PULL_REQUEST_PART.CHECKS]: LIVE_READ.PULL_REQUEST_CHECKS,
  [PULL_REQUEST_PART.CONVERSATION]: LIVE_READ.PULL_REQUEST_CONVERSATION,
  [PULL_REQUEST_PART.PUBLISHED]: LIVE_READ.PULL_REQUEST_PUBLISHED,
  [PULL_REQUEST_PART.REVIEW_OPTIONS]: LIVE_READ.REVIEW_OPTIONS,
  [PULL_REQUEST_PART.VIEWED]: LIVE_READ.PULL_REQUEST_VIEWED,
} as const satisfies Record<PullRequestPart, LiveRead>;
/** One of the account's own devices' last beat, at the host's instant: its age as the service answered it, taken from the host's clock as the answer landed. */
interface AppDeviceBeat {
  deviceId: string;
  beatAt: number;
}

/**
 * The account's own devices' last beats as the host last asked for them
 * (`compose-agents.ts`): each beat at the host's instant, so a window ages
 * it on its own clock, which is the host's machine's; and the instant of
 * the latest ask, which moves with every ask, so a surface judging the beats
 * by the clock draws again as often as they are asked. Where the latest ask
 * failed after one had answered, the beats it answered stand and say so
 * (`stale`), since a window that could not ask must not say a device is away.
 */
export interface AppDevicePresence {
  beats: readonly AppDeviceBeat[];
  askedAt: number;
  stale?: true;
}

/** The account's devices' beats the windows hold, by the account, as the host's read of them stands. */
export type AppDevicePresences = Readonly<Record<string, AppHostRead<AppDevicePresence>>>;

/** The account's hosts as Settings › Hosts draws them, by name, with each removal still out drawn gone, and the install script's address its commands name. */
export interface AppHostsHeld {
  hosts: readonly HostLine[];
  installScriptUrl: string;
}

/** The account's hosts the windows hold, by the account, as the host's read of them stands. */
export type AppHosts = Readonly<Record<string, AppHostRead<AppHostsHeld>>>;

/**
 * Each workspace's pending invitations the host holds for an owner's or an
 * admin's windows (`workspace-invitations-read.ts`): those a window draws,
 * and the few drawn lately, by the workspace's id, each as its own read
 * stands, those not yet expired, soonest to expire first, once it answered.
 * One absent is held by nobody.
 */
export type AppWorkspaceInvitations = Readonly<
  Record<string, AppHostRead<readonly WorkspaceInvitation[]>>
>;

/**
 * This Mac as its host reads it (`compose-this-mac-host.ts`): the machine's
 * id in the keyed hash every host reports (`@repo/host/node`'s
 * `machine-identity.ts`), where it could be read, and the device of the
 * record of the account install on this Mac, where that install was
 * enrolled with this app's service.
 */
export interface AppThisMacHost {
  deviceId?: string;
  machineId?: string;
}

/** This Mac as the host last read it, by the account signed in: the one key the host holds, none while nobody is signed in. */
export type AppThisMacHosts = Readonly<Record<string, AppHostRead<AppThisMacHost>>>;

/** One workspace's people, as the host's read of them stands: its members and who its work names but left, once it answered. */
export type AppWorkspaceMembersRead = AppHostRead<WorkspaceMembersAnswer>;

/**
 * Each workspace's people the host holds for the windows
 * (`workspace-members-read.ts`): those a window draws, and the few drawn
 * lately, by the workspace's id, each as its own read stands. One absent is
 * held by nobody.
 */
export type AppWorkspaceMembers = Readonly<Record<string, AppWorkspaceMembersRead>>;

/**
 * Each workspace's own integrations the host holds for the windows
 * (`workspace-integrations-follow.ts`): its Sentry installations and its
 * Slack bot, those a window draws and the few drawn lately, by the
 * workspace's id, each as its read stands with every write drawn over it
 * until the read carries it.
 */
export type AppWorkspaceIntegrations = AppHeldById<WorkspaceIntegrations>;

/** The channels of each workspace's Slack team the host holds for an owner's or an admin's windows, by the workspace's id, as Slack last listed them. */
export type AppSlackChannels = AppHeldById<readonly SlackListedChannel[]>;

/** One workspace's photo as the host last fetched it: the version the workspaces named it by, and its bytes as a `data:` URL. */
export interface AppWorkspacePhoto {
  version: string;
  url: string;
}

/** Each listed workspace's photo the host holds, by the workspace; one with none, or not yet fetched, absent. */
export type AppWorkspacePhotos = Readonly<Record<string, AppHostRead<AppWorkspacePhoto>>>;

/** Each agent's own tools the windows hold, by the agent, as the host's read of them stands. */
export type AppWorkspaceTools = Readonly<Record<string, AppHostRead<WorkspaceToolsAnswer>>>;

/**
 * Where every one of the account's integrations stands, by the account, as
 * the host's read of them stands (`compose-integrations.ts`): its rows as
 * the service last answered them, with GitHub's standing beside them.
 */
export type AppIntegrations = Readonly<Record<string, AppHostRead<IntegrationStatusesAnswer>>>;

/** The outside MCP clients the account allowed, by the account, as the host's read of them stands. */
export type AppMcpClients = Readonly<Record<string, AppHostRead<McpClientsAnswer>>>;
/** Each integration server's tools the windows hold, by the server's name, as the host's read of them stands: its tools, or why it listed none. */
export type AppIntegrationTools = Readonly<Record<string, AppHostRead<IntegrationToolsAnswer>>>;

/**
 * The account's own provider keys and plans as the service last answered
 * them, a read's or a write's: each provider, its status, its times, and its
 * hint, a label of the key's prefix and its last four characters. Never a
 * key, which the service never answers, and never a write's own outcome.
 */
export type AppProviderKeyList = Pick<ProviderKeysAnswer, "keys" | "subscriptions">;

/** The account's provider keys the windows hold, by the account, as the host's read of them stands. */
export type AppProviderKeys = Readonly<Record<string, AppHostRead<AppProviderKeyList>>>;

/** The models a coding agent may run on as the account is offered them, and its devices, by the account, as the host's read of them stands. */
export type AppModels = Readonly<Record<string, AppHostRead<ModelsAnswer>>>;

/** The account's preferences row, by the account, as the host's read of it stands with every write drawn over it. */
export type AppAccountPreferences = Readonly<Record<string, AppHostRead<AccountPreferencesLive>>>;

/** What GitHub holds of the page a link names, as the host last read it: its pull request or its issue, null where GitHub holds no such page. */
export type AppLinkStanding = GitHubRepositoryPullRequestAnswer | GitHubRepositoryIssueAnswer;

/** Each link's standing the windows hold, by the workspace it is read through and then the link's own address, as the host's read of it stands. */
export type AppLinkStandings = Readonly<
  Record<string, Readonly<Record<string, AppHostRead<AppLinkStanding>>>>
>;

/** Each workspace's repositories the windows hold, by the workspace, as the host's read of them stands. */
export type AppRepositoryLists = Readonly<Record<string, AppHostRead<GitHubRepositoriesAnswer>>>;

/** The key the repositories the account reaches in every workspace stand under, where a list names none; no workspace's id, which is a UUID. */
export const EVERY_WORKSPACE = "every-workspace";

/**
 * The account's own GitHub token as the service last answered it, a read's
 * or a save's or a removal's: its login, its hint, a label of the token's
 * first and last characters, its status, and its times; none where no token
 * is kept. Never the token, which the service never answers, and never a
 * write's own outcome.
 */
export interface AppGitHubToken {
  token: GitHubTokenSummary | null;
}

/** The account's GitHub token the windows hold, by the account, as the host's read of it stands. */
export type AppGitHubTokens = Readonly<Record<string, AppHostRead<AppGitHubToken>>>;

/** Each workspace's token repositories the windows hold, by the workspace, as the host's read of them stands. */
export type AppTokenRepositories = Readonly<
  Record<string, AppHostRead<readonly WorkspaceTokenRepository[]>>
>;

/** No key held of a read keyed by one id, as the host stands before any window holds one and after the session ends. */
export const NO_KEYS_HELD: Readonly<Record<string, never>> = {};

/**
 * One read the host holds for the windows by one id, as each held as its
 * own read stands: those a window chose, and the few let go lately. One
 * absent is held by nobody.
 */
export type AppHeldById<Rows> = Readonly<Record<string, AppHostRead<Rows>>>;

/** Each workspace's memories the windows hold, by the workspace, most recently kept or corrected first, as the host's read of them stands, with every forget drawn over them until the read carries it (`memory-follow.ts`). */
export type AppMemories = AppHeldById<readonly MemorySummary[]>;

/** The skills the account sees in each workspace the windows hold, by the workspace, the workspace's first and then its own, as the host's read of them stands, with every write drawn over them until the read carries it (`installed-skills-follow.ts`). */
export type AppInstalledSkills = AppHeldById<readonly InstalledSkillSummary[]>;

/**
 * Each task's plan the host holds for the windows (`compose-tasks.ts`): the
 * tasks a window opened, and the few it opened lately, by the task's id,
 * each as its read and the writes since stand.
 */
export type AppPlanDocuments = AppHeldById<HeldPlanDocument>;

/**
 * Each task's plan history the host holds for the windows
 * (`compose-tasks.ts`): the tasks whose version history a window showed, and
 * the few it showed lately, by the task's id, each its newest page as its
 * read stands and the older pages read past it laid after it.
 */
export type AppHistories = AppHeldById<PlanRevisionsAnswer>;

/** The automations' held reads, by their names: each workspace's automations, each workspace's runs, and each automation's runs (`compose-automations.ts`). */
export type AppAutomationReads = Pick<
  AppState,
  | typeof LIVE_READ.AUTOMATIONS
  | typeof LIVE_READ.AUTOMATION_WORKSPACE_RUNS
  | typeof LIVE_READ.AUTOMATION_RUNS
>;

/** Every part of the Pull request tabs' pull requests the windows hold, by the part's read. */
export type AppPullRequestParts = Pick<
  AppState,
  (typeof PULL_REQUEST_PART_READ)[keyof typeof PULL_REQUEST_PART_READ]
>;

/** What a task's comment threads stand on: its plan, or one of its pages. */
type CommentSubjectKind = (typeof COMMENT_SUBJECT)[keyof typeof COMMENT_SUBJECT];

/** One subject's comment threads, as the host's read of them stands: every thread, the oldest started first, resolved ones among them, once it answered, with the windows' writes laid over them until the read holds them. */
type AppSubjectComments = AppHostRead<readonly PlanCommentThread[]>;

/**
 * Each task's comments the host holds for the windows
 * (`plan-comment-reads.ts`): a plan's own threads by its task's id, and a
 * page's by the page's id, never its version, those a window chose and the
 * few let go lately, each as its own read stands. One absent is held by
 * nobody.
 */
export type AppPlanComments = {
  readonly [Kind in CommentSubjectKind]: Readonly<Record<string, AppSubjectComments>>;
};

/** No comments held, as the host stands before any window shows a plan or a page and after the session ends. */
export const NO_PLAN_COMMENTS: AppPlanComments = {
  [COMMENT_SUBJECT.PLAN]: {},
  [COMMENT_SUBJECT.PAGE]: {},
};

/** The rows of each read the host holds for the panel, by its name: a keyed read's are one key's rows. */
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
  [LIVE_READ.PLAN_COMMENTS]: readonly PlanCommentThread[];
  [LIVE_READ.HISTORY]: PlanRevisionsAnswer;
  [LIVE_READ.PLAN_DOCUMENT]: HeldPlanDocument;
}

/**
 * The commands agents asked to run on this Mac that wait on the developer's
 * answer, the earliest first, as the host holds them while Settings › This
 * Mac asks every time (`compose-mac-commands.ts`): what the panel's prompt
 * draws. Main's, because the host holds the command whichever window is
 * open, and empty wherever this platform runs no commands.
 */
interface AppMacCommandsSlice {
  asks: readonly MacCommandAsk[];
}

/**
 * What macOS answered the last notification the app posted, which is the only
 * word Electron gives of notifications being off for the app in System Settings:
 * unknown until one is shown or refused, and kept for the launch alone.
 */
interface AppNotificationsSlice {
  status: NotificationsStatus;
}

/**
 * Whether this machine has a network, as its platform last answered
 * (`client/network-watch.ts`): online until a probe says otherwise. An
 * answer of offline is a reliable one; online says nothing of whether the
 * service itself answers.
 */
interface AppNetworkSlice {
  online: boolean;
  /** How many changes made offline the service refused as they were sent again, until a window clears the count; none where none was. */
  offlineRefused?: number;
}

/**
 * What the signed-in account may open in the app, as the host last read it
 * from the service for that account (`account-access-client.ts`): whether
 * it is an admin, which the sidebar offers the admin dashboard by, and
 * whether a Start on a task with no repository runs. Not while nobody is
 * signed in, for another account than the one read, or where the read
 * failed. A window draws by it and authorizes nothing: the dashboard's own
 * gate on the service decides every admin read, and the Start route every
 * Start.
 */
export interface AppAccessSlice {
  admin: boolean;
  /**
   * True where a Start on a task that names no repository runs where the
   * task's agents run on a host, as the service answers it in the local demo
   * alone; absent everywhere else.
   */
  startsWithoutRepository?: true;
  /**
   * Whether the access is not read yet for whoever is signed in, as it is
   * for a moment after a sign-in or a launch: a window holds back on what it
   * would refuse a reader who is no admin, such as a reloaded Admin address,
   * until it is. Absent once read, a failed read among them.
   */
  pending?: true;
}

/**
 * Everything main keeps of what the host tells it and what this machine
 * answers for itself: one document, read whole and replaced a slice at a
 * time, so the state a window is handed and the state main answers a call
 * from cannot differ.
 *
 * Per-window facts — the mode, the display, the role — are deliberately not
 * here: they belong to the window they describe, the panels own them, and
 * they ride the snapshot a window is handed rather than the document.
 */
export interface AppState {
  /** 0 before any patch; +1 per applied patch, monotone and never reset. */
  readonly version: number;
  run: AppRunFacts;
  settings?: AppSettings;
  account: AccountSnapshot;
  access: AppAccessSlice;
  update: UpdateSnapshot;
  audio: AppAudioSlice;
  /**
   * The Tasks tab's named tasks as the host's reads of the service
   * hold them: the list and the one active task, whose plan is held apart
   * (`LIVE_READ.PLAN_DOCUMENT`). Only the panel's Tasks tab draws it.
   */
  tasks: TasksView;
  agents: AppAgentsSlice;
  inbox: AppInboxSlice;
  /** Each agent's origin the windows chose, held while an agent's page holds it and a while after: the run its page says started it. */
  [LIVE_READ.AGENT_ORIGINS]: AppAgentOrigins;
  /** The account's preferences row, by the account, held for the signed-in session: the default agent, the chapters model, and Slack notifications every surface draws. */
  [LIVE_READ.ACCOUNT_PREFERENCES]: AppAccountPreferences;
  /** Every inbox item the account reaches, held for the signed-in session: what the window's Inbox, its search, and a person's page list. */
  [LIVE_READ.INBOX_ITEMS]: AppHostRead<AppInboxItems>;
  /** Each plan's or agent's inbox the windows chose, held while a window holds it and a while after: what a chosen item's pane, a task's Inbox tab, and an agent's page read past the feed. */
  [LIVE_READ.HOLDER_INBOX]: AppHolderInboxes;
  /** The skills the account sees in each workspace the windows chose, by the workspace, held while Settings › Skills shows them and a while after: what that page draws. */
  [LIVE_READ.INSTALLED_SKILLS]: AppInstalledSkills;
  /** Where every one of the account's integrations stands, held while a window draws one and a while after: what Settings › Integrations, onboarding's tools step, the composer's servers, and every server's card read. */
  [LIVE_READ.INTEGRATIONS]: AppIntegrations;
  /** Each integration server's tools the windows chose, held while a surface listing it shows and a while after: what an integration's health is read from. */
  [LIVE_READ.INTEGRATION_TOOLS]: AppIntegrationTools;
  /** Each link's standing the windows' chips chose, held while a chip draws it and a while after. */
  [LIVE_READ.LINK_STANDINGS]: AppLinkStandings;
  /** Each workspace's memories the windows chose, by the workspace, held while Settings › Memory shows them and a while after: what that page draws. */
  [LIVE_READ.MEMORIES]: AppMemories;
  /** The models the account is offered and its devices, by the account, held while a window draws a model or a device and a while after: what every model menu, Settings › Agents, setup, and New task's Runs on read. */
  [LIVE_READ.MODELS]: AppModels;
  /** Each task's or agent's pages the windows chose, held while a window holds them and a while after: what the panel beside an Inbox item, and beside an agent's page, lists. */
  [LIVE_READ.PAGES]: AppPages;
  /** The account's own provider keys, held while a window draws them: what Settings › Agents and Call and Dictate read. */
  [LIVE_READ.PROVIDER_KEYS]: AppProviderKeys;
  /** Each workspace's repositories the windows chose, held while a repository chip or picker stands and a while after. */
  [LIVE_READ.REPOSITORY_LISTS]: AppRepositoryLists;
  /** The account's own GitHub token, held while a window draws it and a while after: what Settings › Account, a workspace's Add repository, and onboarding's GitHub step read. Never written to disk. */
  [LIVE_READ.GITHUB_TOKEN]: AppGitHubTokens;
  /** Each agent's pull request's chapters the windows chose, held while a Pull request tab holds them and a while after: what its Chapters tab draws. */
  [LIVE_READ.PULL_REQUEST_CHAPTERS]: AppChapters;
  /** Each task's or agent's cloud Browser tabs the windows' side panels list, held while one lists them and a while after: what the side panel's Browser tabs draw. Never written to disk. */
  [LIVE_READ.BROWSER_TABS]: AppBrowserTabs;
  /** Each agent's pull request the windows' Pull request tabs chose, held while a tab shows it and a while after: its description, branches, mergeability, and people. */
  [LIVE_READ.PULL_REQUEST]: AppPullRequestPart<AgentOverviewPullRequestAnswerView>;
  /** The checks on each of those pull requests' heads, held as they are. */
  [LIVE_READ.PULL_REQUEST_CHECKS]: AppPullRequestPart<AgentOverviewChecksAnswerView>;
  /** Each of those pull requests' conversation and where its reviewers stand, held as they are. */
  [LIVE_READ.PULL_REQUEST_CONVERSATION]: AppPullRequestPart<AgentOverviewConversationAnswerView>;
  /** What each of those agents published, its pull request as the service last read it from GitHub, held as they are. */
  [LIVE_READ.PULL_REQUEST_PUBLISHED]: AppPullRequestPart<AgentPullRequestAnswerView>;
  /** Which of each of those pull requests' files the member marked viewed, held as they are, read on the member's own GitHub sign-in. */
  [LIVE_READ.PULL_REQUEST_VIEWED]: AppPullRequestPart<AgentPullRequestViewedAnswerView>;
  /** What each of those tabs' reviewer and label pickers offer, held as they are once a picker asks. */
  [LIVE_READ.REVIEW_OPTIONS]: AppPullRequestPart<AgentReviewOptionsAnswerView>;
  /** The account's own devices' beats, held while a window draws a device's standing and a while after: what Settings › Hosts, an agent's place, and Runs on judge a device by. */
  [LIVE_READ.DEVICE_PRESENCE]: AppDevicePresences;
  /** The account's hosts, held while Settings › Hosts draws them and a while after: what that page lists. */
  [LIVE_READ.HOSTS]: AppHosts;
  /** Each workspace's pending invitations an owner's or an admin's windows draw, held while a window draws them and a while after: what Settings › Workspace lists under Invitations. */
  [LIVE_READ.WORKSPACE_INVITATIONS]: AppWorkspaceInvitations;
  /** Which machine This Mac is and the device its host's record names, held for the signed-in session and told as it moves: what Settings › Hosts and Runs on name This Mac by. */
  [LIVE_READ.THIS_MAC_HOST]: AppThisMacHosts;
  /** Each agent's or worker's transcript the windows' tabs show, held while a tab shows it and a while after, followed only while one does: what an agent's tab and a worker's draw. Never written to disk. */
  [LIVE_READ.TRANSCRIPT]: AppTranscripts;
  /** Each workspace's people the windows draw, held while a window draws them and a while after: what every surface naming a workspace's members or who left reads. */
  [LIVE_READ.WORKSPACE_MEMBERS]: AppWorkspaceMembers;
  /** Each workspace's own integrations the windows draw, held while Settings › Workspace or an automation's editor draws them and a while after: what its Sentry and Slack bot rows read. */
  [LIVE_READ.WORKSPACE_INTEGRATIONS]: AppWorkspaceIntegrations;
  /** Each workspace's Slack channels an owner's or an admin's window draws, held while Settings › Workspace lists them and a while after: what its Slack channel rows read. */
  [LIVE_READ.SLACK_CHANNELS]: AppSlackChannels;
  /** Each workspace's token repositories the windows draw, held while a window draws them and a while after: what Settings › Workspace and onboarding's GitHub step list. */
  [LIVE_READ.TOKEN_REPOSITORIES]: AppTokenRepositories;
  /** Each listed workspace's photo, held for the signed-in session and fetched again as its version moves: what every workspace's tile draws. */
  [LIVE_READ.WORKSPACE_PHOTOS]: AppWorkspacePhotos;
  /** Each agent's own tools the windows chose, held while its servers popover shows and a while after. */
  [LIVE_READ.WORKSPACE_TOOLS]: AppWorkspaceTools;
  /** The outside MCP clients the account allowed, held while Settings › Integrations shows them and a while after. */
  [LIVE_READ.MCP_CLIENTS]: AppMcpClients;
  /** Each workspace's automations the windows chose, by the workspace, newest made first, held while a window holds them and a while after: what the Automations pages, a person's page, ⌘K, and an agent's card read. */
  [LIVE_READ.AUTOMATIONS]: AppHeldById<readonly AutomationSummary[]>;
  /** Each workspace's runs the windows chose, by the workspace, newest fired first, held as the automations are: what the Runs tab and the sidebar's Automations row read. */
  [LIVE_READ.AUTOMATION_WORKSPACE_RUNS]: AppHeldById<readonly AutomationWorkspaceRun[]>;
  /** Each automation's runs the windows chose, by the automation, newest fired first, held as the automations are: what its editor and an agent its run started read. */
  [LIVE_READ.AUTOMATION_RUNS]: AppHeldById<readonly AutomationRunSummary[]>;
  /** Each plan's or page's comment threads the windows show, held while a window holds them and a while after: what a plan's margin, its Comments tab, its summary, and a page's tab draw. */
  [LIVE_READ.PLAN_COMMENTS]: AppPlanComments;
  /** Each task's plan history the windows showed, held while a version history shows it and a while after: what the version history lists. */
  [LIVE_READ.HISTORY]: AppHistories;
  /** Each task's plan the windows opened, held while a window has it open and a while after: what the task's page, a section's chip, and a mention's saved text draw. */
  [LIVE_READ.PLAN_DOCUMENT]: AppPlanDocuments;
  macCommands: AppMacCommandsSlice;
  notifications: AppNotificationsSlice;
  network: AppNetworkSlice;
  sessionReplay: AppSessionReplaySlice;
}

/**
 * What one window answers for and the document cannot: whether it stands in
 * full screen, where macOS hides its traffic lights and the title bar's
 * buttons take their place. Decided in the main process by which window
 * asked, never by anything a renderer could claim about itself. Which
 * surface a window draws is not here: each role has an entry of its own
 * (`window-root.tsx`), so no reader of the document needs telling.
 */
export interface AppWindowFacts {
  fullScreen: boolean;
  /**
   * Whether a development build's label, the branch it was cut from, is
   * hidden for now, as View > Developer > Show Build Label leaves it for a
   * demo; absent while it is drawn, and in every build that draws none.
   */
  buildLabelHidden?: boolean;
}

/**
 * The document as one window is handed it: every slice, and that window's own
 * facts beside them. Its first read is this window's bootstrap, and every
 * delivery after it (`AppStateDelivery`) carries what moved under a version
 * at least as high, so there is no "which arrived first" for a reader to
 * answer.
 */
export type AppStateSnapshot = AppState & { window: AppWindowFacts };

/**
 * The boundary declaration of a snapshot: what the wire cannot lie about
 * cheaply and every reader depends on. The version that orders deliveries,
 * the window facts, and the capabilities that decide which platform controls
 * stand, each one this build knows, since a bridge other than the desktop's
 * may hand them. The other slices are read by the guards of the vocabularies
 * they came from, where a reader actually uses them, so the read tolerates
 * the slices this declaration does not name rather than refusing them. The
 * read only answers yes or no: the delivered value is passed on untouched,
 * never the decoded one, which would carry only what is declared here.
 */
const appStateSnapshotSchema = Schema.Struct({
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  run: Schema.Struct({
    capabilities: Schema.Array(Schema.Literals(Object.values(HOST_CAPABILITY))),
  }),
  window: Schema.Struct({ fullScreen: Schema.Boolean }),
});

const readAppStateSnapshot = readEither(appStateSnapshotSchema, { excess: EXCESS_KEYS.DROP });

/** The boundary parse for a snapshot, as the window's bridge holds every delivery to it. */
export function isAppStateSnapshot(value: UnparsedWireValue): boolean {
  return Result.isSuccess(readAppStateSnapshot(value));
}

/** What a delivery replaces whole: every slice and the window's facts. */
type AppStateEntry = Exclude<keyof AppStateSnapshot, "version">;

/**
 * How a slice of the document is keyed: a held read's by one id, or by a
 * kind and then an id; or by part, as the task list's view is, each part
 * crossing whole, or as the rows that moved where it is a list of rows.
 */
export const READ_KEYS = {
  ONE: "one",
  TWO: "two",
  PARTS: "parts",
} as const;

/** Where a slice's keys stand: in the slice itself, or in the rows its read answered, as the account's feed holds its holders. */
export const KEYS_ON = {
  SLICE: "slice",
  ROWS: "rows",
} as const;

/** One list of rows in the task list's view, by its name in `TasksView`. */
type TasksRows<Part extends keyof TasksView> = NonNullable<TasksView[Part]>;

/** How one slice is laid out, which is all its delivery reads of it. */
interface HostReadSliceEntry {
  readonly keys: (typeof READ_KEYS)[keyof typeof READ_KEYS];
  readonly on: (typeof KEYS_ON)[keyof typeof KEYS_ON];
  /**
   * The field each of a key's rows is told apart by, where a key crosses as
   * the rows that moved in it: the key's value itself on a slice keyed on
   * its rows, and the rows of the key's read otherwise. Absent where a key
   * crosses whole.
   */
  readonly rowId?: string;
  /** For a slice keyed by part, the field each part that is a list of rows tells its rows apart by, by the part's name; a part it does not name crosses whole. */
  readonly rowIds?: { readonly [part: string]: string };
  /**
   * The field a key's list of rows stands under, where its read's rows are
   * a record rather than the list itself: the list crosses as its rows that
   * moved, and the record's other fields cross whole beside them wherever
   * the key moved. Absent where a key's rows are its list.
   */
  readonly rowsAt?: string;
}

/**
 * Each keyed slice, by its name in the document, as its delivery crosses it:
 * the keys that moved in it rather than the slice whole, and a row-keyed
 * key's rows that moved rather than the key whole. The held reads stand
 * here, and the task list's view, keyed by part, whose lists of tasks,
 * agents, and pull requests cross as their rows, since every agent's turn
 * and every plan saved moves a row of them, and the open plan's document
 * crosses only where it moved.
 */
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
  [LIVE_READ.PLAN_COMMENTS]: {
    keys: READ_KEYS.TWO,
    on: KEYS_ON.SLICE,
    rowId: "id" satisfies keyof PlanCommentThread,
  },
  // Note that a history crosses whole, since each save lands a newest page that replaces its head.
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
  // Note that a transcript crosses as the messages that moved, since each step of a turn rewrites one message, its journal, while the rest stand.
  [LIVE_READ.TRANSCRIPT]: {
    keys: READ_KEYS.TWO,
    on: KEYS_ON.SLICE,
    rowId: "id" satisfies keyof AgentTranscriptMessage,
    rowsAt: "messages" satisfies keyof AppTranscript,
  },
  [LIVE_READ.WORKSPACE_MEMBERS]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
  // Note that a workspace's integrations cross whole, since a write moves one of a few rows.
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
  // Note that a plan crosses whole, since each save replaces it.
  [LIVE_READ.PLAN_DOCUMENT]: { keys: READ_KEYS.ONE, on: KEYS_ON.SLICE },
} as const satisfies { readonly [Slice in keyof AppState]?: HostReadSliceEntry };

/** A slice `HOST_READ_SLICE` declares. */
export type HostReadSlice = keyof typeof HOST_READ_SLICE;

/** Where one key of a held read stands in its slice: its id, or its kind and then its id, as `HOST_READ_SLICE` declares. */
export type HostReadKeyPath<Slice extends HostReadSlice> =
  (typeof HOST_READ_SLICE)[Slice]["keys"] extends typeof READ_KEYS.TWO
    ? readonly [kind: string, id: string]
    : readonly [id: string];

// SAFETY: `Object.keys` of the table names its own entries.
const HOST_READ_SLICES = Object.keys(HOST_READ_SLICE) as HostReadSlice[];

/**
 * One key of a slice that moved, by its path (its id or part, or its kind
 * and then its id): its value whole, or null where it is gone, since no
 * slice here holds a key whose value is null; or, where the key is a list of
 * rows told apart by an id and held rows when last sent and still does,
 * each row that is not the very one sent, with the key's ids in order where
 * its membership or order moved.
 */
type KeyMoved =
  | { readonly key: readonly string[]; readonly value: unknown }
  | {
      readonly key: readonly string[];
      readonly rows: readonly object[];
      readonly ids?: readonly string[];
      /** Where the key's rows are a record (`rowsAt`), its fields beside the list, whole. */
      readonly beside?: Keyed;
    };

/**
 * One push of the document to a window: what moved in it since the last that
 * window was handed, under the version it moved to. Each entry in `entries`
 * is replaced whole, each in `gone` is no longer held, and every entry named
 * in neither is the one the window holds. An entry that went is named in a
 * list of its own rather than as undefined, because the push is JSON and
 * JSON keeps no key whose value is undefined. A window's first delivery
 * names every entry it draws.
 */
export interface AppStateDelivery {
  readonly version: number;
  readonly entries: { readonly [Entry in AppStateEntry]?: AppStateSnapshot[Entry] };
  readonly gone?: readonly AppStateEntry[];
  /** Each keyed slice's keys that moved since the window's last delivery, in place of its entry, where the window held the slice and still does (`HOST_READ_SLICE`). */
  readonly moved?: { readonly [Slice in HostReadSlice]?: readonly KeyMoved[] };
}

/** One level of a slice's keys: each id's or part's value, or, above the last level, each kind's record of ids. */
type Keyed = Readonly<Record<string, unknown>>;

/** The value `keyed` holds under `id` itself, never one it inherits. */
function ownValue(keyed: Keyed, id: string): unknown {
  return Object.hasOwn(keyed, id) ? keyed[id] : undefined;
}

/** The record a slice's keys stand in, as `slice` holds it; none where a slice keyed on its rows holds no rows. */
function keyedOf(entry: HostReadSliceEntry, slice: object | undefined): Keyed | undefined {
  // SAFETY: a slice the table declares is a record of its keys, or a read whose rows are, as its `on` says.
  return entry.on === KEYS_ON.SLICE
    ? (slice as Keyed | undefined)
    : (slice as AppHostRead<Keyed> | undefined)?.rows;
}

/** The field the rows of the key at `key` are told apart by; none where the key crosses whole. */
function rowIdOf(entry: HostReadSliceEntry, key: readonly string[]): string | undefined {
  if (entry.keys !== READ_KEYS.PARTS) return entry.rowId;
  const [part] = key;
  return part === undefined || entry.rowIds === undefined || !Object.hasOwn(entry.rowIds, part)
    ? undefined
    : entry.rowIds[part];
}

/** Whether a key's value is its list of rows itself, as a holder of the feed's and a part of the task list's are, rather than a read whose rows it holds. */
function rowsAreValue(entry: HostReadSliceEntry): boolean {
  return entry.on === KEYS_ON.ROWS || entry.keys === READ_KEYS.PARTS;
}

/** The record a key's read's rows are, where its slice names the field its list stands under (`rowsAt`); none otherwise. */
function recordOf(entry: HostReadSliceEntry, value: unknown): Keyed | undefined {
  if (entry.rowsAt === undefined || typeof value !== "object" || value === null) return undefined;
  const rows: unknown = Reflect.get(value, "rows");
  // SAFETY: a read whose slice names `rowsAt` holds its rows as a record of fields.
  return typeof rows === "object" && rows !== null ? (rows as Keyed) : undefined;
}

/**
 * The rows a key's value holds: the value itself, or its read's rows (see
 * `rowsAreValue`), or the list its read's rows hold under `rowsAt`; none
 * where it holds none. Note that a read holding rows says nothing else
 * (`AppHostRead`), so its rows are all of it that can move.
 */
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

/** A key's read's record of rows without its list, where its slice names `rowsAt`; none otherwise. */
function besideOf(entry: HostReadSliceEntry, value: unknown): Keyed | undefined {
  const record = recordOf(entry, value);
  if (record === undefined) return undefined;
  return Object.fromEntries(Object.entries(record).filter(([field]) => field !== entry.rowsAt));
}

/** A row's id, under the field its slice names. */
function idOf(rowId: string, row: object): string {
  // SAFETY: a row-keyed slice's rows each carry their id as a string under `rowId` (`HOST_READ_SLICE`).
  return Reflect.get(row, rowId) as string;
}

/**
 * How `key` crosses from `sent` to `next`: as its rows that are not the very
 * ones sent where both hold rows of unique ids, with every id in order where
 * any came, went, or moved past another; and whole otherwise. Note that the
 * ids cross wherever membership differs from what was sent, so a window
 * that missed a delivery is never left holding a row that went.
 */
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
  // Note that a list whose ids repeat cannot be laid by them, so it crosses whole.
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

/** Each id under `path` that moved from `before` to `after`, and each gone as null. */
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

/**
 * Each key of a slice that moved from `before` to `after`. Note that a key
 * is compared by reference alone, because the document keeps the identity
 * of every key and row a patch did not move (`client/app-state-store.ts`),
 * so one that is not the very value sent is one that moved, and a kind no
 * key of moved is passed at its first comparison.
 */
function keysMoved(entry: HostReadSliceEntry, before: Keyed, after: Keyed): KeyMoved[] {
  if (entry.keys !== READ_KEYS.TWO) return idsMoved(entry, [], before, after);
  const kinds = new Set([...Object.keys(before), ...Object.keys(after)]);
  // SAFETY: each kind of a slice keyed by two holds a record of its ids.
  const ofKind = (keyed: Keyed, kind: string) => (ownValue(keyed, kind) ?? {}) as Keyed;
  return [...kinds].flatMap((kind) =>
    idsMoved(entry, [kind], ofKind(before, kind), ofKind(after, kind)),
  );
}

/** The value `held` stood at once `move` lands on it: laid in, keeping what of it did not move, or none where it is gone. */
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

/**
 * The read `held` stood at with its record of rows laid anew: `list` under
 * `rowsAt`, and the fields beside it as `beside` says, each the very one
 * held where it says nothing new, or as held where it says nothing; the
 * very read held where nothing moved.
 */
function recordLaid(
  rowsAt: string,
  held: unknown,
  list: readonly object[],
  beside: Keyed | undefined,
): unknown {
  // SAFETY: a read is a record of its fields, its rows among them, as `recordOf` reads it.
  const read = (typeof held === "object" && held !== null ? held : {}) as Keyed;
  const was = read.rows;
  // SAFETY: a read whose slice names `rowsAt` holds its rows as a record of fields.
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

/** One level of keys once `moves` land on it, by each move's last segment, and every id they do not name the very value held. */
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

/** Each kind's keys once `moves` land on them, every kind they do not name the very record held. */
function withKindsMoved(
  entry: HostReadSliceEntry,
  held: Keyed | undefined,
  moves: readonly KeyMoved[],
): Keyed {
  const next: Record<string, unknown> = { ...held };
  for (const kind of new Set(moves.map((move) => move.key[0] ?? ""))) {
    // SAFETY: each kind of a slice keyed by two holds a record of its ids.
    const ofKind = (held === undefined ? undefined : ownValue(held, kind)) as Keyed | undefined;
    next[kind] = withIdsMoved(
      entry,
      ofKind,
      moves.filter((move) => move.key[0] === kind),
    );
  }
  return next;
}

/** A slice once `moves` land on it, every key and kind they do not name the very one held. */
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

/**
 * The delivery that brings a window holding `sent` to `next`, or none where
 * nothing it is handed moved. Note that the document keeps the identity of
 * every part a patch did not move, so an untouched entry is answered at its
 * first comparison and only an entry that moved is walked.
 */
export function appStateDelivery(
  sent: AppStateSnapshot | undefined,
  next: AppStateSnapshot,
): AppStateDelivery | undefined {
  // SAFETY: `Object.keys` of a snapshot names its own entries and its version, the last dropped here.
  const names = [...new Set([...Object.keys(sent ?? {}), ...Object.keys(next)])].filter(
    (name) => name !== "version",
  ) as AppStateEntry[];
  // Note that a keyed slice crosses as the keys that moved in it wherever the window held it and still does, so it is never walked whole as well.
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

/**
 * The document a window holds once a delivery lands on it: each entry named
 * replaced, keeping the identity of every part of it that did not move, so a
 * memo keyed on a part the delivery left alone still holds; each keyed
 * slice's keys that moved laid in the same way; each entry gone held no more; and
 * every other entry the very object held.
 */
export function withAppStateDelivery(
  held: AppStateSnapshot,
  delivery: AppStateDelivery,
): AppStateSnapshot {
  const entries = Object.fromEntries(
    Object.entries(delivery.entries).map(([name, value]) => [
      name,
      // SAFETY: a delivery's entries are keyed by the snapshot's own entry names.
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
  // Note that an entry gone is held as no key at all, as the document holds it.
  for (const name of delivery.gone ?? []) Reflect.deleteProperty(next, name);
  return next;
}

/**
 * The boundary declaration of a delivery, held to the same terms as a
 * snapshot's: the version, and the window facts and capabilities where it
 * carries them, each one this build knows.
 */
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

/** The boundary parse for a delivery, as the window's push stream holds every one to it. */
export function isAppStateDelivery(value: UnparsedWireValue): boolean {
  return Result.isSuccess(readAppStateDelivery(value));
}

/**
 * What this run may record, as the renderer is handed it. Note that an
 * unpackaged run never records, whatever its bundle was built with, because
 * `pnpm start` builds the renderer in whatever shell it is run from, and one
 * left holding the release's replay key would otherwise record a development
 * run into production's project.
 */
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

/** The access of nobody, of another account, or of a read that failed: nothing opened. */
export const NO_ACCESS: AppAccessSlice = { admin: false, pending: true };
