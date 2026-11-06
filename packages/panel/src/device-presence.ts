import { signedInAccountId } from "@repo/credentials/snapshot";
import { DEVICE_STANDING, type DeviceStanding, deviceStanding } from "@repo/features/agent-wire";
import type { AppDevicePresence } from "@repo/host/app-state";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { devicePresenceQuery, devicePresenceRefreshMutation } from "./live-reads.js";
import { APP_SLICE, useAppSlice } from "./use-app-state.js";

/**
 * device-presence.ts -- the one source of when each of the account's devices last beat, which every surface that says whether a device is there reads.
 *
 * A device beats every `DEVICE_BEAT.EVERY_MS`, and the lists the window holds
 * (an agent's, a task's, the menu's, Settings' hosts) carry only the beat they
 * were read at, so a surface that judged from them alone read a device
 * offline a while after its last read though it kept beating. A surface that
 * draws a device's standing reads this instead (`useDevicePresence`), and
 * while any does the host holds the account's beats (`devicePresenceQuery`)
 * and asks the service for them every `MAC_PRESENCE.POLL_MS`: one read,
 * however many surfaces and windows. Nothing is read while no surface draws
 * a device, and no surface keeps a clock of its own: each ask moves the read,
 * so every surface drawing it draws again. The host asks again as a window
 * comes forward or a tab is shown (`window-focus.ts`), and as the window comes
 * back online, which one listener here tells it however many surfaces draw.
 *
 * The host lays each beat at its own instant, the service's age of it taken
 * from the host's clock as the answer landed, beside that instant, and a
 * window ages both on `Date.now()`, the same machine's clock, so no clock of
 * another machine is ever compared with it. A device is there while its beat
 * is within `MAC_PRESENCE.FRESH_MS`, and away only once a read that landed
 * lately found it past that (`deviceStanding`): a beat the window alone has
 * aged past it since, a read late or slow, a timer throttled while hidden, or
 * a sleep, says unknown. So does a read that failed, since a window that
 * could not ask must not say a device is away, and the beats an earlier read
 * answered stand, aging, until a later one does. A device the read does not
 * name is not the account's own (a teammate's, say), and `presenceStanding`
 * says nothing of it.
 */

/** Where the read stands: when each device the last answer named beat, when the latest read landed, whether any read has landed, and whether the latest failed. */
export interface PresenceBook {
  readonly beats: ReadonlyMap<string, number>;
  readonly askedAt: number;
  readonly settled: boolean;
  readonly failed: boolean;
}

/** Nothing known yet: before the first read lands. */
const NO_BOOK: PresenceBook = { beats: new Map(), askedAt: 0, settled: false, failed: false };

/** No beat known and the read failed: it never answered. */
const FAILED_BOOK: PresenceBook = { beats: new Map(), askedAt: 0, settled: true, failed: true };

/** How many surfaces draw a device's standing now, which the one `online` listener stands for. */
let drawers = 0;

/** The read's asking again, as the surface drawing latest holds it; each asks the host for the same beats. */
let askAgain: (() => void) | undefined;

/** The window back online: the host asks for the beats again, as it does when a window comes forward. */
const heardOnline = (): void => askAgain?.();

/** One more surface drawing a device's standing, the window's `online` listened to once while any does; answers its release. */
function listenOnline(again: () => void): () => void {
  drawers += 1;
  askAgain = again;
  if (drawers === 1) window.addEventListener("online", heardOnline);
  return () => {
    drawers -= 1;
    if (drawers > 0) return;
    askAgain = undefined;
    window.removeEventListener("online", heardOnline);
  };
}

/**
 * Where `deviceId` stands now, by how long ago its last beat was on this
 * machine's clock: checking before the first read lands, and none for a
 * device the read does not name as the account's own, which a surface says
 * nothing of. Where the latest read failed, a beat held from an earlier one
 * is still judged by its age, and a device with none is unknown; a beat past
 * fresh is offline only where a read that landed lately found it so.
 */
export function presenceStanding(
  book: PresenceBook,
  deviceId: string | undefined,
): DeviceStanding | undefined {
  if (!book.settled) return DEVICE_STANDING.CHECKING;
  if (deviceId === undefined) return undefined;
  const beatAt = book.beats.get(deviceId);
  if (beatAt === undefined) return book.failed ? DEVICE_STANDING.UNKNOWN : undefined;
  const now = Date.now();
  return deviceStanding(
    { sinceBeatMs: now - beatAt, sinceReadMs: now - book.askedAt },
    book.failed,
  );
}

/** The book a read of the beats stands at: nothing known before it answers, and failed where it never could. */
function bookOf(rows: AppDevicePresence | undefined, failed: boolean): PresenceBook {
  if (rows === undefined) return failed ? FAILED_BOOK : NO_BOOK;
  return {
    beats: new Map(rows.beats.map((beat) => [beat.deviceId, beat.beatAt])),
    askedAt: rows.askedAt,
    settled: true,
    failed: rows.stale === true,
  };
}

/** The shared presence while `drawing`, a surface that shows a device's standing; the nothing-known book while it does not, or before the first read lands. */
export function useDevicePresence(drawing: boolean): PresenceBook {
  const accountId = signedInAccountId(useAppSlice(APP_SLICE.ACCOUNT));
  const { data: rows, isError } = useQuery(devicePresenceQuery(drawing ? accountId : undefined));
  const { mutate: askAgain } = useMutation(devicePresenceRefreshMutation());
  useEffect(() => (drawing ? listenOnline(() => askAgain()) : undefined), [drawing, askAgain]);
  return useMemo(() => bookOf(rows, isError), [rows, isError]);
}
