import { AutomationDirectory } from "@luke/panel/automation-directory";
import { listedIn } from "@luke/panel/tasks/inbox-model";
import { type ReactNode, useCallback } from "react";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab";

/**
 * listed-automations.tsx -- the listed workspace's automations, read around the whole window, so an agent's card on Home's rows or in ⌘K names the automation that started it as the task's own does.
 *
 * They are read only while the Automations experiment is on and an agent
 * the window lists names an automation: one on a listed task's row, one of
 * the open task's agents, or one with no task whose question waits in the
 * listed workspace. The open task and the Inbox stand directories of their
 * own, which share this read where they are of the listed workspace
 * (`automation-directory.tsx`).
 */

/** Whether an agent the window lists names the automation that started it: a listed task's row's, the open task's, or one with no task whose question waits in the listed workspace, as Home's rows name it. */
function namesAutomation(tasks: TasksControl): boolean {
  const lines = tasks.tasks.flatMap((task) => task.agents?.agents ?? []);
  const agents = [...(tasks.agents.agents ?? []), ...(tasks.agents.archived ?? [])];
  return (
    [...lines, ...agents].some((agent) => agent.automationId !== undefined) ||
    tasks.inboxTaskless.some(
      (waiting) => waiting.automationId !== null && listedIn(waiting, tasks.workspace?.id),
    )
  );
}

/** The listed workspace's automations for everything inside, while `on` (`EXPERIMENT.AUTOMATIONS`). */
export function ListedAutomations({
  tasks,
  on,
  children,
}: {
  tasks: TasksControl;
  on: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const { onOpen } = tasks.automationsView;
  const openAutomation = useCallback(
    (automationId: string) => onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId }),
    [onOpen],
  );
  return (
    <AutomationDirectory
      workspace={tasks.workspace}
      on={on}
      wanted={namesAutomation(tasks)}
      onOpen={openAutomation}
    >
      {children}
    </AutomationDirectory>
  );
}
