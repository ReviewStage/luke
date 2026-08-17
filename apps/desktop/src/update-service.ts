import { isNewerVersion, isRecord, parseReleaseVersion, text } from "@sidecar/core";
import { UPDATE_STATUS, type UpdateSnapshot } from "./shared/contracts";

/**
 * The two addresses updating ever touches, fixed here rather than passed in,
 * so the renderer names an intent and never an address — and nothing a check
 * read can steer where a press goes. The check is the one request Luke makes
 * with no user-supplied key at all: an unauthenticated read of the latest
 * published release's name, carrying nothing about the user or their
 * sessions.
 */
export const UPDATE_ENDPOINT = {
  LATEST_RELEASE_URL: "https://api.github.com/repos/ReviewStage/luke/releases/latest",
  LATEST_RELEASE_PAGE_URL: "https://github.com/ReviewStage/luke/releases/latest",
} as const;

/** GitHub's documented media type and version pin, as the Copilot adapter sends them. */
const GITHUB_REQUEST_HEADERS: Readonly<Record<string, string>> = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2026-03-10",
};

const UPDATE_CHECK_DEFAULTS = {
  REQUEST_TIMEOUT_MS: 10_000,
  /**
   * Six hours between timed checks: a release lands at most every few days,
   * and an unauthenticated GitHub read is rate-limited by address, so asking
   * more often buys nothing but requests.
   */
  INTERVAL_MS: 6 * 60 * 60 * 1000,
} as const;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface UpdateServiceOptions {
  /** The running build's version, as the packaged app reports it. */
  currentVersion: string;
  /** Every state the service moves through, for the broadcast to carry. */
  onChange: (update: UpdateSnapshot) => void;
  fetch?: FetchLike;
  requestTimeoutMs?: number;
  intervalMs?: number;
}

/**
 * Learns whether a newer release than the running build has been published,
 * and nothing else. A failed check is an answer for the row — `unreachable`
 * — never a throw: status codes alone diagnose the path, and the response's
 * only read field is the release's tag name, validated as a version before
 * it is compared or kept. What the service learns changes only what the
 * settings row says; fetching the update stays the user's own press, on a
 * page fixed by the build.
 */
export class UpdateService {
  readonly #currentVersion: string;
  readonly #onChange: (update: UpdateSnapshot) => void;
  readonly #fetch: FetchLike;
  readonly #requestTimeoutMs: number;
  readonly #intervalMs: number;
  #snapshot: UpdateSnapshot;
  #inFlight: Promise<UpdateSnapshot> | undefined;
  #timer: NodeJS.Timeout | undefined;

  constructor(options: UpdateServiceOptions) {
    this.#currentVersion = options.currentVersion;
    this.#onChange = options.onChange;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#requestTimeoutMs = options.requestTimeoutMs ?? UPDATE_CHECK_DEFAULTS.REQUEST_TIMEOUT_MS;
    this.#intervalMs = options.intervalMs ?? UPDATE_CHECK_DEFAULTS.INTERVAL_MS;
    this.#snapshot = { status: UPDATE_STATUS.UNKNOWN, currentVersion: this.#currentVersion };
  }

  snapshot(): UpdateSnapshot {
    return this.#snapshot;
  }

  /**
   * Asks for the latest release name once. A check already in flight answers
   * the new asker too, rather than doubling the request — the timer and the
   * row's button land on the same read.
   */
  check(): Promise<UpdateSnapshot> {
    this.#inFlight ??= this.#read()
      .catch((error): UpdateSnapshot => {
        // A throw anywhere in the read must not leave a dead check parked in
        // flight, where every later ask would reuse the failure and the row
        // would say "checking" forever. It lands on the same honest answer an
        // unreachable service gives, and the next ask is a fresh read.
        this.#report(
          `Update check failed: ${error instanceof Error ? error.name : "unknown error"}`,
        );
        return { status: UPDATE_STATUS.UNREACHABLE, currentVersion: this.#currentVersion };
      })
      .then((snapshot) => {
        this.#inFlight = undefined;
        this.#move(snapshot);
        return snapshot;
      });
    return this.#inFlight;
  }

  /**
   * Starts the timed check. It checks at once — a build that only ever
   * checked hours after launch would spend its first day behind — and the
   * timer never holds the process open.
   */
  start(): void {
    if (this.#timer) return;
    void this.check();
    this.#timer = setInterval(() => void this.check(), this.#intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async #read(): Promise<UpdateSnapshot> {
    this.#move({ status: UPDATE_STATUS.CHECKING, currentVersion: this.#currentVersion });
    let response: Response;
    try {
      response = await this.#fetch(UPDATE_ENDPOINT.LATEST_RELEASE_URL, {
        headers: GITHUB_REQUEST_HEADERS,
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
    } catch (error) {
      this.#report(
        `Update check did not complete: ${error instanceof Error ? error.name : "unknown error"}`,
      );
      return { status: UPDATE_STATUS.UNREACHABLE, currentVersion: this.#currentVersion };
    }
    if (!response.ok) {
      this.#report(`Update check failed with status ${response.status}`);
      return { status: UPDATE_STATUS.UNREACHABLE, currentVersion: this.#currentVersion };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      this.#report("Update check answered with an unreadable body");
      return { status: UPDATE_STATUS.UNREACHABLE, currentVersion: this.#currentVersion };
    }
    const tag = isRecord(payload) ? text(payload.tag_name) : undefined;
    const latest = tag && parseReleaseVersion(tag) ? tag.trim().replace(/^v/, "") : undefined;
    if (!latest) {
      // A release this build cannot name is not an update it can offer.
      this.#report("Update check answered without a readable release version");
      return { status: UPDATE_STATUS.UNREACHABLE, currentVersion: this.#currentVersion };
    }
    return isNewerVersion(latest, this.#currentVersion)
      ? {
          status: UPDATE_STATUS.UPDATE_AVAILABLE,
          currentVersion: this.#currentVersion,
          latestVersion: latest,
        }
      : { status: UPDATE_STATUS.UP_TO_DATE, currentVersion: this.#currentVersion };
  }

  #move(snapshot: UpdateSnapshot): void {
    this.#snapshot = snapshot;
    try {
      this.#onChange(snapshot);
    } catch {
      // A listener's failure is its own — a window torn down mid-broadcast
      // must not fail the check whose snapshot has already moved.
    }
  }

  #report(message: string): void {
    process.stderr.write(`${message}\n`);
  }
}
