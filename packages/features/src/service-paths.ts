export const HOSTED_SERVICE_PATH = {
  ACCOUNT_DELETE: "/api/account/delete",
  EVENTS: "/api/events",
  ACCOUNT_PREFERENCES: "/api/account/preferences",
  ACCOUNT_ACCESS: "/api/account/access",
  ACCOUNT_PROVIDER_KEYS: "/api/account/provider-keys",
  ACCOUNT_CHATGPT_DEVICE: "/api/account/chatgpt/device",
  ACCOUNT_CHATGPT_DEVICE_POLL: "/api/account/chatgpt/device/poll",
  ACCOUNT_CHATGPT_DEVICE_CANCEL: "/api/account/chatgpt/device/cancel",
  ACCOUNT_MEMORIES: "/api/account/memories",
  ACCOUNT_MEMORIES_SEARCH: "/api/account/memories/search",
  ACCOUNT_MCP_CLIENTS: "/api/account/mcp-clients",
  DICTATION: "/api/dictation",
  ACCOUNT_SUPPORT_ACCESS: "/api/account/support-access",
  ACCOUNT_INTEGRATIONS: "/api/account/integrations",
  ACCOUNT_INTEGRATIONS_SETTLE: "/api/account/integrations/settle",
  ACCOUNT_INTEGRATIONS_GITHUB: "/api/account/integrations/github",
  ACCOUNT_INTEGRATIONS_CONNECTED: "/api/account/integrations/connected",
  INBOX: "/api/inbox",
  INBOX_READ: "/api/inbox/read",
  LIVE_INBOX: "/api/live/inbox",
  LIVE_INBOX_ITEMS: "/api/live/inbox-items",
  LIVE_TASK_RECORD: "/api/live/task-record",
  LIVE_TASK_PAGES: "/api/live/task-pages",
  LIVE_AGENT_PAGES: "/api/live/agent-pages",
  LIVE_AGENT_ORIGIN: "/api/live/agent-origin",
  LIVE_TASK_HISTORY: "/api/live/task-history",
  LIVE_TASK_COMMENTS: "/api/live/task-comments",
  LIVE_TASK_BROWSER_TABS: "/api/live/task-browser-tabs",
  LIVE_AGENT_BROWSER_TABS: "/api/live/agent-browser-tabs",
  LIVE_AGENT_TRANSCRIPT: "/api/live/agent-transcript",
  LIVE_TASK_INBOX: "/api/live/task-inbox",
  LIVE_AGENT_INBOX: "/api/live/agent-inbox",
  LIVE_TASKS: "/api/live/tasks",
  LIVE_AUTOMATIONS: "/api/live/automations",
  LIVE_AUTOMATION_RUNS: "/api/live/automation-runs",
  LIVE_AUTOMATION_WORKSPACE_RUNS: "/api/live/automation-workspace-runs",
  LIVE_WORKSPACES: "/api/live/workspaces",
  LIVE_SIDEBAR: "/api/live/sidebar",
  LIVE_WORKSPACE_MEMBERS: "/api/live/workspace-members",
  LIVE_WORKSPACE_INVITATIONS: "/api/live/workspace-invitations",
  LIVE_WORKSPACE_MEMORIES: "/api/live/workspace-memories",
  LIVE_WORKSPACE_INTEGRATIONS: "/api/live/workspace-integrations",
  LIVE_HOSTS: "/api/live/hosts",
  LIVE_PULL_REQUEST_CHAPTERS: "/api/live/pull-request-chapters",
  LIVE_INSTALLED_SKILLS: "/api/live/installed-skills",
  LIVE_INTEGRATION_STATUSES: "/api/live/integration-statuses",
  LIVE_ACCOUNT_PREFERENCES: "/api/live/account-preferences",
  AGENTS: "/api/agents",
  RUNNER_TOKEN: "/api/agents/runner-token",
  DEVICE_AGENT_DEVICES: "/api/device-agents/devices",
  DEVICE_AGENT_PRESENCE: "/api/device-agents/presence",
  DEVICE_AGENT_LINES: "/api/device-agents/lines",
  DEVICE_AGENT_LINE_CLAIM: "/api/device-agents/lines/claim",
  DEVICE_AGENT_LINE_STEP: "/api/device-agents/lines/step",
  DEVICE_AGENT_REQUESTS: "/api/device-agents/requests",
  DEVICE_AGENT_REQUEST_CLAIM: "/api/device-agents/requests/claim",
  DEVICE_AGENT_LIVE_AGENTS: "/api/device-agents/live-agents",
  DEVICE_AGENT_ENROLL_OWN: "/api/device-agents/devices/enroll",
  DEVICE_AGENT_LEAVE: "/api/device-agents/devices/leave",
  HOST_PAIRING_START: "/api/device-agents/pairing",
  HOST_PAIRING_POLL: "/api/device-agents/pairing/poll",
  HOSTS: "/api/hosts",
  DEVICE_PRESENCE: "/api/hosts/presence",
  HOST_REMOVE: "/api/hosts/remove",
  HOST_PAIRING: "/api/hosts/pairing",
  HOST_PAIRING_APPROVE: "/api/hosts/pairing/approve",
  HOST_PAIRING_DENY: "/api/hosts/pairing/deny",
  MAC_COMMANDS: "/api/mac-commands",
  MAC_COMMAND_CLAIM: "/api/mac-commands/claim",
  MAC_COMMANDS_LISTENING: "/api/mac-commands/listening",
  LIVE_MAC_COMMANDS: "/api/live/mac-commands",
  AUTOMATIONS: "/api/automations",
  INSTALLED_SKILLS: "/api/installed-skills",
  MODELS: "/api/models",
  TASKS: "/api/plans",
  REPOSITORY_PINS: "/api/repository-pins",
  TASK_SECTIONS: "/api/task-sections",
  GITHUB_REPOSITORIES: "/api/github/repositories",
  GITHUB_REPOSITORY_TREE: "/api/github/repositories/tree",
  GITHUB_REPOSITORY_FILE: "/api/github/repositories/file",
  GITHUB_REPOSITORY_SKILLS: "/api/github/repositories/skills",
  GITHUB_REPOSITORY_PULL_REQUEST: "/api/github/repositories/pull-request",
  GITHUB_REPOSITORY_ISSUE: "/api/github/repositories/issue",
  GITHUB_INSTALL: "/api/github/install",
  GITHUB_INSTALLED: "/api/github/installed",
  GITHUB_INSTALLED_AUTHORIZED: "/api/github/installed/authorized",
  GITHUB_CONNECT: "/api/github/connect",
  GITHUB_CONNECT_CLAIM: "/api/github/connect/claim",
  GITHUB_TOKEN: "/api/github/token",
  GITHUB_TOKEN_REPOSITORIES: "/api/github/token-repositories",
  GITHUB_CONNECTION: "/api/github/connection",
  GITHUB_DISCONNECT: "/api/github/disconnect",
  WORKSPACES: "/api/workspaces",
  WORKSPACE_GITHUB_CONNECT: "/api/workspaces/github/connect",
  WORKSPACE_GITHUB_DISCONNECT: "/api/workspaces/github/disconnect",
  WORKSPACE_SENTRY_INSTALL: "/api/workspaces/sentry/install",
  WORKSPACE_SENTRY_INSTALLATIONS: "/api/workspaces/sentry/installations",
  WORKSPACE_SENTRY_DISCONNECT: "/api/workspaces/sentry/disconnect",
  WORKSPACE_SLACK_BOT: "/api/workspaces/slack-bot",
  WORKSPACE_SLACK_BOT_CONNECT: "/api/workspaces/slack-bot/connect",
  WORKSPACE_SLACK_BOT_DISCONNECT: "/api/workspaces/slack-bot/disconnect",
  WORKSPACE_SLACK_BOT_NOTIFICATIONS: "/api/workspaces/slack-bot/notifications",
  WORKSPACE_SLACK_BOT_REPOSITORY: "/api/workspaces/slack-bot/repository",
  WORKSPACE_SLACK_BOT_CHANNEL: "/api/workspaces/slack-bot/channel",
  SENTRY_INSTALLED: "/api/triggers/sentry/installed",
  WORKSPACES_RENAME: "/api/workspaces/rename",
  WORKSPACES_SLUG_SET: "/api/workspaces/slug/set",
  WORKSPACES_PHOTO_SET: "/api/workspaces/photo/set",
  WORKSPACES_MEMBERS: "/api/workspaces/members",
  WORKSPACES_MEMBERS_REMOVE: "/api/workspaces/members/remove",
  WORKSPACES_MEMBERS_ROLE: "/api/workspaces/members/role",
  WORKSPACES_TRANSFER: "/api/workspaces/transfer",
  WORKSPACES_LEAVE: "/api/workspaces/leave",
  WORKSPACES_INVITATIONS: "/api/workspaces/invitations",
  WORKSPACES_INVITATIONS_CANCEL: "/api/workspaces/invitations/cancel",
  WORKSPACES_INVITATION_OFFER: "/api/workspaces/invitations/offer",
} as const;

