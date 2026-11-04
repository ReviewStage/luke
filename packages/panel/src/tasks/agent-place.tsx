import {
  AGENT_MACHINE,
  type AgentSummary,
  DEVICE_STANDING,
  type DeviceStanding,
} from "@repo/features/agent-wire";
import {
  ChipName,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  STATUS_TONE,
  StaticChip,
  Tooltip,
  useSecond,
  VisuallyHidden,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import type { ReactNode } from "react";
import { presenceStanding, useDevicePresence } from "../device-presence.js";
import { machineName, useThisMac } from "../machine-name.js";
import { DeviceGlyph, RUNS_ON_WORDS } from "./runs-on.js";

/**
 * agent-place.tsx -- the chip an agent's message box wears saying where the agent runs: its device by name, or the cloud.
 *
 * It is New task's Runs on chip as the task keeps it (`runs-on.tsx`): the
 * same toolbar chip, the same glyph by the device's platform, and the same
 * name every list of machines gives it (`machine-name.ts`), This Mac among
 * them, so a task reads alike before and after it starts. Since where a
 * task runs is set when it is created, the chip ends in no chevron and
 * takes no press (`StaticChip`); a rest on it, or a tap under a finger,
 * hangs a card saying where every agent on the task runs and whether the
 * device is online, and a reader hears "Runs on:" before its words. An
 * agent in a sandbox says "Cloud" beside the cloud glyph.
 *
 * While a device has not beaten lately, asleep or with the app closed,
 * judged from how long ago the service says it last beat, the label adds
 * that it is offline ("Charles's MacBook Pro · Offline"), as the Runs on
 * chips do, its glyph in the attention tone, since the agent's messages
 * wait for it to come back. The beat comes from the window's shared presence
 * read (`device-presence.ts`), so a device that keeps beating never reads
 * offline for want of a read; where that read fails and the beat held is
 * old, the label says it cannot check rather than that the device is away.
 * A device the read does not name is a teammate's, which the window cannot
 * speak for, so its label is its name alone. Nothing is drawn for an agent
 * on a device the service no longer names, since it is neither in the cloud
 * nor anywhere that can be named. In a box too narrow for its words, where
 * the branch's chip draws its mark alone too, the chip draws its glyph alone
 * in a square and keeps the words for a reader and its hint.
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

/** What the card says under its head of every agent on the task, in the cloud or on a device. */
const SHARED_NOTE = {
  CLOUD: "Every agent on this task runs in a cloud sandbox. Set when the task was created.",
  DEVICE: "Every agent on this task runs on this device. Set when the task was created.",
} as const;

export function AgentPlace({
  agent,
  narrow = false,
}: {
  agent: Pick<AgentSummary, "mac" | "machine">;
  /** Whether the box is too narrow for the chip's words, so it draws its glyph alone. */
  narrow?: boolean;
}): React.JSX.Element | null {
  if (agent.machine !== AGENT_MACHINE.DEVICE) {
    return (
      <PlaceChip
        glyph={<GLYPH.CLOUD aria-hidden="true" />}
        words={RUNS_ON_WORDS.CLOUD}
        sub={undefined}
        note={SHARED_NOTE.CLOUD}
        narrow={narrow}
      />
    );
  }
  if (agent.mac === undefined) return null;
  return <MacChip mac={agent.mac} narrow={narrow} />;
}

/** The chip and its card: the glyph, the words a reader hears after "Runs on:", and the card's head and note. */
function PlaceChip({
  glyph,
  words,
  sub,
  note,
  quiet = true,
  narrow,
}: {
  glyph: ReactNode;
  words: string;
  sub: string | undefined;
  note: string;
  quiet?: boolean;
  narrow: boolean;
}): React.JSX.Element {
  return (
    <Tooltip
      label={`${RUNS_ON}${words}`}
      card={
        <HoverCard>
          <HoverCardHead glyph={glyph} name={words} sub={sub} />
          <HoverCardNote>{note}</HoverCardNote>
        </HoverCard>
      }
    >
      <StaticChip tone={quiet ? undefined : STATUS_TONE.ATTENTION} iconOnly={narrow}>
        {glyph}
        <VisuallyHidden>{RUNS_ON}</VisuallyHidden>
        <ChipName>{words}</ChipName>
      </StaticChip>
    </Tooltip>
  );
}

/** The chip of an agent on a device, held against the window's clock, so a Mac that goes quiet reads offline without another read. */
function MacChip({
  mac,
  narrow,
}: {
  mac: NonNullable<AgentSummary["mac"]>;
  narrow: boolean;
}): React.JSX.Element {
  const presence = useDevicePresence(true);
  const thisMac = useThisMac();
  // Note that the clock only redraws the label as a beat ages, since the standing is read off the book's own monotonic clock.
  useSecond();
  const standing = presenceStanding(presence, mac.deviceId);
  const quiet =
    standing === undefined ||
    standing === DEVICE_STANDING.ONLINE ||
    standing === DEVICE_STANDING.CHECKING;
  const name = machineName({ deviceId: mac.deviceId, name: mac.name }, [], thisMac);
  return (
    <PlaceChip
      glyph={<DeviceGlyph device={undefined} />}
      words={macWords(name, standing)}
      sub={standing === DEVICE_STANDING.ONLINE ? RUNS_ON_WORDS.ONLINE : undefined}
      note={SHARED_NOTE.DEVICE}
      quiet={quiet}
      narrow={narrow}
    />
  );
}
