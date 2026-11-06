import { type ReactNode, useCallback } from "react";
import { AutomationDirectory } from "../automation-directory.js";
import { listedIn } from "../tasks/inbox-model.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";

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

export function ListedAutomations({
  tasks,
  children,
}: {
  tasks: TasksControl;
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
      wanted={namesAutomation(tasks)}
      onOpen={openAutomation}
    >
      {children}
    </AutomationDirectory>
  );
}
