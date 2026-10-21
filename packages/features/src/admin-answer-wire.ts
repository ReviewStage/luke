/**
 * admin-answer-wire.ts -- what each admin read answers, as the service builds it and every page that draws it reads it.
 *
 * The service shapes these from its own rows (`@luke/service/admin/*`, each
 * read's builder beside its queries) and the dashboard draws them, the web's
 * `/admin` page and the app's Admin place alike. They are declared here,
 * below both, so a page reaches the shapes without a line of query code, and
 * the hosted contract (`contract/admin.ts`) and the host's acts can name them.
 * Only types live here: every value an answer is keyed by is its vocabulary
 * module's (`admin-wire.ts`, `admin-overview-vocabulary.ts`,
 * `admin-account-wire.ts`, `admin-cost-wire.ts`).
 */

import type {
  ADMIN_FAILURE_KIND,
  AdminPullRequest,
  AdminWorkspaceKind,
} from "./admin-account-wire.js";
import type { ActivityFeature, FunnelStep, ReachFeature } from "./admin-overview-vocabulary.js";
import type { ADMIN_ATTENTION_KIND, AdminWorkspacesKind } from "./admin-wire.js";
import type { AutomationRunReason } from "./automation-wire.js";
import type { CodingAgentFailure, CodingAgentStatus, ContextWindow } from "./coding-agent-wire.js";
import type { GitHubInstallationStatus } from "./github-installation-wire.js";
import type { INTEGRATION_ROW_STATUS, IntegrationRowStatus } from "./integration-row-wire.js";
import type { IntegrationProvider } from "./integration-wire.js";
import type { FastAccess, ProviderKeyProvider, ProviderKeyStatus } from "./provider-key-wire.js";
import type { VoiceCloseReason } from "./voice-close-wire.js";

/* ----- The Overview's metrics (`@luke/service/admin/admin-metrics`) ----- */

export interface AdminDailyUsage {
  /** The UTC day the count covers, as YYYY-MM-DD. */
  day: string;
  calls: number;
}

export interface AdminDailySignups {
  day: string;
  count: number;
}

/**
 * A trailing run of days beside the run before it — the one thing a count on
 * its own cannot say, which is whether it is going up. Both runs are folded
 * from the same zero-filled series the page draws, so the comparison can never
 * disagree with the bars above it.
 */
export interface AdminTrend {
  /** The length of each run, in whole UTC days. */
  days: number;
  recent: number;
  prior: number;
}

/**
 * How many accounts linked each sign-in method. An account that linked more
 * than one method counts once under each, so the methods can legitimately sum
 * past the account total — never past it per method.
 */
export interface AdminSignInMethods {
  google: number;
  github: number;
  other: number;
}

/**
 * One cell of the retention grid: of the accounts created in the cohort's
 * week, how many were retained — by the grid's basis, a hosted-tier call or
 * a meaningful action — during the week `offset` weeks after it.
 * `share` is null for a cohort with nobody to take a share of — a percentage
 * of nothing would pose as precision — and a week the calendar has not
 * reached is no cell at all rather than a zero.
 */
export interface AdminRetentionCell {
  offset: number;
  activeAccounts: number;
  share: number | null;
  /** The cell's week is the one `generatedAt` falls in, still accruing. */
  inProgress: boolean;
}

export interface AdminRetentionCohort {
  /** The cohort's UTC week, named by its Monday as YYYY-MM-DD. */
  weekStart: string;
  /** Accounts created during this week. */
  size: number;
  cells: AdminRetentionCell[];
}

export interface AdminMetrics {
  generatedAt: number;
  windowDays: number;
  users: {
    total: number;
    /** Accounts created inside the window, the same rows the signup series draws. */
    newInWindow: number;
    signupTrend: AdminTrend;
    dailySignups: AdminDailySignups[];
  };
  /** Tasks, agents, pull requests, calls, and who is active, as `admin-overview.ts` shapes them. */
  overview: AdminOverview;
  /** Signup cohorts retained by any hosted-tier call; the overview carries the meaningful basis. */
  retention: {
    weeks: number;
    /** Oldest cohort first; each row's cells stop at the current week. */
    cohorts: AdminRetentionCohort[];
  };
}

