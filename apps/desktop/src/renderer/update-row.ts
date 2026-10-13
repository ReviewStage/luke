import {
  type BuildCommit,
  type RunningBuild,
  UPDATE_STATUS,
  type UpdateSnapshot,
} from "#shared/messages/update";

/** The one action the row's button offers in each state. */
export const UPDATE_ROW_ACTION = {
  /** Ask the release manifest for the latest build. */
  CHECK: "check",
  /** Nothing to press: a check is already out. */
  CHECKING: "checking",
  /** Nothing to press: a newer build is downloading itself. */
  DOWNLOADING: "downloading",
  /** Restart into the downloaded release. */
  RESTART: "restart",
  /** Open the latest release's page in the browser. */
  GET: "get",
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
 * Whether the sidebar carries the release itself, above the account row:
 * whenever a newer one is known to a build that installs in place, so the
 * news is said there alone rather than by a dot on Settings' gear. Its row
 * offers the release's own next step: wait while it downloads, restart once
 * it is downloaded, or get it from the releases page once installing it
 * failed. A build that updates by hand has no news to carry.
 */
export function updateInSidebar(update: UpdateSnapshot): boolean {
  return update.installSupported && updateAvailable(update);
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
  const percent = update.progress ? ` (${Math.round(update.progress.percent)}%)` : "";
  return `Downloading version ${update.latestVersion}…${percent}`;
}

/** A packaged build's row, from where its updater stands. */
function releaseRow(update: UpdateSnapshot): Omit<UpdateRow, "title"> {
  // Note that a packaged build only lacks an updater when it runs on no
  // network or off macOS; the browser is still its way to the latest.
  if (!update.installSupported) {
    return {
      detail: "This build can't update itself. Download the latest release instead.",
      action: UPDATE_ROW_ACTION.GET,
      current: false,
      failed: false,
    };
  }
  switch (update.status) {
    case UPDATE_STATUS.CHECKING:
      return {
        detail: "Checking the latest release…",
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
      };
    case UPDATE_STATUS.READY:
      return {
        detail: `Version ${update.latestVersion} is downloaded.`,
        action: UPDATE_ROW_ACTION.RESTART,
        current: false,
        failed: false,
      };
    case UPDATE_STATUS.UPDATED:
      return {
        detail: `Updated from version ${update.previousVersion}.`,
        action: UPDATE_ROW_ACTION.CHECK,
        current: true,
        failed: false,
      };
    case UPDATE_STATUS.ERROR:
      return {
        detail: update.latestVersion
          ? `The update could not be installed. Get version ${update.latestVersion} from the releases page instead.`
          : "The update check failed. The releases page has the latest build.",
        action: UPDATE_ROW_ACTION.GET,
        current: false,
        failed: true,
      };
    default:
      return update.status === UPDATE_STATUS.IDLE && update.upToDate
        ? {
            detail: "This is the latest release.",
            action: UPDATE_ROW_ACTION.CHECK,
            current: true,
            failed: false,
          }
        : {
            // Not an answer: nothing has been learned yet, so the row only
            // offers to ask rather than posing an unknown as up to date.
            detail: "The latest release has not been checked for yet.",
            action: UPDATE_ROW_ACTION.CHECK,
            current: false,
            failed: false,
          };
  }
}

/**
 * Reads the row from the last learned answer. The row only ever says where
 * the build stands and offers the next honest step: check again, wait for
 * the check or download already out, restart into a build already fetched —
 * or, where installing in place is impossible or has failed, go get it in
 * the browser instead. A build that cannot install itself never offers a
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
