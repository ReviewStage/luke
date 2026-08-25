import {
  UPDATE_STATUS,
  type UpdateProgress,
  type UpdateSnapshot,
  type UpdateStatus,
} from "#shared/contracts";

/**
 * The addresses updating ever touches, fixed here rather than passed in,
 * so the renderer names an intent and never an address — and nothing a check
 * read can steer where a press goes. The feed is where electron-updater reads
 * `latest-mac.yml` and the archive it names, both published by this
 * repository's release pipeline; `releases/latest` is what keeps the address
 * from ever moving. The changelog page is the site's rendering of the same
 * repository's CHANGELOG.md, where the Updates section's Changelog row goes.
 */
export const UPDATE_ENDPOINT = {
  // The trailing slash keeps the last segment a directory under every URL
  // resolver; electron-updater normalizes a slashless base itself, but the
  // literal should not need that reading.
  UPDATE_FEED_URL: "https://github.com/ReviewStage/luke/releases/latest/download/",
  LATEST_RELEASE_PAGE_URL: "https://github.com/ReviewStage/luke/releases/latest",
  CHANGELOG_PAGE_URL: "https://tryluke.dev/changelog",
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

/**
 * How a still-publishing release fails: the pipeline can put the manifest
 * live minutes before the archive it names finishes uploading, so a check
 * succeeds while the download 404s or lands short of its sha512. The
 * wordings are electron-updater's own — `HttpExecutor.doDownload` refusing
 * the download's status, `DigestTransform.validate` on the mismatch. A
 * genuinely corrupt release presents identically, which is why the retry
 * these earn is bounded rather than standing.
 */
const PUBLISHING_WINDOW_ERROR_PATTERNS = ["status 404", "sha512 checksum mismatch"] as const;

export function isPublishingWindowErrorMessage(message: string): boolean {
  return PUBLISHING_WINDOW_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * The publishing-window retry cadence. Each retry is the same check against
 * the same fixed feed — only the timing is new — and the schedule is short
 * and finite because the window it rides out is minutes long (v0.3.11's
 * manifest went live two minutes before its archive finished uploading).
 * Exhausted, the failure is the error row it always was: a corrupt release
 * must not hide behind endless retries.
 */
const PUBLISHING_RETRY_DELAYS_MS = [2 * 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000] as const;

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
  publishingRetryDelaysMs?: readonly number[];
  report?: (line: string) => void;
}

/**
 * Luke's face on electron-updater, shaped after the updater Superset runs in
 * production. A check reads the release manifest from the feed fixed by the
 * build; a newer build downloads at once and installs at the quit the user
 * asks for — the row's restart press, or whenever they next quit. Failures
 * are answers for the row, never throws: a network failure is silence (the
 * next timed check retries), a download refused right after its check found
 * the version is a release still publishing (retried on a short bounded
 * schedule), anything else is `error`, drawn as the way back to the releases
 * page. An install may only be asked for once — repeat
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
  readonly #publishingRetryDelaysMs: readonly number[];
  readonly #report: (line: string) => void;
  #snapshot: UpdateSnapshot;
  #latestVersion: string | undefined;
  #installing = false;
  #started = false;
  #timer: NodeJS.Timeout | undefined;
  #firstCheck: NodeJS.Timeout | undefined;
  #publishingRetry: NodeJS.Timeout | undefined;
  #publishingVersion: string | undefined;
  #publishingRetriesUsed = 0;
  /**
   * The version a live publishing wait is about, or undefined outside one.
   * Distinct from `#publishingVersion`, which keys the spent budget and must
   * outlive the wait: an exhausted version stays exhausted, so a later check
   * that finds it still failing lands on the error row, not a fresh schedule.
   */
  #publishingWait: string | undefined;

  constructor(options: UpdateServiceOptions) {
    this.#currentVersion = options.currentVersion;
    this.#onChange = options.onChange;
    this.#engine = options.engine;
    this.#lastRunVersion = options.lastRunVersion;
    this.#intervalMs = options.intervalMs ?? UPDATE_CHECK_DEFAULTS.INTERVAL_MS;
    this.#justUpdatedFirstCheckDelayMs =
      options.justUpdatedFirstCheckDelayMs ??
      UPDATE_CHECK_DEFAULTS.JUST_UPDATED_FIRST_CHECK_DELAY_MS;
    this.#publishingRetryDelaysMs = options.publishingRetryDelaysMs ?? PUBLISHING_RETRY_DELAYS_MS;
    this.#report = options.report ?? ((line) => process.stderr.write(`${line}\n`));
    this.#snapshot = this.#idle(false);
    this.#engine?.wire({
      onChecking: () => this.#move({ ...this.#base(UPDATE_STATUS.CHECKING) }),
      onAvailable: (version) => {
        this.#latestVersion = version;
        this.#move({ ...this.#base(UPDATE_STATUS.DOWNLOADING), latestVersion: version });
      },
      onNotAvailable: () => {
        this.#publishingWait = undefined;
        this.#move(this.#idle(true));
      },
      onProgress: (progress) => {
        if (this.#snapshot.status !== UPDATE_STATUS.DOWNLOADING) return;
        this.#move({ ...this.#snapshot, progress });
      },
      onDownloaded: (version) => {
        this.#latestVersion = version;
        this.#publishingWait = undefined;
        this.#move({ ...this.#base(UPDATE_STATUS.READY), latestVersion: version });
      },
      onError: (message) => {
        // Squirrel surfacing an error instead of quitting must release the
        // install guard, or the row's restart press dies with the attempt.
        this.#installing = false;
        if (isNetworkErrorMessage(message)) {
          if (this.#resumePublishingWait(message)) return;
          this.#report(`Update check could not reach the feed: ${message}`);
          this.#move(this.#idle(false));
          return;
        }
        if (this.#retryWhilePublishing(message)) return;
        this.#publishingWait = undefined;
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
    // Every check is also the retry a publishing wait was waiting on, so a
    // press or timed tick mid-wait collapses the pending timer rather than
    // stacking a second check behind it.
    if (this.#publishingRetry) {
      clearTimeout(this.#publishingRetry);
      this.#publishingRetry = undefined;
    }
    this.#move({ ...this.#base(UPDATE_STATUS.CHECKING) });
    try {
      await engine.checkForUpdates();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isNetworkErrorMessage(message)) {
        if (!this.#resumePublishingWait(message)) {
          this.#report(`Update check could not reach the feed: ${message}`);
          this.#move(this.#idle(false));
        }
      } else {
        this.#publishingWait = undefined;
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
    if (this.#publishingRetry) clearTimeout(this.#publishingRetry);
    this.#timer = undefined;
    this.#firstCheck = undefined;
    this.#publishingRetry = undefined;
  }

  /**
   * Spends the next slot of the version's retry budget and arms the timer.
   * The budget is keyed to the version so a later release starts fresh, and
   * it survives the wait itself: an exhausted version stays exhausted, so a
   * later check that finds it still failing lands on the error row rather
   * than a fresh schedule.
   */
  #armPublishingRetry(version: string): boolean {
    if (version !== this.#publishingVersion) {
      this.#publishingVersion = version;
      this.#publishingRetriesUsed = 0;
    }
    const delayMs = this.#publishingRetryDelaysMs[this.#publishingRetriesUsed];
    if (delayMs === undefined) return false;
    this.#publishingRetriesUsed += 1;
    if (this.#publishingRetry) clearTimeout(this.#publishingRetry);
    this.#publishingRetry = setTimeout(() => void this.check(), delayMs);
    this.#publishingRetry.unref();
    return true;
  }

  /**
   * A download that 404s or fails its sha512 right after a check found the
   * version is a release still publishing: the manifest went live before its
   * archive finished uploading. The same check is retried on the bounded
   * schedule; a version that outlives it falls to the error row it always
   * was, because a genuinely corrupt release fails the same way.
   */
  #retryWhilePublishing(message: string): boolean {
    if (this.#snapshot.status !== UPDATE_STATUS.DOWNLOADING) return false;
    if (!isPublishingWindowErrorMessage(message)) return false;
    const version = this.#snapshot.latestVersion;
    if (!this.#armPublishingRetry(version)) {
      this.#publishingWait = undefined;
      return false;
    }
    this.#publishingWait = version;
    this.#report(`Release ${version} is still publishing, retrying: ${message}`);
    // The partial archive must not stand, or the retry re-verifies it forever.
    void this.#engine?.clearCachedUpdate().catch(() => undefined);
    this.#move({ ...this.#base(UPDATE_STATUS.PUBLISHING), latestVersion: version });
    return true;
  }

  /**
   * A network failure while a publishing wait stands must not orphan the
   * wait: the interrupted check was the wait's own retry, or a press
   * standing in for it, and falling to idle silence would leave the found
   * version to the four-hour timer. The resume spends the same bounded
   * budget, so a machine that stays offline runs out of slots instead of
   * checking forever.
   */
  #resumePublishingWait(message: string): boolean {
    const version = this.#publishingWait;
    if (version === undefined) return false;
    // A failed check arrives twice, as the `error` event and the rejected
    // promise. The second delivery finds the wait already drawn and its
    // timer already armed — entering `publishing` always arms one — and must
    // not spend a second slot on the same failure.
    if (this.#snapshot.status === UPDATE_STATUS.PUBLISHING) return true;
    if (!this.#armPublishingRetry(version)) {
      this.#publishingWait = undefined;
      return false;
    }
    this.#report(`Update check could not reach the feed, still waiting on ${version}: ${message}`);
    this.#move({ ...this.#base(UPDATE_STATUS.PUBLISHING), latestVersion: version });
    return true;
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
