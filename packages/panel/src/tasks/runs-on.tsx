import {
  CODING_AGENT_MACHINE,
  DEVICE_STANDING,
  type DeviceStanding,
  deviceStanding,
} from "@luke/features/coding-agent-wire";
import { DEVICE_KIND, type DeviceKind } from "@luke/features/device-agent-wire";
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
import { useMemo } from "react";
import { type PresenceBook, useDeviceBeat, useDevicePresence } from "../device-presence.js";
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
 * name under the glyph of its kind, a Mac running Luke or a host, each saying
 * whether it is online, held against the window's own clock. An offline device is listed but not picked, since
 * the service refuses a task set to one that has not beat lately. New task's chip
 * starts on the member's last pick, kept in this window, and on Cloud only
 * where nothing is kept or that device is no longer listed. A kept device
 * that is offline, as a Mac is while Luke restarts on it and readies its
 * sandbox, stays picked and says so, so its start is refused by name rather
 * than sent quietly to the cloud; it wears the Experimental
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

/** A device's glyph by its kind; a Mac's where a service before kinds said none. */
function DeviceGlyph({ kind }: { kind: DeviceKind | undefined }): React.JSX.Element {
  return kind === DEVICE_KIND.HOST ? <GLYPH.HOST /> : <GLYPH.DESKTOP />;
}

/** Where a device offered stands at `now`; one a service before beats said nothing of is online, as it listed only those. */
function offerStanding(device: MacOffer, book: PresenceBook, now: number): DeviceStanding {
  if (device.seenAt === undefined) return DEVICE_STANDING.ONLINE;
  return deviceStanding(device.seenAt, book.beats.get(device.deviceId), now, book.failed);
}

/** What a menu row says of a device standing as it does: online, or unknown, which is not offered as away, and an offline one muted, unpicked. */
function standingRow(standing: DeviceStanding): Pick<MenuRow, "detail" | "disabled"> {
  if (standing === DEVICE_STANDING.ONLINE) return { detail: RUNS_ON_WORDS.ONLINE };
  return standing === DEVICE_STANDING.OFFLINE
    ? { disabled: RUNS_ON_WORDS.OFFLINE }
    : { detail: RUNS_ON_WORDS.UNKNOWN };
}

/** A device's name, then where it stands where it is not online. */
function standingName(name: string, standing: DeviceStanding): string {
  if (standing === DEVICE_STANDING.ONLINE) return name;
  return `${name} · ${standing === DEVICE_STANDING.OFFLINE ? RUNS_ON_WORDS.OFFLINE : RUNS_ON_WORDS.UNKNOWN}`;
}

/** Cloud, then each device by name under its kind's glyph, an online one saying so and an offline one muted, unpicked. */
function runsOnRows(
  devices: readonly MacOffer[],
  book: PresenceBook,
  now: number,
): readonly MenuRow[] {
  return [
    { id: CLOUD_ROW, label: RUNS_ON_WORDS.CLOUD, icon: <GLYPH.CLOUD /> },
    ...devices.map(
      (device): MenuRow => ({
        id: device.deviceId,
        label: device.name,
        icon: <DeviceGlyph kind={device.kind} />,
        ...standingRow(offerStanding(device, book, now)),
      }),
    ),
  ];
}

/**
 * New task's pick, starting on the member's last where that device is
 * listed, online or not, else Cloud, and kept as it changes. Answers the
 * device picked, none for the cloud, and the setter. Note that an offline
 * device stays picked rather than falling back to Cloud, because a task's
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

/** What New task's chip says of the device picked: its name while online, and that it is offline, or cannot be checked, otherwise. */
function offerStateWords(device: MacOffer, book: PresenceBook, now: number): string {
  return standingName(device.name, offerStanding(device, book, now));
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
  const now = useSecond();
  const ids = useMemo(() => devices.map((each) => each.deviceId), [devices]);
  const book = useDevicePresence(ids);
  return (
    <span className="new-task-runs-on inline-flex min-w-0 items-center gap-item-gap">
      <Picker
        label={RUNS_ON_WORDS.LABEL}
        value={device?.deviceId ?? CLOUD_ROW}
        valueLabel={device === undefined ? RUNS_ON_WORDS.CLOUD : offerStateWords(device, book, now)}
        valueIcon={device === undefined ? <GLYPH.CLOUD /> : <DeviceGlyph kind={device.kind} />}
        rows={runsOnRows(devices, book, now)}
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
function standingWords(runsOn: TaskRunsOn | undefined, book: PresenceBook, now: number): string {
  if (runsOn === undefined) return RUNS_ON_WORDS.CLOUD;
  if (runsOn.device === undefined) return RUNS_ON_WORDS.REMOVED;
  const standing = deviceStanding(
    runsOn.device.seenAt,
    runsOn.deviceId === undefined ? undefined : book.beats.get(runsOn.deviceId),
    now,
    book.failed,
  );
  const words = {
    [DEVICE_STANDING.ONLINE]: RUNS_ON_WORDS.ONLINE,
    [DEVICE_STANDING.OFFLINE]: RUNS_ON_WORDS.OFFLINE,
    [DEVICE_STANDING.UNKNOWN]: RUNS_ON_WORDS.UNKNOWN,
  } as const;
  return `${runsOn.device.name} · ${words[standing]}`;
}

/**
 * The task's Runs on chip, beside its status and priority: where its agents
 * run, read-only, since it is set when the task is created. It drops no menu
 * and takes no press, and its hover says so.
 */
export function TaskRunsOnChip({ runsOn }: { runsOn: TaskRunsOn | undefined }): React.JSX.Element {
  const now = useSecond();
  const book = useDeviceBeat(runsOn?.deviceId);
  const words = standingWords(runsOn, book, now);
  return (
    <Tooltip label={RUNS_ON_WORDS.LOCKED_HINT}>
      <Chip
        look={CHIP_LOOK.FIELD}
        width={CHIP_WIDTH.AUTO}
        aria-label={`${RUNS_ON_WORDS.LABEL}: ${words}`}
        aria-disabled
      >
        {runsOn === undefined ? <GLYPH.CLOUD /> : <DeviceGlyph kind={runsOn.device?.kind} />}
        <ChipName>{words}</ChipName>
      </Chip>
    </Tooltip>
  );
}
