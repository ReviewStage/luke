import { FILL_ELEMENT, Fill, ProductMark, TEXT_ELEMENT, TEXT_VARIANT, Text } from "@repo/ui";
import { type RefObject, useEffect, useRef } from "react";
import { EDITOR_ROOT_SELECTOR } from "../plan-editor/contract.js";
import { freshAccount } from "../tasks/fresh-account.js";
import { MENTION_MENU_SIDE } from "../tasks/mention-picker.js";
import { NewTaskComposer } from "../tasks/new-task-composer.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * desktop-welcome.tsx -- a new account's welcome, which Home draws in its own place while the account has nothing yet: the product's mark, one line, and New task's composer under them.
 *
 * An account with tasks, or a question waiting on it, sees Home itself
 * (`desktop-home.tsx`), so the welcome stands only for an account with no
 * task in any workspace and nothing waiting on it, once the task list says
 * so, and nothing otherwise. Nothing here names the sidebar, which may be
 * folded away.
 *
 * The composer starts the task in the listed workspace, as the dialog
 * would: in Agent mode a task with a coding agent on the words, opened on
 * its tab, and in Plan mode the plan and a call with the app. A New task press
 * while it stands, ⌘N's among them, hands its words the caret rather than
 * opening the dialog over it; the dialog stays for every other place, and
 * only the welcome holds the card
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

/** A new account's welcome, in the task's place while no task is open; nothing for any other account. */
export function DesktopWelcome({
  tasks,
  takesFocus = true,
}: {
  tasks: TasksControl;
  /** Whether the composer's words take the caret as the welcome shows; none on a phone, whose places bar steps aside while a field is typed in. */
  takesFocus?: boolean;
}): React.JSX.Element | null {
  const box = useRef<HTMLDivElement>(null);
  useHomeNewTask(box, tasks.newTask.homeAsks);
  if (!welcomed(tasks)) return null;
  return (
    <Fill
      as={FILL_ELEMENT.SECTION}
      className="home-welcome items-center justify-center-safe gap-block-gap overflow-y-auto p-page-inset text-center"
      aria-label="Welcome"
    >
      <span
        className="home-welcome-mark mb-tight-gap flex size-welcome-tile items-center justify-center rounded-ui-14 bg-muted text-foreground [&_.ui-product-mark]:size-welcome-mark!"
        aria-hidden="true"
      >
        <ProductMark />
      </span>
      <Text as={TEXT_ELEMENT.H1} variant={TEXT_VARIANT.TITLE}>
        Start your first task
      </Text>
      <div
        className="home-composer ph-no-capture mt-control-gap w-welcome-composer text-start"
        ref={box}
      >
        <NewTaskComposer
          newTask={{ ...tasks.newTask, preset: undefined }}
          workspaceId={tasks.newTask.workspaceId}
          onLeave={letGoOfFocus}
          takesFocus={takesFocus}
          listSide={MENTION_MENU_SIDE.BELOW}
        />
      </div>
    </Fill>
  );
}
