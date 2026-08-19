import { autoUpdater, type UpdateCheckResult } from "electron-updater";
import { UPDATE_ENDPOINT, type UpdaterEngine, type UpdaterEngineEvents } from "./update-service";

/** electron-updater emits progress per chunk; the broadcast needs far less. */
const PROGRESS_EMIT_INTERVAL_MS = 500;

/**
 * electron-updater starts the auto-download inside checkForUpdates and hands
 * back its promise unattached; every rejection has already gone through the
 * `error` event, so the copy only needs to stop being unhandled.
 */
function releaseDownloadPromise(result: UpdateCheckResult | null): void {
  result?.downloadPromise?.catch(() => undefined);
}

/**
 * electron-updater's cache helper is not part of its public surface, but a
 * corrupt cached download is only ever retried — the cache self-invalidates
 * solely on a remote sha512 change — so errors must reach in and clear it.
 */
interface AppUpdaterInternals {
  downloadedUpdateHelper: { clear(): Promise<void> } | null;
}

/**
 * The updater Superset runs in production, bound the same way: electron
 * updater's generic provider pointed at the feed fixed by the build, auto
 * download on, install at quit on, differential download off (a known source
 * of flaky downloads). Under it all is still Squirrel.Mac: the archive's code
 * signature must match the running app's, and the swap happens in ShipIt at
 * quit. It can only replace a signed, packaged build, which is why the caller
 * constructs this at all only for one.
 */
export function createElectronUpdaterEngine(): UpdaterEngine {
  return {
    wire(events: UpdaterEngineEvents) {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.disableDifferentialDownload = true;
      autoUpdater.setFeedURL({ provider: "generic", url: UPDATE_ENDPOINT.UPDATE_FEED_URL });
      autoUpdater.on("checking-for-update", () => events.onChecking());
      autoUpdater.on("update-available", (info) => events.onAvailable(info.version));
      autoUpdater.on("update-not-available", () => events.onNotAvailable());
      let lastProgressAt = 0;
      autoUpdater.on("download-progress", (progress) => {
        const now = Date.now();
        if (now - lastProgressAt < PROGRESS_EMIT_INTERVAL_MS) return;
        lastProgressAt = now;
        events.onProgress({
          percent: progress.percent,
          transferredBytes: progress.transferred,
          totalBytes: progress.total,
        });
      });
      autoUpdater.on("update-downloaded", (info) => events.onDownloaded(info.version));
      autoUpdater.on("error", (error) => events.onError(error.message));
    },
    async checkForUpdates() {
      releaseDownloadPromise(await autoUpdater.checkForUpdates());
    },
    quitAndInstall() {
      autoUpdater.quitAndInstall(false, true);
    },
    async clearCachedUpdate() {
      // electron-updater keeps the cache helper protected, so no typed access
      // exists: Reflect is the narrowest way to a property the type will not
      // name, and the annotation keeps every use of the answer checked.
      // oxlint-disable-next-line anti-slop/no-reflect-get
      const helper: AppUpdaterInternals["downloadedUpdateHelper"] = Reflect.get(
        autoUpdater,
        "downloadedUpdateHelper",
      );
      await helper?.clear();
    },
  };
}
