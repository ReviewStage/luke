import { signedInAccountId } from "@repo/credentials/snapshot";
import { DEVICE_STANDING, type DeviceStanding, deviceStanding } from "@repo/features/agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import type { AppDevicePresence } from "@repo/host/app-state";
import { useMemo } from "react";
import { APP_SLICE, useAppSlice } from "./use-app-state.js";
import { HOST_READ_STATUS, type HostReadStatus, useHostRead } from "./use-host-read.js";

/**
 * device-presence.ts -- the one source of when each of the account's devices last beat, which every surface that says whether a device is there reads.
 *
 * A device beats every `DEVICE_BEAT.EVERY_MS`, and the lists the window holds
 * (an agent's, a task's, the menu's, Settings' hosts) carry only the beat they
 * were read at, so a surface that judged from them alone read a device
 * offline a while after its last read though it kept beating. A surface that
 * draws a device's standing reads this instead (`useDevicePresence`), and
 * while any does the host holds the account's beats (`LIVE_READ.DEVICE_PRESENCE`)
 * and asks the service for them every `MAC_PRESENCE.POLL_MS`: one read,
 * however many surfaces and windows. Nothing is read while no surface draws
 * a device, and no surface keeps a clock of its own: each ask moves the read,
 * so every surface drawing it draws again.
 *
 * The host lays each beat at its own instant, the service's age of it taken
 * from the host's clock as the answer landed, and a window ages it on
 * `Date.now()`, the same machine's clock, so no clock of another machine is
 * ever compared with it. A device is away only after it has missed
 * `DEVICE_BEAT.MISSED_BEATS` beats. A read that failed marks what is not
 * named as unknown rather than offline, since a window that could not ask
 * must not say a device is away, and the beats an earlier read answered
 * stand, aging, until a later one does. A device the read does not name is
 * not the account's own (a teammate's, say), and `presenceStanding` says
 * nothing of it.
 */

/** Where the read stands: when each device the last answer named beat, whether any read has landed, and whether the latest failed. */
export interface PresenceBook {
  readonly beats: ReadonlyMap<string, number>;
  readonly settled: boolean;
  readonly failed: boolean;
}

/** Nothing known yet: before the first read lands. */
const NO_BOOK: PresenceBook = { beats: new Map(), settled: false, failed: false };

/** No beat known and the read failed: it never answered. */
const FAILED_BOOK: PresenceBook = { beats: new Map(), settled: true, failed: true };

/**
 * Where `deviceId` stands now, by how long ago its last beat was on this
 * machine's clock: checking before the first read lands, and none for a
 * device the read does not name as the account's own, which a surface says
 * nothing of. Where the latest read failed, a beat held from an earlier one
 * is still judged by its age, and a device with none is unknown.
 */
export function presenceStanding(
  book: PresenceBook,
  deviceId: string | undefined,
): DeviceStanding | undefined {
  if (!book.settled) return DEVICE_STANDING.CHECKING;
  if (deviceId === undefined) return undefined;
  const beatAt = book.beats.get(deviceId);
  if (beatAt === undefined) return book.failed ? DEVICE_STANDING.UNKNOWN : undefined;
  return deviceStanding(Date.now() - beatAt, book.failed);
}

/** The book a read of the beats stands at. */
function bookOf(rows: AppDevicePresence | undefined, status: HostReadStatus): PresenceBook {
  if (status === HOST_READ_STATUS.LOADING) return NO_BOOK;
  if (rows === undefined) return FAILED_BOOK;
  return {
    beats: new Map(rows.beats.map((beat) => [beat.deviceId, beat.beatAt])),
    settled: true,
    failed: rows.stale === true,
  };
}

/** The shared presence while `drawing`, a surface that shows a device's standing; the nothing-known book while it does not, or before the first read lands. */
export function useDevicePresence(drawing: boolean): PresenceBook {
  const accountId = signedInAccountId(useAppSlice(APP_SLICE.ACCOUNT));
  const { rows, status } = useHostRead(LIVE_READ.DEVICE_PRESENCE, drawing ? accountId : undefined);
  return useMemo(() => bookOf(rows, status), [rows, status]);
}
