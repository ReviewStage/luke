import {
  UPDATE_STATUS,
  type UpdateProgress,
  type UpdateSnapshot,
  type UpdateStatus,
} from "./shared/contracts";

/**
 * The two addresses updating ever touches, fixed here rather than passed in,
 * so the renderer names an intent and never an address — and nothing a check
 * read can steer where a press goes. The feed is where electron-updater reads
 * `latest-mac.yml` and the archive it names, both published by this
 * repository's release pipeline; `releases/latest` is what keeps the address
 * from ever moving.
 */
export const UPDATE_ENDPOINT = {
  // The trailing slash keeps the last segment a directory under every URL
  // resolver; electron-updater normalizes a slashless base itself, but the
  // literal should not need that reading.
  UPDATE_FEED_URL: "https://github.com/ReviewStage/luke/releases/latest/download/",
  LATEST_RELEASE_PAGE_URL: "https://github.com/ReviewStage/luke/releases/latest",
} as const;

const UPDATE_CHECK_DEFAULTS = {
  /**
   * Four hours between timed checks, matching the interval Superset settled
   * on for the same feed shape: a release lands at most every few days, and
   * an unauthenticated GitHub read is rate-limited by address.
   */
  INTERVAL_MS: 4 * 60 * 60 * 1000,
  /**
   * The first check after an install waits long enough for the "updated"
   * confirmation to be seen before `checking` overwrites it.
   */
  JUST_UPDATED_FIRST_CHECK_DELAY_MS: 10_000,
} as const;

/**
 * Failures that are the network's, not the release's: transient, expected,
 * and resolved by the next timed check, so they must not be drawn as errors.
 */
const SILENT_NETWORK_ERROR_PATTERNS = [
  "net::ERR_INTERNET_DISCONNECTED",
  "net::ERR_NETWORK_CHANGED",
  "net::ERR_CONNECTION_REFUSED",
  "net::ERR_NAME_NOT_RESOLVED",
  "net::ERR_CONNECTION_TIMED_OUT",
  "net::ERR_CONNECTION_RESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ECONNRESET",
] as const;

