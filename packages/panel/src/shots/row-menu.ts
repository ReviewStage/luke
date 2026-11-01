/**
 * row-menu.ts -- 0.21.0 shot "Menus and arrow keys on every row": a pinned sidebar task's menu held open, Move up and Move down with their ⇧⌘↑ and ⇧⌘↓ above the task's own commands, each with the words, icon, and shortcut ⌘K gives it.
 *
 * Throwaway (`README.md`). Three of acme's tasks pinned, Teammate invitations
 * (the open task) in the middle so both moves show; one step right-clicks its
 * row and opens the menu again whenever the window's activation closes it.
 */

import { FIXTURE_CLOSED_PANEL } from "../tasks/tasks-fixture";
import { standingPlan, standingPlans } from "./board";
import { ago } from "./clock";
import { codingAgentAnswers } from "./coding-agent";
import { SHOT_ID, shotTasksView } from "./plan-document";
import type { ShotSpec, ShotStep } from "./shot-spec";
import { ACT_KIND } from "@luke/host/acts";
import { acmeMembers, MEMBER, whoWorkspaces } from "./who";

const PINNED_AT = ago(60);
const PINNED: ReadonlyMap<string, number> = new Map([
  [SHOT_ID.WEBHOOKS, ago(20)],
  [SHOT_ID.PLAN, PINNED_AT],
  [SHOT_ID.BILLING, ago(180)],
]);

const ROW = "Teammate invitations";

function pinnedRow(): HTMLElement | undefined {
  for (const row of document.querySelectorAll<HTMLElement>('nav[aria-label="Pinned"] li.luke-list-row'))
    if (row.querySelector(".luke-list-row-title")?.textContent?.includes(ROW) === true) return row;
  return undefined;
}

/** Right-clicks the pinned row, and again whenever its menu has closed. */
const OPEN_ROW_MENU: ShotStep = {
  key: "row-menu",
  ready: () => true,
  run: () => {
    let opens = 0;
    let waiting = false;
    const check = (): void => {
      if (waiting || opens >= 12) return;
      const row = pinnedRow();
      if (row === undefined || row.dataset.menuOpen === "true") return;
      waiting = true;
      window.setTimeout(() => {
        waiting = false;
        const again = pinnedRow();
        if (again === undefined || again.dataset.menuOpen === "true") return;
        opens += 1;
        // Note that we right-click at the row's lower right, so the menu hangs below the row rather than over it.
        const press = again.querySelector<HTMLElement>(".luke-list-row-main") ?? again;
        const box = press.getBoundingClientRect();
        press.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            button: 2,
            clientX: box.left + box.width * 0.62,
            clientY: box.bottom - 3,
          }),
        );
        // Note that we blur the menu's first item, because a focus ring on it is not what a pointer sees.
        window.setTimeout(() => {
          const focused = document.activeElement;
          if (focused instanceof HTMLElement && focused.closest('[role="menu"]') !== null) focused.blur();
        }, 300);
      }, 1200);
    };
    new MutationObserver(check).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-menu-open"],
    });
    check();
  },
};

export function rowMenuShot(): ShotSpec {
  const members = acmeMembers();
  const plans = standingPlans().map((plan) => {
    const pinnedAt = PINNED.get(plan.id);
    return pinnedAt === undefined ? plan : { ...plan, pinnedAt };
  });
  return {
    planning: shotTasksView({
      plan: standingPlan({ pinnedAt: PINNED_AT }),
      plans,
      extra: { workspaces: whoWorkspaces(members.length) },
    }),
    sidePanel: FIXTURE_CLOSED_PANEL,
    readerId: MEMBER.DEAN.userId,
    answers: {
      ...codingAgentAnswers(),
      [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => members,
    },
    steps: [OPEN_ROW_MENU],
  };
}
