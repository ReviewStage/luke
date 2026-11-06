import type { AgentSummary } from "@repo/features/agent-wire";
import { LINK_PLACE, pullRequestAddressOf } from "@repo/features/link-grammar";
import { summaryOfTaskless, TASKS_READ, type TasksView } from "@repo/features/tasks-view";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { listedPullRequestOf } from "@repo/ui/pull-request-link";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback } from "react";
import { tabCard } from "../desktop/tab-card.js";
import { appStateQuery, selectTasks } from "../use-app-state.js";
import { type AgentSubject, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import { type MentionedAgentsPlace, useMentionedPlace } from "./mentioned-place.js";
import { TAB_KIND } from "./tab-look.js";
import { useListedPullRequest } from "./use-agent-pull-request.js";
import type { AgentsControl } from "./use-agents.js";
import { useKnownNames } from "./use-known-names.js";
import { useOpenPlace } from "./use-open-link.js";

const TASK_WORDS = {
  NONE: "On no task",
  UNKNOWN: "On another task",
} as const;

const NO_PULL_REQUESTS: AgentsControl["pullRequests"] = new Map();

const UNLISTED = {
  READING: "reading",
  ABSENT: "absent",
} as const;

type Listed = AgentSummary | (typeof UNLISTED)[keyof typeof UNLISTED];

function agentOf(listed: Listed): AgentSummary | undefined {
  return typeof listed === "string" ? undefined : listed;
}

function listedAgentOf(tasks: TasksView | undefined, agentId: string): Listed {
  const onTask = tasks?.taskAgents?.find((agent) => agent.id === agentId);
  if (onTask !== undefined) return onTask;
  const onNone = tasks?.tasklessAgents?.find((agent) => agent.id === agentId);
  if (onNone !== undefined) return summaryOfTaskless(onNone);
  const answered = tasks?.taskAgents !== undefined || tasks?.listStatus === TASKS_READ.FAILED;
  return answered ? UNLISTED.ABSENT : UNLISTED.READING;
}

function useListedAgent(agentId: string): Listed {
  const select = useCallback(
    (state: AppStateSnapshot) => listedAgentOf(state.tasks, agentId),
    [agentId],
  );
  return useQuery({ ...appStateQuery, select }).data ?? UNLISTED.READING;
}

function useListedModel(agentId: string): string | undefined {
  const select = useCallback(
    (state: AppStateSnapshot) => agentOf(listedAgentOf(state.tasks, agentId))?.model,
    [agentId],
  );
  return useQuery({ ...appStateQuery, select }).data;
}

type ModelDrawer = (model: string | undefined) => ReactNode;

export function ReadAgentModel({
  agentId,
  children,
}: {
  agentId: string;
  children: ModelDrawer;
}): ReactNode {
  return children(useListedModel(agentId));
}

function useTaskFoot(agent: AgentSummary | undefined): string | undefined {
  const tasks = useKnownNames().tasks;
  if (agent === undefined) return undefined;
  if (agent.planId === null) return TASK_WORDS.NONE;
  const task = tasks.get(agent.planId);
  return task === undefined ? TASK_WORDS.UNKNOWN : `On ${task}`;
}

function listedSubject(agent: AgentSummary, place: MentionedAgentsPlace): AgentSubject {
  return agentSubject(
    {
      agents: [agent],
      archived: undefined,
      models: place.models,
      me: place.me,
      pullRequests: NO_PULL_REQUESTS,
    },
    agent.id,
    NOTHING_HELD,
    false,
  );
}

export function MentionedAgentCard({
  agentId,
  reading,
  fallback,
}: {
  agentId: string;
  reading: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  const place = useMentionedPlace();
  const listed = useListedAgent(agentId);
  const agent = agentOf(listed);
  const foot = useTaskFoot(agent);
  if (listed === UNLISTED.READING) return reading;
  if (agent === undefined) return fallback;
  return tabCard({
    kind: TAB_KIND.AGENT,
    subject: listedSubject(agent, place),
    models: place.models,
    foot,
  });
}

interface OwnedPullRequest {
  readonly agentId: string;
  readonly taskId: string | undefined;
  readonly number: number | undefined;
}

function useOwnedPullRequest(url: string): OwnedPullRequest | undefined {
  const tasks = useQuery({ ...appStateQuery, select: selectTasks }).data;
  if (tasks === undefined) return undefined;
  const number = pullRequestAddressOf(url)?.number;
  const listed = listedPullRequestOf(url, tasks.tasks, tasks.tasklessAgents);
  return listed === undefined ? undefined : { ...listed, number };
}

function OwnedPullRequestCard({
  owned,
  reading,
  fallback,
}: {
  owned: OwnedPullRequest;
  reading: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  const place = useMentionedPlace();
  const openPlace = useOpenPlace();
  const { agentId, taskId, number } = owned;
  const listed = useListedAgent(agentId);
  const pullRequest = useListedPullRequest(agentId);
  if (listed === UNLISTED.READING) return reading;
  const agent = agentOf(listed);
  const another = number !== undefined && pullRequest?.number !== number;
  if (agent === undefined || pullRequest === undefined || another) return fallback;
  const card = tabCard({
    kind: TAB_KIND.CHANGES,
    subject: listedSubject(agent, place),
    models: place.models,
    pullRequest,
    people: undefined,
    onOpenAgent: () =>
      openPlace?.({
        kind: LINK_PLACE.AGENT,
        ...(taskId === undefined ? undefined : { planId: taskId }),
        agentId,
      }),
  });
  return card ?? fallback;
}

export function PullRequestChipCard({
  url,
  reading,
  fallback,
}: {
  url: string;
  reading: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  const owned = useOwnedPullRequest(url);
  if (owned === undefined) return fallback;
  return <OwnedPullRequestCard owned={owned} reading={reading} fallback={fallback} />;
}

export function AgentPullRequestChipCard({
  agentId,
  taskId,
  reading,
  fallback,
}: {
  agentId: string;
  taskId: string | undefined;
  reading: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  return (
    <OwnedPullRequestCard
      owned={{ agentId, taskId, number: undefined }}
      reading={reading}
      fallback={fallback}
    />
  );
}
