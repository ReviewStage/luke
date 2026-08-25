import { UPDATE_STATUS, type UpdateSnapshot } from "#shared/wire/update";

/** The one act the row's button offers in each state. */
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
} as const;

export type UpdateRowAction = (typeof UPDATE_ROW_ACTION)[keyof typeof UPDATE_ROW_ACTION];

/** What the update row says, and what its button does. */
export interface UpdateRow {
  detail: string;
  action: UpdateRowAction;
  /** Whether the running build is positively the latest, for the check mark. */
  current: boolean;
}

/**
 * Whether a newer release is positively known to exist. This is what marks
 * the Settings tab and moves the Updates section to the head of the front
 * page — one judgment, so the dot, the section's place, and the row can
 * never disagree about whether there is news. The news stands through the
 * whole install: a release downloading, still publishing, waiting on its
 * restart, or failed mid-fetch is still one this build is not on.
 */
export function updateAvailable(update: UpdateSnapshot): boolean {
  return (
    update.status === UPDATE_STATUS.DOWNLOADING ||
    update.status === UPDATE_STATUS.READY ||
    update.status === UPDATE_STATUS.PUBLISHING ||
    (update.status === UPDATE_STATUS.ERROR && update.latestVersion !== undefined)
  );
}

function downloadingDetail(update: UpdateSnapshot & { status: "downloading" }): string {
  const percent = update.progress ? ` (${Math.round(update.progress.percent)}%)` : "";
  return `Downloading version ${update.latestVersion}…${percent}`;
}

/**
 * Reads the row from the last learned answer. The row only ever says where
 * the build stands and offers the next honest step: check again, wait for
 * the check or download already out, restart into a build already fetched —
 * or, where installing in place is impossible or has failed, go get it in
 * the browser instead. A build that cannot install itself never offers a
 * check it could do nothing with.
 */
export function updateRow(update: UpdateSnapshot): UpdateRow {
  if (!update.installSupported) {
    return {
      detail: "This build updates by hand: the releases page has the latest.",
      action: UPDATE_ROW_ACTION.GET,
      current: false,
    };
  }
  switch (update.status) {
    case UPDATE_STATUS.CHECKING:
      return {
        detail: "Checking the latest release…",
        action: UPDATE_ROW_ACTION.CHECKING,
        current: false,
      };
    case UPDATE_STATUS.DOWNLOADING:
      return {
        detail: downloadingDetail(update),
        action: UPDATE_ROW_ACTION.DOWNLOADING,
        current: false,
      };
    case UPDATE_STATUS.READY:
      return {
        detail: `Version ${update.latestVersion} is downloaded.`,
        action: UPDATE_ROW_ACTION.RESTART,
        current: false,
      };
    case UPDATE_STATUS.UPDATED:
      return {
        detail: `Updated from version ${update.previousVersion}.`,
        action: UPDATE_ROW_ACTION.CHECK,
        current: true,
      };
    case UPDATE_STATUS.PUBLISHING:
      return {
        detail: `Version ${update.latestVersion} was found but its download isn't ready yet. Luke will retry in a few minutes.`,
        action: UPDATE_ROW_ACTION.CHECK,
        current: false,
      };
    case UPDATE_STATUS.ERROR:
      return {
        detail: update.latestVersion
          ? `The update could not be installed. Get version ${update.latestVersion} from the releases page instead.`
          : "The update check failed. The releases page has the latest build.",
        action: UPDATE_ROW_ACTION.GET,
        current: false,
      };
    default:
      return update.status === UPDATE_STATUS.IDLE && update.upToDate
        ? {
            detail: "This is the latest release.",
            action: UPDATE_ROW_ACTION.CHECK,
            current: true,
          }
        : {
            // Not an answer: nothing has been learned yet, so the row only
            // offers to ask rather than posing an unknown as up to date.
            detail: "The latest release has not been checked for yet.",
            action: UPDATE_ROW_ACTION.CHECK,
            current: false,
          };
  }
}
