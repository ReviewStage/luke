import { useAtomValue } from "@effect/atom-react";
import { ACT_KIND } from "@luke/host/acts";
import type { ThisMacHostRead } from "@luke/host/contract";
import { Duration, Effect, Option, Schedule, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { askAct } from "./act.js";
import { rendererRuntime } from "./renderer-runtime.js";

/**
 * machine-name.ts -- what every list of the member's machines calls each one: This Mac, or its name, with its model where another listed machine has that name too.
 *
 * Settings › Hosts, New task's Runs on, and an agent's row in its plan's
 * head all name a machine here (`machineName`), so they never disagree. The
 * machine the desktop app runs on reads "This Mac": the one whose host
 * reported the same keyed machine id the desktop reads of this Mac, or, for
 * one whose host reported none, the device this Mac's account host's record
 * names. Two machines listed under one name, as two Macs set up alike are,
 * each say their model after it. This Mac is read once and then every few
 * seconds while any surface names a machine: one read, however many
 * surfaces. A browser tab has no This Mac, since its host refuses the read,
 * so it reads once and no more (`useThisMac`).
 */

/** What the machine the desktop app runs on is called. */
export const THIS_MAC = "This Mac";

/** How often This Mac is read again while a surface draws a machine, so a Mac the app just enrolled finds its row within seconds of the service listing it. */
const READ_EVERY = Duration.seconds(5);

/** A machine as a list holds it: its device, the name it registered, and which machine it is and its model, where its host reported them. */
export interface ListedMachine {
  readonly deviceId: string | undefined;
  readonly name: string;
  readonly machineId?: string | undefined;
  readonly model?: string | undefined;
}

/** This Mac as the desktop reads it (`ThisMacHostRead`); none in a browser tab. */
export type ThisMac = ThisMacHostRead | undefined;

/** One read of This Mac; none where the window has none. */
const thisMacRead: Effect.Effect<Option.Option<ThisMacHostRead>> = Effect.tryPromise(() =>
  askAct(ACT_KIND.THIS_MAC_HOST_READ),
).pipe(
  Effect.map((answer) => ("failure" in answer ? Option.none() : Option.some(answer))),
  Effect.orElseSucceed(() => Option.none<ThisMacHostRead>()),
);

/** The shared read, run only while a surface subscribes, once and then every `READ_EVERY`, until a read is refused, as a browser tab's always is. */
const thisMacAtom = rendererRuntime.atom(
  Stream.fromEffectSchedule(thisMacRead, Schedule.spaced(READ_EVERY)).pipe(
    Stream.takeWhile(Option.isSome),
    Stream.map((read) => read.value),
  ),
);

/** Whether the machine given is the one the desktop app runs on: by machine id where both name one, else by the device this Mac's host's record names. */
export function isThisMac(machine: ListedMachine, thisMac: ThisMac): boolean {
  if (thisMac === undefined) return false;
  if (machine.machineId !== undefined && thisMac.machineId !== undefined) {
    return machine.machineId === thisMac.machineId;
  }
  return machine.deviceId !== undefined && machine.deviceId === thisMac.deviceId;
}

/** What the machine given is called among those listed: This Mac, or its name, and its model where another listed machine but This Mac has the same name. */
export function machineName(
  machine: ListedMachine,
  listed: readonly ListedMachine[],
  thisMac: ThisMac,
): string {
  if (isThisMac(machine, thisMac)) return THIS_MAC;
  const twinned = listed.some(
    (other) =>
      other.deviceId !== machine.deviceId &&
      other.name === machine.name &&
      !isThisMac(other, thisMac),
  );
  return twinned && machine.model !== undefined
    ? `${machine.name} · ${machine.model}`
    : machine.name;
}

/** No reading, while no surface draws a machine. */
const IDLE = Atom.make(AsyncResult.initial<ThisMacHostRead>());

/** This Mac while `drawing`, a surface that names a machine, through the window's one shared read; none before it lands, while nothing draws, and in a browser tab. */
export function useThisMac(drawing: boolean): ThisMac {
  return Option.getOrUndefined(AsyncResult.value(useAtomValue(drawing ? thisMacAtom : IDLE)));
}
