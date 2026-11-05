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

/**
 * runs-on.tsx -- where a coding agent runs: the cloud, or one of the member's own devices, chosen in a start's chip and shown read-only on each agent's row.
 *
 * Each agent runs where its Start put it, for its life (`agent-wire.ts`'s
 * `agentStartRequestFields`). New task's chip names it for the task and its
 * first agent, and while the Bring your own host experiment is on a draft
 * agent's box wears the same chip (`draft-agent-tab.tsx`), a fork's and a
 * continue's among them (`useStartRunsOn`). The chip, a toolbar chip ending
 * in its chevron as the model chip beside it is, drops a menu: Cloud first, then
 * each device the member registered, as the models answer lists them, by what
 * every list of machines calls it (`machine-name.ts`), This Mac among them,
 * under the glyph of its platform, a Mac or a Linux server, each saying
 * whether it is online, held against the window's own clock, or, online,
 * that it is still getting ready for local agents or couldn't set them up.
 * Every device's glyph wears one dot at its corner rather than words, whose
 * hint says them: green online, gray away, amber where its standing can't
 * be checked, the working tone while it gets ready and red where it
 * couldn't set up; one that takes no agent is dimmed and unpicked too. The
 * dot stands on the glyph rather than at the row's end, which the check of
 * the one picked keeps. The menu stands at the regular width rather than a settings
 * picker's narrow one, so a device's whole name fits. A
 * device offline or not ready is listed but not picked, since the service
 * refuses a task set to one that has not beat lately or is not set up yet.
 * New task's chip starts on the member's last pick, kept in this window, and
 * on Cloud only where nothing is kept or that device is no longer listed. A
 * kept device that is offline, as a Mac is while the app restarts on it, or
 * still getting ready or not set up, stays picked and says so, so its start
 * is refused by name rather than sent quietly to the cloud. It stands on
 * every New task but an automation's or a child's, and lists Cloud alone
 * where the member has no device, or while the Bring your own host
 * experiment is off, which lists no device (`new-task-composer.tsx`). On
 * the task, each agent's row in its plan's head says Cloud, or the device
 * that agent runs on, named the same way, or that the device was removed
 * (`plan-agents.tsx`).
 */

/** What the menu and its chips say. */
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

/** The id the Cloud row is picked by, which no device's id is. */
const CLOUD_ROW = "cloud";

/** Where New task keeps the member's last pick: Cloud's id, or a device's. */
const KEPT = { PICK: keptKey("app.newTaskRunsOn", Schema.String) } as const;

/** The cloud, as a request names it. */
const RUNS_ON_CLOUD: TaskRunsOnRequest = { machine: AGENT_MACHINE.VERCEL };

/** A device's glyph by its platform (`devicePlatformOf`): a server's for Linux, a Mac's otherwise. */
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

/** The tone of each standing's dot: green online, gray away or still being checked, the attention tone where it cannot be checked. */
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

/** A device as a list of places draws it: its platform's glyph wearing one dot, its words on hover and to a reader, and why it takes no agent now, none where it does. */
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

/** A device's row past its name, for every device alike (`deviceMark`); one that takes no agent is dimmed and unpicked too, its dot saying why. */
function offerMarks(
  device: MacOffer,
  book: PresenceBook,
): Pick<MenuRow, "icon" | "disabled" | "why"> {
  const { icon, unready } = deviceMark(device, book);
  return unready === undefined ? { icon } : { icon, disabled: unready, why: MENU_ROW_WHY.MARK };
}

/** Cloud, then each device by what the list calls it, its platform's glyph wearing its standing's dot, one that takes no agent muted and unpicked. */
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

/** Where an agent runs, by the id its Runs on row is picked by: Cloud's, or its device's; none for one on a device the service no longer names. */
function placeRow(agent: Pick<AgentSummary, "machine" | "mac">): string | undefined {
  return agent.machine === AGENT_MACHINE.DEVICE ? agent.mac?.deviceId : CLOUD_ROW;
}