export function isNetworkErrorMessage(message: string): boolean {
  return SILENT_NETWORK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

/** The updater lifecycle, as electron-updater announces it. */
export interface UpdaterEngineEvents {
  onChecking: () => void;
  /** A newer build exists; with auto-download its fetch has already begun. */
  onAvailable: (version: string) => void;
  onNotAvailable: () => void;
  onProgress: (progress: UpdateProgress) => void;
  onDownloaded: (version: string) => void;
  onError: (message: string) => void;
}

/**
 * The one thing that can replace the running build: a wrapper over
 * electron-updater, injected so the service's state can be exercised without
 * it. Absent wherever installing in place is impossible — an unpackaged run,
 * a run that sends no network — which the service reports as
 * `installSupported: false` so the row offers the browser instead.
 */
export interface UpdaterEngine {
  wire(events: UpdaterEngineEvents): void;
  /** Resolves when the check has answered; a found download runs on behind it. */
  checkForUpdates(): Promise<void>;
  quitAndInstall(): void;
  /**
   * Drops electron-updater's cached download. Its cache only self-invalidates
   * when the remote sha512 differs, so a corrupt cached download would be
   * retried forever if an error left it standing.
   */
  clearCachedUpdate(): Promise<void>;
}

/** Where the last-run version is kept between launches, for the `updated` confirmation. */
export interface LastRunVersionStore {
  read(): string | undefined;
  write(version: string): void;
}

export interface UpdateServiceOptions {
  /** The running build's version, as the packaged app reports it. */
  currentVersion: string;
  /** Every state the service moves through, for the broadcast to carry. */
  onChange: (update: UpdateSnapshot) => void;
  engine?: UpdaterEngine;
  lastRunVersion?: LastRunVersionStore;
  intervalMs?: number;
  justUpdatedFirstCheckDelayMs?: number;
  report?: (line: string) => void;
}

/**
 * Luke's face on electron-updater, shaped after the updater Superset runs in
 * production. A check reads the release manifest from the feed fixed by the
 * build; a newer build downloads at once and installs at the quit the user
 * asks for — the row's restart press, or whenever they next quit. Failures
 * are answers for the row, never throws: a network failure is silence (the
 * next timed check retries), anything else is `error`, drawn as the way back
 * to the releases page. An install may only be asked for once — repeat
 * presses racing Squirrel's binary swap is a failure Superset met in
 * production — and a failed install falls out of `ready`, so the guard
 * releases with it.
 */
export class UpdateService {
  readonly #currentVersion: string;
  readonly #onChange: (update: UpdateSnapshot) => void;
  readonly #engine: UpdaterEngine | undefined;
  readonly #lastRunVersion: LastRunVersionStore | undefined;
  readonly #intervalMs: number;
  readonly #justUpdatedFirstCheckDelayMs: number;
  readonly #report: (line: string) => void;
  #snapshot: UpdateSnapshot;
  #latestVersion: string | undefined;
  #installing = false;
  #started = false;
  #timer: NodeJS.Timeout | undefined;
  #firstCheck: NodeJS.Timeout | undefined;

  constructor(options: UpdateServiceOptions) {
    this.#currentVersion = options.currentVersion;
    this.#onChange = options.onChange;
    this.#engine = options.engine;
    this.#lastRunVersion = options.lastRunVersion;
    this.#intervalMs = options.intervalMs ?? UPDATE_CHECK_DEFAULTS.INTERVAL_MS;
    this.#justUpdatedFirstCheckDelayMs =
      options.justUpdatedFirstCheckDelayMs ??
      UPDATE_CHECK_DEFAULTS.JUST_UPDATED_FIRST_CHECK_DELAY_MS;
    this.#report = options.report ?? ((line) => process.stderr.write(`${line}\n`));
    this.#snapshot = this.#idle(false);
    this.#engine?.wire({
      onChecking: () => this.#move({ ...this.#base(UPDATE_STATUS.CHECKING) }),
      onAvailable: (version) => {
        this.#latestVersion = version;
        this.#move({ ...this.#base(UPDATE_STATUS.DOWNLOADING), latestVersion: version });
      },
      onNotAvailable: () => this.#move(this.#idle(true)),
      onProgress: (progress) => {
        if (this.#snapshot.status !== UPDATE_STATUS.DOWNLOADING) return;
        this.#move({ ...this.#snapshot, progress });
      },
      onDownloaded: (version) => {
        this.#latestVersion = version;
        this.#move({ ...this.#base(UPDATE_STATUS.READY), latestVersion: version });
      },
      onError: (message) => {
        // Squirrel surfacing an error instead of quitting must release the
        // install guard, or the row's restart press dies with the attempt.
        this.#installing = false;
        if (isNetworkErrorMessage(message)) {
          this.#report(`Update check could not reach the feed: ${message}`);
          this.#move(this.#idle(false));
          return;
        }
        this.#report(`Update failed: ${message}`);
        void this.#engine?.clearCachedUpdate().catch(() => undefined);
        this.#move({ ...this.#base(UPDATE_STATUS.ERROR), latestVersion: this.#latestVersion });
      },
    });
  }

  snapshot(): UpdateSnapshot {
    return this.#snapshot;
  }

  /**
   * Asks the manifest for the latest build once, resolving with the state the
   * answer moved to — `downloading` when a newer build was found, because the
   * fetch begins inside the check. Without an engine there is nothing to ask
   * and the standing snapshot is the whole answer.
   */
  async check(): Promise<UpdateSnapshot> {
    const engine = this.#engine;
    if (!engine || this.#installing) return this.#snapshot;
    // A download in flight or in hand holds the row — here Luke is stricter
    // than the updater Superset runs: a timed tick that re-checked mid-flight
    // would stomp the progress or the restart offer with `checking`, and a
    // feed failure after a completed download would trade a build in hand
    // for an error row and a cleared cache.
    if (
      this.#snapshot.status === UPDATE_STATUS.DOWNLOADING ||
      this.#snapshot.status === UPDATE_STATUS.READY
    ) {
      return this.#snapshot;
    }
    this.#move({ ...this.#base(UPDATE_STATUS.CHECKING) });
    try {
      await engine.checkForUpdates();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isNetworkErrorMessage(message)) {
        this.#report(`Update check could not reach the feed: ${message}`);
        this.#move(this.#idle(false));
      } else {
        this.#report(`Update check failed: ${message}`);
        this.#move({ ...this.#base(UPDATE_STATUS.ERROR), latestVersion: this.#latestVersion });
      }
    }
    return this.#snapshot;
  }

  /**
   * Restarts into the downloaded build. Only `ready` has one, and only one
   * ask ever reaches the engine: repeat presses while Squirrel stages the
   * swap fan out into parallel installs racing to replace the binary, which
   * can leave the app on the old version.
   */
  install(): void {
    if (!this.#engine || this.#installing) return;
    if (this.#snapshot.status !== UPDATE_STATUS.READY) return;
    this.#installing = true;
    this.#engine.quitAndInstall();
  }

  /**
   * Starts the timed check. The first check runs at once — except on the
   * first launch after an install, where it waits long enough for the
   * `updated` confirmation to be seen before `checking` overwrites it.
   */
  start(): void {
    if (this.#started || !this.#engine) return;
    this.#started = true;
    const previous = this.#lastRunVersion?.read();
    const justUpdated = previous !== undefined && previous !== this.#currentVersion;
    if (previous !== this.#currentVersion) this.#lastRunVersion?.write(this.#currentVersion);
    if (justUpdated) {
      this.#report(`Updated: ${previous} -> ${this.#currentVersion}`);
      this.#move({ ...this.#base(UPDATE_STATUS.UPDATED), previousVersion: previous });
    }
    this.#timer = setInterval(() => void this.check(), this.#intervalMs);
    this.#timer.unref();
    this.#firstCheck = setTimeout(
      () => void this.check(),
      justUpdated ? this.#justUpdatedFirstCheckDelayMs : 0,
    );
    this.#firstCheck.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    if (this.#firstCheck) clearTimeout(this.#firstCheck);
    this.#timer = undefined;
    this.#firstCheck = undefined;
  }

  #base<Status extends UpdateStatus>(status: Status) {
    return {
      status,
      currentVersion: this.#currentVersion,
      installSupported: this.#engine !== undefined,
    };
  }

  #idle(upToDate: boolean): UpdateSnapshot {
    return { ...this.#base(UPDATE_STATUS.IDLE), upToDate };
  }

  #move(snapshot: UpdateSnapshot): void {
    this.#snapshot = snapshot;
    try {
      this.#onChange(snapshot);
    } catch {
      // A listener's failure is its own — a window torn down mid-broadcast
      // must not fail the transition that has already moved.
    }
  }
}
