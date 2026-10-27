import { useAtomValue } from "@effect/atom-react";
import { useAtomMount } from "@effect/atom-react/Hooks";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import {
  DEVICE_STANDING,
  type DeviceStanding,
  deviceStanding,
  MAC_PRESENCE,
} from "@luke/features/coding-agent-wire";
import { DEVICE_PRESENCE_MAX_IDS, type DevicePresenceAnswer } from "@luke/features/host-wire";
import { ACT_KIND } from "@luke/host/acts";
import { Duration, Effect, Schedule, Stream } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { useContext, useEffect, useMemo } from "react";
import { askAct } from "./act.js";
import { rendererRuntime } from "./renderer-runtime.js";

/**
 * device-presence.ts -- the one source of how long ago each device last beat, which every surface that says whether a device is there reads.
 *
 * A device beats every `DEVICE_BEAT.EVERY_MS`, and the lists the window holds
 * (an agent's, a task's, the menu's, Settings' hosts) carry only the beat they
 * were read at, so a surface that judged from them alone read a device
 * offline a while after its last read though it kept beating. A surface that
 * draws a device's standing says which devices it draws here
 * (`useDevicePresence`), and while any does the window reads their beats
 * once, together, every `MAC_PRESENCE.POLL_MS`. Nothing is read while no
 * surface draws one, and no surface keeps a clock of its own.
 *
 * The service answers each beat as an age on its own clock, and the window
 * ages it on its monotonic clock (`performance.now()`) from the moment the
 * answer landed, so no wall clock is ever compared with another: a window
 * whose clock is minutes off judges as one whose clock is right. A device is
 * away only after it has missed `DEVICE_BEAT.MISSED_BEATS` beats. A read that
 * failed leaves the devices it named "unknown" rather than offline, since a
 * window that could not ask must not say a device is away, and the beats an
 * earlier read answered stand, aging, until a later one does. The book of
 * beats lives apart from the read that fills it, so a change of the devices
 * drawn restarts the read without the surfaces losing what they knew.
 */

/** How often the beats of the devices drawn are read. */
const PRESENCE_EVERY = Duration.millis(MAC_PRESENCE.POLL_MS);

/** One beat as the service answered it: how old it was then, and the window's monotonic time it landed at. */
interface HeldBeat {
  readonly ageMs: number;
  readonly landedAt: number;
}

/** Where the presence reads stand: the beats the last rounds answered, by device, the devices whose batch of the last round failed, which the window cannot say of, and whether any round has answered yet. */
export interface PresenceBook {
  readonly beats: ReadonlyMap<string, HeldBeat>;
  readonly unchecked: ReadonlySet<string>;
  readonly settled: boolean;
}

/** Nothing known yet: before the first round answers. */
const NO_BOOK: PresenceBook = { beats: new Map(), unchecked: new Set(), settled: false };

/** The window's monotonic time in milliseconds, which no clock setting moves. */
function monotonicNow(): number {
  return performance.now();
}

/**
 * Where `deviceId` stands now: checking before the first round answers,
 * unknown for a surface that names no device, and otherwise by the age of its
 * last beat as the service said it plus the time since that answer landed.
 */
export function presenceStanding(book: PresenceBook, deviceId: string | undefined): DeviceStanding {
  if (!book.settled) return DEVICE_STANDING.CHECKING;
  if (deviceId === undefined) return DEVICE_STANDING.UNKNOWN;
  const beat = book.beats.get(deviceId);
  const age = beat === undefined ? undefined : beat.ageMs + (monotonicNow() - beat.landedAt);
  return deviceStanding(age, book.unchecked.has(deviceId));
}

/** How long ago `deviceId` last beat as the book now knows it, none where no beat is held. */
export function presenceAgeMs(book: PresenceBook, deviceId: string): number | undefined {
  const beat = book.beats.get(deviceId);
  return beat === undefined ? undefined : beat.ageMs + (monotonicNow() - beat.landedAt);
}

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

/** What one batch answered: the beats of the devices it named, or the devices it named where it failed. */
export interface PresenceRead {
  readonly devices: DevicePresenceAnswer["devices"];
  readonly failedIds: readonly string[];
}

/** One batch of at most `DEVICE_PRESENCE_MAX_IDS` ids: what the service answered, or a failure where it did not. */
function batchRead(ids: readonly string[]): Effect.Effect<PresenceRead> {
  return Effect.tryPromise(() => askAct(ACT_KIND.HOSTS_PRESENCE, { ids })).pipe(
    Effect.map(
      (answer): PresenceRead =>
        "failure" in answer
          ? { devices: [], failedIds: ids }
          : { devices: answer.devices, failedIds: [] },
    ),
    Effect.orElseSucceed((): PresenceRead => ({ devices: [], failedIds: ids })),
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
      failedIds: reads.flatMap((read) => read.failedIds),
    })),
  );
}

/** The book after a round that landed at `landedAt`: the beats it answered, the held beats kept only for the devices whose batch failed, and those devices marked unchecked. */
export function presenceAfter(
  book: PresenceBook,
  read: PresenceRead,
  landedAt: number,
): PresenceBook {
  const beats = new Map<string, HeldBeat>();
  for (const id of read.failedIds) {
    const held = book.beats.get(id);
    if (held !== undefined) beats.set(id, held);
  }
  for (const each of read.devices) beats.set(each.deviceId, { ageMs: each.ageMs, landedAt });
  return { beats, unchecked: new Set(read.failedIds), settled: true };
}

/** The latest book, kept apart from the read that fills it so a restart of the read loses nothing. */
const bookAtom = Atom.keepAlive(Atom.make<PresenceBook>(NO_BOOK));

/** The shared read, run only while a surface mounts it: again whenever the devices drawn change, and every `PRESENCE_EVERY` between, each round written into the book. */
const pollAtom = rendererRuntime.atom((get) => {
  const ids = [...get(watchedAtom).keys()];
  if (ids.length === 0) return Stream.empty;
  return Stream.fromEffectSchedule(beatsRead(ids), Schedule.spaced(PRESENCE_EVERY)).pipe(
    Stream.tap((read) =>
      Effect.sync(() => get.set(bookAtom, presenceAfter(get.once(bookAtom), read, monotonicNow()))),
    ),
  );
});

const NO_DEVICES: readonly string[] = [];

/**
 * The shared presence, held while the caller draws the devices `ids` names (a
 * stable array, since a new one is a change of devices): the book of beats,
 * for `presenceStanding`.
 */
export function useDevicePresence(ids: readonly string[]): PresenceBook {
  const registry = useContext(RegistryContext);
  useEffect(() => {
    if (ids.length === 0) return;
    registry.update(watchedAtom, (watched) => watchedWith(watched, ids, 1));
    return () => registry.update(watchedAtom, (watched) => watchedWith(watched, ids, -1));
  }, [registry, ids]);
  useAtomMount(pollAtom);
  return useAtomValue(bookAtom);
}

/** The shared presence for one device, or none where it names none. */
export function useDeviceBeat(deviceId: string | undefined): PresenceBook {
  const ids = useMemo(() => (deviceId === undefined ? NO_DEVICES : [deviceId]), [deviceId]);
  return useDevicePresence(ids);
}