/* ----- The Overview (`@luke/service/admin/admin-overview`) ----- */

/** One UTC day of the activity chart: its key, and each feature's count that day. */
export type AdminActivityDay = { day: string } & Record<ActivityFeature, number>;

/**
 * One funnel step: how many of the window's new accounts ever took it, and
 * their share of everyone who signed up in the window. `share` is null when
 * nobody signed up, because a share of nothing would pose as precision.
 */
export interface AdminFunnelStep {
  step: FunnelStep;
  accounts: number;
  share: number | null;
}

/** One feature's reach: how many of the week's active developers used it, and their share. */
interface AdminReachRow {
  feature: ReachFeature;
  developers: number;
  share: number | null;
}

/**
 * One of the most active accounts over the window, ranked by the days it took
 * a meaningful action rather than by volume: who lives in Luke daily, which a
 * single heavy day cannot fake. The account fields match the roster row's,
 * because both tables draw the same account cell, and the id goes back into
 * the detail endpoint's gate, never into a rendered string.
 */
export interface AdminOverviewAccount {
  id: string;
  name: string;
  email: string;
  image: string | null;
  admin: boolean;
  /** Window days with at least one meaningful action. */
  activeDays: number;
  /** Tasks the account created in the window. */
  tasks: number;
  /** Coding agents started under the account in the window. */
  agents: number;
  /** Pull requests of the account's agents merged in the window. */
  prsMerged: number;
  /** Minutes of voice calls the account started in the window, rounded. */
  callMinutes: number;
  /** The account's freshest sign-in session write, in epoch milliseconds; null when none stands. */
  lastSeenAt: number | null;
}

export interface AdminOverview {
  headline: {
    /** Distinct accounts with a meaningful action in each run. */
    activeDevelopers: AdminTrend;
    tasksCreated: AdminTrend;
    agentsStarted: AdminTrend;
    /** Of the agents started in the recent run, how many an automation started. */
    agentsFromAutomations: number;
    prsMerged: AdminTrend;
    /**
     * The pull requests of the agents started in the recent run, and how many
     * of them are merged: a conversion of that week's agents, not of the
     * merges `prsMerged` dates. A pull request records no instant it was
     * opened, so the week's openings cannot be counted on their own, and one
     * an older agent opened this week is in neither figure.
     */
    prsOpened: { opened: number; merged: number };
  };
  activity: {
    /** The window's UTC days, oldest first, zero-filled. */
    daily: AdminActivityDay[];
    /** Every feature's count summed, over the trend's two runs. */
    trend: AdminTrend;
  };
  /** The window's new accounts, step by step, in the vocabulary's order. */
  funnel: AdminFunnelStep[];
  reach: {
    /** The week's active developers: the headline's recent run, the base of every share. */
    activeDevelopers: number;
    features: AdminReachRow[];
  };
  topAccounts: AdminOverviewAccount[];
  /** Signup cohorts retained by a meaningful action, on the hosted grid's own weeks. */
  retention: {
    weeks: number;
    cohorts: AdminRetentionCohort[];
  };
}

/* ----- One account's page (`@luke/service/admin/admin-user`) ----- */

/** The account the page names, from the service's own user row. */
export interface AdminUserAccount {
  id: string;
  name: string;
  email: string;
  /** The avatar URL the sign-in provider gave the account, when it gave one. */
  image: string | null;
  admin: boolean;
  /** When the account was created, in epoch milliseconds. */
  createdAt: number;
  /** Linked sign-in providers, as their account rows name them (e.g. "github"). */
  signInMethods: string[];
}

/** The account's whole hosted-tier history, folded to counts and two dates. */
export interface AdminUserAllTime {
  activeDays: number;
  firstActiveDay: string | null;
  lastActiveDay: string | null;
  calls: number;
}

