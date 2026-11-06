import type {
  ADMIN_FAILURE_KIND,
  AdminPullRequest,
  AdminWorkspaceKind,
} from "./admin-account-wire.js";
import type {
  ActivityFeature,
  AgentOrigin,
  DayAccountCount,
  FunnelStep,
  MeaningfulAction,
  ReachFeature,
} from "./admin-overview-vocabulary.js";
import type { ADMIN_ATTENTION_KIND, AdminWorkspacesKind } from "./admin-wire.js";
import type { AgentFailure, AgentStatus, ContextWindow } from "./agent-wire.js";
import type { AutomationRunReason } from "./automation-wire.js";
import type { GitHubInstallationStatus } from "./github-installation-wire.js";
import type { IntegrationRowStatus } from "./integration-row-wire.js";
import type { IntegrationProvider } from "./integration-wire.js";
import type { FastAccess, ProviderKeyProvider, ProviderKeyStatus } from "./provider-key-wire.js";
import type { WorkspaceRole } from "./workspace-wire.js";

export interface AdminDailyUsage {
  day: string;
  calls: number;
}

export interface AdminDailySignups {
  day: string;
  count: number;
}

export interface AdminTrend {
  days: number;
  recent: number;
  prior: number;
}

export interface AdminSignInMethods {
  google: number;
  github: number;
  other: number;
}

export interface AdminRetentionCell {
  offset: number;
  activeAccounts: number;
  share: number | null;
  inProgress: boolean;
}

export interface AdminRetentionCohort {
  weekStart: string;
  size: number;
  cells: AdminRetentionCell[];
}

export interface AdminMetrics {
  generatedAt: number;
  windowDays: number;
  users: {
    total: number;
    newInWindow: number;
    signupTrend: AdminTrend;
    dailySignups: AdminDailySignups[];
  };
  overview: AdminOverview;
  retention: {
    weeks: number;
    cohorts: AdminRetentionCohort[];
  };
}

export type AdminActivityDay = { day: string } & Record<ActivityFeature, number>;

export interface AdminFunnelStep {
  step: FunnelStep;
  accounts: number;
  share: number | null;
}

interface AdminReachRow {
  feature: ReachFeature;
  developers: number;
  share: number | null;
}

interface AdminAgentOriginRow {
  origin: AgentOrigin;
  agents: number;
  share: number | null;
}

export interface AdminOverviewAccount {
  id: string;
  name: string;
  email: string;
  image: string | null;
  admin: boolean;
  activeDays: number;
  tasks: number;
  agents: number;
  prsMerged: number;
  lastSeenAt: number | null;
}

export interface AdminOverview {
  headline: {
    activeDevelopers: AdminTrend;
    tasksCreated: AdminTrend;
    agentsStarted: AdminTrend;
    prsMerged: AdminTrend;
    prsOpened: { opened: number; merged: number };
  };
  agentOrigins: {
    agentsStarted: number;
    origins: AdminAgentOriginRow[];
    pilots: number;
  };
  activity: {
    daily: AdminActivityDay[];
    trend: AdminTrend;
  };
  funnel: AdminFunnelStep[];
  reach: {
    activeDevelopers: number;
    features: AdminReachRow[];
  };
  topAccounts: AdminOverviewAccount[];
  retention: {
    weeks: number;
    cohorts: AdminRetentionCohort[];
  };
}

export interface AdminUserAccount {
  id: string;
  name: string;
  email: string;
  image: string | null;
  admin: boolean;
  createdAt: number;
  signInMethods: string[];
  supportAccessUntil: number | null;
}

export type AdminActionDay = { day: string } & Record<MeaningfulAction, number>;

export interface AdminDailyCount {
  day: string;
  count: number;
}

export interface AdminUserActions {
  daily: AdminActionDay[];
  calendarDaily: AdminDailyCount[];
  actionsTrend: AdminTrend;
  activeDaysWindow: number;
  activeDaysTrend: AdminTrend;
  currentStreakDays: number;
  firstActiveDay: string | null;
  lastActiveDay: string | null;
}

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
  analyticsPersonUrl?: string | undefined;
  actions: AdminUserActions;
  activity: {
    daily: AdminDailyUsage[];
    calendarDaily: AdminDailyUsage[];
    usageTrend: AdminTrend;
    activeDaysWindow: number;
    activeDaysTrend: AdminTrend;
    currentStreakDays: number;
    callsWindow: number;
    allTime: AdminUserAllTime;
  };
  support: AdminAccountSupport;
}

export interface AdminUserListRow {
  id: string;
  name: string;
  email: string;
  image: string | null;
  admin: boolean;
  createdAt: number;
  activeDays: number;
  lastActiveDay: string | null;
  lastSeenAt: number | null;
  favorite: boolean;
}

export interface AdminUserList {
  generatedAt: number;
  windowDays: number;
  total: number;
  limit: number;
  search: string | undefined;
  signIn: AdminSignIn;
  rows: AdminUserListRow[];
}

export interface AdminSignIn {
  accounts: number;
  methods: AdminSignInMethods;
}

export interface AdminDayAccount {
  id: string;
  name: string;
  email: string;
  image: string | null;
  admin: boolean;
  calls: number;
}

export interface AdminDayTotals {
  accounts: number;
  calls: number;
}

