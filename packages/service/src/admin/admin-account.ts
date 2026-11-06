import type { GitHubInstallationStatus } from "@repo/database/github-installation-vocabulary";
import { INTEGRATION_ROW_STATUS } from "@repo/database/integration-vocabulary";
import type { AgentLatestTurn } from "@repo/database/models/agent-store";
import {
  ADMIN_FAILURE_KIND,
  ADMIN_PULL_REQUEST,
  ADMIN_WORKSPACE_KIND,
  type AdminPullRequest,
} from "@repo/features/admin-account-wire";
import type {
  AdminAccountAgent,
  AdminAccountConnection,
  AdminAccountFailure,
  AdminAccountProviderKey,
  AdminAccountSupport,
} from "@repo/features/admin-answer-wire";
import {
  AGENT_STATUS,
  type ContextWindow,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@repo/features/agent-wire";
import type { AutomationRunReason } from "@repo/features/automation-wire";
import { PROVIDER_KEY_STATUS } from "@repo/features/provider-key-wire";
import { EXPERIMENTS, type ExperimentChoices } from "@repo/settings";
import { agentFailureOf, agentStatusOf } from "../agents/coder-host/status.js";

export const ADMIN_RECENT_AGENTS_LIMIT = 10;

export const ADMIN_ACCOUNT_STATUS_READ_LIMIT = 2000;

export const ADMIN_ACCOUNT_FAILURES_LIMIT = 20;

export interface AdminAccountAgentSource {
  id: string;
  createdAt: Date;
  repository: string | null;
  model: string;
  effort: string;
  contextWindow: ContextWindow;
  pullRequestState: PullRequestState | null;
  turn: AgentLatestTurn | undefined;
  awaitingLineAt: Date | undefined;
}

interface AdminAccountWorkspaceSource {
  id: string;
  name: string;
  role: string;
  memberCount: number;
  personal: boolean;
  github: readonly GitHubInstallationStatus[];
}

export interface AdminAccountSource {
  sessionSeenAt: Date | null;
  totals: {
    tasksCreated: number;
    agentsStarted: number;
    pullRequestsOpened: number;
    pullRequestsMerged: number;
  };
  windowAgents: readonly AdminAccountAgentSource[];
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
  failedRuns: readonly { at: Date; reason: AutomationRunReason | null }[];
}

function pullRequestOf(state: PullRequestState | null): AdminPullRequest {
  if (state === null) return ADMIN_PULL_REQUEST.NONE;
  if (state === PULL_REQUEST_STATE.MERGED) return ADMIN_PULL_REQUEST.MERGED;
  if (state === PULL_REQUEST_STATE.CLOSED) return ADMIN_PULL_REQUEST.CLOSED;
  return ADMIN_PULL_REQUEST.OPEN;
}

function agentOf(source: AdminAccountAgentSource, now: number): AdminAccountAgent {
  const status = agentStatusOf(source.turn, {
    createdAt: source.createdAt,
    now,
    awaitingLineAt: source.awaitingLineAt,
  });
  const failure = status === AGENT_STATUS.FAILED ? (agentFailureOf(source.turn) ?? null) : null;
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

function agentFailures(
  source: AdminAccountSource,
  now: number,
  windowStart: number,
): AdminAccountFailure[] {
  const failures: AdminAccountFailure[] = [];
  for (const agent of source.windowAgents) {
    const read = agentOf(agent, now);
    const at = (agent.turn?.settledAt ?? agent.createdAt).getTime();
    if (read.status !== AGENT_STATUS.FAILED || at < windowStart) continue;
    failures.push({ kind: ADMIN_FAILURE_KIND.AGENT, at, reason: read.failure });
  }
  return failures;
}

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

export function buildAdminAccountSupport(
  source: AdminAccountSource,
  now: number,
  windowStart: number,
): AdminAccountSupport {
  const windowRead = source.windowAgents
    .filter((agent) => agent.createdAt.getTime() >= windowStart)
    .map((agent) => agentOf(agent, now));
  const chosen = source.defaults?.experiments ?? {};

  const failures = [
    ...agentFailures(source, now, windowStart),
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
    lastSeenAt: source.sessionSeenAt?.getTime() ?? null,
    totals: {
      tasksCreated: source.totals.tasksCreated,
      agentsStarted: source.totals.agentsStarted,
      agentsFailed: windowRead.filter((agent) => agent.status === AGENT_STATUS.FAILED).length,
      agentsRead: windowRead.length,
      pullRequestsOpened: source.totals.pullRequestsOpened,
      pullRequestsMerged: source.totals.pullRequestsMerged,
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
