import { type ComponentProps, createElement } from "react";
import { AgentChangesTab, useChangesReads } from "../tasks/agent-changes-tab.js";

/**
 * changes-tab.ts -- the Files changed view reading on its own, as the Pull request tab reads for it.
 *
 * The view is handed its reads by the Pull request tab (`useChangesReads`),
 * which counts the lines left to review from them; a test of the view alone
 * draws it under this, which reads the same way, as the view comes on
 * screen.
 */

/** The view, its reads asked as it is shown. */
export function ChangesTabReading(
  props: Omit<ComponentProps<typeof AgentChangesTab>, "reads">,
): React.JSX.Element {
  const reads = useChangesReads(props.agentId, props.control, props.shown);
  return createElement(AgentChangesTab, { ...props, reads });
}
