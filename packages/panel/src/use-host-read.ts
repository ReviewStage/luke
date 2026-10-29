import { LIVE_READ, type LiveRead } from "@luke/features/live-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { AppHostReads } from "@luke/host/app-state";
import { useCallback } from "react";
import { tellAct } from "./act.js";
import { APP_SLICE, useAppSlice } from "./use-app-state.js";

/**
 * use-host-read.ts -- the one way a surface reads server data: a read the host holds for the panel, drawn from app state, with where it stands and Try again.
 *
 * The host follows each read for as long as its lifetime holds it
 * (`@luke/host`'s `live-collection.ts`) and lays its rows in the app-state
 * slice named for it (`LIVE_READ`), which outlives every page, so a surface
 * drawn again draws its rows in its first frame, before anything is pushed.
 * A read is loading until it first answers, failed where it said it could
 * not answer before it ever had, and ready from its first rows on: one that
 * holds rows never says loading again. Nothing else in the panel opens a
 * follow (`anti-slop/no-follow-outside-host-read`).
 */

export const HOST_READ_STATUS = {
  LOADING: "loading",
  READY: "ready",
  FAILED: "failed",
} as const;

export type HostReadStatus = (typeof HOST_READ_STATUS)[keyof typeof HOST_READ_STATUS];

/** A read as a surface draws it: its rows once it answered, where it stands, and Try again. */
export interface HostRead<Rows> {
  readonly rows: Rows | undefined;
  readonly status: HostReadStatus;
  readonly retry: () => void;
}

/** Each read's slice, and the act that reads it again at once. */
const READS = {
  [LIVE_READ.INBOX_ITEMS]: {
    slice: APP_SLICE.INBOX_ITEMS,
    retry: ACT_KIND.AGENTS_INBOX_ITEMS_RETRY,
  },
} as const;

export function useHostRead<Read extends LiveRead>(read: Read): HostRead<AppHostReads[Read]> {
  const { slice, retry } = READS[read];
  const held = useAppSlice(slice);
  const rows = held?.rows;
  const status =
    rows !== undefined
      ? HOST_READ_STATUS.READY
      : held?.failed === true
        ? HOST_READ_STATUS.FAILED
        : HOST_READ_STATUS.LOADING;
  const onRetry = useCallback(() => tellAct(retry), [retry]);
  return { rows, status, retry: onRetry };
}
