import {
  UPDATE_ENDPOINT,
  type UpdaterEngine,
  type UpdaterEngineEvents,
} from "@repo/host/update-service";
import { autoUpdater, type UpdateCheckResult } from "electron-updater";

const PROGRESS_EMIT_INTERVAL_MS = 500;

function releaseDownloadPromise(result: UpdateCheckResult | null): void {
  result?.downloadPromise?.catch(() => undefined);
}

interface AppUpdaterInternals {
  downloadedUpdateHelper: { clear(): Promise<void> } | null;
}

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
      const helper: AppUpdaterInternals["downloadedUpdateHelper"] = Reflect.get(
        autoUpdater,
        "downloadedUpdateHelper",
      );
      await helper?.clear();
    },
  };
}
