/**
 * tables.ts -- every table Luke Sync captures, as one list the drift check and the migration writer read.
 *
 * A table is synced by declaring it here (`defineSyncTable`) and writing
 * its capture into a migration (`pnpm --filter @luke/database sync:render`);
 * the drift check (`__tests__/capture.test.ts`) then fails until the migrated
 * database carries exactly what these declarations render. Each table is
 * declared once, for every view that reads it: a view's live read names
 * these declarations in its `reads`, so a table one view synced first is
 * the same capture the next view reads.
 *
 * Beside the tables a view draws from stand the ones every read of a task
 * or an agent is gated on (`workspace-store.ts`): the account's membership
 * of the workspace, and, for one reached on a member's own GitHub token,
 * that member's token and what GitHub last answered it of a repository. A
 * write to them notifies the account it moves, so a read the account loses
 * is woken and answers without it.
 */
import { member } from "../schemas/auth.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { githubPersonalToken } from "../schemas/github-personal-token.js";
import { githubRepositoryRead } from "../schemas/github-repository-read.js";
import { repositoryPin } from "../schemas/repository-pin.js";
import { task } from "../schemas/task.js";
import { agentSectionEntry, taskSection, taskSectionEntry } from "../schemas/task-section.js";
import { TOPIC } from "./notification.js";
import { defineSyncTable, type SyncTable } from "./sync-table.js";

/**
 * A task, on its own topic and its workspace's. Note that the plan's text
 * and the agents' journal of saves are ignored, because every save rewrites
 * both and no view reads them live: a save moves `updated_at` beside them,
 * which the task list and the task's record read, so a save still notifies.
 */
export const taskSync = defineSyncTable(task, {
  topics: [
    { kind: TOPIC.TASK, column: task.id },
    { kind: TOPIC.WORKSPACE, column: task.organizationId },
  ],
  ignore: [task.document, task.agentEdits],
});

/**
 * A coding agent, on its own topic, its task's, and its workspace's. Note
 * that its last step is ignored, because every model step rewrites it, and
 * so is when its pull request was last read, because every read of the pull
 * request rewrites that; no view reads either live.
 */
export const codingAgentSync = defineSyncTable(codingAgent, {
  topics: [
    { kind: TOPIC.AGENT, column: codingAgent.id },
    { kind: TOPIC.TASK, column: codingAgent.taskId },
    { kind: TOPIC.WORKSPACE, column: codingAgent.organizationId },
  ],
  ignore: [codingAgent.lastStep, codingAgent.publishedRead],
});

/** An account's membership of a workspace, on the workspace's topic and the account's. */
export const memberSync = defineSyncTable(member, {
  topics: [
    { kind: TOPIC.WORKSPACE, column: member.organizationId },
    { kind: TOPIC.ACCOUNT, column: member.userId },
  ],
});

/** A member's own GitHub token, on the member's topic. */
export const githubPersonalTokenSync = defineSyncTable(githubPersonalToken, {
  topics: [{ kind: TOPIC.ACCOUNT, column: githubPersonalToken.userId }],
});

/**
 * What GitHub last answered a member's token of a repository, on the
 * member's topic. Note that when it was asked is ignored, because the
 * hourly ask rewrites it (`github/repository-reads.ts`) while the answer
 * mostly stands, and no read gates on it.
 */
export const githubRepositoryReadSync = defineSyncTable(githubRepositoryRead, {
  topics: [{ kind: TOPIC.ACCOUNT, column: githubRepositoryRead.userId }],
  ignore: [githubRepositoryRead.checkedAt],
});

/** One of an account's sidebar sections, on the account's topic. */
export const taskSectionSync = defineSyncTable(taskSection, {
  topics: [{ kind: TOPIC.ACCOUNT, column: taskSection.userId }],
});

/** A task an account keeps in one of its sections, on the account's topic. */
export const taskSectionEntrySync = defineSyncTable(taskSectionEntry, {
  topics: [{ kind: TOPIC.ACCOUNT, column: taskSectionEntry.userId }],
});

/** An agent with no task an account keeps in one of its sections, on the account's topic. */
export const agentSectionEntrySync = defineSyncTable(agentSectionEntry, {
  topics: [{ kind: TOPIC.ACCOUNT, column: agentSectionEntry.userId }],
});

/** A repository an account pinned to its sidebar, on the account's topic. */
export const repositoryPinSync = defineSyncTable(repositoryPin, {
  topics: [{ kind: TOPIC.ACCOUNT, column: repositoryPin.userId }],
});

export const SYNC_TABLES: readonly SyncTable[] = [
  taskSync,
  codingAgentSync,
  memberSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  taskSectionSync,
  taskSectionEntrySync,
  agentSectionEntrySync,
  repositoryPinSync,
];