export function automationPath(automationId: string): string {
  return `${HOSTED_SERVICE_PATH.AUTOMATIONS}/${encodeURIComponent(automationId)}`;
}

export function installedSkillPath(skillId: string): string {
  return `${HOSTED_SERVICE_PATH.INSTALLED_SKILLS}/${encodeURIComponent(skillId)}`;
}

export function automationWebhookPath(automationId: string): string {
  return `${automationPath(automationId)}/webhook`;
}

function taskPath(taskId: string): string {
  return `${HOSTED_SERVICE_PATH.TASKS}/${encodeURIComponent(taskId)}`;
}

export interface RepositoryPlace {
  readonly workspaceId: string;
  readonly repository: string;
}

export interface SkillsPlace {
  readonly workspaceId: string;
  readonly repository?: string;
}

function descriptionAttachmentsPath(taskId: string): string {
  return `${taskPath(taskId)}/attachments`;
}

export function descriptionAttachmentPath(taskId: string, attachmentId: string): string {
  return `${descriptionAttachmentsPath(taskId)}/${encodeURIComponent(attachmentId)}`;
}

function inboxItemPath(itemId: string): string {
  return `/api/inbox/${encodeURIComponent(itemId)}`;
}

export function workspacePhotoPath(workspaceId: string): string {
  return `${HOSTED_SERVICE_PATH.WORKSPACES}/${encodeURIComponent(workspaceId)}/photo`;
}

export function inboxAttachmentPath(itemId: string, attachmentId: string): string {
  return `${inboxItemPath(itemId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

export function agentPicturePath(agentId: string, pictureId: string, callId?: string): string {
  const agent = `/api/agents/${encodeURIComponent(agentId)}`;
  const owner = callId === undefined ? agent : `${agent}/subagents/${encodeURIComponent(callId)}`;
  return `${owner}/pictures/${encodeURIComponent(pictureId)}`;
}

export function agentGitHubImagePath(agentId: string, src: string): string {
  return `/api/agents/${encodeURIComponent(agentId)}/github-image?${new URLSearchParams({ src })}`;
}
