import { UPDATE_STATUS, type UpdateSnapshot } from "../shared/contracts";

/** The one act the row's button offers in each state. */
export const UPDATE_ROW_ACTION = {
  /** Ask GitHub for the latest release name. */
  CHECK: "check",
  /** Nothing to press: a check is already out. */
  CHECKING: "checking",
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
 * page — one judgment, so the dot, the section's place, and the Download
 * button can never disagree about whether there is news.
 */
export function updateAvailable(update: UpdateSnapshot): boolean {
  return update.status === UPDATE_STATUS.UPDATE_AVAILABLE;
}

/**
 * Reads the row from the last learned answer. Fetching an update is the
 * user's own act in the browser — the row only ever says where the build
 * stands and offers the next honest step: check again, wait for the check
 * already out, or go get the newer release.
 */
export function updateRow(update: UpdateSnapshot): UpdateRow {
  switch (update.status) {
    case UPDATE_STATUS.CHECKING:
      return {
        detail: "Checking the latest release…",
        action: UPDATE_ROW_ACTION.CHECKING,
        current: false,
      };
    case UPDATE_STATUS.UP_TO_DATE:
      return {
        detail: "This is the latest release.",
        action: UPDATE_ROW_ACTION.CHECK,
        current: true,
      };
    case UPDATE_STATUS.UPDATE_AVAILABLE:
      return {
        detail: `Version ${update.latestVersion} is available to download.`,
        action: UPDATE_ROW_ACTION.GET,
        current: false,
      };
    case UPDATE_STATUS.UNREACHABLE:
      return {
        detail: "Could not reach GitHub to check. Try again in a moment.",
        action: UPDATE_ROW_ACTION.CHECK,
        current: false,
      };
    default:
      return {
        // Not an answer: nothing has been learned yet, so the row only offers
        // to ask rather than posing an unknown as up to date.
        detail: "The latest release has not been checked for yet.",
        action: UPDATE_ROW_ACTION.CHECK,
        current: false,
      };
  }
}
