import { act } from "react";

export function taskName(container: ParentNode): HTMLButtonElement {
  const name = container.querySelector(".task-topbar h1 button");
  if (!(name instanceof HTMLButtonElement)) throw new Error("the task's name stands in its topbar");
  return name;
}

export function openTaskMenu(container: ParentNode): void {
  const name = taskName(container);
  act(() => {
    name.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
}
