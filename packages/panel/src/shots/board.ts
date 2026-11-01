/**
 * board.ts -- 0.19.0 shot "Task status, priority, and the Board": acme's tasks on the Board, laid out by status, each card with its key, creator, priority, status, and repository, beside the sidebar's rows wearing their status marks.
 *
 * Throwaway (`README.md`). The sidebar open; the Board opened by one step
 * as its sidebar row opens it. acme's tasks (`team-world.ts`) each take a
 * key, a status, and a priority, and twelve more join them so every column
 * holds four or more: Backlog, Todo, In progress, and Done.
 */

import type { Task, TaskSummary } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import { FIXTURE_CLOSED_PANEL } from "../tasks/tasks-fixture";
import { daysAgo, hoursAgo } from "./clock";
import { codingAgentAnswers } from "./coding-agent";
import { SHOT_ID, shotPlan, shotTasksView } from "./plan-document";
import type { ShotSpec } from "./shot-spec";
import { teamPlans } from "./team-world";
import { acmeMembers, MEMBER, whoWorkspaces } from "./who";

type Standing = Pick<TaskSummary, "status" | "priority" | "number">;

/** Where each of acme's tasks stands. */
export const STANDING: Readonly<Record<string, Standing>> = {
  [SHOT_ID.PLAN]: { status: "in-progress", priority: "high", number: 42 },
  [SHOT_ID.BILLING]: { status: "in-progress", priority: "urgent", number: 40 },
  [SHOT_ID.ONBOARDING]: { status: "in-progress", priority: "medium", number: 41 },
  [SHOT_ID.AUDIT]: { status: "todo", priority: "medium", number: 45 },
  [SHOT_ID.WEBHOOKS]: { status: "done", priority: "high", number: 38 },
  [SHOT_ID.RATE_LIMITS]: { status: "done", priority: "low", number: 36 },
  [SHOT_ID.DARK_MODE]: { status: "backlog", priority: "low", number: 47 },
};

/** The tasks the Board adds to acme's, filed or finished, none of them with agents of their own. */
export function moreTasks(): TaskSummary[] {
  const task = (
    id: string,
    name: string,
    repository: string,
    createdBy: (typeof MEMBER)[keyof typeof MEMBER],
    standing: Standing,
    updatedAt: number,
  ): TaskSummary => ({
    workspaceId: SHOT_ID.WORKSPACE,
    id,
    name,
    repository,
    createdAt: updatedAt,
    updatedAt,
    createdBy,
    ownerId: createdBy.userId,
    ...standing,
  });
  return [
    task("a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f01", "Expire invite links after 7 days", "acme/relay", MEMBER.DEAN, { status: "todo", priority: "high", number: 46 }, hoursAgo(1)),
    task("a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f02", "Handle Postmark bounces", "acme/relay", MEMBER.DANA, { status: "todo", priority: "medium", number: 43 }, hoursAgo(6)),
    task("a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f03", "Seat-based plan for Harbor", "acme/ledger", MEMBER.DANA, { status: "backlog", priority: "medium", number: 48 }, daysAgo(1)),
    task("a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f04", "Slack alert for failing webhooks", "acme/relay", MEMBER.JORDAN, { status: "backlog", priority: "none", number: 49 }, daysAgo(2)),
    task("a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f05", "Members page empty state", "acme/web", MEMBER.PRIYA, { status: "done", priority: "low", number: 39 }, daysAgo(2)),
    task("a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f06", "Show the invoice's tax lines", "acme/ledger", MEMBER.THEO, { status: "backlog", priority: "low", number: 50 }, daysAgo(3)),
    task("a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f07", "Resend an expired invite", "acme/relay", MEMBER.DANA, { status: "todo", priority: "medium", number: 44 }, hoursAgo(3)),
    task("a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f08", "Usage alert at 80% of the plan", "acme/ledger", MEMBER.THEO, { status: "todo", priority: "low", number: 52 }, daysAgo(1)),
    task("a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f09", "Rotate webhook signing secrets", "acme/relay", MEMBER.JORDAN, { status: "in-progress", priority: "high", number: 51 }, hoursAgo(2)),
    task("a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f0a", "Retry Postmark sends on a 429", "acme/relay", MEMBER.DANA, { status: "done", priority: "high", number: 34 }, daysAgo(1)),
    task("a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f0b", "Dashboard nav on small screens", "acme/web", MEMBER.THEO, { status: "done", priority: "medium", number: 35 }, daysAgo(4)),
    task("a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f0c", "Audit log retention setting", "acme/relay", MEMBER.JORDAN, { status: "backlog", priority: "none", number: 53 }, daysAgo(5)),
  ];
}

/** Who each task is assigned to, by its id; a task not named here is unassigned. */
const ASSIGNEE: Readonly<Record<string, TaskSummary["assignee"]>> = {
  [SHOT_ID.PLAN]: MEMBER.DEAN,
  [SHOT_ID.BILLING]: MEMBER.THEO,
  [SHOT_ID.ONBOARDING]: MEMBER.PRIYA,
  [SHOT_ID.AUDIT]: MEMBER.PRIYA,
  [SHOT_ID.WEBHOOKS]: MEMBER.JORDAN,
  [SHOT_ID.RATE_LIMITS]: MEMBER.JORDAN,
  "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f09": MEMBER.DANA,
  "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f01": MEMBER.JORDAN,
  "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f02": MEMBER.DEAN,
  "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f07": MEMBER.PRIYA,
  "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f08": MEMBER.DANA,
  "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f06": MEMBER.DANA,
  "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f0a": MEMBER.PRIYA,
  "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f0b": MEMBER.DEAN,
  "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f05": MEMBER.THEO,
};

/** A task as it stands in 0.20.0's world: assigned where {@link ASSIGNEE} names someone. */
export function assigned(task: TaskSummary): TaskSummary {
  const assignee = ASSIGNEE[task.id];
  return assignee === undefined ? task : { ...task, assignee };
}

/** acme's tasks with their keys, statuses, priorities, and assignees, as every shot from 0.20.0 on lists them. */
export function standingPlans(): TaskSummary[] {
  return teamPlans().map((plan) => assigned({ ...plan, ...STANDING[plan.id] }));
}

/** Teammate invitations as it stands: Dean's, assigned to him, in progress. */
export function standingPlan(overrides: Partial<Task> = {}): Task {
  return shotPlan({
    ownerId: MEMBER.DEAN.userId,
    createdBy: MEMBER.DEAN,
    assignee: MEMBER.DEAN,
    ...STANDING[SHOT_ID.PLAN],
    ...overrides,
  });
}

export function boardShot(): ShotSpec {
  const members = acmeMembers();
  const plans = [
    ...teamPlans().map((plan) => ({ ...plan, ...STANDING[plan.id] })),
    ...moreTasks(),
  ];
  return {
    planning: shotTasksView({
      plan: shotPlan({ ownerId: MEMBER.DEAN.userId, createdBy: MEMBER.DEAN, ...STANDING[SHOT_ID.PLAN] }),
      plans,
      extra: { workspaces: whoWorkspaces(members.length) },
    }),
    sidePanel: FIXTURE_CLOSED_PANEL,
    readerId: MEMBER.DEAN.userId,
    answers: {
      ...codingAgentAnswers(),
      [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => members,
    },
    steps: [
      {
        key: "board",
        ready: ({ plans: control }) => control.tasks.some((plan) => plan.id === SHOT_ID.PLAN),
        run: ({ plans: control }) => control.boardView.onOpen(),
      },
    ],
  };
}
