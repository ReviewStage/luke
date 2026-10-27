import {
  type CodingAgentSummary,
  DEVICE_STANDING,
  type DeviceStanding,
} from "@luke/features/coding-agent-wire";
import { EXPERIMENT } from "@luke/settings";
import { Badge, STATUS_TONE, useSecond, VisuallyHidden } from "@luke/ui";
import { LaptopIcon } from "@luke/ui/icons";
import { presenceStanding, useDevicePresence } from "../device-presence.js";
import { useExperiment } from "../use-app-state.js";

/**
 * local-agent-mac.tsx -- the label a local agent's box wears naming the Mac it runs on, and saying so while that Mac is away.
 *
 * A local agent runs on one of its starter's devices rather than in the
 * cloud, so its box says which one by name alone ("Charles's MacBook Pro"),
 * from the name the device registered, beside the laptop glyph that already
 * says it is a place, and a reader hears "Runs on:" before it. While that
 * device has not beaten lately, asleep or with Luke closed, judged from how
 * long ago the service says it last beat, the label adds that it is offline ("Charles's MacBook Pro · Offline"), as
 * the Runs on chips do, in the attention tone, since
 * the agent's messages wait for it to come back. The beat comes from the
 * window's shared presence read (`device-presence.ts`), so a device that keeps
 * beating never reads offline for want of a read; where that read fails and
 * the beat held is old, the label says it cannot check rather than that the
 * device is away. A device the read does not name is a teammate's, which the
 * window cannot speak for, so its label is its name alone. Nothing is drawn for an
 * agent in a sandbox, for one whose Mac the service no longer names, or while
 * the local agents experiment is off.
 */

/** What a reader hears before the name, which the glyph says to the eye. */
const RUNS_ON = "Runs on: ";

/** The label's words, by where the device stands. */
function macWords(name: string, standing: DeviceStanding | undefined): string {
  if (standing === undefined || standing === DEVICE_STANDING.ONLINE) return name;
  if (standing === DEVICE_STANDING.CHECKING) return name;
  return standing === DEVICE_STANDING.OFFLINE
    ? `${name} · Offline`
    : `${name} · Can't check status`;
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
  const presence = useDevicePresence(true);
  // Note that the clock only redraws the label as a beat ages, since the standing is read off the book's own monotonic clock.
  useSecond();
  const standing = presenceStanding(presence, mac.deviceId);
  const quiet =
    standing === undefined ||
    standing === DEVICE_STANDING.ONLINE ||
    standing === DEVICE_STANDING.CHECKING;
  return (
    <Badge
      tone={quiet ? STATUS_TONE.NEUTRAL : STATUS_TONE.ATTENTION}
      icon={<LaptopIcon aria-hidden="true" />}
    >
      <VisuallyHidden>{RUNS_ON}</VisuallyHidden>
      {macWords(mac.name, standing)}
    </Badge>
  );
}
