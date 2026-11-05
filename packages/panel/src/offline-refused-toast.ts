/**
 * offline-refused-toast.ts -- the toast that says how many changes made offline the service refused once it answered again, standing until it is seen.
 *
 * The host counts each change made while the service could not be reached
 * that the service refused when it was sent again, and tells the count on
 * the `network` slice; each was already taken back where it was drawn. Every
 * window says the count in one toast, which stands until its OK clears the
 * count for every window; a count that moves is said again in place of the
 * last.
 */

import { countWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { STATUS_TONE } from "@repo/ui";
import { useEffect } from "react";
import { useAct } from "./act.js";
import { useToast, useWithdrawToast } from "./toast.js";
import { APP_SLICE, useAppSlice } from "./use-app-state.js";

/** What the toast is about, which withdraws it as the count moves or is cleared. */
const OFFLINE_REFUSED_SUBJECT = "offline-refused";

/** Says how many changes made offline the service refused, until a window clears the count. */
export function useOfflineRefusedToast(): void {
  const toast = useToast();
  const withdraw = useWithdrawToast();
  const { press } = useAct();
  const count = useAppSlice(APP_SLICE.NETWORK)?.offlineRefused ?? 0;
  useEffect(() => {
    withdraw(OFFLINE_REFUSED_SUBJECT);
    if (count === 0) return;
    toast({
      words: `Couldn't save ${countWords(count, { one: "change", many: "changes" })} you made offline.`,
      tone: STATUS_TONE.ATTENTION,
      subject: OFFLINE_REFUSED_SUBJECT,
      persists: true,
      replayUnmasked: true,
      action: {
        label: "OK",
        onPress: () => press(ACT_KIND.TASKS_OFFLINE_REFUSED_CLEAR),
        replayUnmasked: true,
      },
    });
  }, [toast, withdraw, press, count]);
}
