import { useAtomValue } from "@effect/atom-react";
import {
  DEVICE_STANDING,
  type DeviceStanding,
  deviceStanding,
  MAC_PRESENCE,
} from "@luke/features/coding-agent-wire";
import type { DevicePresenceAnswer } from "@luke/features/host-wire";
import { ACT_KIND } from "@luke/host/acts";
import { Duration, Effect, Option, Schedule, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { askAct } from "./act.js";
import { rendererRuntime } from "./renderer-runtime.js";

/**
 * device-presence.ts -- the one source of how long ago each of the account's devices last beat, which every surface that says whether a device is there reads.
 *
 * A device beats every `DEVICE_BEAT.EVERY_MS`, and the lists the window holds
 * (an agent's, a task's, the menu's, Settings' hosts) carry only the beat they
 * were read at, so a surface that judged from them alone read a device
 * offline a while after its last read though it kept beating. A surface that
 * draws a device's standing reads this instead (`useDevicePresence`), and
 * while any does the window asks the service for the account's own devices
 * every `MAC_PRESENCE.POLL_MS`: one read, one poll, however many surfaces.
 * Nothing is read while no surface draws a device, and no surface keeps a
 * clock of its own.
 *
 * The service answers each beat as an age on its own clock, and the window
 * ages it on its monotonic clock (`performance.now()`) from the moment the
 * answer landed, so no wall clock is ever compared with another: a window
 * whose clock is minutes off judges as one whose clock is right. A device is
 * away only after it has missed `DEVICE_BEAT.MISSED_BEATS` beats. A read that
 * failed marks what is not named as unknown rather than offline, since a
 * window that could not ask must not say a device is away, and the beats an
 * earlier read answered stand, aging, until a later one does. A device the
 * answer does not name is not the account's own (a teammate's, say), and
 * `presenceStanding` says nothing of it.
 */

/** One beat as the service answered it: how old it was then, and the window's monotonic time it landed at. */
interface HeldBeat {
  readonly ageMs: number;
  readonly landedAt: number;
}

/** Where the reads stand: the beats the last answer held, by device, whether any read has landed, and whether the latest failed. */
export interface PresenceBook {
  readonly beats: ReadonlyMap<string, HeldBeat>;
  readonly settled: boolean;
  readonly failed: boolean;
}

/** Nothing known yet: before the first read lands. */
const NO_BOOK: PresenceBook = { beats: new Map(), settled: false, failed: false };

/** The window's monotonic time in milliseconds, which no clock setting moves. */
function monotonicNow(): number {
  return performance.now();
}

/**
 * Where `deviceId` stands now, by the age of its last beat as the service said
 * it plus the time since that answer landed: checking before the first read
 * lands, and none for a device the service does not name as the account's own,
 * which a surface says nothing of. Where the latest read failed, a beat held
 * from an earlier one is still judged by its age, and a device with none is
 * unknown.
 */
export function presenceStanding(
  book: PresenceBook,
  deviceId: string | undefined,
): DeviceStanding | undefined {
  if (!book.settled) return DEVICE_STANDING.CHECKING;
  if (deviceId === undefined) return undefined;
  const beat = book.beats.get(deviceId);
  if (beat === undefined) return book.failed ? DEVICE_STANDING.UNKNOWN : undefined;
  return deviceStanding(beat.ageMs + (monotonicNow() - beat.landedAt), book.failed);
}

/** How long ago `deviceId` last beat as the book now knows it, none where no beat is held. */
export function presenceAgeMs(book: PresenceBook, deviceId: string): number | undefined {
  const beat = book.beats.get(deviceId);
  return beat === undefined ? undefined : beat.ageMs + (monotonicNow() - beat.landedAt);
}

/** The book after a read that landed at `landedAt`: its ages where it answered, the held ones where it did not. */
export function presenceAfter(
  book: PresenceBook,
  answer: Option.Option<DevicePresenceAnswer>,
  landedAt: number,
): PresenceBook {
  return Option.match(answer, {
    onNone: () => ({ beats: book.beats, settled: true, failed: true }),
    onSome: ({ devices }) => ({
      beats: new Map(devices.map((each) => [each.deviceId, { ageMs: each.ageMs, landedAt }])),
      settled: true,
      failed: false,
    }),
  });
}

/** One read of the account's devices: what the service answered, or nothing where it did not. */
const beatsRead: Effect.Effect<Option.Option<DevicePresenceAnswer>> = Effect.tryPromise(() =>
  askAct(ACT_KIND.HOSTS_PRESENCE),
).pipe(
  Effect.map((answer) => ("failure" in answer ? Option.none() : Option.some(answer))),
  Effect.orElseSucceed(() => Option.none<DevicePresenceAnswer>()),
);

/** The shared read, run only while a surface subscribes, once and then every `POLL_MS`. */
const presenceAtom = rendererRuntime.atom(
  Stream.fromEffectSchedule(beatsRead, Schedule.spaced(Duration.millis(MAC_PRESENCE.POLL_MS))).pipe(
    Stream.scan(
      () => NO_BOOK,
      (book, answer) => presenceAfter(book, answer, monotonicNow()),
    ),
  ),
);

/** No reading, while no surface draws a device. */
const IDLE = Atom.make(AsyncResult.initial<PresenceBook>());

/** The shared presence while `drawing`, a surface that shows a device's standing; the nothing-known book while it does not, or before the first read lands. */
export function useDevicePresence(drawing: boolean): PresenceBook {
  return Option.getOrElse(
    AsyncResult.value(useAtomValue(drawing ? presenceAtom : IDLE)),
    () => NO_BOOK,
  );
}
