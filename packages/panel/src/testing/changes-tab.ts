import { type ComponentProps, createElement } from "react";
import { AgentChangesTab, type ChangesReads, useChangesReads } from "../tasks/agent-changes-tab.js";
import { usePullRequestNumber } from "../tasks/pull-request-number.js";
import { useAgentPullRequestSource } from "../tasks/pull-request-source.js";
import type { AgentsControl } from "../tasks/use-agents.js";

export function ChangesTabReading({
  onReads,
  control,
  ...props
}: Omit<ComponentProps<typeof AgentChangesTab>, "reads" | "source"> & {
  control: AgentsControl;
  onReads?: ((reads: ChangesReads) => void) | undefined;
}): React.JSX.Element {
  const source = useAgentPullRequestSource(control, props.agentId, usePullRequestNumber());
  const reads = useChangesReads(props.agentId, source, props.shown);
  onReads?.(reads);
  return createElement(AgentChangesTab, { ...props, source, reads });
}
