/**
 * task-marks.ts -- 0.23.0 shot "One mark for how a task stands": the sidebar's tasks, each row ending in the one mark for how its agents stand: working, failed, or its pull request open, draft, merged, or closed.
 *
 * Throwaway (`README.md`). Ten of acme's tasks, every one Dean's and to do or
 * in progress, so the sidebar's default view lists them all with no line
 * for hidden ones; each task's agents are reshaped so acme/relay's group
 * alone wears all six marks. The side panel closed; framed as a close-up of
 * the sidebar.
 */

import type { TaskAgentsSummary, TaskPullRequestLine, TaskSummary } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import { FIXTURE_CLOSED_PANEL } from "../tasks/tasks-fixture";
import { moreTasks, standingPlan, standingPlans } from "./board";
import { ago, hoursAgo } from "./clock";
import { codingAgentAnswers, MODEL } from "./coding-agent";
import { SHOT_ID, shotTasksView } from "./plan-document";
import type { ShotSpec } from "./shot-spec";
import { acmeMembers, MEMBER, whoWorkspaces } from "./who";

/** The board's tasks this shot lists (`board.ts`). */
const TASK = {
  EXPIRE_LINKS: "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f01",
  POSTMARK_BOUNCES: "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f02",
  RESEND_EXPIRED: "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f07",
  USAGE_ALERT: "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f08",
  ROTATE_SECRETS: "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f09",
} as const;

type AgentStatus = TaskAgentsSummary["agents"][number]["status"];

/** One pull request line, its checks passing. */
function pr(number: number, title: string, state: TaskPullRequestLine["state"]): TaskPullRequestLine {
  return { number, title, state, checks: "passing", additions: 96, deletions: 12 };
}

/** A task's one agent, standing as `status`, with what it opened. */
function agents(
  id: string,
  title: string,
  status: AgentStatus,
  at: number,
  pullRequests: TaskPullRequestLine[] = [],
): TaskAgentsSummary {
  return {
    total: 1,
    working: status === "running" ? 1 : 0,
    ...(status === "failed" ? { failed: 1 } : undefined),
    activityAt: at,
    agents: [{ id, title, model: MODEL.OPUS, effort: "high", status, at }],
    pullRequestTotal: pullRequests.length,
    pullRequests,
  };
}

/** How one listed task stands. */
interface Stand {
  readonly status: NonNullable<TaskSummary["status"]>;
  readonly updatedAt: number;
  readonly agents: TaskAgentsSummary | undefined;
}

/** How each listed task stands: its status in the sidebar, when it moved, and its agents. */
const STANDS: ReadonlyMap<string, Stand> = new Map<string, Stand>([
  [SHOT_ID.PLAN, { status: "in-progress", updatedAt: ago(4), agents: agents("d1e2f3a4-0001-4b5c-8d9e-0f1a2b3c4d01", "Invite emails", "running", ago(1)) }],
  [TASK.ROTATE_SECRETS, { status: "in-progress", updatedAt: ago(18), agents: agents("d1e2f3a4-0002-4b5c-8d9e-0f1a2b3c4d02", "Rotate signing secrets", "failed", ago(18)) }],
  [TASK.RESEND_EXPIRED, { status: "in-progress", updatedAt: ago(41), agents: agents("d1e2f3a4-0003-4b5c-8d9e-0f1a2b3c4d03", "Resend an expired invite", "completed", ago(41), [pr(218, "Resend an expired invite", "open")]) }],
  [SHOT_ID.WEBHOOKS, { status: "in-progress", updatedAt: hoursAgo(2), agents: agents("d1e2f3a4-0004-4b5c-8d9e-0f1a2b3c4d04", "Retry failed webhook deliveries", "completed", hoursAgo(2), [pr(209, "Retry failed webhook deliveries", "merged")]) }],
  [TASK.EXPIRE_LINKS, { status: "todo", updatedAt: hoursAgo(3), agents: agents("d1e2f3a4-0005-4b5c-8d9e-0f1a2b3c4d05", "Expire invite links", "completed", hoursAgo(3), [pr(217, "Expire invite links after 7 days", "draft")]) }],
  [TASK.POSTMARK_BOUNCES, { status: "todo", updatedAt: hoursAgo(6), agents: agents("d1e2f3a4-0006-4b5c-8d9e-0f1a2b3c4d06", "Handle Postmark bounces", "completed", hoursAgo(6), [pr(212, "Unsubscribe on a hard bounce", "closed")]) }],
  [SHOT_ID.BILLING, { status: "in-progress", updatedAt: ago(26), agents: agents("d1e2f3a4-0007-4b5c-8d9e-0f1a2b3c4d07", "Meter API calls per workspace", "completed", ago(26), [pr(88, "Record usage events per workspace", "open")]) }],
  [TASK.USAGE_ALERT, { status: "todo", updatedAt: hoursAgo(20), agents: undefined }],
  [SHOT_ID.ONBOARDING, { status: "in-progress", updatedAt: hoursAgo(5), agents: agents("d1e2f3a4-0008-4b5c-8d9e-0f1a2b3c4d08", "Build the onboarding checklist", "running", ago(3)) }],
  [SHOT_ID.AUDIT, { status: "todo", updatedAt: hoursAgo(26), agents: agents("d1e2f3a4-0009-4b5c-8d9e-0f1a2b3c4d09", "Export the audit log", "completed", hoursAgo(26), [pr(135, "Export the audit log as CSV", "merged")]) }],
]);

/** The listed tasks, Dean's, as they stand here. */
function markedTasks(): TaskSummary[] {
  return [...standingPlans(), ...moreTasks()].flatMap((task) => {
    const stands = STANDS.get(task.id);
    if (stands === undefined) return [];
    const { agents: shown, ...rest } = stands;
    const { agents: _agents, ...row } = task;
    return [{ ...row, ...rest, ...(shown === undefined ? undefined : { agents: shown }), assignee: MEMBER.DEAN }];
  });
}

export function taskMarksShot(): ShotSpec {
  const members = acmeMembers();
  return {
    planning: shotTasksView({
      plan: standingPlan(),
      plans: markedTasks(),
      extra: { workspaces: whoWorkspaces(members.length) },
    }),
    sidePanel: FIXTURE_CLOSED_PANEL,
    readerId: MEMBER.DEAN.userId,
    answers: {
      ...codingAgentAnswers(),
      [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => members,
      [ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: () => [],
    },
    layout: { sidebarCollapsed: false },
  };
}
