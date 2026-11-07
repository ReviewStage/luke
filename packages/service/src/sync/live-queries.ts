/**
 * live-queries.ts -- every live read Sync wakes, by its name, as one registry the registry test reads.
 *
 * Each read is declared once (`@repo/features/live-read`) and bound once
 * (`../live/live-read-binding.ts`, one file under `../live/reads/` each),
 * and its binding stands here.
 */
import { type AnyBoundRead, liveReadRegistry } from "../live/live-read-binding.js";
import { accountInboxRead } from "../live/reads/account-inbox.js";
import { accountPreferencesRead } from "../live/reads/account-preferences.js";
import { agentOriginRead } from "../live/reads/agent-origin.js";
import { agentTranscriptRead } from "../live/reads/agent-transcript.js";
import {
  automationRunsRead,
  automationsRead,
  automationWorkspaceRunsRead,
} from "../live/reads/automations.js";
import { agentBrowserTabsRead, taskBrowserTabsRead } from "../live/reads/browser-tabs.js";
import { hostsRead } from "../live/reads/hosts.js";
import { inboxItemsRead } from "../live/reads/inbox-items.js";
import { installedSkillsRead } from "../live/reads/installed-skills.js";
import { integrationStatusesRead } from "../live/reads/integration-statuses.js";
import { macCommandsRead } from "../live/reads/mac-commands.js";
import { agentPagesRead, taskPagesRead } from "../live/reads/pages.js";
import { pullRequestChaptersRead } from "../live/reads/pull-request-chapters.js";
import { agentInboxRead, taskInboxRead } from "../live/reads/scope-inbox.js";
import { sidebarRead } from "../live/reads/sidebar.js";
import { taskCommentsRead } from "../live/reads/task-comments.js";
import { taskHistoryRead } from "../live/reads/task-history.js";
import { taskRecordRead } from "../live/reads/task-record.js";
import { tasksRead } from "../live/reads/tasks.js";
import { workspaceIntegrationsRead } from "../live/reads/workspace-integrations.js";
import { workspaceInvitationsRead } from "../live/reads/workspace-invitations.js";
import { workspaceMembersRead } from "../live/reads/workspace-members.js";
import { workspaceMemoriesRead } from "../live/reads/workspace-memories.js";
import { workspacesRead } from "../live/reads/workspaces.js";

/** Every live read, declared once and bound (`../live/live-read-binding.ts`). */
export const BOUND_READS: readonly AnyBoundRead[] = [
  tasksRead,
  accountInboxRead,
  inboxItemsRead,
  taskInboxRead,
  agentInboxRead,
  agentTranscriptRead,
  hostsRead,
  agentOriginRead,
  taskPagesRead,
  agentPagesRead,
  taskHistoryRead,
  taskRecordRead,
  taskCommentsRead,
  taskBrowserTabsRead,
  agentBrowserTabsRead,
  macCommandsRead,
  integrationStatusesRead,
  sidebarRead,
  workspaceIntegrationsRead,
  workspaceInvitationsRead,
  workspaceMembersRead,
  workspacesRead,
  installedSkillsRead,
  accountPreferencesRead,
  workspaceMemoriesRead,
  automationsRead,
  automationWorkspaceRunsRead,
  automationRunsRead,
  pullRequestChaptersRead,
];

export const LIVE_QUERIES = liveReadRegistry(BOUND_READS);
