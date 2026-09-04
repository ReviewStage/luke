import fs from "node:fs";
import { type ObservedHookEvent, readObservationHookEvent } from "./hook-merge.js";

/**
 * Watches an observation hook spool so a hook event can wake something the
 * moment it lands, rather than at the next observation pass. The hook writes
 * `<session id>.json` by rename, so a directory watch sees every event as a
 * file name; the file itself is read back through the same bounded reader the
 * adapters use, and anything it declines to read is dropped here too. The
 * watcher only sharpens timing: nothing it reports is state the adapters do
 * not already read from the spool on their own pass, and a machine where it
 * cannot stand observes exactly as before.
 */

/**
 * The spool file names this reader accepts. A session id becomes the spool
 * file's name, so a name outside this shape was not written by the hook — the
 * hook's own temporary file, dotted and suffixed, falls outside it too.
 */
const SPOOL_FILE_NAME_PATTERN = /^([A-Za-z0-9_-]{1,128})\.json$/;

/**
 * How long ids collect before one read reports them together. A turn boundary
 * fires a couple of hooks in quick succession, and several sessions can turn
 * over at once; one batch reads the spool once for all of them.
 */
const DEFAULT_DEBOUNCE_MS = 500;

/**
 * How often a watcher that could not stand tries again. The spool directory
 * is created by hook installation and may not exist yet when the watch is
 * asked for, and a watch can fail on its own later.
 */
const DEFAULT_REARM_INTERVAL_MS = 5000;

type Timer = ReturnType<typeof setTimeout>;

/** One hook event as the spool reported it, named by the session it belongs to. */
export interface ObservedSpoolEvent<Event extends string> extends ObservedHookEvent<Event> {
  providerSessionId: string;
}

export interface ObservationSpoolWatcherOptions<Event extends string> {
  spoolDirectory: string;
  /** The tokens the hook may write; a file holding anything else is dropped. */
  events: readonly Event[];
  onEvents: (events: readonly ObservedSpoolEvent<Event>[]) => void;
  debounceMs?: number;
  rearmIntervalMs?: number;
  watch?: typeof fs.watch;
  schedule?: (callback: () => void, delayMs: number) => Timer;
  cancel?: (timer: Timer) => void;
}

function spoolSessionId(fileName: string | null): string | undefined {
  if (fileName === null) return undefined;
  return SPOOL_FILE_NAME_PATTERN.exec(fileName)?.[1];
}

export class SpoolWatcher<Event extends string> {
  readonly #spoolDirectory: string;
  readonly #events: readonly Event[];
  readonly #onEvents: (events: readonly ObservedSpoolEvent<Event>[]) => void;
  readonly #debounceMs: number;
  readonly #rearmIntervalMs: number;
  readonly #watch: typeof fs.watch;
  readonly #schedule: (callback: () => void, delayMs: number) => Timer;
  readonly #cancel: (timer: Timer) => void;

  readonly #pendingIds = new Set<string>();
  #debounceTimer: Timer | undefined;
  #rearmTimer: Timer | undefined;
  #handle: fs.FSWatcher | undefined;
  #reads: Promise<void> = Promise.resolve();
  #closed = false;

  constructor(options: ObservationSpoolWatcherOptions<Event>) {
    this.#spoolDirectory = options.spoolDirectory;
    this.#events = options.events;
    this.#onEvents = options.onEvents;
    this.#debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.#rearmIntervalMs = options.rearmIntervalMs ?? DEFAULT_REARM_INTERVAL_MS;
    this.#watch = options.watch ?? fs.watch;
    this.#schedule = options.schedule ?? setTimeout;
    this.#cancel = options.cancel ?? clearTimeout;
    this.#arm();
  }

  close(): void {
    this.#closed = true;
    if (this.#debounceTimer !== undefined) this.#cancel(this.#debounceTimer);
    this.#debounceTimer = undefined;
    if (this.#rearmTimer !== undefined) this.#cancel(this.#rearmTimer);
    this.#rearmTimer = undefined;
    this.#pendingIds.clear();
    this.#dropHandle();
  }

  /**
   * Any failure to stand — a spool directory not created yet, a watch the
   * platform refused — is answered the same way: try again later. The watch
   * is a sharpening, so no failure of it is worth surfacing past the spool
   * read the adapters make anyway.
   */
  #arm(): void {
    if (this.#closed) return;
    let handle: fs.FSWatcher;
    try {
      handle = this.#watch(
        this.#spoolDirectory,
        { persistent: false, encoding: "utf8" },
        (_eventType, fileName) => {
          if (handle !== this.#handle) return;
          this.#collect(fileName);
        },
      );
    } catch {
      this.#scheduleRearm();
      return;
    }
    this.#handle = handle;
    handle.on("error", () => {
      if (handle !== this.#handle) return;
      this.#dropHandle();
      this.#scheduleRearm();
    });
  }

  #dropHandle(): void {
    const handle = this.#handle;
    this.#handle = undefined;
    handle?.close();
  }

  #scheduleRearm(): void {
    if (this.#closed || this.#rearmTimer !== undefined) return;
    this.#rearmTimer = this.#schedule(() => {
      this.#rearmTimer = undefined;
      this.#arm();
    }, this.#rearmIntervalMs);
  }

  /**
   * The batch window opens at the first id and is not extended by later ones,
   * so a spool that never falls quiet still reports on the beat.
   */
  #collect(fileName: string | null): void {
    if (this.#closed) return;
    const providerSessionId = spoolSessionId(fileName);
    if (providerSessionId === undefined) return;
    this.#pendingIds.add(providerSessionId);
    if (this.#debounceTimer !== undefined) return;
    this.#debounceTimer = this.#schedule(() => {
      this.#debounceTimer = undefined;
      const ids = [...this.#pendingIds];
      this.#pendingIds.clear();
      this.#reads = this.#reads.then(() => this.#report(ids));
    }, this.#debounceMs);
  }

  /**
   * Reads run one batch after another so two batches can never reach the
   * listener out of order. A file that cannot be read — gone again already,
   * or unreadable for any reason — is dropped: the spool is a refinement of
   * state the adapters still read for themselves.
   */
  async #report(ids: readonly string[]): Promise<void> {
    const observed: ObservedSpoolEvent<Event>[] = [];
    for (const providerSessionId of ids) {
      const event = await readObservationHookEvent(
        this.#events,
        this.#spoolDirectory,
        providerSessionId,
      ).catch(() => undefined);
      if (event) observed.push({ providerSessionId, ...event });
    }
    if (this.#closed || observed.length === 0) return;
    this.#onEvents(observed);
  }
}
