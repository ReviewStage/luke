import { type ReactNode, useCallback } from "react";
import { AutomationDirectory } from "../automation-directory";
import { AUTOMATIONS_PAGE, type PlansControl } from "../planning/use-plans-tab";

/**
 * listed-automations.tsx -- the listed workspace's automations, read around the whole window, so an agent's card on Home's rows or in ⌘K names the automation that started it as the plan's own does.
 *
 * They are read only while the Automations experiment is on and an agent
 * the window lists names an automation: one on a listed plan's row, or one
 * of the open plan's agents. The open plan and the Inbox stand directories
 * of their own, which share this read where they are of the listed
 * workspace (`automation-directory.tsx`).
 */

/** Whether an agent the window lists names the automation that started it: a listed plan's row's, or the open plan's. */
function namesAutomation(plans: PlansControl): boolean {
  const lines = plans.plans.flatMap((plan) => plan.agents?.agents ?? []);
  const agents = [...(plans.agents.agents ?? []), ...(plans.agents.archived ?? [])];
  return [...lines, ...agents].some((agent) => agent.automationId !== undefined);
}

/** The listed workspace's automations for everything inside, while `on` (`EXPERIMENT.AUTOMATIONS`). */
export function ListedAutomations({
  plans,
  on,
  children,
}: {
  plans: PlansControl;
  on: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const { onOpen } = plans.automationsView;
  const openAutomation = useCallback(
    (automationId: string) => onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId }),
    [onOpen],
  );
  return (
    <AutomationDirectory
      workspace={plans.workspace}
      on={on}
      wanted={namesAutomation(plans)}
      onOpen={openAutomation}
    >
      {children}
    </AutomationDirectory>
  );
}
