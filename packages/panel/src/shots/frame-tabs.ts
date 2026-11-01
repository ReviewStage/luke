/**
 * frame-tabs.ts -- 0.21.0 shot "Tabs on the window's frame": Teammate invitations on its finished agent's tab, the tab row standing on the frame level with the traffic lights, and the side panel beside it on #214's Files changed, each in a sheet of its own.
 *
 * Throwaway (`README.md`). #214 written out file by file (`pr-214.ts`,
 * `pr-214-tab.ts`); one step opens the agent's Pull request tab in the side
 * panel on Files changed.
 */

import { ACT_KIND } from "@luke/host/acts";
import { FIXTURE_CODE_PANEL } from "../tasks/tasks-fixture";
import { PULL_REQUEST_VIEW } from "../tasks/use-side-panel";
import { standingPlan, standingPlans } from "./board";
import { ago } from "./clock";
import { FILES } from "./pr-214";
import { pr214TabAnswers } from "./pr-214-tab";
import { SHOT_ID, shotTasksView } from "./plan-document";
import type { ShotSpec } from "./shot-spec";
import { acmeMembers, MEMBER, whoWorkspaces } from "./who";

export function frameTabsShot(): ShotSpec {
  const members = acmeMembers();
  const viewed = new Set(FILES.slice(0, 2).map((file) => file.path));
  return {
    planning: shotTasksView({ plan: standingPlan(), plans: standingPlans(), extra: { workspaces: whoWorkspaces(members.length) } }),
    sidePanel: { ...FIXTURE_CODE_PANEL, width: 820 },
    readerId: MEMBER.DEAN.userId,
    answers: {
      ...pr214TabAnswers({ viewed }),
      [ACT_KIND.CODING_AGENTS_OVERVIEW_CHECKS]: (payload) =>
        payload.agentId !== SHOT_ID.AGENT
          ? undefined
          : {
              pullRequest: {
                checks: [
                  { name: "test", app: "GitHub Actions", state: "passed", url: null, startedAt: ago(30), completedAt: ago(27) },
                  { name: "lint", app: "GitHub Actions", state: "passed", url: null, startedAt: ago(30), completedAt: ago(29) },
                ],
              },
            },
    },
    layout: { mainTab: { agent: SHOT_ID.AGENT } },
    steps: [
      {
        key: "pull-request-files",
        ready: ({ plans }) => plans.agents.agentIds?.includes(SHOT_ID.AGENT) ?? false,
        run: ({ plans }) => {
          plans.sidePanel.onPullRequestView({ changes: SHOT_ID.AGENT }, PULL_REQUEST_VIEW.FILES);
          plans.sidePanel.onChoose({ changes: SHOT_ID.AGENT });
        },
      },
    ],
  };
}
