/**
 * admin-account.ts -- what a maintainer supports one account from, folded from its rows.
 *
 * The account page's support sections: when the account was last seen, how
 * much it did over the window (tasks, coding agents and their pull requests,
 * call minutes), its newest agents, its workspaces, its keys and
 * connections, its coding-agent defaults and experiments, and a timeline of
 * what failed for it recently. Every value is a count, a status, a model or
 * effort, or one of the service's own enumerated words; nothing the account
 * typed, said, or ran is read into it, so no task title, plan, prompt,
 * pull request title, or `failure_detail` is here. A workspace is named,
 * and an agent's repository is, which the developer allowed the admin pages. A coding agent's status and failure class are read by
 * `coder-host/status.ts`, the same reading the panel draws, so the page
 * never says an agent failed where the account's own window says it ran.
 *
 * The builder is pure, split from `admin-account-queries.ts` as the other
 * admin pages split theirs, so the folding is tested without a database.
 */

import type { GitHubInstallationStatus } from "@luke/database/github-installation-vocabulary";
import { INTEGRATION_ROW_STATUS } from "@luke/database/integration-vocabulary";
import type { CodingAgentLatestTurn } from "@luke/database/models/coding-agent-store";
import type { VoiceCloseReason } from "@luke/database/voice-vocabulary";
import type { AutomationRunReason } from "@luke/features/automation-wire";
import {
  CODING_AGENT_STATUS,
  type CodingAgentFailure,
  type CodingAgentStatus,
  type ContextWindow,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@luke/features/coding-agent-wire";
import type { IntegrationProvider } from "@luke/features/integration-wire";
import {
  type FastAccess,
  PROVIDER_KEY_STATUS,
  type ProviderKeyProvider,
  type ProviderKeyStatus,
} from "@luke/features/provider-key-wire";
import { EXPERIMENTS, type Experiment, type ExperimentChoices } from "@luke/settings";
import { codingAgentFailureOf, codingAgentStatusOf } from "../agents/coder-host/status.js";
import {
  ADMIN_FAILURE_KIND,
  ADMIN_PULL_REQUEST,
  ADMIN_WORKSPACE_KIND,
  type AdminPullRequest,
  type AdminWorkspaceKind,
} from "./admin-account-wire.js";
import { lastSeenInstant } from "./admin-users.js";

/** How many of the account's newest coding agents the page lists. */
export const ADMIN_RECENT_AGENTS_LIMIT = 10;

/**
 * How many of the window's agents have their status read for the failed
 * share. A status is read from the agent's newest turn, one row per agent,
 * so an automation that starts an agent a minute cannot turn one page into
 * a read of every turn it ran; past the bound the share is of the newest.
 */
export const ADMIN_ACCOUNT_STATUS_READ_LIMIT = 2000;

/** How many recent failures the timeline lists, and how many each source contributes at most. */
export const ADMIN_ACCOUNT_FAILURES_LIMIT = 20;

const SECONDS_PER_MINUTE = 60;

/** One coding agent as the queries read it: the fields the page may show, and what its status is read from. */
export interface AdminAccountAgentSource {
  id: string;
  createdAt: Date;
  /** The repository it works in, as `owner/name`. */
  repository: string;
  model: string;
  effort: string;
  contextWindow: ContextWindow;
  /** The state of its pull request as GitHub last answered, alone; null where none was found. */
  pullRequestState: PullRequestState | null;
  turn: CodingAgentLatestTurn | undefined;
  awaitingLineAt: Date | undefined;
}

/** One of the account's workspace memberships: the workspace's name, its size, and its GitHub installations. */
interface AdminAccountWorkspaceSource {
  id: string;
  name: string;
  role: string;
  memberCount: number;
  personal: boolean;
  github: readonly GitHubInstallationStatus[];
}

interface AdminAccountProviderKey {
  provider: ProviderKeyProvider;
  status: ProviderKeyStatus;
  /** When the status was last set, in epoch milliseconds. */
  statusAt: number;
  fastAccess: FastAccess | null;
}

interface AdminAccountConnection {
  provider: IntegrationProvider;
  /** `INTEGRATION_ROW_STATUS`: pending, connected, or expired. */
  status: string;
  /** When its status last moved, in epoch milliseconds. */
  at: number;
}

/** The raw shape the queries produce for one account, before the builder reads statuses and folds the timeline. */
export interface AdminAccountSource {
  /** The newest write of any of the account's sign-in sessions. */
  sessionSeenAt: Date | null;
  totals: {
    tasksCreated: number;
    agentsStarted: number;
    pullRequestsOpened: number;
    pullRequestsMerged: number;
    callSeconds: number;
  };
  /** The window's newest agents, at most `ADMIN_ACCOUNT_STATUS_READ_LIMIT`. */
  windowAgents: readonly AdminAccountAgentSource[];
  /** The account's newest agents, whenever they started. */
  recentAgents: readonly AdminAccountAgentSource[];
  workspaces: readonly AdminAccountWorkspaceSource[];
  providerKeys: readonly AdminAccountProviderKey[];
  connections: readonly AdminAccountConnection[];
  defaults: {
    model: string | null;
    effort: string | null;
    contextWindow: ContextWindow | null;
    experiments: ExperimentChoices;
  } | null;
  /** The window's newest dropped calls, at most the timeline's bound. */
  droppedCalls: readonly { at: Date; reason: VoiceCloseReason }[];
  /** The window's newest failed runs of the account's automations, at most the timeline's bound. */
  failedRuns: readonly { at: Date; reason: AutomationRunReason | null }[];
}

export interface AdminAccountAgent {
  id: string;
  /** When it was started, in epoch milliseconds. */
  createdAt: number;
  repository: string;
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
    experiments: { key: Experiment; name: string }[];
  };
  /** The window's failures, newest first, at most `ADMIN_ACCOUNT_FAILURES_LIMIT`. */
  failures: AdminAccountFailure[];
}