export interface AdminDayActiveAccount {
  id: string;
  name: string;
  email: string;
  image: string | null;
  admin: boolean;
  counts: Record<DayAccountCount, number>;
}

export interface AdminDayActivity {
  features: Record<ActivityFeature, number>;
  activeDevelopers: number;
  accounts: AdminDayActiveAccount[];
}

export interface AdminDayDetail {
  generatedAt: number;
  day: string;
  limit: number;
  activity: AdminDayActivity;
  totals: AdminDayTotals;
  accounts: AdminDayAccount[];
}

export interface AdminDatabaseHealth {
  reachable: boolean;
  latencyMs: number;
}

export interface AdminIntegration {
  key: string;
  label: string;
  configured: boolean;
}

export interface AdminFailureCount {
  failed: number;
  total: number;
}

export interface AdminAutomationCount extends AdminFailureCount {
  skipped: number;
}

export interface AdminReliabilityDay {
  day: string;
  appTurns: number | null;
  agentRuns: number | null;
  automationRuns: number | null;
}

export type AdminAttentionProblem =
  | {
      kind: typeof ADMIN_ATTENTION_KIND.PROVIDER_KEY;
      provider: ProviderKeyProvider;
      status: ProviderKeyStatus;
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

export interface AdminAttentionAccount {
  id: string;
  name: string;
  email: string;
  image: string | null;
  admin: boolean;
  brokenSince: number;
  problems: AdminAttentionProblem[];
  failedAgents: number;
}

export interface AdminReliability {
  generatedAt: number;
  windowDays: number;
  headline: {
    appTurns: AdminFailureCount;
    agentRuns: AdminFailureCount;
    abandonedTurns: number;
    automationRuns: AdminAutomationCount;
  };
  daily: AdminReliabilityDay[];
  agentFailures: { failure: AgentFailure; count: number }[];
  automationReasons: { reason: AutomationRunReason | null; skipped: number; failed: number }[];
  attention: {
    total: number;
    limit: number;
    accounts: AdminAttentionAccount[];
  };
  analyticsConsoleUrl?: string | undefined;
  systemHealth: {
    database: AdminDatabaseHealth;
    integrations: AdminIntegration[];
  };
}

export interface AdminWorkspaceOwner {
  id: string;
  name: string;
  email: string;
  image: string | null;
  admin: boolean;
}

export interface AdminWorkspaceInstallation {
  login: string;
  status: GitHubInstallationStatus;
}

export interface AdminWorkspaceRow {
  id: string;
  name: string;
  personal: boolean;
  owner: AdminWorkspaceOwner | null;
  members: number;
  installations: AdminWorkspaceInstallation[];
  tasksWeek: number;
  agentsWeek: number;
  prsMergedWeek: number;
  createdAt: number;
}

export interface AdminWorkspaceSummary {
  shared: number;
  sharedActiveWeek: number;
  invitations: {
    accepted: number;
    pending: number;
    expired: number;
    settled: number;
    acceptanceRate: number | null;
  };
  github: {
    sharedWithActive: number;
    sharedWithSuspended: number;
    activeShare: number | null;
  };
}

export interface AdminWorkspaceList {
  generatedAt: number;
  activityDays: number;
  kind: AdminWorkspacesKind;
  search: string | undefined;
  total: number;
  limit: number;
  summary: AdminWorkspaceSummary;
  rows: AdminWorkspaceRow[];
}

export interface AdminWorkspaceMember {
  account: AdminWorkspaceOwner;
  role: WorkspaceRole;
  joinedAt: number;
}

export interface AdminWorkspaceDetail {
  generatedAt: number;
  activityDays: number;
  workspace: AdminWorkspaceRow;
  members: AdminWorkspaceMember[];
}

export interface AdminAccountProviderKey {
  provider: ProviderKeyProvider;
  status: ProviderKeyStatus;
  statusAt: number;
  fastAccess: FastAccess | null;
}

export interface AdminAccountConnection {
  provider: IntegrationProvider;
  status: string;
  at: number;
}

export interface AdminAccountAgent {
  id: string;
  createdAt: number;
  repository: string | null;
  model: string;
  effort: string;
  contextWindow: ContextWindow;
  status: AgentStatus;
  failure: AgentFailure | null;
  pullRequest: AdminPullRequest;
}

export interface AdminAccountWorkspace {
  id: string;
  name: string;
  kind: AdminWorkspaceKind;
  role: string;
  memberCount: number;
  github: readonly GitHubInstallationStatus[];
}

export type AdminAccountFailure =
  | { kind: typeof ADMIN_FAILURE_KIND.AGENT; at: number; reason: AgentFailure | null }
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
  lastSeenAt: number | null;
  totals: {
    tasksCreated: number;
    agentsStarted: number;
    agentsFailed: number;
    agentsRead: number;
    pullRequestsOpened: number;
    pullRequestsMerged: number;
  };
  recentAgents: AdminAccountAgent[];
  workspaces: AdminAccountWorkspace[];
  providerKeys: AdminAccountProviderKey[];
  connections: AdminAccountConnection[];
  defaults: {
    model: string | null;
    effort: string | null;
    contextWindow: ContextWindow | null;
    experiments: { key: string; name: string }[];
  };
  failures: AdminAccountFailure[];
}
