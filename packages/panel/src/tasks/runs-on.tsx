import { AGENT_MACHINE, DEVICE_STANDING, type DeviceStanding } from "@luke/features/agent-wire";
import {
  DEVICE_PLATFORM,
  DEVICE_SETUP,
  type DevicePlatform,
} from "@luke/features/device-agent-wire";
import type { MacOffer } from "@luke/features/models-wire";
import type { TaskRunsOn, TaskRunsOnRequest } from "@luke/features/task-wire";
import {
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
} from "@luke/ui";
import { GLYPH, ICON_SIZE } from "@luke/ui/icons";
import { Schema } from "effect";
import { devicePlatformOf } from "../device-platform.js";
import { type PresenceBook, presenceStanding, useDevicePresence } from "../device-presence.js";
import { DEVICE_SETUP_WORDS } from "../device-setup.js";
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
 * that it is still getting ready for local agents or couldn't set them up.
 * Every device's glyph wears one dot at its corner rather than words, whose
 * hint says them: green online, grey away, amber where its standing can't
 * be checked, the working tone while it gets ready and red where it
 * couldn't set up; one that takes no agent is dimmed and unpicked too. The
 * dot stands on the glyph rather than at the row's end, which the check of
 * the one picked keeps. The menu stands at the regular width rather than a settings
 * picker's narrow one, so a device's whole name fits. A
 * device offline or not ready is listed but not picked, since the service
 * refuses a task set to one that has not beat lately or is not set up yet.
 * New task's chip starts on the member's last pick, kept in this window, and
 * on Cloud only where nothing is kept or that device is no longer listed. A
 * kept device that is offline, as a Mac is while Luke restarts on it, or
 * still getting ready or not set up, stays picked and says so, so its start
 * is refused by name rather than sent quietly to the cloud. It stands on
 * every New task but an automation's or a child's, and lists Cloud alone
 * where the member has no device, or while the Bring your own host
 * experiment is off, which lists no device (`new-task-composer.tsx`). On
 * the task, each agent's row in its plan's head says Cloud, or the device
 * it runs on, or that the device was removed (`plan-agents.tsx`).
 */

/** What the menu and its chips say. */
const RUNS_ON_WORDS = {
  LABEL: "Runs on",
  CLOUD: "Cloud",
  ONLINE: "Online",
  OFFLINE: "Offline",
  UNKNOWN: "Can't check status",
  CHECKING: "Checking",
  REMOVED: "Removed device",
  NO_MATCH: "No devices match",
} as const;

/** The id the Cloud row is picked by, which no device's id is. */
const CLOUD_ROW = "cloud";

/** Where New task keeps the member's last pick: Cloud's id, or a device's. */
const KEPT = { PICK: keptKey("luke.newTaskRunsOn", Schema.String) } as const;

/** The cloud, as a request names it. */
const RUNS_ON_CLOUD: TaskRunsOnRequest = { machine: AGENT_MACHINE.VERCEL };

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

/** The tone of each standing's dot: green online, grey away or still being checked, the attention tone where it cannot be checked. */
const STANDING_TONE = {
  [DEVICE_STANDING.ONLINE]: STATUS_TONE.COMPLETE,
  [DEVICE_STANDING.OFFLINE]: STATUS_TONE.NEUTRAL,
  [DEVICE_STANDING.UNKNOWN]: STATUS_TONE.ATTENTION,
  [DEVICE_STANDING.CHECKING]: STATUS_TONE.NEUTRAL,
} as const;

/** The tone of the dot of a device online but not ready: still getting ready is working, one that couldn't set up failed. */
const SETUP_TONE = {
  [DEVICE_SETUP.PREPARING]: STATUS_TONE.WORKING,
  [DEVICE_SETUP.FAILED]: STATUS_TONE.DANGER,
} as const;

/** Why a device offered takes no agent now, and its dot's tone: away, or still getting ready or not set up, whatever its standing; none for one that takes an agent, and none for one whose standing cannot be told yet, which is not called away. */
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

