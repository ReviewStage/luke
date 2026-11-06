import { act } from "react";

/**
 * task-menu.ts -- the task's own menu opened as a reader opens it (`desktop/main-tabs.tsx`'s `TaskTopbar`): a right-click on the task's name in its topbar, which stands in place of a ⋯.
 */

/** The task's name in its topbar, the press that opens its details and whose right-click is its menu. */
export function taskName(container: ParentNode): HTMLButtonElement {
  const name = container.querySelector(".task-topbar h1 button");
  if (!(name instanceof HTMLButtonElement)) throw new Error("the task's name stands in its topbar");
  return name;
}

/** Opens the task's menu from its name's right-click. */
export function openTaskMenu(container: ParentNode): void {
  const name = taskName(container);
  act(() => {
    name.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
}
