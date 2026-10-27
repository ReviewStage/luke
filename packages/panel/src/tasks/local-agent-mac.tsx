import { type CodingAgentSummary, macOnline } from "@luke/features/coding-agent-wire";
import { EXPERIMENT } from "@luke/settings";
import { Badge, STATUS_TONE, useSecond, VisuallyHidden } from "@luke/ui";
import { LaptopIcon } from "@luke/ui/icons";
import { useExperiment } from "../use-app-state.js";

/**
 * local-agent-mac.tsx -- the label a local agent's box wears naming the Mac it runs on, and saying so while that Mac is away.
 *
 * A local agent runs on one of its starter's devices rather than in the
 * cloud, so its box says which one by name alone ("Charles's MacBook Pro"),
 * from the name the device registered, beside the laptop glyph that already
 * says it is a place, and a reader hears "Runs on:" before it. While that
 * device has not beaten lately, asleep or with Luke closed, held against the
 * window's own clock from when it last beat, the label adds that it is offline ("Charles's MacBook Pro · Offline"), as
 * the Runs on chips do, in the attention tone, since
 * the agent's messages wait for it to come back. Nothing is drawn for an
 * agent in a sandbox, for one whose Mac the service no longer names, or while
 * the local agents experiment is off.
 */

/** What a reader hears before the name, which the glyph says to the eye. */
const RUNS_ON = "Runs on: ";

/** The label's words, by whether the Mac is there. */
function macWords(name: string, online: boolean): string {
  return online ? name : `${name} · Offline`;
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
      <VisuallyHidden>{RUNS_ON}</VisuallyHidden>
      {macWords(mac.name, online)}
    </Badge>
  );
}
