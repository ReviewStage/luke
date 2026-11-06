import { LINK_ORIGIN } from "@repo/features/link-home";
import { scheduleOnce } from "@repo/runtime/effect";
import {
  UPDATE_FAILURE,
  UPDATE_STATUS,
  type UpdateFailure,
  type UpdateProgress,
  type UpdateSnapshot,
  type UpdateStatus,
} from "@repo/settings/update";
import { type Context, Duration, Effect, type Fiber, Schedule, Scope } from "effect";

export const UPDATE_ENDPOINT = {
  UPDATE_FEED_URL: "https://github.com/ReviewStage/vespin/releases/latest/download/",
  LATEST_RELEASE_PAGE_URL: "https://github.com/ReviewStage/vespin/releases/latest",
  CHANGELOG_PAGE_URL: `${LINK_ORIGIN}/changelog`,
} as const;

const UPDATE_CHECK_DEFAULTS = {
  INTERVAL_MS: 4 * 60 * 60 * 1000,
  JUST_UPDATED_FIRST_CHECK_DELAY_MS: 10_000,
} as const;

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

const READ_ONLY_VOLUME_ERROR_PATTERN = "read-only volume";

function updateFailureOf(message: string): UpdateFailure | undefined {
  return message.includes(READ_ONLY_VOLUME_ERROR_PATTERN)
    ? UPDATE_FAILURE.READ_ONLY_VOLUME
    : undefined;
}

export interface UpdaterEngineEvents {
  onChecking: () => void;
  onAvailable: (version: string) => void;
  onNotAvailable: () => void;
  onProgress: (progress: UpdateProgress) => void;
  onDownloaded: (version: string) => void;
  onError: (message: string) => void;
}

export interface UpdaterEngine {
  wire(events: UpdaterEngineEvents): void;
  checkForUpdates(): Promise<void>;
  quitAndInstall(): void;
  clearCachedUpdate(): Promise<void>;
}

export function idleUpdateSnapshot(
  currentVersion: string,
  installSupported: boolean,
): Extract<UpdateSnapshot, { status: typeof UPDATE_STATUS.IDLE }> {
  return { status: UPDATE_STATUS.IDLE, currentVersion, installSupported, upToDate: false };
}

interface LastRunVersionStore {
  read(): string | undefined;
  write(version: string): void;
}

interface UpdateServiceOptions {
  currentVersion: string;
  onChange: (update: UpdateSnapshot) => void;
  engine?: UpdaterEngine | undefined;
  lastRunVersion?: LastRunVersionStore;
  intervalMs?: number;
  justUpdatedFirstCheckDelayMs?: number;
  report: (line: string) => void;
}

export class UpdateService {
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
  readonly #scope: Scope.Scope;
  #snapshot: UpdateSnapshot;
  #latestVersion: string | undefined;
  #asked = false;
  #installing = false;
  #started = false;
  #stopped = false;
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
    this.#report = options.report;
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
        this.#installing = false;
        if (isNetworkErrorMessage(message)) {
          this.#report(`Update check could not reach the feed: ${message}`);
          this.#move(this.#idle(false, this.#asked));
          return;
        }
        this.#report(`Update failed: ${message}`);
        void this.#engine?.clearCachedUpdate().catch(() => undefined);
        this.#move(this.#errorSnapshot(updateFailureOf(message)));
      },
    });
  }

  snapshot(): UpdateSnapshot {
    return this.#snapshot;
  }

  async check({ asked = false }: { asked?: boolean } = {}): Promise<UpdateSnapshot> {
    const engine = this.#engine;
    if (!engine || this.#installing) return this.#snapshot;
    if (
      this.#snapshot.status === UPDATE_STATUS.DOWNLOADING ||
      this.#snapshot.status === UPDATE_STATUS.READY
    ) {
      return this.#snapshot;
    }
    this.#asked = asked;
    this.#latestVersion = undefined;
    this.#move({ ...this.#base(UPDATE_STATUS.CHECKING) });
    try {
      await engine.checkForUpdates();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isNetworkErrorMessage(message)) {
        this.#report(`Update check could not reach the feed: ${message}`);
        this.#move(this.#idle(false, this.#asked));
      } else {
        this.#report(`Update check failed: ${message}`);
        this.#move(this.#errorSnapshot(updateFailureOf(message)));
      }
    }
    return this.#snapshot;
  }

  install(): void {
    if (!this.#engine || this.#installing) return;
    if (this.#snapshot.status !== UPDATE_STATUS.READY) return;
    this.#installing = true;
    this.#engine.quitAndInstall();
  }

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

  #errorSnapshot(failure?: UpdateFailure): UpdateSnapshot {
    return {
      ...this.#base(UPDATE_STATUS.ERROR),
      ...(this.#latestVersion === undefined ? undefined : { latestVersion: this.#latestVersion }),
      ...(failure === undefined ? undefined : { failure }),
    };
  }

  #idle(upToDate: boolean, unreachable = false): UpdateSnapshot {
    const idle = {
      ...idleUpdateSnapshot(this.#currentVersion, this.#engine !== undefined),
      upToDate,
    };
    return unreachable ? { ...idle, unreachable } : idle;
  }

  #move(snapshot: UpdateSnapshot): void {
    this.#snapshot = snapshot;
    try {
      this.#onChange(snapshot);
    } catch {}
  }
}
