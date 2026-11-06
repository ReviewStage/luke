import { type RefObject, useEffect, useRef } from "react";
import { EDITOR_ROOT_SELECTOR } from "../description-editor/contract.js";
import { freshAccount } from "../tasks/fresh-account.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

export function letGoOfFocus(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

export function useHomeNewTask(box: RefObject<HTMLElement | null>, asks: number): void {
  const seen = useRef(asks);
  useEffect(() => {
    if (asks === seen.current) return;
    seen.current = asks;
    box.current?.querySelector<HTMLElement>(EDITOR_ROOT_SELECTOR)?.focus();
  }, [box, asks]);
}

export function welcomed(tasks: TasksControl): boolean {
  return (
    tasks.signedIn &&
    tasks.listRead &&
    freshAccount({
      tasks: tasks.tasks,
      taskless: tasks.inboxTaskless,
      readerId: tasks.me,
    })
  );
}
