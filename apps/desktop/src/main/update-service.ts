import { scheduleOnce } from "@sidecar/runtime/effect";
import { type Context, Duration, Effect, type Fiber, Schedule, Scope } from "effect";
import {
  UPDATE_STATUS,
  type UpdateProgress,
  type UpdateSnapshot,
  type UpdateStatus,
} from "#shared/messages/update";
import { reportToStderr } from "./stderr-report";

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

function isNetworkErrorMessage(message: string): boolean {
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

/**
 * Where the updater stands before it has learned anything: what the row
 * draws at launch, and what the app state document begins with, from the one
 * definition rather than two that have to agree.
 */
export function idleUpdateSnapshot(
  currentVersion: string,
  installSupported: boolean,
): Extract<UpdateSnapshot, { status: typeof UPDATE_STATUS.IDLE }> {
  return { status: UPDATE_STATUS.IDLE, currentVersion, installSupported, upToDate: false };
}

/** Where the last-run version is kept between launches, for the `updated` confirmation. */
interface LastRunVersionStore {
  read(): string | undefined;
  write(version: string): void;
}

interface UpdateServiceOptions {
  /** The running build's version, as the packaged app reports it. */
  currentVersion: string;
  /** Every state the service moves through, for the broadcast to carry. */
  onChange: (update: UpdateSnapshot) => void;
  engine?: UpdaterEngine | undefined;
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
  /**
   * The service as the effect that builds it, since nothing here may run
   * under services of its own: the launch's own scope is what the timed
   * check and the first check fork into, and the
   * launch's own services are what a synchronous caller's
   * `start`/`check`/`install` steps or forks its effects under, read once out
   * of the fiber building this rather than defaulted, so a bridge can never
   * run under the empty context plain `Effect.runSync` stands for in place of
   * the one the launch actually holds.
   */
  static make(options: UpdateServiceOptions): Effect.Effect<UpdateService, never, Scope.Scope> {
    return Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const services = yield* Effect.context<never>();
      return new UpdateService(options, scope, services);
    });
  }

  readonly #currentVersion: string;
  readonly #onChange: (update: UpdateSnapshot) => void;
  readonly #engine: UpdaterEngine | undefined;
  readonly #lastRunVersion: LastRunVersionStore | undefined;
  readonly #intervalMs: number;
  readonly #justUpdatedFirstCheckDelayMs: number;
  readonly #report: (line: string) => void;
  readonly #services: Context.Context<never>;
  /** Every fiber the service forks — the timed check and the first check — lands here. */
  readonly #scope: Scope.Scope;
  #snapshot: UpdateSnapshot;
  #latestVersion: string | undefined;
  #installing = false;
  #started = false;
  #stopped = false;
  /**
   * The timed check and the first check `start()` forks, tracked so `stop()`
   * can interrupt them directly when the scope they forked into is not this
   * class's own to close.
   */
  #repeatingCheck: Fiber.Fiber<unknown> | undefined;
  #firstCheck: Fiber.Fiber<unknown> | undefined;

  private constructor(
    options: UpdateServiceOptions,
    scope: Scope.Scope,
    services: Context.Context<never>,
  ) {
    this.#currentVersion = options.currentVersion;
    this.#onChange = options.onChange;
    this.#engine = options.engine;
    this.#lastRunVersion = options.lastRunVersion;
    this.#services = services;
    this.#scope = scope;
    this.#intervalMs = options.intervalMs ?? UPDATE_CHECK_DEFAULTS.INTERVAL_MS;
    this.#justUpdatedFirstCheckDelayMs =
      options.justUpdatedFirstCheckDelayMs ??
      UPDATE_CHECK_DEFAULTS.JUST_UPDATED_FIRST_CHECK_DELAY_MS;
    this.#report = options.report ?? reportToStderr;
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
        this.#move(this.#errorSnapshot());
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
        this.#move(this.#errorSnapshot());
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
   * `updated` confirmation to be seen before `checking` overwrites it. Both
   * are fibers forked into the service's own scope, which `stop()` closes.
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
    const runSync = Effect.runSyncWith(this.#services);
    const work = Effect.sync(() => void this.check());
    // The interval never fires at the fork itself: the whole repeat is
    // pushed back by one interval, so the cadence lands at `intervalMs`,
    // `2 * intervalMs`, ... exactly as the timer it replaces did, leaving the
    // very first check to the one below.
    this.#repeatingCheck = runSync(
      Effect.provideService(
        Effect.forkScoped(
          Effect.delay(
            Effect.repeat(work, Schedule.spaced(Duration.millis(this.#intervalMs))),
            Duration.millis(this.#intervalMs),
          ),
        ),
        Scope.Scope,
        this.#scope,
      ),
    );
    this.#firstCheck = runSync(
      Effect.provideService(
        scheduleOnce(justUpdated ? this.#justUpdatedFirstCheckDelayMs : 0, work),
        Scope.Scope,
        this.#scope,
      ),
    );
  }

  /**
   * Gives back every fiber `start()` forked: the timed check and the first
   * check, each interrupted directly rather
   * than by closing the scope they forked into, since that scope is the
   * launch's own and not this class's to close.
   */
  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#repeatingCheck?.interruptUnsafe();
    this.#firstCheck?.interruptUnsafe();
  }

  #base<Status extends UpdateStatus>(status: Status) {
    return {
      status,
      currentVersion: this.#currentVersion,
      installSupported: this.#engine !== undefined,
    };
  }

  #errorSnapshot(): UpdateSnapshot {
    const base = { ...this.#base(UPDATE_STATUS.ERROR) };
    return this.#latestVersion === undefined
      ? base
      : { ...base, latestVersion: this.#latestVersion };
  }

  #idle(upToDate: boolean): UpdateSnapshot {
    return { ...idleUpdateSnapshot(this.#currentVersion, this.#engine !== undefined), upToDate };
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
