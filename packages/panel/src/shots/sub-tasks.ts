/**
 * sub-tasks.ts -- 0.24.0 shot "Sub-tasks and blocked tasks": the sidebar open with Teammate invitations unfolded over its sub-tasks, one wearing the stop sign, and the ring counting those done; the task's head grouping its sub-tasks and its relations.
 *
 * Throwaway (`README.md`). Teammate invitations (ACME-42) breaks into five
 * sub-tasks, two of them done, all Dean's, so the sidebar's "Assigned to: Me"
 * nests the three still open under it and its ring reads 2/5. Invite emails
 * through Postmark waits on Verify acme.dev with Postmark, Dana's, so it wears
 * the stop sign. The task itself waited on Members page empty state, done
 * since, and holds up Resend an expired invite and Handle Postmark bounces.
 * The plan fills the window beside the sidebar, so its head stands in front;
 * one step unfolds the sidebar row, which a fixture run starts folded.
 */

import type { TaskSummary } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import { FIXTURE_CODE_PANEL } from "../tasks/tasks-fixture";
import { assigned, moreTasks, standingPlan, standingPlans } from "./board";
import { ago, daysAgo, hoursAgo } from "./clock";
import { codingAgentAnswers } from "./coding-agent";
import { pressStep } from "./dom-steps";
import { PLAN_REPOSITORY, SHOT_ID, shotTasksView } from "./plan-document";
import type { ShotSpec } from "./shot-spec";
import { acmeMembers, MEMBER, whoWorkspaces } from "./who";

/** The tasks this shot adds to acme's, by id. */
const SUB = {
  SCHEMA: "c2a1e3f5-7b9d-4c1e-8a3f-5b7d9e1f3a01",
  ENDPOINTS: "c2a1e3f5-7b9d-4c1e-8a3f-5b7d9e1f3a02",
  ACCEPT_PAGE: "c2a1e3f5-7b9d-4c1e-8a3f-5b7d9e1f3a03",
  EMAILS: "c2a1e3f5-7b9d-4c1e-8a3f-5b7d9e1f3a04",
  VERIFY_DOMAIN: "c2a1e3f5-7b9d-4c1e-8a3f-5b7d9e1f3a05",
} as const;

/** The board's tasks this shot names (`board.ts`). */
const EXPIRE_LINKS = "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f01";
const POSTMARK_BOUNCES = "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f02";
const MEMBERS_EMPTY_STATE = "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f05";
const RESEND_EXPIRED = "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f07";

/** One of Teammate invitations' sub-tasks, Dean's, as New sub-task makes it. */
function subTask(
  id: string,
  name: string,
  standing: Pick<TaskSummary, "status" | "priority" | "number">,
  createdAt: number,
  updatedAt: number,
  extra: Partial<TaskSummary> = {},
): TaskSummary {
  return {
    workspaceId: SHOT_ID.WORKSPACE,
    id,
    name,
    repository: PLAN_REPOSITORY,
    createdAt,
    updatedAt,
    createdBy: MEMBER.DEAN,
    ownerId: MEMBER.DEAN.userId,
    assignee: MEMBER.DEAN,
    parentTaskId: SHOT_ID.PLAN,
    ...standing,
    ...extra,
  };
}

/** acme's tasks as 0.24.0 stands them: Teammate invitations broken into five sub-tasks, one blocked. */
function subTaskPlans(): TaskSummary[] {
  const board = moreTasks()
    .map(assigned)
    .map((task) => {
      if (task.id === EXPIRE_LINKS) {
        return { ...task, parentTaskId: SHOT_ID.PLAN, assignee: MEMBER.DEAN, createdAt: daysAgo(1.6) };
      }
      return task;
    });
  return [
    ...standingPlans(),
    ...board,
    subTask(SUB.SCHEMA, "Pending memberships schema", { status: "done", priority: "high", number: 54 }, daysAgo(2), daysAgo(1)),
    subTask(SUB.ENDPOINTS, "Invite and accept endpoints", { status: "done", priority: "high", number: 55 }, daysAgo(1.9), ago(12)),
    subTask(SUB.ACCEPT_PAGE, "Accept page", { status: "in-progress", priority: "medium", number: 56 }, daysAgo(1.8), ago(9)),
    subTask(
      SUB.EMAILS,
      "Invite emails through Postmark",
      { status: "todo", priority: "high", number: 57 },
      daysAgo(1.7),
      ago(6),
      { blocked: true },
    ),
    {
      workspaceId: SHOT_ID.WORKSPACE,
      id: SUB.VERIFY_DOMAIN,
      name: "Verify acme.dev with Postmark",
      repository: PLAN_REPOSITORY,
      createdAt: daysAgo(1.7),
      updatedAt: hoursAgo(2),
      createdBy: MEMBER.DANA,
      ownerId: MEMBER.DANA.userId,
      assignee: MEMBER.DANA,
      status: "in-progress",
      priority: "high",
      number: 58,
    },
  ];
}

export function subTasksShot(): ShotSpec {
  const members = acmeMembers();
  return {
    planning: shotTasksView({
      plan: standingPlan({ blockedBy: [MEMBERS_EMPTY_STATE], blocks: [RESEND_EXPIRED, POSTMARK_BOUNCES] }),
      plans: subTaskPlans(),
      extra: { workspaces: whoWorkspaces(members.length) },
    }),
    sidePanel: FIXTURE_CODE_PANEL,
    readerId: MEMBER.DEAN.userId,
    answers: {
      ...codingAgentAnswers(),
      [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => members,
      [ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: () => [],
    },
    layout: { sidebarCollapsed: false, sidePanelFullScreen: true },
    steps: [
      pressStep(
        "unfold-sub-tasks",
        'button.luke-list-row-fold[aria-label="Sub-tasks of Teammate invitations"]',
        1500,
      ),
    ],
  };
}
