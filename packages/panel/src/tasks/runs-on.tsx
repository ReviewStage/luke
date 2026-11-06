import {
  AGENT_MACHINE,
  type AgentRunsOnRequest,
  type AgentSummary,
  DEVICE_STANDING,
  type DeviceStanding,
} from "@repo/features/agent-wire";
import {
  DEVICE_PLATFORM,
  DEVICE_SETUP,
  type DevicePlatform,
} from "@repo/features/device-agent-wire";
import type { MacOffer } from "@repo/features/models-wire";
import type { TaskRunsOnRequest } from "@repo/features/task-wire";
import {
  CHIP_LOOK,
  CHIP_WIDTH,
  GAP,
  GlyphSlot,
  Inline,
  MENU_ROW_WHY,
  type MenuRow,
  POPOVER_ALIGN,
  POPOVER_WIDTH,
  STATUS_TONE,
  StatusGlyph,
  type StatusTone,
  useSecond,
} from "@repo/ui";
import { GLYPH, ICON_SIZE } from "@repo/ui/icons";
import { ReplayWords } from "@repo/ui/session-replay-marks";
import { Schema } from "effect";
import { devicePlatformOf } from "../device-platform.js";
import { type PresenceBook, presenceStanding, useDevicePresence } from "../device-presence.js";
import { DEVICE_SETUP_WORDS } from "../device-setup.js";
import { machineName, type ThisMac, useThisMac } from "../machine-name.js";
import { Picker } from "../settings/picker-row.js";
import { keptKey, useKept } from "../use-kept.js";

export const RUNS_ON_WORDS = {
  LABEL: "Runs on",
  CLOUD: "Cloud",
  ONLINE: "Online",
  OFFLINE: "Offline",
  UNKNOWN: "Can't check status",
  CHECKING: "Checking",
  REMOVED: "Removed device",
  NO_MATCH: "No devices match",
} as const;

const CLOUD_ROW = "cloud";

const KEPT = { PICK: keptKey("app.newTaskRunsOn", Schema.String) } as const;

const RUNS_ON_CLOUD: TaskRunsOnRequest = { machine: AGENT_MACHINE.VERCEL };

export function DeviceGlyph({
  device,
}: {
  device: { readonly platform?: DevicePlatform } | undefined;
}): React.JSX.Element {
  return devicePlatformOf(device ?? {}) === DEVICE_PLATFORM.LINUX ? (
    <GLYPH.HOST />
  ) : (
    <GLYPH.DESKTOP />
  );
}

function offerStanding(device: MacOffer, book: PresenceBook): DeviceStanding {
  if (device.seenAt === undefined) return DEVICE_STANDING.ONLINE;
  return presenceStanding(book, device.deviceId) ?? DEVICE_STANDING.OFFLINE;
}

const STANDING_WORDS = {
  [DEVICE_STANDING.ONLINE]: RUNS_ON_WORDS.ONLINE,
  [DEVICE_STANDING.OFFLINE]: RUNS_ON_WORDS.OFFLINE,
  [DEVICE_STANDING.UNKNOWN]: RUNS_ON_WORDS.UNKNOWN,
  [DEVICE_STANDING.CHECKING]: RUNS_ON_WORDS.CHECKING,
} as const;

const STANDING_TONE = {
  [DEVICE_STANDING.ONLINE]: STATUS_TONE.COMPLETE,
  [DEVICE_STANDING.OFFLINE]: STATUS_TONE.NEUTRAL,
  [DEVICE_STANDING.UNKNOWN]: STATUS_TONE.ATTENTION,
  [DEVICE_STANDING.CHECKING]: STATUS_TONE.NEUTRAL,
} as const;

const SETUP_TONE = {
  [DEVICE_SETUP.PREPARING]: STATUS_TONE.WORKING,
  [DEVICE_SETUP.FAILED]: STATUS_TONE.DANGER,
} as const;

