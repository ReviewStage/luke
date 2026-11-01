/**
 * pr-card.ts -- 0.24.0 shot "One shape for every hover card": #214's card held open beside its row in the task's summary, its mark, title, and repository over its size and checks, who opened it and which agent, and its reviewers with where each stands.
 *
 * Throwaway (`README.md`). The reviewers reach the card from the agent's
 * changes read, which only the Pull request tab asks, so one step opens #214
 * on Files changed and closes the panel again once the read is held; the
 * summary, pinned open, then lists the pull request, and one step holds its
 * card up through the capture (`hint.tsx`'s throwaway hold). Dana approved,
 * Jordan commented, and Priya's review is requested.
 */

import type { GitHubPerson } from "@luke/features/agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import { FIXTURE_CODE_PANEL } from "../tasks/tasks-fixture";
import { PULL_REQUEST_VIEW } from "../tasks/use-side-panel";
import { standingPlan, standingPlans } from "./board";
import { onceDrawn } from "./dom-steps";
import { GITHUB } from "./github-people";
import { SHOT_ID, shotTasksView } from "./plan-document";
import { pr214Changes } from "./pr-214";
import { pr214TabAnswers } from "./pr-214-tab";
import type { ShotSpec, ShotStep } from "./shot-spec";
import { acmeMembers, initialPicture, MEMBER, whoWorkspaces } from "./who";

const PRIYA: GitHubPerson = {
  login: "priyaraman",
  avatarUrl: initialPicture("P", "#c7b4f5", "#3d2a78"),
  bot: false,
  userId: MEMBER.PRIYA.userId,
};

/** How many times the card is asked up again before the step gives up. */
const MAX_ASKS = 12;

/** Opens #214 on Files changed, so its changes read, reviewers and all, is asked once. */
const READ_REVIEWERS: ShotStep = {
  key: "read-reviewers",
  ready: ({ plans }) => plans.agents.agentIds?.includes(SHOT_ID.AGENT) ?? false,
  run: ({ plans }) => {
    plans.sidePanel.onPullRequestView({ changes: SHOT_ID.AGENT }, PULL_REQUEST_VIEW.FILES);
    plans.sidePanel.onChoose({ changes: SHOT_ID.AGENT });
  },
};

/** Closes the panel once the reviewers are held, so the summary stands beside the column. */
const CLOSE_PANEL: ShotStep = {
  key: "close-panel",
  ready: ({ plans }) => plans.agents.changesPeople.get(SHOT_ID.AGENT) !== undefined,
  run: ({ plans }) => {
    plans.sidePanel.onClose({ changes: SHOT_ID.AGENT });
    plans.sidePanel.onSetOpen(false);
  },
};

/** The summary's row for #214, once drawn. */
function pullRequestRow(): HTMLElement | undefined {
  for (const row of document.querySelectorAll<HTMLElement>("aside li.luke-list-row"))
    if (row.querySelector(".luke-list-row-title")?.textContent?.includes("#214") === true)
      return row.querySelector<HTMLElement>("button.luke-list-row-main") ?? row;
  return undefined;
}

/** Rests the pointer on #214's row, and again while its card is not up. */
const HOLD_CARD: ShotStep = {
  key: "hold-card",
  ready: ({ plans }) => !plans.sidePanel.open,
  run: () => {
    let asks = 0;
    const ask = (): void => {
      const row = pullRequestRow();
      if (row !== undefined && document.querySelector("[data-pull-request-card]") === null) {
        row.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
        asks += 1;
      }
      if (document.querySelector("[data-pull-request-card]") !== null) {
        document.documentElement.dataset.shotHoldCard = "true";
      }
      if (asks < MAX_ASKS) window.setTimeout(ask, 1000);
    };
    onceDrawn("aside li.luke-list-row", () => window.setTimeout(ask, 1500));
  },
};

export function prCardShot(): ShotSpec {
  const members = acmeMembers();
  const changes = pr214Changes();
  return {
    planning: shotTasksView({
      plan: standingPlan(),
      plans: standingPlans(),
      extra: { workspaces: whoWorkspaces(members.length) },
    }),
    sidePanel: FIXTURE_CODE_PANEL,
    readerId: MEMBER.DEAN.userId,
    answers: {
      ...pr214TabAnswers({ viewed: new Set() }),
      [ACT_KIND.AGENTS_CHANGES]: (payload) =>
        payload.agentId !== SHOT_ID.AGENT || !("pullRequest" in changes) || changes.pullRequest === null
          ? { pullRequest: null }
          : {
              pullRequest: {
                ...changes.pullRequest,
                author: GITHUB.DEAN,
                writtenAs: "developer",
                reviewers: [
                  { by: GITHUB.DANA, state: "approved" },
                  { by: GITHUB.JORDAN, state: "commented" },
                  { by: PRIYA, state: "requested" },
                ],
              },
            },
    },
    layout: { sidebarCollapsed: true, summaryPinned: true },
    steps: [READ_REVIEWERS, CLOSE_PANEL, HOLD_CARD],
  };
}
