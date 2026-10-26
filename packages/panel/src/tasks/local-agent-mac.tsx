import { type CodingAgentSummary, macOnline } from "@luke/features/coding-agent-wire";
import { EXPERIMENT } from "@luke/settings";
import { Badge, STATUS_TONE, useSecond } from "@luke/ui";
import { LaptopIcon } from "@luke/ui/icons";
import { useExperiment } from "../use-app-state.js";

/**
 * local-agent-mac.tsx -- the label a local agent's box wears naming the Mac it runs on, and saying so while that Mac is away.
 *
 * A local agent runs on its starter's Mac rather than in a sandbox, so its
 * box says which one ("On Charles's MacBook Pro"), from the name the Mac
 * registered. While that Mac has not beaten lately, asleep or with Luke
 * closed, held against the window's own clock from when it last beat, the
 * label says it is offline instead, in the attention tone, since
 * the agent's messages wait for it to come back. Nothing is drawn for an
 * agent in a sandbox, for one whose Mac the service no longer names, or while
 * the local agents experiment is off.
 */

/** The label's words, by whether the Mac is there. */
function macWords(name: string, online: boolean): string {
  return online ? `On ${name}` : `${name} is offline`;
}

export function LocalAgentMac({
  agent,
}: {
  agent: Pick<CodingAgentSummary, "mac">;
}): React.JSX.Element | null {
  const on = useExperiment(EXPERIMENT.LOCAL_AGENTS);
  if (!on || agent.mac === undefined) return null;
  return <MacBadge mac={agent.mac} />;
}

/** The label itself, held against the window's clock, so a Mac that goes quiet reads offline without another read. */
function MacBadge({ mac }: { mac: NonNullable<CodingAgentSummary["mac"]> }): React.JSX.Element {
  const online = macOnline(mac.seenAt, useSecond());
  return (
    <Badge
      tone={online ? STATUS_TONE.NEUTRAL : STATUS_TONE.ATTENTION}
      icon={<LaptopIcon aria-hidden="true" />}
    >
      {macWords(mac.name, online)}
    </Badge>
  );
}
