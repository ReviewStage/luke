import { ACT_KIND } from "@repo/host/acts";
import { UPDATE_STATUS, type UpdateSnapshot } from "@repo/settings/update";
import { STATUS_TONE } from "@repo/ui";
import { useMutation } from "@tanstack/react-query";
import { Option, Schema } from "effect";
import { useEffect } from "react";
import { pressMutation } from "./act-mutations.js";
import { readKeptOption, writeKept } from "./kept-storage.js";
import { useToast } from "./toast.js";

const ANNOUNCED_KEY = "app.update-announced";

function readAnnounced(): string | null {
  return Option.getOrNull(readKeptOption(ANNOUNCED_KEY, Schema.String));
}

function keepAnnounced(version: string): void {
  writeKept(ANNOUNCED_KEY, Schema.String, version);
}

export function useUpdatedToast(update: UpdateSnapshot | undefined): void {
  const toast = useToast();
  const { mutate: openChangelog } = useMutation(pressMutation(ACT_KIND.UPDATE_OPEN_CHANGELOG));
  const version = update?.status === UPDATE_STATUS.UPDATED ? update.currentVersion : undefined;
  useEffect(() => {
    if (version === undefined || readAnnounced() === version) return;
    keepAnnounced(version);
    toast({
      words: `Updated to ${version}`,
      tone: STATUS_TONE.COMPLETE,
      replayUnmasked: true,
      action: {
        label: "What's new",
        onPress: () => openChangelog(),
        replayUnmasked: true,
      },
    });
  }, [toast, openChangelog, version]);
}