export interface AdminUserDetail {
  generatedAt: number;
  windowDays: number;
  account: AdminUserAccount;
  activity: {
    daily: AdminDailyUsage[];
    /**
     * The calendar's zero-filled trailing year, `calendarDayKeys`'s span,
     * whatever window the rest of the page is read at.
     */
    calendarDaily: AdminDailyUsage[];
    usageTrend: AdminTrend;
    activeDaysWindow: number;
    /** Active days in the trailing run beside the run before it. */
    activeDaysTrend: AdminTrend;
    /**
     * Consecutive active days ending today or yesterday — today may simply not
     * have started yet. Read off the window's own series, so a run older than
     * the window reports the window's length and the page words it as "or
     * longer" rather than posing a truncation as the exact count.
     */
    currentStreakDays: number;
    callsWindow: number;
    allTime: AdminUserAllTime;
  };
  /** What a maintainer supports the account from: `admin-account.ts`. */
  support: AdminAccountSupport;
}

/* ----- The Users roster (`@luke/service/admin/admin-users`) ----- */

export interface AdminUserListRow {
  id: string;
  name: string;
  email: string;
  /** The avatar URL the sign-in provider gave the account, when it gave one. */
  image: string | null;
  admin: boolean;
  /** When the account was created, in epoch milliseconds. */
  createdAt: number;
  /** Window days with a hosted-usage row; zero for an account never active. */
  activeDays: number;
  /** The account's most recent active day inside the window, if any. */
  lastActiveDay: string | null;
  /**
   * When the account last touched the service at all, in epoch milliseconds,
   * as `lastSeenInstant` folds it. Null for an account whose sessions have
   * all been pruned and which never touched the hosted tier.
   */
  lastSeenAt: number | null;
  calls: number;
  /** Whether the viewing admin starred this account, theirs alone to see. */
  favorite: boolean;
}

export interface AdminUserList {
  generatedAt: number;
  windowDays: number;
  /** Every account the scope — and the search, when one rode the read — covers, counted past the row bound. */
  total: number;
  /** The bound `rows` was read under, so the page can word a truncation. */
  limit: number;
  /** The term the rows and total were filtered by, echoed so the page words the answer it shows. */
  search: string | undefined;
  /** How the accounts the scope keeps sign in, beside how many there are; no search narrows it. */
  signIn: AdminSignIn;
  rows: AdminUserListRow[];
}

/** The sign-in methods chart's whole input: the methods linked, and the accounts they are a share of. */
export interface AdminSignIn {
  accounts: number;
  methods: AdminSignInMethods;
}

/* ----- One day opened (`@luke/service/admin/admin-day`) ----- */

/** One account's share of the day, the same account fields the tables draw. */
export interface AdminDayAccount {
  id: string;
  name: string;
  email: string;
  /** The avatar URL the sign-in provider gave the account, when it gave one. */
  image: string | null;
  admin: boolean;
  calls: number;
}

/** The whole day's counts, over every account the scope keeps, past the row bound. */
export interface AdminDayTotals {
  accounts: number;
  calls: number;
}

export interface AdminDayDetail {
  generatedAt: number;
  /** The UTC day the counts cover, as YYYY-MM-DD. */
  day: string;
  /** The bound `accounts` was read under, so the page can word a truncation. */
  limit: number;
  totals: AdminDayTotals;
  /** The day's active accounts, busiest first, cut at the stated bound. */
  accounts: AdminDayAccount[];
}

/* ----- System health (`@luke/service/admin/admin-health`) ----- */

export interface AdminDatabaseHealth {
  reachable: boolean;
  /** Round-trip of a trivial probe query, in milliseconds. */
  latencyMs: number;
}

/**
 * Whether one provider is wired, by the presence of its keys alone. The key
 * is stable for anything that keys off the row; the label is the
 * maintainer-facing name.
 */
export interface AdminIntegration {
  key: string;
  label: string;
  configured: boolean;
}

/* ----- Reliability (`@luke/service/admin/admin-reliability`) ----- */

/** Of some ended work, how much failed. */
export interface AdminFailureCount {
  failed: number;
  total: number;
}

/** Of an automation's settled runs, how many failed and how many a guard skipped. */
export interface AdminAutomationCount extends AdminFailureCount {
  skipped: number;
}

/**
 * One UTC day's failure rates, each the share of that day's ended work that
 * failed: null on a day nothing of its kind ended, so the line breaks there
 * rather than reading a quiet day as a perfect one.
 */
export interface AdminReliabilityDay {
  day: string;
  lukeTurns: number | null;
  agentRuns: number | null;
  calls: number | null;
  automationRuns: number | null;
}

