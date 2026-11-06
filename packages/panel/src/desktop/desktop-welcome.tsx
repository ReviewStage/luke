import { type RefObject, useEffect, useRef } from "react";
import { EDITOR_ROOT_SELECTOR } from "../description-editor/contract.js";
import { freshAccount } from "../tasks/fresh-account.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * desktop-welcome.tsx -- whether an account is new: signed in, its task list read, and nothing of its own yet, which setup's steps and Home's setup sections are for; and the hook that hands Home's composer the caret on New task.
 */

/** Hands the focus back to the page from whatever holds it, as Escape from an agent's box does. */
export function letGoOfFocus(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

/**
 * Hands the words of the composer under `box` the caret each time New task
 * is pressed while it stands (`newTask.homeAsks`); its first draw is
 * `takesFocus`'s to decide, so a count raised before it showed asks nothing.
 */
export function useHomeNewTask(box: RefObject<HTMLElement | null>, asks: number): void {
  const seen = useRef(asks);
  useEffect(() => {
    if (asks === seen.current) return;
    seen.current = asks;
    box.current?.querySelector<HTMLElement>(EDITOR_ROOT_SELECTOR)?.focus();
  }, [box, asks]);
}

/** Whether the welcome stands: an account signed in whose task list landed holding nothing of its own. */
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
