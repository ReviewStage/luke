import { countWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { STATUS_TONE } from "@repo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { pressMutation } from "./act-mutations.js";
import { useToast, useWithdrawToast } from "./toast.js";
import { appStateQuery, selectNetwork } from "./use-app-state.js";

const OFFLINE_REFUSED_SUBJECT = "offline-refused";

export function useOfflineRefusedToast(): void {
  const toast = useToast();
  const withdraw = useWithdrawToast();
  const { mutate: clearOfflineRefused } = useMutation(
    pressMutation(ACT_KIND.TASKS_OFFLINE_REFUSED_CLEAR),
  );
  const count = useQuery({ ...appStateQuery, select: selectNetwork }).data?.offlineRefused ?? 0;
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
        onPress: () => clearOfflineRefused(),
        replayUnmasked: true,
      },
    });
  }, [toast, withdraw, clearOfflineRefused, count]);
}