export type AdminAttentionProblem =
  | {
      kind: typeof ADMIN_ATTENTION_KIND.PROVIDER_KEY;
      provider: ProviderKeyProvider;
      status: ProviderKeyStatus;
      /** When the provider last answered the key so, epoch milliseconds. */
      since: number;
    }
  | {
      kind: typeof ADMIN_ATTENTION_KIND.INTEGRATION;
      provider: IntegrationProvider;
      status: IntegrationRowStatus;
      since: number;
    }
  | {
      kind: typeof ADMIN_ATTENTION_KIND.GITHUB_INSTALLATION;
      status: GitHubInstallationStatus;
      since: number;
    };

/** One account with something broken, in the account fields the other admin tables draw. */
export interface AdminAttentionAccount {
  id: string;
  name: string;
  email: string;
  image: string | null;
  admin: boolean;
  /** The newest of its problems' instants, which orders the list. */
  brokenSince: number;
  problems: AdminAttentionProblem[];
  /** Its coding agents whose turn failed in the last `ADMIN_ATTENTION_AGENT_DAYS` days. */
  failedAgents: number;
}

export interface AdminReliability {
  generatedAt: number;
  windowDays: number;
  headline: {
    lukeTurns: AdminFailureCount;
    agentRuns: AdminFailureCount;
    /** Turns of any kind the maintenance sweep settled as abandoned. */
    abandonedTurns: number;
    calls: AdminFailureCount;
    automationRuns: AdminAutomationCount;
  };
  daily: AdminReliabilityDay[];
  /** Failed coding-agent runs by class, most first; a class with none is absent. */
  agentFailures: { failure: CodingAgentFailure; count: number }[];
  /** Skipped and failed automation runs by reason, most first. */
  automationReasons: { reason: AutomationRunReason | null; skipped: number; failed: number }[];
  attention: {
    /** Every account with something broken, past the row bound. */
    total: number;
    limit: number;
    accounts: AdminAttentionAccount[];
  };
  /** The analytics project's console, where per-request error rates live; absent where the deployment names none. */
  analyticsConsoleUrl?: string | undefined;
  systemHealth: {
    database: AdminDatabaseHealth;
    integrations: AdminIntegration[];
  };
}

/* ----- Workspaces (`@luke/service/admin/admin-workspaces`) ----- */

/** The account a row names as its workspace's owner, the shared account cell's fields. */
export interface AdminWorkspaceOwner {
  id: string;
  name: string;
  email: string;
  image: string | null;
  admin: boolean;
}

/** One GitHub App installation on a workspace: the account it is on and where it stands. */
export interface AdminWorkspaceInstallation {
  login: string;
  status: GitHubInstallationStatus;
}

/** One integration a workspace connected for its members, and whether its grant still works. */
export interface AdminWorkspaceIntegration {
  provider: IntegrationProvider;
  status: typeof INTEGRATION_ROW_STATUS.CONNECTED | typeof INTEGRATION_ROW_STATUS.EXPIRED;
}

export interface AdminWorkspaceRow {
  id: string;
  /** The workspace's name as its members read it; a personal one goes by its owner's name. */
  name: string;
  personal: boolean;
  /** The workspace's first owner, or none once every owner's account is gone. */
  owner: AdminWorkspaceOwner | null;
  members: number;
  /** Every installation connected to it, the first linked first. */
  installations: AdminWorkspaceInstallation[];
  integrations: AdminWorkspaceIntegration[];
  tasksWeek: number;
  agentsWeek: number;
  /** Distinct pull requests from its agents that merged inside the week. */
  prsMergedWeek: number;
  /** When the workspace was made, in epoch milliseconds. */
  createdAt: number;
}

export interface AdminWorkspaceSummary {
  /** Workspaces with two or more members that are nobody's personal one. */
  shared: number;
  /** Shared workspaces with a task or agent started, or a plan revised, inside the week. */
  sharedActiveWeek: number;
  invitations: {
    accepted: number;
    /** Still pending and not yet past their expiry. */
    pending: number;
    /** Still pending, but past their expiry, so never to be accepted. */
    expired: number;
    /** Every invitation no longer open: accepted, expired, or otherwise ended. */
    settled: number;
    /** Accepted over settled; null before any invitation has settled. */
    acceptanceRate: number | null;
  };
  github: {
    /** Shared workspaces with at least one active installation. */
    sharedWithActive: number;
    /** Shared workspaces with at least one suspended installation. */
    sharedWithSuspended: number;
    /** Shared workspaces with an active installation over all shared; null with none shared. */
    activeShare: number | null;
  };
}

