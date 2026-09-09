import fs from "node:fs";
import { type Clock, systemClock } from "@sidecar/runtime/vocabulary";
import type { IDisposable } from "@sidecar/wire";
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

/** The narrow slice of `fs.watch` the watcher relies on, so a test can stand in. */
export interface SpoolWatchHandle {
  on(event: "error", listener: (error: Error) => void): void;
  close(): void;
}

/**
 * The listener's file name is a string or nothing: `fs.watch` hands back a
 * `Buffer` only under the buffer encoding, which this watcher never asks for.
 */
export type SpoolWatch = (
  directory: string,
  options: { persistent: false },
  listener: (eventType: string, fileName: string | null) => void,
) => SpoolWatchHandle;

/** One hook event as the spool reported it, named by the session it belongs to. */
export interface ObservedSpoolEvent<Event extends string> extends ObservedHookEvent<Event> {
  providerSessionId: string;
}

export interface ObservationSpoolWatcherOptions<Event extends string> {
  spoolDirectory: string;
  /** The tokens the hook may write; a file holding anything else is dropped. */
  events: readonly Event[];
  onEvents: (events: readonly ObservedSpoolEvent<Event>[]) => void;
  watch?: SpoolWatch;
  clock?: Clock;
}

export interface ObservationSpoolWatcher {
  close(): void;
}

function spoolSessionId(fileName: string | null): string | undefined {
  if (fileName === null) return undefined;
  return SPOOL_FILE_NAME_PATTERN.exec(fileName)?.[1];
}

class SpoolWatcher<Event extends string> implements ObservationSpoolWatcher {
  readonly #spoolDirectory: string;
  readonly #events: readonly Event[];
  readonly #onEvents: (events: readonly ObservedSpoolEvent<Event>[]) => void;
  readonly #watch: SpoolWatch;
  readonly #clock: Clock;

  readonly #pendingIds = new Set<string>();
  #debounceTimer: IDisposable | undefined;
  #rearmTimer: IDisposable | undefined;
  #handle: SpoolWatchHandle | undefined;
  #reads: Promise<void> = Promise.resolve();
  #closed = false;

  constructor(options: ObservationSpoolWatcherOptions<Event>) {
    this.#spoolDirectory = options.spoolDirectory;
    this.#events = options.events;
    this.#onEvents = options.onEvents;
    this.#watch = options.watch ?? fs.watch;
    this.#clock = options.clock ?? systemClock;
    this.#arm();
  }

  close(): void {
    this.#closed = true;
    this.#debounceTimer?.dispose();
    this.#debounceTimer = undefined;
    this.#rearmTimer?.dispose();
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
    let handle: SpoolWatchHandle;
    try {
      handle = this.#watch(this.#spoolDirectory, { persistent: false }, (_eventType, fileName) => {
        if (handle !== this.#handle) return;
        this.#collect(fileName);
      });
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
    this.#rearmTimer = this.#clock.schedule(DEFAULT_REARM_INTERVAL_MS, () => {
      this.#rearmTimer = undefined;
      this.#arm();
    });
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
    this.#debounceTimer = this.#clock.schedule(DEFAULT_DEBOUNCE_MS, () => {
      this.#debounceTimer = undefined;
      const ids = [...this.#pendingIds];
      this.#pendingIds.clear();
      this.#reads = this.#reads.then(() => this.#report(ids)).catch(() => undefined);
    });
  }

  /**
   * Reads run one batch after another so two batches can never reach the
   * listener out of order. A file that cannot be read — gone again already,
   * or unreadable for any reason — is dropped: the spool is a refinement of
   * state the adapters still read for themselves. A listener that throws
   * loses only its own batch; the chain recovers so the next batch is still
   * delivered, because a watcher that stalled on one bad callback would
   * silently stop sharpening anything after it.
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

/**
 * Stands a watch on one provider's spool and reports each batch of hook
 * events it sees, until closed. A directory that does not exist yet, or a
 * watch that fails later, is retried on a fixed interval rather than
 * reported: the watcher is additive to the adapters' own spool reads.
 */
export function watchObservationSpool<Event extends string>(
  options: ObservationSpoolWatcherOptions<Event>,
): ObservationSpoolWatcher {
  return new SpoolWatcher(options);
}
