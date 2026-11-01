/**
 * row-sheet.ts -- 0.22.0 shot "Menus rise from the bottom on a phone": the web app on a phone, the Tasks page's List, and a task row's ⋯ menu risen from the bottom as a sheet, its items in reach of a thumb.
 *
 * Throwaway (`README.md`). Taken in Safari on an iPhone simulator from the
 * web app's development server, `/app.html?fixture=shot-row-sheet`. 0.20.0's
 * List (`tasks-list.ts`); one step presses ACME-51's ⋯ once the page is drawn.
 */

import { onceDrawn } from "./dom-steps";
import type { ShotSpec } from "./shot-spec";
import { tasksListShot } from "./tasks-list";

/** Rotate webhook signing secrets: ACME-51, in progress on acme/relay. */
const ROW = "a1f0c2d4-1b2c-4d3e-8f4a-5b6c7d8e9f09";
const MORE = `li.tasks-list-row[data-task-id="${ROW}"] button[aria-label="Task actions"]`;

export function rowSheetShot(): ShotSpec {
  const base = tasksListShot();
  return {
    ...base,
    steps: [
      ...(base.steps ?? []),
      {
        key: "row-sheet",
        ready: ({ plans }) => plans.boardView.open,
        run: () => {
          window.setTimeout(
            () =>
              onceDrawn(MORE, (button) => {
                // Note that the click says it was a press (`detail: 1`), because a click with none reads as a key and lights the first item.
                // Note that a touch's pointer events come first, because the menu reads how it was opened from them.
                const touch = { bubbles: true, cancelable: true, pointerType: "touch", isPrimary: true, pointerId: 1 };
                button.dispatchEvent(new PointerEvent("pointerdown", touch));
                button.dispatchEvent(new PointerEvent("pointerup", touch));
                button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
                // Note that we blur the sheet's first item, because a finger leaves no highlight on it.
                const clear = (): void => {
                  const focused = document.activeElement;
                  if (focused instanceof HTMLElement && focused.closest('[role="menu"]') !== null) focused.blur();
                  for (const item of document.querySelectorAll<HTMLElement>('[role="menu"] [data-highlighted]')) {
                    item.dispatchEvent(new PointerEvent("pointerleave", { bubbles: false, pointerType: "touch" }));
                    item.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false }));
                    item.removeAttribute("data-highlighted");
                  }
                };
                window.setTimeout(clear, 400);
                window.setTimeout(clear, 1500);
              }),
            1500,
          );
        },
      },
    ],
  };
}
