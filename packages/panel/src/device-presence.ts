import { signedInAccountId } from "@repo/credentials/snapshot";
import { DEVICE_STANDING, type DeviceStanding, deviceStanding } from "@repo/features/agent-wire";
import type { AppDevicePresence } from "@repo/host/app-state";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { devicePresenceQuery, devicePresenceRefreshMutation } from "./live-reads.js";
import { appStateQuery, selectAccount } from "./use-app-state.js";

export interface PresenceBook {
  readonly beats: ReadonlyMap<string, number>;
  readonly askedAt: number;
  readonly settled: boolean;
  readonly failed: boolean;
}

const NO_BOOK: PresenceBook = { beats: new Map(), askedAt: 0, settled: false, failed: false };

const FAILED_BOOK: PresenceBook = { beats: new Map(), askedAt: 0, settled: true, failed: true };

let drawers = 0;

let askAgain: (() => void) | undefined;

const heardOnline = (): void => askAgain?.();

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

function bookOf(rows: AppDevicePresence | undefined, failed: boolean): PresenceBook {
  if (rows === undefined) return failed ? FAILED_BOOK : NO_BOOK;
  return {
    beats: new Map(rows.beats.map((beat) => [beat.deviceId, beat.beatAt])),
    askedAt: rows.askedAt,
    settled: true,
    failed: rows.stale === true,
  };
}

export function useDevicePresence(drawing: boolean): PresenceBook {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const { data: rows, isError } = useQuery(devicePresenceQuery(drawing ? accountId : undefined));
  const { mutate: askAgain } = useMutation(devicePresenceRefreshMutation());
  useEffect(() => (drawing ? listenOnline(() => askAgain()) : undefined), [drawing, askAgain]);
  return useMemo(() => bookOf(rows, isError), [rows, isError]);
}
