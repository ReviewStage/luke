import { CODING_AGENT_MACHINE, macOnline } from "@luke/features/coding-agent-wire";
import { DEVICE_KIND, type DeviceKind } from "@luke/features/device-agent-wire";
import type { MacOffer } from "@luke/features/models-wire";
import type { TaskRunsOn, TaskRunsOnRequest } from "@luke/features/task-wire";
import { CHIP_WIDTH, type MenuRow, POPOVER_ALIGN, useSecond } from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { Schema } from "effect";
import { useState } from "react";
import { ExperimentTag } from "../experiment-marks.js";
import { Picker } from "../settings/picker-row.js";
import { keptKey, useKept } from "../use-kept.js";

/**
 * runs-on.tsx -- where a task's coding agents run: the cloud, or one of the member's own devices, as New task's chip and the task's own control choose it.
 *
 * Where agents run is the task's (`task-wire.ts`'s `runsOn`), and it decides
 * where every agent started on it afterwards runs. Both controls drop the
 * same menu: Cloud first, then each device the member registered, as the
 * models answer lists them, by its name under the glyph of its kind, a Mac
 * running Luke or a host, each saying whether it is online, held against
 * the window's own clock. An offline device is listed but not picked, since
 * the service refuses a task set to one that has not beat lately. New task's chip
 * starts on the member's last pick, kept in this window, and on Cloud where
 * that device is no longer listed or is offline, which the card then holds
 * until a pick, so a device coming back mid-compose never moves it; it wears the Experimental
 * tag; it stands only while the member has a device to pick. The task's
 * control stands with its status and priority, saying the device it runs on
 * and whether it is online, or that the device was removed, and its hint
 * says a change reaches only the agents started from then on. Both are
 * drawn only while the Local agents experiment is on, which their owners
 * ask.
 */

/** What the menu and its chips say. */
const RUNS_ON_WORDS = {
  LABEL: "Runs on",
  CLOUD: "Cloud",
  ONLINE: "Online",
  OFFLINE: "Offline",
  REMOVED: "Removed device",
  NO_MATCH: "No devices match",
  HINT: "Where this task's agents run. A change applies to agents started from now on.",
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

/** Whether a device offered is online at `now`; one a service before beats said nothing of is, as it listed only those. */
function offerOnline(device: MacOffer, now: number): boolean {
  return device.seenAt === undefined || macOnline(device.seenAt, now);
}

/** Cloud, then each device by name under its kind's glyph, an online one saying so and an offline one muted, unpicked. */
function runsOnRows(devices: readonly MacOffer[], now: number): readonly MenuRow[] {
  return [
    { id: CLOUD_ROW, label: RUNS_ON_WORDS.CLOUD, icon: <GLYPH.CLOUD /> },
    ...devices.map(
      (device): MenuRow => ({
        id: device.deviceId,
        label: device.name,
        icon: <DeviceGlyph kind={device.kind} />,
        ...(offerOnline(device, now)
          ? { detail: RUNS_ON_WORDS.ONLINE }
          : { disabled: RUNS_ON_WORDS.OFFLINE }),
      }),
    ),
  ];
}

/** What a picked row asks: the cloud, or the device it names. */
function runsOnOf(id: string): TaskRunsOnRequest {
  return id === CLOUD_ROW ? RUNS_ON_CLOUD : { machine: CODING_AGENT_MACHINE.DEVICE, deviceId: id };
}

/**
 * New task's pick, starting on the member's last where that device is listed
 * and online, else Cloud, and kept as it changes. Answers the device picked,
 * none for the cloud, and the setter.
 */
export function useNewTaskRunsOn(
  devices: readonly MacOffer[] | undefined,
): readonly [MacOffer | undefined, (deviceId: string | undefined) => void] {
  const [kept, keep] = useKept(KEPT.PICK, CLOUD_ROW);
  // Whether this card fell back to Cloud, which it holds until a pick, so a device coming back mid-compose never moves it.
  const [fellBack, setFellBack] = useState(false);
  const now = useSecond();
  const picked = devices?.find((each) => each.deviceId === kept);
  const usable = picked !== undefined && offerOnline(picked, now);
  // Note that a list not yet read judges nothing, so the kept device stands once it arrives online.
  if (!fellBack && !usable && kept !== CLOUD_ROW && devices !== undefined) setFellBack(true);
  const choose = (deviceId: string | undefined) => {
    setFellBack(false);
    keep(deviceId ?? CLOUD_ROW);
  };
  return [usable && !fellBack ? picked : undefined, choose];
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
  return (
    <span className="new-task-runs-on inline-flex min-w-0 items-center gap-item-gap">
      <Picker
        label={RUNS_ON_WORDS.LABEL}
        value={device?.deviceId ?? CLOUD_ROW}
        valueLabel={device?.name ?? RUNS_ON_WORDS.CLOUD}
        valueIcon={device === undefined ? <GLYPH.CLOUD /> : <DeviceGlyph kind={device.kind} />}
        rows={runsOnRows(devices, now)}
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
function standingWords(runsOn: TaskRunsOn | undefined, now: number): string {
  if (runsOn === undefined) return RUNS_ON_WORDS.CLOUD;
  if (runsOn.device === undefined) return RUNS_ON_WORDS.REMOVED;
  const online = macOnline(runsOn.device.seenAt, now);
  return `${runsOn.device.name} · ${online ? RUNS_ON_WORDS.ONLINE : RUNS_ON_WORDS.OFFLINE}`;
}

/**
 * The task's Runs on control, beside its status and priority: where its
 * agents run now, dropping the menu, a pick other than it handed to `onPick`.
 */
export function TaskRunsOnPicker({
  runsOn,
  devices,
  onOpen,
  onPick,
}: {
  runsOn: TaskRunsOn | undefined;
  devices: readonly MacOffer[];
  /** Reads the devices again as the menu opens, so one that came online since is pickable. */
  onOpen?: (() => void) | undefined;
  /** Where a pick is sent; without one the control only says. */
  onPick: ((runsOn: TaskRunsOnRequest) => void) | undefined;
}): React.JSX.Element {
  const now = useSecond();
  const value = runsOn === undefined ? CLOUD_ROW : runsOn.deviceId;
  return (
    <Picker
      label={RUNS_ON_WORDS.LABEL}
      hint={RUNS_ON_WORDS.HINT}
      value={value}
      valueLabel={standingWords(runsOn, now)}
      valueIcon={
        runsOn === undefined ? <GLYPH.CLOUD /> : <DeviceGlyph kind={runsOn.device?.kind} />
      }
      rows={runsOnRows(devices, now)}
      noMatch={RUNS_ON_WORDS.NO_MATCH}
      align={POPOVER_ALIGN.START}
      width={CHIP_WIDTH.AUTO}
      disabled={onPick === undefined}
      onOpen={onOpen}
      onPick={(id) => {
        if (id !== value) onPick?.(runsOnOf(id));
      }}
    />
  );
}
