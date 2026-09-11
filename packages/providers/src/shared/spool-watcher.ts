import path from "node:path";
import type { PlatformError } from "@effect/platform/Error";
import * as FileSystem from "@effect/platform/FileSystem";
import { Chunk, Duration, Effect, Option, Schedule, Stream } from "effect";
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

/**
 * A batch is bounded by its window and never by a count, so the grouping is
 * given a size no window of file names can reach rather than a cap that would
 * cut one in half.
 */
const SPOOL_BATCH_LIMIT = Number.MAX_SAFE_INTEGER;

/** One hook event as the spool reported it, named by the session it belongs to. */
export interface ObservedSpoolEvent<Event extends string> extends ObservedHookEvent<Event> {
  providerSessionId: string;
}

export interface ObservationSpoolOptions<Event extends string> {
  spoolDirectory: string;
  /** The tokens the hook may write; a file holding anything else is dropped. */
  events: readonly Event[];
}

function spoolSessionId(fileName: string): string | undefined {
  return SPOOL_FILE_NAME_PATTERN.exec(fileName)?.[1];
}

/**
 * Every session id the spool's own watch names, one element per event. The
 * watch fails when it cannot stand at all — a spool directory hook
 * installation has not created yet — and when the platform's watcher ends in
 * an error of its own; both are the same answer, tried again later, because
 * the watch is a sharpening and no failure of it is worth surfacing past the
 * spool read the adapters make anyway.
 */
function watchedSessionIds(
  spoolDirectory: string,
): Stream.Stream<string, PlatformError, FileSystem.FileSystem> {
  return Stream.unwrap(
    Effect.map(FileSystem.FileSystem, (fileSystem) =>
      Stream.filterMap(fileSystem.watch(spoolDirectory), (event) =>
        Option.fromNullable(spoolSessionId(path.basename(event.path))),
      ),
    ),
  );
}

/**
 * Reads one batch of ids back out of the spool. A file that cannot be read —
 * gone again already, or unreadable for any reason — is dropped: the spool is
 * a refinement of state the adapters still read for themselves. An id the
 * same window named twice is read once.
 */
function readBatch<Event extends string>(
  options: ObservationSpoolOptions<Event>,
  ids: readonly string[],
): Effect.Effect<readonly ObservedSpoolEvent<Event>[]> {
  return Effect.map(
    Effect.forEach([...new Set(ids)], (providerSessionId) =>
      Effect.map(
        Effect.option(
          Effect.tryPromise(() =>
            readObservationHookEvent(options.events, options.spoolDirectory, providerSessionId),
          ),
        ),
        (read) =>
          read._tag === "Some" && read.value !== undefined
            ? [{ providerSessionId, ...read.value }]
            : [],
      ),
    ),
    (batches) => batches.flat(),
  );
}

/**
 * Each batch of hook events the spool reports, until the stream's own scope
 * closes. The window is the beat rather than any one id's own: ids are
 * grouped by the window they land in and no later id extends it, so a spool
 * that never falls quiet still reports on the beat, and a window that named
 * nothing readable reports nothing at all. Reads run one batch after another,
 * so two batches can never reach a reader out of order.
 */
export function observationSpoolEvents<Event extends string>(
  options: ObservationSpoolOptions<Event>,
): Stream.Stream<readonly ObservedSpoolEvent<Event>[], PlatformError, FileSystem.FileSystem> {
  return watchedSessionIds(options.spoolDirectory).pipe(
    Stream.retry(Schedule.spaced(Duration.millis(DEFAULT_REARM_INTERVAL_MS))),
    Stream.groupedWithin(SPOOL_BATCH_LIMIT, Duration.millis(DEFAULT_DEBOUNCE_MS)),
    Stream.mapEffect((ids) => readBatch(options, Chunk.toReadonlyArray(ids))),
    Stream.filter((batch) => batch.length > 0),
  );
}
