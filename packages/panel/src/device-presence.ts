import { useAtomValue } from "@effect/atom-react";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { DEVICE_PRESENCE_MAX_IDS, type DevicePresenceAnswer } from "@luke/features/host-wire";
import { ACT_KIND } from "@luke/host/acts";
import { Duration, Effect, Option, Schedule, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { useContext, useEffect, useMemo } from "react";
import { askAct } from "./act.js";
import { rendererRuntime } from "./renderer-runtime.js";

/**
 * device-presence.ts -- the one source of when each device last beat, which every surface that says whether a device is there reads.
 *
 * A device beats every fifteen seconds, and the lists the window holds (an
 * agent's, a task's, the menu's, Settings' hosts) carry only the beat they
 * were read at, so a surface that judged from them alone read a device
 * offline a while after its last read though it kept beating. A surface
 * that draws a device's standing says which devices it draws here
 * (`useDevicePresence`), and while any does the window reads their beats
 * once, together, every `PRESENCE_EVERY`: beat plus read stays inside the
 * forty-five seconds a device counts as there (`MAC_PRESENCE`), and a device
 * that stopped beating still reads offline within about a minute. Nothing
 * is read while no surface draws one, and no surface keeps a clock of its
 * own. A read that failed is held as failed, which `deviceStanding` turns
 * into "unknown" rather than offline, since a window that could not ask must
 * not say a device is away; the beats an earlier read answered stand until a
 * later one does.
 */

/** How often the beats of the devices drawn are read: under the forty-five seconds a beat counts for, less a beat's own fifteen. */
const PRESENCE_EVERY = Duration.seconds(20);

/** Where the presence reads stand: the beats the last answered, by device, and whether the latest one failed. */
export interface PresenceBook {
  readonly beats: ReadonlyMap<string, number>;
  readonly failed: boolean;
}

const NO_BOOK: PresenceBook = { beats: new Map(), failed: false };

/** How many surfaces draw each device, by its id: the devices the shared read names. */
type Watched = ReadonlyMap<string, number>;

const watchedAtom = Atom.keepAlive(Atom.make<Watched>(new Map()));

/** The watchers with each of `ids` counted once more, or once fewer. */
function watchedWith(watched: Watched, ids: readonly string[], step: 1 | -1): Watched {
  const next = new Map(watched);
  for (const id of ids) {
    const count = (next.get(id) ?? 0) + step;
    if (count > 0) next.set(id, count);
    else next.delete(id);
  }
  return next;
}

/** What one round of reads answered: the beats of the devices that answered, and whether any batch did not. */
export interface PresenceRead {
  readonly devices: DevicePresenceAnswer["devices"];
  readonly failed: boolean;
}

/** One batch of at most `DEVICE_PRESENCE_MAX_IDS` ids: what the service answered, or a failure where it did not. */
function batchRead(ids: readonly string[]): Effect.Effect<PresenceRead> {
  return Effect.tryPromise(() => askAct(ACT_KIND.HOSTS_PRESENCE, { ids })).pipe(
    Effect.map(
      (answer): PresenceRead =>
        "failure" in answer
          ? { devices: [], failed: true }
          : { devices: answer.devices, failed: false },
    ),
    Effect.orElseSucceed((): PresenceRead => ({ devices: [], failed: true })),
  );
}

/** One round of reads of every device drawn, in batches the service takes, answered together. */
function beatsRead(ids: readonly string[]): Effect.Effect<PresenceRead> {
  const batches: string[][] = [];
  for (let from = 0; from < ids.length; from += DEVICE_PRESENCE_MAX_IDS) {
    batches.push(ids.slice(from, from + DEVICE_PRESENCE_MAX_IDS));
  }
  return Effect.forEach(batches, batchRead, { concurrency: "unbounded" }).pipe(
    Effect.map((reads) => ({
      devices: reads.flatMap((read) => read.devices),
      failed: reads.some((read) => read.failed),
    })),
  );
}

/** The book after a round: the beats it answered, over the held ones where a batch failed, and whether any did. */
export function presenceAfter(book: PresenceBook, read: PresenceRead): PresenceBook {
  const beats = new Map(read.failed ? book.beats : []);
  for (const each of read.devices) beats.set(each.deviceId, each.seenAt);
  return { beats, failed: read.failed };
}

/** The shared read, run only while a surface subscribes: again whenever the devices drawn change, and every `PRESENCE_EVERY` between. */
const presenceAtom = rendererRuntime.atom((get) => {
  const ids = [...get(watchedAtom).keys()];
  if (ids.length === 0) return Stream.make(NO_BOOK);
  return Stream.fromEffectSchedule(beatsRead(ids), Schedule.spaced(PRESENCE_EVERY)).pipe(
    Stream.scan(() => NO_BOOK, presenceAfter),
  );
});

const NO_DEVICES: readonly string[] = [];

/**
 * The shared presence, held while the caller draws the devices `ids` names (a
 * stable array, since a new one is a change of devices): the book of beats,
 * to hand `deviceStanding` with the beat each device's own list read carried.
 */
export function useDevicePresence(ids: readonly string[]): PresenceBook {
  const registry = useContext(RegistryContext);
  useEffect(() => {
    if (ids.length === 0) return;
    registry.update(watchedAtom, (watched) => watchedWith(watched, ids, 1));
    return () => registry.update(watchedAtom, (watched) => watchedWith(watched, ids, -1));
  }, [registry, ids]);
  return Option.getOrElse(AsyncResult.value(useAtomValue(presenceAtom)), () => NO_BOOK);
}

/** The shared presence for one device, or none where it names none. */
export function useDeviceBeat(deviceId: string | undefined): PresenceBook {
  const ids = useMemo(() => (deviceId === undefined ? NO_DEVICES : [deviceId]), [deviceId]);
  return useDevicePresence(ids);
}
