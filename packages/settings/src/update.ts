export const UPDATE_STATUS = {
  IDLE: "idle",
  CHECKING: "checking",
  DOWNLOADING: "downloading",
  READY: "ready",
  UPDATED: "updated",
  ERROR: "error",
} as const;

export type UpdateStatus = (typeof UPDATE_STATUS)[keyof typeof UPDATE_STATUS];

export const UPDATE_FAILURE = {
  READ_ONLY_VOLUME: "read-only-volume",
} as const;

export type UpdateFailure = (typeof UPDATE_FAILURE)[keyof typeof UPDATE_FAILURE];

export interface BuildCommit {
  sha: string;
  dirty: boolean;
  branch?: string;
}

export interface RunningBuild {
  packaged: boolean;
  commit?: BuildCommit;
}

export interface UpdateProgress {
  percent: number;
  transferredBytes: number;
  totalBytes: number;
}

export type UpdateSnapshot =
  | {
      status: typeof UPDATE_STATUS.IDLE;
      currentVersion: string;
      installSupported: boolean;
      upToDate: boolean;
      unreachable?: boolean;
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
      previousVersion: string;
    }
  | {
      status: typeof UPDATE_STATUS.ERROR;
      currentVersion: string;
      installSupported: boolean;
      latestVersion?: string;
      failure?: UpdateFailure;
    };
