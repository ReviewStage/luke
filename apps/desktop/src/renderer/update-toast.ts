/**
 * update-toast.ts -- the toast that says Luke was updated, once for each version, on the first launch after the update, with the way to what changed.
 *
 * Main reports `UPDATED` on the first launch after an install, until its
 * first check overwrites it, which the Settings row words as where the
 * update came from. The toast says it where the developer is looking
 * instead, and offers What's new, the changelog Settings' Changelog row
 * opens. The version it last said is kept in the renderer's storage, so a
 * window drawn again while main still reports it says nothing twice.
 */

import { ACT_KIND } from "@luke/host/acts";
import { useAct } from "@luke/panel/act";
import { UPDATE_STATUS, type UpdateSnapshot } from "@luke/settings/update";
import { useEffect } from "react";
import { TOAST_TONE, useToast } from "./toast";

/** The storage key the version last announced is kept under. */
const ANNOUNCED_KEY = "luke.update-announced";

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
  const { tell } = useAct();
  const version = update?.status === UPDATE_STATUS.UPDATED ? update.currentVersion : undefined;
  useEffect(() => {
    if (version === undefined || readAnnounced() === version) return;
    keepAnnounced(version);
    toast({
      words: `Updated to ${version}`,
      tone: TOAST_TONE.DONE,
      action: { label: "What's new", onPress: () => tell(ACT_KIND.UPDATE_OPEN_CHANGELOG) },
    });
  }, [toast, tell, version]);
}
