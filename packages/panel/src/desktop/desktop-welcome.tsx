import { SetupChecklist } from "../onboarding/setup-checklist.js";
import { freshAccount } from "../tasks/fresh-account.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * desktop-welcome.tsx -- a new account's welcome, which Home draws in its own place while the account has nothing yet: what setup left undone, or the product's mark, one line, and New task.
 *
 * An account with tasks, or a question waiting on it, sees Home itself
 * (`desktop-home.tsx`), so the welcome stands only for an account with no
 * task in any workspace and nothing waiting on it, once the task list says
 * so, and nothing otherwise. Nothing here names the sidebar, which may be
 * folded away. What it draws is setup's (`setup-checklist.tsx`): an agent or
 * GitHub left undone, asked for again, then New task, whose dialog starts
 * the first task.
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

/** A new account's welcome, in the task's place while no task is open; nothing for any other account. */
export function DesktopWelcome({ tasks }: { tasks: TasksControl }): React.JSX.Element | null {
  if (!welcomed(tasks)) return null;
  return <SetupChecklist tasks={tasks} />;
}
