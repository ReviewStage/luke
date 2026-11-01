/**
 * tasks-list.ts -- 0.20.0 shot "The Tasks page, assignees, and Mark done": the Tasks page's List grouped by status, each row with its priority, key, repository, assignee's face, and creator's face.
 *
 * Throwaway (`README.md`). 0.19.0's Board tasks (`board.ts`), each given an
 * assignee who is often not its creator, a few left unassigned so the dashed
 * mark shows. The List's display is written where the page reads it at mount:
 * grouped by status, ordered by priority, Done tasks of the past week shown,
 * and the creator column on beside the assignee.
 */

import { ACT_KIND } from "@luke/host/acts";
import { FIXTURE_CLOSED_PANEL } from "../tasks/tasks-fixture";
import { assigned, moreTasks, standingPlan, standingPlans } from "./board";
import { codingAgentAnswers } from "./coding-agent";
import { SHOT_ID, shotTasksView } from "./plan-document";
import type { ShotSpec } from "./shot-spec";
import { acmeMembers, MEMBER, whoWorkspaces } from "./who";


/** The List's display as the page reads it at mount. */
const LIST_DISPLAY = {
  grouping: "status",
  order: "priority",
  emptyGroups: false,
  completed: "past-week",
  pinnedFirst: false,
  properties: ["priority", "key", "status", "repository", "assignee", "creator", "agents", "updated"],
  offered: ["priority", "key", "status", "waiting", "repository", "assignee", "creator", "agents", "updated"],
};

export function tasksListShot(): ShotSpec {
  const members = acmeMembers();
  const plans = [...standingPlans(), ...moreTasks().map(assigned)];
  return {
    planning: shotTasksView({
      plan: standingPlan(),
      plans,
      extra: { workspaces: whoWorkspaces(members.length) },
    }),
    sidePanel: FIXTURE_CLOSED_PANEL,
    readerId: MEMBER.DEAN.userId,
    answers: {
      ...codingAgentAnswers(),
      [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => members,
      [ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: () => [],
    },
    steps: [
      {
        key: "tasks-list",
        ready: ({ plans: control }) => control.tasks.some((plan) => plan.id === SHOT_ID.PLAN),
        run: ({ plans: control }) => {
          localStorage.setItem("luke.tasksPageView", JSON.stringify("list"));
          localStorage.setItem("luke.tasksListDisplay", JSON.stringify(LIST_DISPLAY));
          control.boardView.onOpen();
        },
      },
    ],
  };
}
