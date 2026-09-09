/**
 * Where the updater stands, in the states electron-updater's own lifecycle
 * moves through. `IDLE` is both "nothing learned yet" and "nothing newer" —
 * `upToDate` on the snapshot says which, so the row never poses an unasked
 * question as an answer. A check that finds a newer build downloads it at
 * once, so there is no standing "available" state: the news arrives as
 * `DOWNLOADING`. `UPDATED` is transient — the first launch after an install
 * confirms what just happened. `PUBLISHING` is the window between a release's
 * manifest and its archive: a version was found but its download is not
 * servable yet, and the service is retrying on its own bounded schedule.
 * `ERROR` must be drawn as the way back to the browser, never as a dead end.
 */
export const UPDATE_STATUS = {
  IDLE: "idle",
  CHECKING: "checking",
  DOWNLOADING: "downloading",
  READY: "ready",
  UPDATED: "updated",
  PUBLISHING: "publishing",
  ERROR: "error",
} as const;

export type UpdateStatus = (typeof UPDATE_STATUS)[keyof typeof UPDATE_STATUS];

/** How far along a download is, as electron-updater reports it. */
export interface UpdateProgress {
  percent: number;
  transferredBytes: number;
  totalBytes: number;
}

/**
 * What the update row draws from. The latest version travels only on the
 * states that learned it, and no address ever travels: the manifest updates
 * are fetched from and the page a failure falls back to are both fixed in
 * the main process, so nothing a check read can steer where a press goes.
 * `installSupported` says whether this build can replace itself in place —
 * only a signed, packaged build running live can — so every other run's row
 * offers the browser instead of an install that must fail. An error's text
 * stays in the main process's log; the row words failures itself.
 */
export type UpdateSnapshot =
  | {
      status: typeof UPDATE_STATUS.IDLE;
      currentVersion: string;
      installSupported: boolean;
      /** True only after a check positively answered "nothing newer". */
      upToDate: boolean;
    }
  | {
      status: typeof UPDATE_STATUS.CHECKING;
      currentVersion: string;
      installSupported: boolean;
    }
  | {
      status: typeof UPDATE_STATUS.DOWNLOADING;
      currentVersion: string;
      installSupported: boolean;
      latestVersion: string;
      progress?: UpdateProgress;
    }
  | {
      status: typeof UPDATE_STATUS.READY;
      currentVersion: string;
      installSupported: boolean;
      latestVersion: string;
    }
  | {
      status: typeof UPDATE_STATUS.UPDATED;
      currentVersion: string;
      installSupported: boolean;
      /** The version this build replaced, for the row to name the arrival. */
      previousVersion: string;
    }
  | {
      status: typeof UPDATE_STATUS.PUBLISHING;
      currentVersion: string;
      installSupported: boolean;
      latestVersion: string;
    }
  | {
      status: typeof UPDATE_STATUS.ERROR;
      currentVersion: string;
      installSupported: boolean;
      latestVersion?: string;
    };
