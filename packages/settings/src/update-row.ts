import { PRODUCT_NAME } from "@repo/features/product-name";
import { commitLabel, devBuildDetail } from "./dev-build.js";
import { type RunningBuild, UPDATE_FAILURE, UPDATE_STATUS, type UpdateSnapshot } from "./update.js";

export const UPDATE_ROW_ACTION = {
  CHECK: "check",
  CHECKING: "checking",
  DOWNLOADING: "downloading",
  RESTART: "restart",
  GET: "get",
  MOVE: "move",
  RETRY: "retry",
  NONE: "none",
} as const;

export type UpdateRowAction = (typeof UPDATE_ROW_ACTION)[keyof typeof UPDATE_ROW_ACTION];

export interface UpdateRow {
  title: string;
  detail: string;
  action: UpdateRowAction;
  current: boolean;
  failed: boolean;
  progress?: number;
}

function updateAvailable(update: UpdateSnapshot): boolean {
  return (
    update.status === UPDATE_STATUS.DOWNLOADING ||
    update.status === UPDATE_STATUS.READY ||
    (update.status === UPDATE_STATUS.ERROR && update.latestVersion !== undefined)
  );
}

export function updateInSidebar(update: UpdateSnapshot): boolean {
  return (
    update.installSupported &&
    updateAvailable(update) &&
    update.status !== UPDATE_STATUS.DOWNLOADING
  );
}

export function fixtureUpdate(
  run: { readonly fixtureMode: boolean },
  update: UpdateSnapshot,
): UpdateSnapshot {
  if (!run.fixtureMode) return update;
  const [major = "0", minor = "0"] = update.currentVersion.split(".");
  return {
    status: UPDATE_STATUS.READY,
    currentVersion: update.currentVersion,
    installSupported: true,
    latestVersion: `${major}.${Number(minor) + 1}.0`,
  };
}

function versionTitle(update: UpdateSnapshot, build: RunningBuild): string {
  const version = `Version ${update.currentVersion}`;
  return build.commit ? `${version} (${commitLabel(build.commit)})` : version;
}

function downloadingDetail(update: UpdateSnapshot & { status: "downloading" }): string {
  const percent = update.progress ? ` ${Math.round(update.progress.percent)}%` : "";
  return `Downloading ${update.latestVersion}…${percent}`;
}

function idleRow(
  update: UpdateSnapshot & { status: typeof UPDATE_STATUS.IDLE },
): Omit<UpdateRow, "title"> {
  if (update.upToDate) {
    return { detail: "Up to date", action: UPDATE_ROW_ACTION.CHECK, current: true, failed: false };
  }
  if (update.unreachable) {
    return {
      detail: "Couldn't reach GitHub",
      action: UPDATE_ROW_ACTION.RETRY,
      current: false,
      failed: true,
    };
  }
  return {
    detail: "Not checked yet",
    action: UPDATE_ROW_ACTION.CHECK,
    current: false,
    failed: false,
  };
}

function releaseRow(update: UpdateSnapshot): Omit<UpdateRow, "title"> {
  if (!update.installSupported) {
    return {
      detail: "This copy can't update itself",
      action: UPDATE_ROW_ACTION.GET,
      current: false,
      failed: false,
    };
  }
  switch (update.status) {
    case UPDATE_STATUS.CHECKING:
      return {
        detail: "Checking for updates…",
        action: UPDATE_ROW_ACTION.CHECKING,
        current: false,
        failed: false,
      };
    case UPDATE_STATUS.DOWNLOADING:
      return {
        detail: downloadingDetail(update),
        action: UPDATE_ROW_ACTION.DOWNLOADING,
        current: false,
        failed: false,
        progress: update.progress?.percent ?? 0,
      };
    case UPDATE_STATUS.READY:
      return {
        detail: `${update.latestVersion} is ready to install`,
        action: UPDATE_ROW_ACTION.RESTART,
        current: false,
        failed: false,
      };
    case UPDATE_STATUS.UPDATED:
      return {
        detail: `Updated from ${update.previousVersion}`,
        action: UPDATE_ROW_ACTION.CHECK,
        current: true,
        failed: false,
      };
    case UPDATE_STATUS.ERROR:
      if (update.failure === UPDATE_FAILURE.READ_ONLY_VOLUME) {
        return {
          detail: `Move ${PRODUCT_NAME} to Applications to install ${update.latestVersion ?? "updates"}`,
          action: UPDATE_ROW_ACTION.MOVE,
          current: false,
          failed: true,
        };
      }
      return update.latestVersion
        ? {
            detail: `Couldn't install ${update.latestVersion}`,
            action: UPDATE_ROW_ACTION.GET,
            current: false,
            failed: true,
          }
        : {
            detail: "Couldn't check for updates",
            action: UPDATE_ROW_ACTION.RETRY,
            current: false,
            failed: true,
          };
    default:
      return idleRow(update);
  }
}

export function updateRow(update: UpdateSnapshot, build: RunningBuild): UpdateRow {
  if (!update.installSupported && !build.packaged) {
    return {
      title: "Development build",
      detail: devBuildDetail(build.commit),
      action: UPDATE_ROW_ACTION.NONE,
      current: false,
      failed: false,
    };
  }
  return { title: versionTitle(update, build), ...releaseRow(update) };
}
