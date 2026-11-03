import { freshAccount } from "../tasks/fresh-account.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * desktop-welcome.tsx -- whether an account is new: signed in, its task list read, and nothing of its own yet, which setup's steps and Home's Finish setting up are for.
 */

/** Hands the focus back to the page from whatever holds it, as Escape from an agent's box does. */
export function letGoOfFocus(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
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
