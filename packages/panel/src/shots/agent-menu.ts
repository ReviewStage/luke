/**
 * agent-menu.ts -- 0.23.0 shot "One menu, in one order": the Add teammate invitations agent's ⋯ held open on its tab, its items in the one order every agent menu keeps, Copy link first and Permanently delete last.
 *
 * Throwaway (`README.md`). The sidebar folded and the side panel closed, the
 * column on the finished agent's transcript; one step presses its tab's ⋯
 * once the tab is drawn, and again whenever the capture's activation has
 * closed the menu, as `row-menu.ts` holds its own.
 */

import { FIXTURE_CLOSED_PANEL } from "../tasks/tasks-fixture";
import { standingPlan, standingPlans } from "./board";
import { codingAgentAnswers } from "./coding-agent";
import { AGENT_TITLE, SHOT_ID, shotTasksView } from "./plan-document";
import type { ShotSpec, ShotStep } from "./shot-spec";
import { acmeMembers, MEMBER, whoWorkspaces } from "./who";
import { ACT_KIND } from "@luke/host/acts";

/** How many times the menu is opened again before the step gives up. */
const MAX_OPENS = 12;

/** Opens the agent tab's ⋯ once drawn, and again whenever it has closed. */
const HOLD_MENU: ShotStep = {
  key: "agent-menu",
  ready: () => true,
  run: () => {
    let opens = 0;
    const check = (): void => {
      const button = document.querySelector<HTMLElement>(`button[aria-label="${AGENT_TITLE} actions"]`);
      if (button !== null && button.getAttribute("aria-expanded") !== "true" && opens < MAX_OPENS) {
        button.click();
        opens += 1;
        // The menu takes the focus to its first item, whose ring is not the point of the picture.
        window.setTimeout(() => {
          const focused = document.activeElement;
          if (focused instanceof HTMLElement && focused.closest('[role="menu"]') !== null) focused.blur();
        }, 300);
      }
    };
    window.setTimeout(() => window.setInterval(check, 1200), 2000);
  },
};

export function agentMenuShot(): ShotSpec {
  const members = acmeMembers();
  return {
    planning: shotTasksView({
      plan: standingPlan(),
      plans: standingPlans(),
      extra: { workspaces: whoWorkspaces(members.length) },
    }),
    sidePanel: FIXTURE_CLOSED_PANEL,
    readerId: MEMBER.DEAN.userId,
    answers: {
      ...codingAgentAnswers(),
      [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => members,
    },
    layout: { sidebarCollapsed: true, mainTab: { agent: SHOT_ID.AGENT } },
    steps: [HOLD_MENU],
  };
}