/** A device's row past its name: its platform's glyph wearing one dot, its words on hover and to a reader, for every device alike; one that takes no agent is dimmed and unpicked too, its dot saying why. */
function offerMarks(
  device: MacOffer,
  book: PresenceBook,
): Pick<MenuRow, "icon" | "disabled" | "why"> {
  const unready = offerUnready(device, book);
  const standing = offerStanding(device, book);
  const tone = unready?.tone ?? STANDING_TONE[standing];
  const words = unready?.words ?? STANDING_WORDS[standing];
  const icon = (
    <StatusGlyph tone={tone} label={words}>
      <DeviceGlyph device={device} />
    </StatusGlyph>
  );
  return unready === undefined
    ? { icon }
    : { icon, disabled: unready.words, why: MENU_ROW_WHY.MARK };
}

/** Cloud, then each device by name, its platform's glyph wearing its standing's dot, one that takes no agent muted and unpicked. */
function runsOnRows(devices: readonly MacOffer[], book: PresenceBook): readonly MenuRow[] {
  return [
    { id: CLOUD_ROW, label: RUNS_ON_WORDS.CLOUD, icon: <GLYPH.CLOUD /> },
    ...devices.map(
      (device): MenuRow => ({
        id: device.deviceId,
        label: device.name,
        ...offerMarks(device, book),
      }),
    ),
  ];
}

/**
 * New task's pick, starting on the member's last where that device is
 * listed, ready or not, else Cloud, and kept as it changes. Answers the
 * device picked, none for the cloud, the setter, and whether the pick kept
 * is a device, listed or not, which a start waits on the devices' read for.
 * Note that an offline device, or one still getting ready, stays picked
 * rather than falling back to Cloud, because a task's Runs on is fixed as it
 * starts, and one sent to the cloud while its Mac was away for a moment could
 * never be moved back.
 */
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

/** What New task's chip says of the device picked: its name while it takes an agent, and why it does not, or that its standing cannot be told, otherwise. */
function offerStateWords(device: MacOffer, book: PresenceBook): string {
  const unready = offerUnready(device, book);
  if (unready !== undefined) return `${device.name} · ${unready.words}`;
  const standing = offerStanding(device, book);
  return standing === DEVICE_STANDING.ONLINE
    ? device.name
    : `${device.name} · ${STANDING_WORDS[standing]}`;
}

/** What a start sends of New task's pick: the device it names, or the cloud. */
export function newTaskRunsOn(device: MacOffer | undefined): TaskRunsOnRequest {
  return device === undefined
    ? RUNS_ON_CLOUD
    : { machine: AGENT_MACHINE.DEVICE, deviceId: device.deviceId };
}

/** New task's Runs on chip: Cloud or the device picked, dropping the menu. */
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
  // Note that a chip offering Cloud alone reads no beats, because it draws no device's standing.
  const book = useDevicePresence(devices.length > 0);
  return (
    <Picker
      label={RUNS_ON_WORDS.LABEL}
      value={device?.deviceId ?? CLOUD_ROW}
      valueLabel={device === undefined ? RUNS_ON_WORDS.CLOUD : offerStateWords(device, book)}
      valueIcon={device === undefined ? <GLYPH.CLOUD /> : <DeviceGlyph device={device} />}
      rows={runsOnRows(devices, book)}
      noMatch={RUNS_ON_WORDS.NO_MATCH}
      align={POPOVER_ALIGN.START}
      width={CHIP_WIDTH.AUTO}
      menuWidth={POPOVER_WIDTH.REGULAR}
      disabled={disabled}
      onPick={(id) => onChoose(id === CLOUD_ROW ? undefined : id)}
    />
  );
}

/**
 * Where a task's agents run, as each agent's row says it: the cloud's glyph
 * and Cloud, or the device's glyph by its platform and its name, or that
 * the device was removed. Note that it is the task's, shared by every agent
 * on it, and words alone, since it is set when the task is created.
 */
export function RunsOnPlace({ runsOn }: { runsOn: TaskRunsOn | undefined }): React.JSX.Element {
  const words =
    runsOn === undefined ? RUNS_ON_WORDS.CLOUD : (runsOn.device?.name ?? RUNS_ON_WORDS.REMOVED);
  return (
    <Inline gap={GAP.ICON} wrap={false}>
      <GlyphSlot size={ICON_SIZE.SMALL}>
        {runsOn === undefined ? <GLYPH.CLOUD /> : <DeviceGlyph device={runsOn.device} />}
      </GlyphSlot>
      <span>{words}</span>
    </Inline>
  );
}