/** The pull request's state as the page draws it, a draft being open. */
function pullRequestOf(state: PullRequestState | null): AdminPullRequest {
  if (state === null) return ADMIN_PULL_REQUEST.NONE;
  if (state === PULL_REQUEST_STATE.MERGED) return ADMIN_PULL_REQUEST.MERGED;
  if (state === PULL_REQUEST_STATE.CLOSED) return ADMIN_PULL_REQUEST.CLOSED;
  return ADMIN_PULL_REQUEST.OPEN;
}

/** One agent with its status read at `now`, and its failure class where it failed. */
function agentOf(source: AdminAccountAgentSource, now: number): AdminAccountAgent {
  const status = codingAgentStatusOf(source.turn, {
    createdAt: source.createdAt,
    now,
    awaitingLineAt: source.awaitingLineAt,
  });
  const failure =
    status === CODING_AGENT_STATUS.FAILED ? (codingAgentFailureOf(source.turn) ?? null) : null;
  return {
    id: source.id,
    createdAt: source.createdAt.getTime(),
    repository: source.repository,
    model: source.model,
    effort: source.effort,
    contextWindow: source.contextWindow,
    status,
    failure,
    pullRequest: pullRequestOf(source.pullRequestState),
  };
}

/** The window's failed agents as timeline entries, each at its newest turn's end or, with none, its start. */
function agentFailures(source: AdminAccountSource, now: number): AdminAccountFailure[] {
  const failures: AdminAccountFailure[] = [];
  for (const agent of source.windowAgents) {
    const read = agentOf(agent, now);
    if (read.status !== CODING_AGENT_STATUS.FAILED) continue;
    const at = agent.turn?.settledAt ?? agent.createdAt;
    failures.push({ kind: ADMIN_FAILURE_KIND.AGENT, at: at.getTime(), reason: read.failure });
  }
  return failures;
}

/** The keys and connections that went bad inside the window, at when their status last moved. */
function credentialFailures(
  source: AdminAccountSource,
  windowStart: number,
): AdminAccountFailure[] {
  const failures: AdminAccountFailure[] = [];
  for (const key of source.providerKeys) {
    if (key.status === PROVIDER_KEY_STATUS.VERIFIED || key.statusAt < windowStart) continue;
    failures.push({
      kind: ADMIN_FAILURE_KIND.KEY,
      at: key.statusAt,
      provider: key.provider,
      reason: key.status,
    });
  }
  for (const connection of source.connections) {
    if (connection.status !== INTEGRATION_ROW_STATUS.EXPIRED || connection.at < windowStart) {
      continue;
    }
    failures.push({
      kind: ADMIN_FAILURE_KIND.CONNECTION,
      at: connection.at,
      provider: connection.provider,
      reason: connection.status,
    });
  }
  return failures;
}

/**
 * Folds one account's queried rows into the page's support sections, read
 * at `now` over the window starting at `windowStart` (epoch milliseconds,
 * the window's first UTC day). The usage day `lastActiveDay` is the
 * account's newest hosted-usage day, which `lastSeenInstant` folds with the
 * session write as the roster does, so the two pages say the same.
 */
export function buildAdminAccountSupport(
  source: AdminAccountSource,
  now: number,
  windowStart: number,
  lastActiveDay: string | null,
): AdminAccountSupport {
  const windowRead = source.windowAgents.map((agent) => agentOf(agent, now));
  const chosen = source.defaults?.experiments ?? {};

  const failures = [
    ...agentFailures(source, now),
    ...source.droppedCalls.map(
      (call): AdminAccountFailure => ({
        kind: ADMIN_FAILURE_KIND.CALL,
        at: call.at.getTime(),
        reason: call.reason,
      }),
    ),
    ...credentialFailures(source, windowStart),
    ...source.failedRuns.map(
      (run): AdminAccountFailure => ({
        kind: ADMIN_FAILURE_KIND.AUTOMATION,
        at: run.at.getTime(),
        reason: run.reason,
      }),
    ),
  ]
    .sort((left, right) => right.at - left.at)
    .slice(0, ADMIN_ACCOUNT_FAILURES_LIMIT);

  return {
    lastSeenAt: lastSeenInstant(source.sessionSeenAt, lastActiveDay),
    totals: {
      tasksCreated: source.totals.tasksCreated,
      agentsStarted: source.totals.agentsStarted,
      agentsFailed: windowRead.filter((agent) => agent.status === CODING_AGENT_STATUS.FAILED)
        .length,
      agentsRead: windowRead.length,
      pullRequestsOpened: source.totals.pullRequestsOpened,
      pullRequestsMerged: source.totals.pullRequestsMerged,
      callMinutes: Math.round(source.totals.callSeconds / SECONDS_PER_MINUTE),
    },
    recentAgents: source.recentAgents.map((agent) => agentOf(agent, now)),
    workspaces: source.workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      kind: workspace.personal ? ADMIN_WORKSPACE_KIND.PERSONAL : ADMIN_WORKSPACE_KIND.SHARED,
      role: workspace.role,
      memberCount: workspace.memberCount,
      github: workspace.github,
    })),
    providerKeys: [...source.providerKeys],
    connections: [...source.connections],
    defaults: {
      model: source.defaults?.model ?? null,
      effort: source.defaults?.effort ?? null,
      contextWindow: source.defaults?.contextWindow ?? null,
      experiments: EXPERIMENTS.filter((entry) => chosen[entry.key] === true).map((entry) => ({
        key: entry.key,
        name: entry.name,
      })),
    },
    failures,
  };
}
