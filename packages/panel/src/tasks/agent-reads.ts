import type { AgentChangesAnswerView, AgentMessagesParams } from "@repo/features/agent-view";
import type { TasksSkillsParams } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { queryOptions, skipToken } from "@tanstack/react-query";
import { askAct } from "../act.js";
import { QUERY_ROOT } from "../query-keys.js";
import { pullRequestAsked } from "./pull-request-number.js";

export function agentPageQueryOptions(agentId: string) {
  return queryOptions({
    queryKey: [QUERY_ROOT.AGENT_PAGE, agentId],
    queryFn: () => askAct(ACT_KIND.AGENTS_PAGE, { agentId }),
    retry: false,
  });
}

export function inboxItemHomeQueryOptions(itemId: string) {
  return queryOptions({
    queryKey: [QUERY_ROOT.INBOX_ITEM_HOME, itemId],
    queryFn: () => askAct(ACT_KIND.AGENTS_INBOX_ITEM_HOME, { itemId }),
    retry: false,
  });
}

export function taskByNumberQueryOptions(workspace: string, number: number) {
  return queryOptions({
    queryKey: [QUERY_ROOT.TASK_BY_NUMBER, workspace, number],
    queryFn: () => askAct(ACT_KIND.TASKS_FIND, { workspace, number }),
    retry: false,
  });
}

export function agentMessagesQueryOptions(params: AgentMessagesParams) {
  return queryOptions({
    queryKey: [QUERY_ROOT.AGENT_MESSAGES, params.agentId, params.callId ?? null, params.after],
    queryFn: () => askAct(ACT_KIND.AGENTS_MESSAGES, params),
    retry: false,
  });
}

export function repositorySkillsQueryOptions(params: TasksSkillsParams) {
  return queryOptions({
    queryKey:
      "planId" in params
        ? [QUERY_ROOT.REPOSITORY_SKILLS, params.planId, null, null]
        : [QUERY_ROOT.REPOSITORY_SKILLS, null, params.workspaceId, params.repository ?? null],
    queryFn: () => askAct(ACT_KIND.TASKS_SKILLS, params),
    retry: false,
  });
}

export function terminalListQueryOptions(agentId: string) {
  return queryOptions({
    queryKey: [QUERY_ROOT.TERMINAL_LIST, agentId],
    queryFn: () => askAct(ACT_KIND.TERMINAL_LIST, { agentId }),
    retry: false,
  });
}

export class ChangesFailed extends Error {
  readonly answer: Extract<AgentChangesAnswerView, { readonly failure: unknown }>;

  constructor(answer: Extract<AgentChangesAnswerView, { readonly failure: unknown }>) {
    super("The service did not carry this read of the changes.");
    this.answer = answer;
  }
}

function landedChanges(answer: AgentChangesAnswerView) {
  if ("failure" in answer) throw new ChangesFailed(answer);
  return answer;
}

export function agentChangesQueryOptions(agentId: string | undefined, number: number | undefined) {
  return queryOptions({
    queryKey: [QUERY_ROOT.AGENT_CHANGES, agentId, number ?? null],
    queryFn:
      agentId === undefined
        ? skipToken
        : () =>
            askAct(ACT_KIND.AGENTS_CHANGES, pullRequestAsked(agentId, number)).then(landedChanges),
    staleTime: Number.POSITIVE_INFINITY,
    structuralSharing: false,
    retry: false,
  });
}
