import { FILL_ELEMENT, Fill, TEXT_ELEMENT, TEXT_VARIANT, Text, WingFace } from "@luke/ui";
import { MENTION_MENU_SIDE } from "../tasks/mention-picker.js";
import { NewTaskComposer } from "../tasks/new-task-composer.js";
import { freshAccount } from "../tasks/resting-page.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * desktop-welcome.tsx -- a new account's welcome, the page the window rests on with no task open while the account has nothing yet: Luke's face, one line, and New task's composer under them.
 *
 * An account with tasks, or a question waiting on it, rests on the Inbox
 * instead (`resting-page.ts`), so this page draws the welcome only for an account
 * with no task in any workspace and nothing waiting on it, once the task
 * list says so, and nothing otherwise, while the list is read or the window
 * passes on to where it rests. Nothing here names the sidebar, which may be
 * folded away.
 *
 * The composer starts the task in the listed workspace, as the dialog
 * would: in Agent mode a task with a coding agent on the words, opened on
 * its tab, and in Plan mode the plan and a call with Luke. The dialog stays
 * for ⌘N and every other New task press; only the welcome holds the card
 * inline. Its words take the caret as the page shows, unless the developer
 * is typing in a field elsewhere, as an agent's box decides, and Escape there
 * with nothing in it to close takes the caret out of the words. Its words and
 * files are New task's draft in the workspace, which the dialog shares, so
 * leaving the welcome keeps them; its issue is the card's own state, which
 * leaving the welcome lets go. An `@` or `/` list opens under the caret's
 * line, because one risen over it from the page's top is cut off under the
 * page's head.
 */

/** Hands the focus back to the page from whatever holds it, as Escape from an agent's box does. */
function letGoOfFocus(): void {
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
  return (
    <Fill
      as={FILL_ELEMENT.SECTION}
      className="home-welcome items-center justify-center-safe gap-block-gap overflow-y-auto p-page-inset text-center"
      aria-label="Welcome"
    >
      <span
        className="home-welcome-face mb-tight-gap flex size-welcome-tile items-center justify-center rounded-luke-14 bg-muted text-foreground [&_.luke-face]:size-welcome-face!"
        aria-hidden="true"
      >
        <WingFace />
      </span>
      <Text as={TEXT_ELEMENT.H1} variant={TEXT_VARIANT.TITLE}>
        Start your first task
      </Text>
      <div className="home-composer ph-no-capture mt-control-gap w-welcome-composer text-start">
        <NewTaskComposer
          newTask={{ ...tasks.newTask, preset: undefined }}
          workspaceId={tasks.newTask.workspaceId}
          onLeave={letGoOfFocus}
          listSide={MENTION_MENU_SIDE.BELOW}
        />
      </div>
    </Fill>
  );
}