function offerUnready(
  device: MacOffer,
  book: PresenceBook,
): { readonly words: string; readonly tone: StatusTone } | undefined {
  if (offerStanding(device, book) === DEVICE_STANDING.OFFLINE)
    return { words: RUNS_ON_WORDS.OFFLINE, tone: STANDING_TONE[DEVICE_STANDING.OFFLINE] };
  switch (device.setup) {
    case DEVICE_SETUP.PREPARING:
      return {
        words: DEVICE_SETUP_WORDS[DEVICE_SETUP.PREPARING],
        tone: SETUP_TONE[DEVICE_SETUP.PREPARING],
      };
    case DEVICE_SETUP.FAILED:
      return {
        words: DEVICE_SETUP_WORDS[DEVICE_SETUP.FAILED],
        tone: SETUP_TONE[DEVICE_SETUP.FAILED],
      };
    case undefined:
      return undefined;
  }
}

export function deviceMark(
  device: MacOffer,
  book: PresenceBook,
): { readonly icon: React.JSX.Element; readonly unready: string | undefined } {
  const unready = offerUnready(device, book);
  const standing = offerStanding(device, book);
  const tone = unready?.tone ?? STANDING_TONE[standing];
  const words = unready?.words ?? STANDING_WORDS[standing];
  const icon = (
    <StatusGlyph tone={tone} label={words}>
      <DeviceGlyph device={device} />
    </StatusGlyph>
  );
  return { icon, unready: unready?.words };
}

function offerMarks(
  device: MacOffer,
  book: PresenceBook,
): Pick<MenuRow, "icon" | "disabled" | "why"> {
  const { icon, unready } = deviceMark(device, book);
  return unready === undefined ? { icon } : { icon, disabled: unready, why: MENU_ROW_WHY.MARK };
}

function runsOnRows(
  devices: readonly MacOffer[],
  book: PresenceBook,
  thisMac: ThisMac,
): readonly MenuRow[] {
  return [
    { id: CLOUD_ROW, label: RUNS_ON_WORDS.CLOUD, icon: <GLYPH.CLOUD /> },
    ...devices.map(
      (device): MenuRow => ({
        id: device.deviceId,
        label: machineName(device, devices, thisMac),
        ...offerMarks(device, book),
      }),
    ),
  ];
}

export function useNewTaskRunsOn(
  devices: readonly MacOffer[],
): readonly [MacOffer | undefined, (deviceId: string | undefined) => void, boolean] {
  const [kept, keep] = useKept(KEPT.PICK, CLOUD_ROW);
  const picked = devices.find((each) => each.deviceId === kept);
  return [
    picked,
    (deviceId: string | undefined) => keep(deviceId ?? CLOUD_ROW),
    kept !== CLOUD_ROW,
  ];
}

function placeRow(agent: Pick<AgentSummary, "machine" | "mac">): string | undefined {
  return agent.machine === AGENT_MACHINE.DEVICE ? agent.mac?.deviceId : CLOUD_ROW;
}

function rowRequest(row: string): AgentRunsOnRequest {
  return row === CLOUD_ROW ? RUNS_ON_CLOUD : { machine: AGENT_MACHINE.DEVICE, deviceId: row };
}

interface StartPlaceSeed {
  readonly source: Pick<AgentSummary, "machine" | "mac"> | undefined;
  readonly agents: readonly Pick<AgentSummary, "machine" | "mac" | "createdAt" | "startedBy">[];
  readonly me: string | undefined;
}

