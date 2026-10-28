import {
  CODING_AGENT_MACHINE,
  DEVICE_STANDING,
  type DeviceStanding,
} from "@luke/features/coding-agent-wire";
import {
  DEVICE_PLATFORM,
  DEVICE_SETUP,
  type DevicePlatform,
} from "@luke/features/device-agent-wire";
import type { MacOffer } from "@luke/features/models-wire";
import type { TaskRunsOn, TaskRunsOnRequest } from "@luke/features/task-wire";
import {
  CHIP_LOOK,
  CHIP_WIDTH,
  Chip,
  ChipName,
  type MenuRow,
  POPOVER_ALIGN,
  Tooltip,
  useSecond,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { Schema } from "effect";
import { devicePlatformOf } from "../device-platform.js";
import { type PresenceBook, presenceStanding, useDevicePresence } from "../device-presence.js";
import { ExperimentTag } from "../experiment-marks.js";
import { Picker } from "../settings/picker-row.js";
import { keptKey, useKept } from "../use-kept.js";

/**
 * runs-on.tsx -- where a task's coding agents run: the cloud, or one of the member's own devices, chosen in New task's chip and shown read-only on the task.
 *
 * Where agents run is the task's (`task-wire.ts`'s `runsOn`), it decides
 * where every agent started on it runs, and it is set when the task is
 * created and never changed. New task's chip drops a menu: Cloud first, then
 * each device the member registered, as the models answer lists them, by its
 * name under the glyph of its platform, a Mac or a Linux server, each saying
 * whether it is online, held against the window's own clock, or, online,
 * that it is still getting ready for local agents or couldn't set them up. A
 * device offline or not ready is listed but not picked, since the service
 * refuses a task set to one that has not beat lately or is not set up yet.
 * New task's chip starts on the member's last pick, kept in this window, and
 * on Cloud only where nothing is kept or that device is no longer listed. A
 * kept device that is offline, as a Mac is while Luke restarts on it, or
 * still getting ready or not set up, stays picked and says so, so its start
 * is refused by name rather than sent quietly to the cloud; it wears the Experimental
 * tag; it stands only while the member has a device to pick. The task's
 * chip stands with its status and priority, saying the device it runs on
 * and whether it is online, or that the device was removed, with no menu, and
 * its hint says it was set when the task was created. Both are
 * drawn only while the Local agents experiment is on, which their owners
 * ask.
 */

/** What the menu and its chips say. */
const RUNS_ON_WORDS = {
  LABEL: "Runs on",
  CLOUD: "Cloud",
  ONLINE: "Online",
  OFFLINE: "Offline",
  UNKNOWN: "Can't check status",
  CHECKING: "Checking",
  GETTING_READY: "Getting ready…",
  SETUP_FAILED: "Couldn't set up",
  REMOVED: "Removed device",
  NO_MATCH: "No devices match",
  LOCKED_HINT: "Set when the task was created.",
} as const;

/** The id the Cloud row is picked by, which no device's id is. */
const CLOUD_ROW = "cloud";

/** Where New task keeps the member's last pick: Cloud's id, or a device's. */
const KEPT = { PICK: keptKey("luke.newTaskRunsOn", Schema.String) } as const;

/** The cloud, as a request names it. */
const RUNS_ON_CLOUD: TaskRunsOnRequest = { machine: CODING_AGENT_MACHINE.VERCEL };

/** A device's glyph by its platform (`devicePlatformOf`): a server's for Linux, a Mac's otherwise. */
function DeviceGlyph({
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

/** Where a device offered stands now; one a service before beats said nothing of is online, as it listed only those, and one the presence read does not name, though it is the account's own, is gone. */
function offerStanding(device: MacOffer, book: PresenceBook): DeviceStanding {
  if (device.seenAt === undefined) return DEVICE_STANDING.ONLINE;
  return presenceStanding(book, device.deviceId) ?? DEVICE_STANDING.OFFLINE;
}

/** What each standing is called. */
const STANDING_WORDS = {
  [DEVICE_STANDING.ONLINE]: RUNS_ON_WORDS.ONLINE,
  [DEVICE_STANDING.OFFLINE]: RUNS_ON_WORDS.OFFLINE,
  [DEVICE_STANDING.UNKNOWN]: RUNS_ON_WORDS.UNKNOWN,
  [DEVICE_STANDING.CHECKING]: RUNS_ON_WORDS.CHECKING,
} as const;

/** Why a device offered takes no agent now: away, or still getting ready or not set up, whatever its standing; none for one that takes an agent, and none for one whose standing cannot be told yet, which is not called away. */
function offerUnready(device: MacOffer, book: PresenceBook): string | undefined {
  if (offerStanding(device, book) === DEVICE_STANDING.OFFLINE) return RUNS_ON_WORDS.OFFLINE;
  switch (device.setup) {
    case DEVICE_SETUP.PREPARING:
      return RUNS_ON_WORDS.GETTING_READY;
    case DEVICE_SETUP.FAILED:
      return RUNS_ON_WORDS.SETUP_FAILED;
    case undefined:
      return undefined;
  }
}

/** What a device's row says: why it takes no agent, else that it is online, else that its standing cannot be told yet. */
function offerDetail(device: MacOffer, book: PresenceBook): Pick<MenuRow, "detail" | "disabled"> {
  const unready = offerUnready(device, book);
  if (unready !== undefined) return { disabled: unready };
  const standing = offerStanding(device, book);
  return { detail: STANDING_WORDS[standing] };
}

/** Cloud, then each device by name under its platform's glyph, one that takes an agent saying it is online and any other muted, unpicked, saying why. */
function runsOnRows(devices: readonly MacOffer[], book: PresenceBook): readonly MenuRow[] {
  return [
    { id: CLOUD_ROW, label: RUNS_ON_WORDS.CLOUD, icon: <GLYPH.CLOUD /> },
    ...devices.map(
      (device): MenuRow => ({
        id: device.deviceId,
        label: device.name,
        icon: <DeviceGlyph device={device} />,
        ...offerDetail(device, book),
      }),
    ),
  ];
}

/**
 * New task's pick, starting on the member's last where that device is
 * listed, ready or not, else Cloud, and kept as it changes. Answers the
 * device picked, none for the cloud, and the setter. Note that an offline
 * device, or one still getting ready, stays picked rather than falling back to Cloud, because a task's
 * Runs on is fixed as it starts, and one sent to the cloud while its Mac was
 * away for a moment could never be moved back.
 */
export function useNewTaskRunsOn(
  devices: readonly MacOffer[] | undefined,
): readonly [MacOffer | undefined, (deviceId: string | undefined) => void] {
  const [kept, keep] = useKept(KEPT.PICK, CLOUD_ROW);
  const picked = devices?.find((each) => each.deviceId === kept);
  return [picked, (deviceId: string | undefined) => keep(deviceId ?? CLOUD_ROW)];
}

/** What New task's chip says of the device picked: its name while it takes an agent, and why it does not, or that its standing cannot be told, otherwise. */
function offerStateWords(device: MacOffer, book: PresenceBook): string {
  const unready = offerUnready(device, book);
  if (unready !== undefined) return `${device.name} · ${unready}`;
  const standing = offerStanding(device, book);
  return standing === DEVICE_STANDING.ONLINE
    ? device.name
    : `${device.name} · ${STANDING_WORDS[standing]}`;
}

/** What a start sends of New task's pick: the device it names, or the cloud. */
export function newTaskRunsOn(device: MacOffer | undefined): TaskRunsOnRequest {
  return device === undefined
    ? RUNS_ON_CLOUD
    : { machine: CODING_AGENT_MACHINE.DEVICE, deviceId: device.deviceId };
}

/** New task's Runs on chip, with the Experimental tag after it: Cloud or the device picked, dropping the menu. */
export function NewTaskRunsOnChip({
  devices,
  device,
  disabled,
  onChoose,
}: {
  devices: readonly MacOffer[];
  device: MacOffer | undefined;
  disabled: boolean;
  onChoose: (deviceId: string | undefined) => void;
}): React.JSX.Element {
  // Note that the clock only redraws the chip as a beat ages, since the standing is read off the book's own monotonic clock.
  useSecond();
  const book = useDevicePresence(true);
  return (
    <span className="new-task-runs-on inline-flex min-w-0 items-center gap-item-gap">
      <Picker
        label={RUNS_ON_WORDS.LABEL}
        value={device?.deviceId ?? CLOUD_ROW}
        valueLabel={device === undefined ? RUNS_ON_WORDS.CLOUD : offerStateWords(device, book)}
        valueIcon={device === undefined ? <GLYPH.CLOUD /> : <DeviceGlyph device={device} />}
        rows={runsOnRows(devices, book)}
        noMatch={RUNS_ON_WORDS.NO_MATCH}
        align={POPOVER_ALIGN.START}
        width={CHIP_WIDTH.AUTO}
        disabled={disabled}
        onPick={(id) => onChoose(id === CLOUD_ROW ? undefined : id)}
      />
      <ExperimentTag />
    </span>
  );
}

/** What the task's control says of where it runs now: Cloud, the device and whether it is online, or a device since removed. */
function standingWords(runsOn: TaskRunsOn | undefined, book: PresenceBook): string {
  if (runsOn === undefined) return RUNS_ON_WORDS.CLOUD;
  if (runsOn.device === undefined) return RUNS_ON_WORDS.REMOVED;
  const standing = presenceStanding(book, runsOn.deviceId);
  // Note that a device the read does not name is a teammate's, which the window cannot speak for, so its chip is its name alone.
  return standing === undefined
    ? runsOn.device.name
    : `${runsOn.device.name} · ${STANDING_WORDS[standing]}`;
}

/**
 * The task's Runs on chip, beside its status and priority: where its agents
 * run, read-only, since it is set when the task is created. It drops no menu
 * and takes no press, and its hover says so.
 */
export function TaskRunsOnChip({ runsOn }: { runsOn: TaskRunsOn | undefined }): React.JSX.Element {
  // Note that the clock only redraws the chip as a beat ages, since the standing is read off the book's own monotonic clock.
  useSecond();
  const book = useDevicePresence(runsOn?.device !== undefined);
  const words = standingWords(runsOn, book);
  return (
    <Tooltip label={RUNS_ON_WORDS.LOCKED_HINT}>
      <Chip
        look={CHIP_LOOK.FIELD}
        width={CHIP_WIDTH.AUTO}
        aria-label={`${RUNS_ON_WORDS.LABEL}: ${words}`}
        aria-disabled
      >
        {runsOn === undefined ? <GLYPH.CLOUD /> : <DeviceGlyph device={runsOn.device} />}
        <ChipName>{words}</ChipName>
      </Chip>
    </Tooltip>
  );
}
