/**
 * update-toast.ts -- the toast that says Luke was updated, once for each version, on the first launch after the update.
 *
 * Main reports `UPDATED` on the first launch after an install, until its
 * first check overwrites it, which the Settings row words as where the
 * update came from. The toast says it where the developer is looking
 * instead. The version it last said is kept in the renderer's storage, so a
 * window drawn again while main still reports it says nothing twice.
 */

import { Duration } from "effect";
import { useEffect } from "react";
import { UPDATE_STATUS, type UpdateSnapshot } from "#shared/messages/update";
import { TOAST_TONE, useToast } from "./toast";

/** The storage key the version last announced is kept under. */
const ANNOUNCED_KEY = "luke.update-announced";

/** How long the toast stands: a moment longer than a change's, being news the developer did not ask for. */
const UPDATED_HOLD = Duration.seconds(4);

/** The version last announced, or none where there is none or storage refuses the read. */
function readAnnounced(): string | null {
  try {
    return window.localStorage.getItem(ANNOUNCED_KEY);
  } catch {
    return null;
  }
}

/** Keeps the version announced; storage that refuses the write leaves it to be said again. */
function keepAnnounced(version: string): void {
  try {
    window.localStorage.setItem(ANNOUNCED_KEY, version);
  } catch {
    // Said again on the next launch main reports it, which is no worse.
  }
}

/** Says, once for each version, that Luke was updated to the version running. */
export function useUpdatedToast(update: UpdateSnapshot | undefined): void {
  const toast = useToast();
  const version = update?.status === UPDATE_STATUS.UPDATED ? update.currentVersion : undefined;
  useEffect(() => {
    if (version === undefined || readAnnounced() === version) return;
    keepAnnounced(version);
    toast({ words: `Updated to version ${version}`, tone: TOAST_TONE.DONE, hold: UPDATED_HOLD });
  }, [toast, version]);
}