/** A Start's place by its Runs on row's id: the cloud, or the device it names. */
function rowRequest(row: string): AgentRunsOnRequest {
  return row === CLOUD_ROW ? RUNS_ON_CLOUD : { machine: AGENT_MACHINE.DEVICE, deviceId: row };
}

/** What a draft's Runs on starts on before a pick: where its source runs, else the member's newest agent on the task. */
interface StartPlaceSeed {
  /** The agent a fork or a continue starts from, whose place it keeps unless picked otherwise. */
  readonly source: Pick<AgentSummary, "machine" | "mac"> | undefined;
  /** The task's agents, archived ones among them, of which the member's newest decides. */
  readonly agents: readonly Pick<AgentSummary, "machine" | "mac" | "createdAt" | "startedBy">[];
  /** The signed-in member, whose agents alone decide, since a device is one member's. */
  readonly me: string | undefined;
}

/**
 * A draft agent's Runs on: the place `picked` names, else the one the
 * service gives a Start naming none (`machineOfStart`) as far as the window
 * can tell it, where the source runs for a fork or a continue, else where
 * the member's newest agent on the task runs, else the member's last pick
 * kept in this window, which a pick here keeps too, else Cloud. Answers the
 * device it shows, none for the cloud, and the setter, which hands `onPick` the place picked. Note that the last pick is
 * this window's, while the service keeps the account's (`runs-on-pick.ts`),
 * so a pick made in another window, or a task's own place where no pick was
 * ever made, can run an untouched draft elsewhere than its chip says; a
 * Start sends a place only once one is picked, so the service still decides
 * the rest. A default device the member's list does not name, a teammate's
 * a fork's source runs on, or one before the list is read, is named as the
 * agent it came from names it, rather than said to be Cloud.
 */
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
  // Note that the agent names its device by its name alone, so it stands as an offer of no model, its standing unread.
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

/** What New task's chip says of the device picked, by what the list calls it: that alone while it takes an agent, and why it does not, or that its standing cannot be told, otherwise. */
function offerStateWords(device: MacOffer, book: PresenceBook, name: string): string {
  const unready = offerUnready(device, book);
  if (unready !== undefined) return `${name} · ${unready.words}`;
  const standing = offerStanding(device, book);
  return standing === DEVICE_STANDING.ONLINE ? name : `${name} · ${STANDING_WORDS[standing]}`;
}

/** What a start sends of New task's pick: the device it names, or the cloud. */
export function newTaskRunsOn(device: MacOffer | undefined): TaskRunsOnRequest {
  return device === undefined
    ? RUNS_ON_CLOUD
    : { machine: AGENT_MACHINE.DEVICE, deviceId: device.deviceId };
}

/** New task's Runs on chip: Cloud or the device picked, its glyph alone in a card too narrow for its words, dropping the menu. */
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
  /** Whether the card is too narrow for its words, so it draws its glyph alone. */
  narrow: boolean;
  onChoose: (deviceId: string | undefined) => void;
}): React.JSX.Element {
  // Note that the clock only redraws the chip as a beat ages, since the standing is read off the book's own monotonic clock.
  useSecond();
  // Note that a chip offering Cloud alone reads no beats, because it draws no device.
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

/**
 * Where an agent runs, as its row says it: the cloud's glyph and Cloud, or
 * the device's glyph by its platform, where the member's devices list it,
 * and what every list of machines calls it, or that the device was removed.
 * Note that it is the agent's own, read off its summary, since each agent
 * is placed as it starts.
 */
export function RunsOnPlace({
  agent,
  devices,
}: {
  agent: Pick<AgentSummary, "machine" | "mac">;
  /** The member's devices, which give a device's platform; a teammate's device is drawn as a Mac. */
  devices: readonly MacOffer[] | undefined;
}): React.JSX.Element {
  const thisMac = useThisMac();
  const { mac } = agent;
  const cloud = agent.machine !== AGENT_MACHINE.DEVICE;
  // Note that the agent names its device alone, so This Mac is told by its device and no name is twinned.
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
      {/* Note that a device is named as its owner named it, so only Cloud and a removed device show. */}
      <span>
        <ReplayWords unmasked={device === undefined}>{words}</ReplayWords>
      </span>
    </Inline>
  );
}
