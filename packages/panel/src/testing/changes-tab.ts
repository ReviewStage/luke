import { type ComponentProps, createElement } from "react";
import { AgentChangesTab, type ChangesReads, useChangesReads } from "../tasks/agent-changes-tab.js";

/**
 * changes-tab.ts -- the Files changed view reading on its own, as the Pull request tab reads for it.
 *
 * The view is handed its reads by the Pull request tab (`useChangesReads`),
 * which counts the lines left to review from them; a test of the view alone
 * draws it under this, which reads the same way, as the view comes on
 * screen, and is handed the reads (`onReads`) to read them again as the
 * Pull request tab's Refresh does.
 */

/** The view, its reads asked as it is shown, and handed to `onReads` on every draw. */
export function ChangesTabReading({
  onReads,
  ...props
}: Omit<ComponentProps<typeof AgentChangesTab>, "reads"> & {
  onReads?: ((reads: ChangesReads) => void) | undefined;
}): React.JSX.Element {
  const reads = useChangesReads(props.agentId, props.control, props.shown);
  onReads?.(reads);
  return createElement(AgentChangesTab, { ...props, reads });
}