export interface AdminWorkspaceList {
  generatedAt: number;
  activityDays: number;
  kind: AdminWorkspacesKind;
  /** The term the rows and total were filtered by, echoed so the page words the answer it shows. */
  search: string | undefined;
  /** Every workspace the scope, kind, and search keep, counted past the row bound. */
  total: number;
  limit: number;
  summary: AdminWorkspaceSummary;
  rows: AdminWorkspaceRow[];
}

/* ----- One account's support sections (`@luke/service/admin/admin-account`) ----- */

export interface AdminAccountProviderKey {
  provider: ProviderKeyProvider;
  status: ProviderKeyStatus;
  /** When the status was last set, in epoch milliseconds. */
  statusAt: number;
  fastAccess: FastAccess | null;
}

export interface AdminAccountConnection {
  provider: IntegrationProvider;
  /** `INTEGRATION_ROW_STATUS`: pending, connected, or expired. */
  status: string;
  /**
   * When the row last changed, in epoch milliseconds. No column keeps when
   * a connection's status alone moved: a rename or a sign-in begun moves
   * this too, so an expired connection is dated no earlier than that.
   */
  at: number;
}

export interface AdminAccountAgent {
  id: string;
  /** When it was started, in epoch milliseconds. */
  createdAt: number;
  repository: string | null;
  model: string;
  effort: string;
  contextWindow: ContextWindow;
  status: CodingAgentStatus;
  /** Why it failed, as the wire's word; null for an agent that did not, or failed with no word. */
  failure: CodingAgentFailure | null;
  pullRequest: AdminPullRequest;
}

export interface AdminAccountWorkspace {
  id: string;
  name: string;
  kind: AdminWorkspaceKind;
  role: string;
  memberCount: number;
  /** The status of each GitHub installation connected to it; empty where none is. */
  github: readonly GitHubInstallationStatus[];
}

/** One entry of the failures timeline: what failed, when, and the enumerated word for why. */
export type AdminAccountFailure =
  | { kind: typeof ADMIN_FAILURE_KIND.AGENT; at: number; reason: CodingAgentFailure | null }
  | { kind: typeof ADMIN_FAILURE_KIND.CALL; at: number; reason: VoiceCloseReason }
  | {
      kind: typeof ADMIN_FAILURE_KIND.KEY;
      at: number;
      provider: ProviderKeyProvider;
      reason: ProviderKeyStatus;
    }
  | {
      kind: typeof ADMIN_FAILURE_KIND.CONNECTION;
      at: number;
      provider: IntegrationProvider;
      reason: string;
    }
  | { kind: typeof ADMIN_FAILURE_KIND.AUTOMATION; at: number; reason: AutomationRunReason | null };

export interface AdminAccountSupport {
  /** When the account last touched the service, as the roster's `lastSeenInstant` folds it; null where nothing says. */
  lastSeenAt: number | null;
  totals: {
    tasksCreated: number;
    agentsStarted: number;
    /** Failed agents among the ones read, which `agentsRead` counts. */
    agentsFailed: number;
    agentsRead: number;
    pullRequestsOpened: number;
    pullRequestsMerged: number;
    callMinutes: number;
  };
  recentAgents: AdminAccountAgent[];
  workspaces: AdminAccountWorkspace[];
  providerKeys: AdminAccountProviderKey[];
  connections: AdminAccountConnection[];
  /** The account's coding-agent defaults; null on each the account never chose. */
  defaults: {
    model: string | null;
    effort: string | null;
    contextWindow: ContextWindow | null;
    /** Each experiment turned on, by its settings key and the name Settings shows. */
    experiments: { key: string; name: string }[];
  };
  /** The window's failures, newest first, at most `ADMIN_ACCOUNT_FAILURES_LIMIT`. */
  failures: AdminAccountFailure[];
}
