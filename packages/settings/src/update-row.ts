import {
  type BuildCommit,
  type RunningBuild,
  UPDATE_STATUS,
  type UpdateSnapshot,
} from "./update.js";

/** The one action the row's button offers in each state. */
export const UPDATE_ROW_ACTION = {
  /** Ask the release manifest for the latest build. */
  CHECK: "check",
  /** Nothing to press: a check is already out. */
  CHECKING: "checking",
  /** Nothing to press: a newer build is downloading itself, and the row draws how far along. */
  DOWNLOADING: "downloading",
  /** Restart into the downloaded release. */
  RESTART: "restart",
  /** Open the latest release's page in the browser. */
  GET: "get",
  /** Ask the release manifest again, after a check that answered nothing. */
  RETRY: "retry",
  /** Nothing to press: a development build is newer than any release. */
  NONE: "none",
} as const;

export type UpdateRowAction = (typeof UPDATE_ROW_ACTION)[keyof typeof UPDATE_ROW_ACTION];

/** What the update row says, and what its button does. */
export interface UpdateRow {
  /** Which build is running: its version, or that it is a development build. */
  title: string;
  detail: string;
  action: UpdateRowAction;
  /** Whether the running build is positively the latest, for the check mark. */
  current: boolean;
  /** Whether the detail says a check or an install failed, which Settings announces as an alert. */
  failed: boolean;
  /** How far a download is, from 0 to 100, while one runs. */
  progress?: number;
}

/**
 * Whether a newer release is positively known to exist. The news stands
 * through the whole install: a release downloading, waiting on its restart,
 * or failed mid-fetch is still one this build is not on.
 */
function updateAvailable(update: UpdateSnapshot): boolean {
  return (
    update.status === UPDATE_STATUS.DOWNLOADING ||
    update.status === UPDATE_STATUS.READY ||
    (update.status === UPDATE_STATUS.ERROR && update.latestVersion !== undefined)
  );
}

/**
 * Whether the sidebar carries the release, between the account and the gear:
 * only while it has something to press — the restart once the release is
 * downloaded, or the releases page once installing it failed. A download
 * runs silently, as a browser's does, and a build that updates by hand has
 * no news to carry.
 */
export function updateInSidebar(update: UpdateSnapshot): boolean {
  return (
    update.installSupported &&
    updateAvailable(update) &&
    update.status !== UPDATE_STATUS.DOWNLOADING
  );
}

/**
 * The release a fixture run stages as downloaded and waiting on its restart,
 * one minor version past the running build, so every capture shows the
 * sidebar's update control. A live run has the updater's own answer.
 */
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

/** The commit as `git describe --dirty` would mark it. */
function commitLabel(commit: BuildCommit): string {
  return commit.dirty ? `${commit.sha}-dirty` : commit.sha;
}

/** The version, with the commit beside it quietly, for a bug report to quote. */
function versionTitle(update: UpdateSnapshot, build: RunningBuild): string {
  const version = `Version ${update.currentVersion}`;
  return build.commit ? `${version} (${commitLabel(build.commit)})` : version;
}

/** Where a development build was cut from: the branch and commit, as far as the build knew. */
function developmentDetail(commit: BuildCommit | undefined): string {
  if (!commit) return "Run from source.";
  return commit.branch ? `${commit.branch} @ ${commitLabel(commit)}` : commitLabel(commit);
}

function downloadingDetail(update: UpdateSnapshot & { status: "downloading" }): string {
  const percent = update.progress ? ` ${Math.round(update.progress.percent)}%` : "";
  return `Downloading ${update.latestVersion}…${percent}`;
}

/** Where an idle updater stands: positively current, unable to reach the feed when asked, or not yet asked. */
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
  // Not an answer: nothing has been learned yet, so the row only offers to
  // ask rather than posing an unknown as up to date.
  return {
    detail: "Not checked yet",
    action: UPDATE_ROW_ACTION.CHECK,
    current: false,
    failed: false,
  };
}

/** A packaged build's row, from where its updater stands. */
function releaseRow(update: UpdateSnapshot): Omit<UpdateRow, "title"> {
  // Note that a packaged build only lacks an updater when it runs on no
  // network or off macOS; the browser is still its way to the latest.
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
      // Note that an install that failed is fetched by hand, while a check
      // that failed is most likely answered by asking again.
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

/**
 * Reads the row from the last learned answer. The row only ever says where
 * the build stands and offers the next honest step: check again, wait for
 * the check or download already out, restart into a build already fetched,
 * try a check that failed again — or, where installing in place is
 * impossible or has failed, go get it in the browser instead. A build that cannot install itself never offers a
 * check it could do nothing with. A development build — run from source,
 * so newer than any release — names its commit and offers nothing, since a
 * release would only be older.
 */
export function updateRow(update: UpdateSnapshot, build: RunningBuild): UpdateRow {
  if (!update.installSupported && !build.packaged) {
    return {
      title: "Development build",
      detail: developmentDetail(build.commit),
      action: UPDATE_ROW_ACTION.NONE,
      current: false,
      failed: false,
    };
  }
  return { title: versionTitle(update, build), ...releaseRow(update) };
}
