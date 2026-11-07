/**
 * update-toast.ts -- the toasts a release is said in: that one is downloaded and waits on its restart, with Restart, and that the app was updated, once for each version, with the way to what changed.
 *
 * A release downloaded in the background is news the developer should not
 * have to find in the sidebar's foot, so it is said in a toast that stands,
 * with Restart, until it is dismissed or the release no longer waits. The
 * sidebar's pill stays beside it as the way back once it is dismissed.
 *
 * Main reports `UPDATED` on the first launch after an install, until its
 * first check overwrites it, which the Settings row words as where the
 * update came from. The toast says it where the developer is looking
 * instead, and offers What's new, the changelog Settings' Changelog row
 * opens. The version it last said is kept in the renderer's storage, so a
 * window drawn again while main still reports it says nothing twice.
 */

import { PRODUCT_NAME } from "@repo/features/product-name";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { HOST_CAPABILITY } from "@repo/settings";
import { UPDATE_STATUS, type UpdateSnapshot } from "@repo/settings/update";
import { STATUS_TONE, UpdateIcon } from "@repo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Option, Schema } from "effect";
import { useEffect } from "react";
import { pressMutation } from "./act-mutations.js";
import { readKeptOption, writeKept } from "./kept-storage.js";
import { useToast, useWithdrawToast } from "./toast.js";
import { appStateQuery } from "./use-app-state.js";

/** The storage key the version last announced is kept under. */
const ANNOUNCED_KEY = "app.update-announced";

/** What the release-ready toast is about, by which it is withdrawn once the release is no longer waiting. */
const READY_SUBJECT = "update-ready";

/** The storage key the version whose ready toast was last dismissed is kept under. */
const DISMISSED_KEY = "app.update-ready-dismissed";

/** The version last announced, or none where there is none or storage refuses the read. */
function readAnnounced(): string | null {
  return Option.getOrNull(readKeptOption(ANNOUNCED_KEY, Schema.String));
}

/** Keeps the version announced; storage that refuses the write leaves it to be said again. */
function keepAnnounced(version: string): void {
  writeKept(ANNOUNCED_KEY, Schema.String, version);
}

/** The version whose ready toast was last dismissed, or none where there is none or storage refuses the read. */
function readDismissed(): string | null {
  return Option.getOrNull(readKeptOption(DISMISSED_KEY, Schema.String));
}

/** Keeps the version whose ready toast was dismissed; storage that refuses the write leaves it to be said again. */
function keepDismissed(version: string): void {
  writeKept(DISMISSED_KEY, Schema.String, version);
}

/**
 * The release downloaded and waiting on its restart, where this window may
 * install one; none in a fixture run, whose staged release
 * (`fixtureUpdate`) every capture would otherwise show under a toast.
 */
function selectReadyVersion(state: AppStateSnapshot): string | undefined {
  const { run, update } = state;
  if (run.fixtureMode === true || !run.capabilities.includes(HOST_CAPABILITY.UPDATES)) {
    return undefined;
  }
  if (!update.installSupported || update.status !== UPDATE_STATUS.READY) return undefined;
  return update.latestVersion;
}

/** Says, once for each version, that the app was updated to the version running. */
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

/**
 * Says, in a toast that stands until it is dismissed, that a newer release
 * is downloaded and waiting on its restart, with Restart, the very act
 * Settings' Restart to update and the sidebar's pill run. Note that one
 * dismissed is not said again for that version, the sidebar's pill staying
 * as the way back to it, and that it is withdrawn once the release no
 * longer waits, as when its install failed.
 */
export function useReadyToast(): void {
  const toast = useToast();
  const withdraw = useWithdrawToast();
  const { mutate: install } = useMutation(pressMutation(ACT_KIND.UPDATE_INSTALL));
  const version = useQuery({ ...appStateQuery, select: selectReadyVersion }).data;
  useEffect(() => {
    if (version === undefined || readDismissed() === version) return;
    toast({
      words: `${PRODUCT_NAME} ${version} is ready to install`,
      detail: "Restart to update.",
      tone: STATUS_TONE.ATTENTION,
      glyph: UpdateIcon,
      replayUnmasked: true,
      subject: READY_SUBJECT,
      persists: true,
      action: { label: "Restart", onPress: () => install(), replayUnmasked: true },
      onDismiss: () => keepDismissed(version),
    });
    return () => withdraw(READY_SUBJECT);
  }, [toast, withdraw, install, version]);
}
