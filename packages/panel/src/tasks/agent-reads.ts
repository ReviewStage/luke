/**
 * agent-reads.ts -- the one-off reads of an agent, an Inbox item, a task by its number, a transcript's page, a repository's skills, and a sandbox's terminals, each asked as a reader acts.
 *
 * Each is a `queryOptions` factory keyed by its root and the ids it reads by,
 * its `queryFn` the act. These reads are asked inside a handler or as a list
 * opens, so they go through `queryClient.fetchQuery` on the factory: every
 * ask reads afresh (`staleTime` 0), while asks made at once share one read,
 * and a failure is answered at once, never tried again on its own.
 */

import type { AgentChangesAnswerView, AgentMessagesParams } from "@repo/features/agent-view";
import type { TasksSkillsParams } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { queryOptions, skipToken } from "@tanstack/react-query";
import { askAct } from "../act.js";
import { QUERY_ROOT } from "../query-keys.js";
import { pullRequestAsked } from "./pull-request-number.js";

/** An agent's page, as a link to it or a row naming it by its id alone reads it. */
export function agentPageQueryOptions(agentId: string) {
  return queryOptions({
    queryKey: [QUERY_ROOT.AGENT_PAGE, agentId],
    queryFn: () => askAct(ACT_KIND.AGENTS_PAGE, { agentId }),
    retry: false,
  });
}

/** Where an Inbox item stands, as a link to it opens it. */
export function inboxItemHomeQueryOptions(itemId: string) {
  return queryOptions({
    queryKey: [QUERY_ROOT.INBOX_ITEM_HOME, itemId],
    queryFn: () => askAct(ACT_KIND.AGENTS_INBOX_ITEM_HOME, { itemId }),
    retry: false,
  });
}

/** The task a workspace's number names, as an app link naming it by number opens it. */
export function taskByNumberQueryOptions(workspace: string, number: number) {
  return queryOptions({
    queryKey: [QUERY_ROOT.TASK_BY_NUMBER, workspace, number],
    queryFn: () => askAct(ACT_KIND.TASKS_FIND, { workspace, number }),
    retry: false,
  });
}

/** One page of a transcript past its cursor, as Copy transcript reads it page by page. */
export function agentMessagesQueryOptions(params: AgentMessagesParams) {
  return queryOptions({
    queryKey: [QUERY_ROOT.AGENT_MESSAGES, params.agentId, params.callId ?? null, params.after],
    queryFn: () => askAct(ACT_KIND.AGENTS_MESSAGES, params),
    retry: false,
  });
}

/** A repository's skills, by the plan that names it, or by a workspace and the repository where an agent stands on no task. */
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

/** An agent's changes the service did not carry, as their query's error, carrying the answer it gave. */
export class ChangesFailed extends Error {
  readonly answer: Extract<AgentChangesAnswerView, { readonly failure: unknown }>;

  constructor(answer: Extract<AgentChangesAnswerView, { readonly failure: unknown }>) {
    super("The service did not carry this read of the changes.");
    this.answer = answer;
  }
}

/** An agent's changes as read, a failure thrown as `ChangesFailed`. */
function landedChanges(answer: AgentChangesAnswerView) {
  if ("failure" in answer) throw new ChangesFailed(answer);
  return answer;
}

/**
 * An agent's changes, its pull request's files, or those of the pull request
 * of its repository by the number given. Its Changes tab reads them as it is
 * first shown, as its agent ends, and on Refresh, so the query is read on
 * those asks alone; a failure stands as the query's error, the changes last
 * read standing beside it.
 */
export function agentChangesQueryOptions(agentId: string | undefined, number: number | undefined) {
  return queryOptions({
    queryKey: [QUERY_ROOT.AGENT_CHANGES, agentId, number ?? null],
    queryFn:
      agentId === undefined
        ? skipToken
        : () =>
            askAct(ACT_KIND.AGENTS_CHANGES, pullRequestAsked(agentId, number)).then(landedChanges),
    staleTime: Number.POSITIVE_INFINITY,
    // Note that each answer is its own, an answer alike to the last included, since the tab reads the
    // marks again with every answer and lets go of a file read whole for the one before.
    structuralSharing: false,
    retry: false,
  });
}
