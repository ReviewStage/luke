import {
  CODING_AGENT_MACHINE,
  type CodingAgentSummary,
  DEVICE_STANDING,
  type DeviceStanding,
} from "@luke/features/coding-agent-wire";
import { EXPERIMENT } from "@luke/settings";
import { Badge, STATUS_TONE, useSecond, VISUALLY_HIDDEN_UNDER, VisuallyHidden } from "@luke/ui";
import { GLYPH, LaptopIcon } from "@luke/ui/icons";
import { presenceStanding, useDevicePresence } from "../device-presence.js";
import { useExperiment } from "../use-app-state.js";

/**
 * agent-place.tsx -- the chip an agent's message box wears saying where the agent runs: its device by name, or the cloud.
 *
 * A local agent runs on one of its starter's devices, so its box says which
 * one by name alone ("Charles's MacBook Pro"), from the name the device
 * registered, beside the laptop glyph that already says it is a place, and
 * a reader hears "Runs on:" before it. An agent in a sandbox says "Cloud",
 * beside the cloud glyph the Runs on chips draw, and a reader hears
 * "Runs on: Cloud". While a device has not beaten lately, asleep or with Luke
 * closed, judged from how long ago the service says it last beat, the label
 * adds that it is offline ("Charles's MacBook Pro · Offline"), as the Runs on
 * chips do, in the attention tone, since the agent's messages wait for it to
 * come back. The beat comes from the window's shared presence read
 * (`device-presence.ts`), so a device that keeps beating never reads offline
 * for want of a read; where that read fails and the beat held is old, the
 * label says it cannot check rather than that the device is away. A device the
 * read does not name is a teammate's, which the window cannot speak for, so
 * its label is its name alone. Nothing is drawn for an agent on a device the
 * service no longer names, since it is neither in the cloud nor anywhere that
 * can be named, or while the local agents experiment is off, like every Runs on
 * surface. In a card too narrow for its words, where the branch's chip draws
 * its mark alone too, the badge draws its glyph alone and keeps the words for
 * a reader, rather than wrapping them a letter to a line.
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

export function AgentPlace({
  agent,
}: {
  agent: Pick<CodingAgentSummary, "mac" | "machine">;
}): React.JSX.Element | null {
  const on = useExperiment(EXPERIMENT.LOCAL_AGENTS);
  if (!on) return null;
  if (agent.machine !== CODING_AGENT_MACHINE.DEVICE) return <CloudBadge />;
  if (agent.mac === undefined) return null;
  return <MacBadge mac={agent.mac} />;
}

/** The chip of an agent in a sandbox. */
function CloudBadge(): React.JSX.Element {
  return (
    <Badge
      tone={STATUS_TONE.NEUTRAL}
      icon={<GLYPH.CLOUD aria-hidden="true" />}
      hideWordsUnder={VISUALLY_HIDDEN_UNDER.SNUG}
    >
      <VisuallyHidden>{RUNS_ON}</VisuallyHidden>
      Cloud
    </Badge>
  );
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
      hideWordsUnder={VISUALLY_HIDDEN_UNDER.SNUG}
    >
      <VisuallyHidden>{RUNS_ON}</VisuallyHidden>
      {macWords(mac.name, standing)}
    </Badge>
  );
}
