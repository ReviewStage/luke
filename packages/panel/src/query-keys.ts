import type { QueryClient } from "@tanstack/react-query";

export const QUERY_ROOT = {
  INVITATION_OFFER: "invitation-offer",
  CONSENT_REQUEST: "consent-request",
  ADMIN: "admin",
  HOST_PAIRING: "host-pairing",
  INSTALLED_SKILL: "installed-skill",
  INSTALLED_SKILL_PREVIEW: "installed-skill-preview",
  TASK_NEWEST_REVISION: "task-newest-revision",
  WORKSPACE_AGENTS: "workspace-agents",
  REPOSITORY_PATHS: "repository-paths",
  AGENT_PART: "agent-part",
  APP_STATE: "appState",
  TASK_FILE: "task-file",
  TASK_TREE: "task-tree",
  PAGE_SOURCE: "page-source",
  CODE_COLORING: "code-coloring",
  AGENT_PAGE: "agent-page",
  INBOX_ITEM_HOME: "inbox-item-home",
  TASK_BY_NUMBER: "task-by-number",
  AGENT_MESSAGES: "agent-messages",
  REPOSITORY_SKILLS: "repository-skills",
  TERMINAL_LIST: "terminal-list",
  AGENT_CHANGES: "agent-changes",
  TASK_REVISION: "task-revision",
  PICTURE: "picture",
} as const;

const ACCOUNT_SCOPED_ROOTS: ReadonlySet<unknown> = new Set<string>([
  QUERY_ROOT.TASK_TREE,
  QUERY_ROOT.WORKSPACE_AGENTS,
  QUERY_ROOT.TASK_FILE,
  QUERY_ROOT.PAGE_SOURCE,
  QUERY_ROOT.REPOSITORY_PATHS,
  QUERY_ROOT.AGENT_PART,
  QUERY_ROOT.TASK_NEWEST_REVISION,
  QUERY_ROOT.AGENT_CHANGES,
  QUERY_ROOT.TASK_REVISION,
  QUERY_ROOT.INSTALLED_SKILL,
  QUERY_ROOT.INSTALLED_SKILL_PREVIEW,
  QUERY_ROOT.HOST_PAIRING,
]);

export function forgetAccountReads(client: QueryClient): Promise<void> {
  return client.resetQueries({ predicate: (query) => ACCOUNT_SCOPED_ROOTS.has(query.queryKey[0]) });
}
