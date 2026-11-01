/**
 * select-several.ts -- 0.21.0 shot "Select several at once": four of acme's tasks chosen on the Tasks page's List with ⌘-clicks, and the selection bar under them offering Mark done, Set status, and Move to section.
 *
 * Throwaway (`README.md`). 0.20.0's List (`tasks-list.ts`) with the
 * sidebar's tasks sorted into Launch and Billing; one step ⌘-clicks four
 * rows' press buttons, a few frames apart, since each press reads the set the
 * last render drew.
 */

import type { TaskSections } from "@luke/features/task-section-wire";
import { daysAgo } from "./clock";
import { onceDrawn } from "./dom-steps";
import { SHOT_ID } from "./plan-document";
import type { ShotSpec } from "./shot-spec";
import { tasksListShot } from "./tasks-list";

/** The four tasks chosen, in the order they are ⌘-clicked. */
const CHOSEN = [
  "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f01",
  "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f07",
  "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f02",
  SHOT_ID.AUDIT,
] as const;

const SECTION = {
  LAUNCH: "c0a1b2c3-1111-4a2b-8c3d-000000000001",
  BILLING: "c0a1b2c3-1111-4a2b-8c3d-000000000002",
} as const;

/** Dean's sections: the invite launch and billing work. */
function sections(): TaskSections {
  return {
    sections: [
      {
        id: SECTION.LAUNCH,
        workspaceId: SHOT_ID.WORKSPACE,
        title: "Launch",
        icon: { kind: "glyph", glyph: "rocket", color: "orange" },
        createdAt: daysAgo(10),
      },
      {
        id: SECTION.BILLING,
        workspaceId: SHOT_ID.WORKSPACE,
        title: "Billing",
        icon: { kind: "glyph", glyph: "briefcase", color: "green" },
        createdAt: daysAgo(12),
      },
    ],
    entries: [
      { taskId: SHOT_ID.PLAN, sectionId: SECTION.LAUNCH, addedAt: daysAgo(2) },
      { taskId: SHOT_ID.ONBOARDING, sectionId: SECTION.LAUNCH, addedAt: daysAgo(3) },
      { taskId: SHOT_ID.BILLING, sectionId: SECTION.BILLING, addedAt: daysAgo(4) },
    ],
    agentEntries: [],
  };
}

export function selectSeveralShot(): ShotSpec {
  const base = tasksListShot();
  return {
    ...base,
    planning: { ...base.planning, taskSections: sections() },
    steps: [
      ...(base.steps ?? []),
      {
        key: "tasks-chosen",
        ready: ({ plans }) => plans.boardView.open,
        run: () => {
          const press = (at: number): void => {
            const id = CHOSEN[at];
            if (id === undefined) return;
            onceDrawn(`.tasks-list-row[data-task-id="${id}"] [data-card-press]`, (button) => {
              button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
              // Note that each ⌘-click reads the set the last render drew, so the next waits for it.
              window.setTimeout(() => press(at + 1), 200);
            });
          };
          window.setTimeout(() => press(0), 1000);
        },
      },
    ],
  };
}