export function useStartRunsOn(
  devices: readonly MacOffer[],
  picked: AgentRunsOnRequest | undefined,
  seed: StartPlaceSeed,
  onPick: (runsOn: AgentRunsOnRequest) => void,
): readonly [MacOffer | undefined, (deviceId: string | undefined) => void] {
  const [kept, keep] = useKept(KEPT.PICK, CLOUD_ROW);
  const newest = seed.agents
    .filter((agent) => seed.me !== undefined && agent.startedBy?.userId === seed.me)
    .reduce<(typeof seed.agents)[number] | undefined>(
      (was, agent) => (was === undefined || agent.createdAt > was.createdAt ? agent : was),
      undefined,
    );
  const seeded = seed.source ?? newest;
  const row =
    picked === undefined
      ? ((seeded === undefined ? undefined : placeRow(seeded)) ?? kept)
      : picked.machine === AGENT_MACHINE.DEVICE
        ? picked.deviceId
        : CLOUD_ROW;
  const unlisted =
    picked === undefined && seeded?.mac?.deviceId !== undefined && seeded.mac.deviceId === row
      ? { deviceId: row, name: seeded.mac.name, providers: [] }
      : undefined;
  return [
    devices.find((each) => each.deviceId === row) ?? unlisted,
    (deviceId: string | undefined) => {
      const chosen = deviceId ?? CLOUD_ROW;
      keep(chosen);
      onPick(rowRequest(chosen));
    },
  ];
}

function offerStateWords(device: MacOffer, book: PresenceBook, name: string): string {
  const unready = offerUnready(device, book);
  if (unready !== undefined) return `${name} · ${unready.words}`;
  const standing = offerStanding(device, book);
  return standing === DEVICE_STANDING.ONLINE ? name : `${name} · ${STANDING_WORDS[standing]}`;
}

export function newTaskRunsOn(device: MacOffer | undefined): TaskRunsOnRequest {
  return device === undefined
    ? RUNS_ON_CLOUD
    : { machine: AGENT_MACHINE.DEVICE, deviceId: device.deviceId };
}

export function NewTaskRunsOnChip({
  devices,
  device,
  disabled,
  narrow,
  onChoose,
}: {
  devices: readonly MacOffer[];
  device: MacOffer | undefined;
  disabled: boolean;
  narrow: boolean;
  onChoose: (deviceId: string | undefined) => void;
}): React.JSX.Element {
  useSecond();
  const book = useDevicePresence(devices.length > 0);
  const thisMac = useThisMac();
  return (
    <Picker
      label={RUNS_ON_WORDS.LABEL}
      value={device?.deviceId ?? CLOUD_ROW}
      valueLabel={
        device === undefined
          ? RUNS_ON_WORDS.CLOUD
          : offerStateWords(device, book, machineName(device, devices, thisMac))
      }
      valueIcon={device === undefined ? <GLYPH.CLOUD /> : <DeviceGlyph device={device} />}
      iconOnly={narrow}
      rows={runsOnRows(devices, book, thisMac)}
      noMatch={RUNS_ON_WORDS.NO_MATCH}
      align={POPOVER_ALIGN.START}
      width={CHIP_WIDTH.AUTO}
      look={CHIP_LOOK.TOOLBAR}
      chevron
      menuWidth={POPOVER_WIDTH.REGULAR}
      disabled={disabled}
      onPick={(id) => onChoose(id === CLOUD_ROW ? undefined : id)}
    />
  );
}

export function RunsOnPlace({
  agent,
  devices,
}: {
  agent: Pick<AgentSummary, "machine" | "mac">;
  devices: readonly MacOffer[] | undefined;
}): React.JSX.Element {
  const thisMac = useThisMac();
  const { mac } = agent;
  const cloud = agent.machine !== AGENT_MACHINE.DEVICE;
  const words = cloud
    ? RUNS_ON_WORDS.CLOUD
    : mac === undefined
      ? RUNS_ON_WORDS.REMOVED
      : machineName({ deviceId: mac.deviceId, name: mac.name }, [], thisMac);
  const device = devices?.find(
    (each) => mac?.deviceId !== undefined && each.deviceId === mac.deviceId,
  );
  return (
    <Inline gap={GAP.ICON} wrap={false}>
      <GlyphSlot size={ICON_SIZE.SMALL}>
        {cloud ? <GLYPH.CLOUD /> : <DeviceGlyph device={device} />}
      </GlyphSlot>
      <span>
        <ReplayWords unmasked={device === undefined}>{words}</ReplayWords>
      </span>
    </Inline>
  );
}
