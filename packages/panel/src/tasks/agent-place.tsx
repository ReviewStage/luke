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

const RUNS_ON = "Runs on: ";

function macWords(name: string, standing: DeviceStanding | undefined): string {
  if (standing === undefined || standing === DEVICE_STANDING.ONLINE) return name;
  if (standing === DEVICE_STANDING.CHECKING) return name;
  return standing === DEVICE_STANDING.OFFLINE
    ? `${name} · Offline`
    : `${name} · Can't check status`;
}

const SHARED_NOTE = {
  CLOUD: "This agent runs in a cloud sandbox. Set when it was started.",
  DEVICE: "This agent runs on this device. Set when it was started.",
} as const;

export function AgentPlace({
  agent,
  narrow = false,
}: {
  agent: Pick<AgentSummary, "mac" | "machine">;
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

function MacChip({
  mac,
  narrow,
}: {
  mac: NonNullable<AgentSummary["mac"]>;
  narrow: boolean;
}): React.JSX.Element {
  const presence = useDevicePresence(true);
  const thisMac = useThisMac();
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
