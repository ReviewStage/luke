/**
 * renderer-health.ts -- how each window's renderer fares, as main hears it: a panel that stopped answering, once per episode, and a window grown past its memory bound.
 *
 * Electron tells main when a window's page stops answering and when it
 * answers again; main reads each process's working set from the operating
 * system. Neither needs the page's own help, so both are heard here even
 * when the page itself is too busy to report anything. What is heard is
 * handed to the reporter the caller names (Sentry, `telemetry-service.ts`),
 * and carries no word of the page: which document it is, how long, how much.
 */

import path from "node:path";
import { Clock, Duration, Effect, Queue, Schedule, Stream } from "effect";
import { app, BrowserWindow } from "electron";

/** How often every window's working set is read. */
const MEMORY_SAMPLE_INTERVAL = Duration.seconds(60);

/** The working set a window may grow to before it is noted: past it, a panel is holding far more than it draws. */
const WORKING_SET_BOUND_BYTES = 1.5 * 1024 ** 3;

/** Electron's process metrics count memory in kilobytes. */
const BYTES_PER_KILOBYTE = 1024;

/** What a window says of its page's responsiveness, by Electron's event names, and its close, which ends the following. */
const WINDOW_EVENT = {
  UNRESPONSIVE: "unresponsive",
  RESPONSIVE: "responsive",
  CLOSED: "closed",
} as const;
type WindowEvent = (typeof WINDOW_EVENT)[keyof typeof WINDOW_EVENT];

/** The page behind a window, as far as this reads it. */
interface FollowedPage {
  getOSProcessId(): number;
  getURL(): string;
}

/** A window as its responsiveness is followed: Electron's own events on it, and its page. */
export interface FollowedWindow {
  on(event: WindowEvent, listener: () => void): unknown;
  removeListener(event: WindowEvent, listener: () => void): unknown;
  readonly webContents: FollowedPage;
}

/** One stretch of a window not answering, from the first `unresponsive` to the `responsive` or close that ended it. */
export interface UnresponsiveEpisode {
  /** The document the window had loaded: `index.html` for a panel. */
  readonly document: string;
  readonly unresponsiveMs: number;
  /** The page's working set as it stopped answering; none where the system listed no such process. */
  readonly workingSetBytes: number | undefined;
  /** Whether the page answered again, rather than the window closing on it. */
  readonly recovered: boolean;
}

/** A window found past the memory bound on one sample. */
export interface WorkingSetCrossing {
  readonly document: string;
  readonly workingSetBytes: number;
}

/** The document a page has loaded, by its file's name, never its whole address. */
function documentOf(page: FollowedPage): string {
  const url = page.getURL();
  return URL.canParse(url) ? path.posix.basename(new URL(url).pathname) : "unknown";
}

/** The working set of one process, in bytes, as the system last measured it. */
function workingSetOf(pid: number): number | undefined {
  const metric = app.getAppMetrics().find((each) => each.pid === pid);
  return metric === undefined ? undefined : metric.memory.workingSetSize * BYTES_PER_KILOBYTE;
}

/** Every event the window says of its responsiveness, until it closes, its listeners taken back as the stream ends. */
function windowEvents(window: FollowedWindow): Stream.Stream<WindowEvent> {
  return Stream.callback<WindowEvent>((queue) =>
    Effect.forEach(
      Object.values(WINDOW_EVENT),
      (event) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const heard = () => {
              Queue.offerUnsafe(queue, event);
            };
            window.on(event, heard);
            return heard;
          }),
          (heard) =>
            Effect.sync(() => {
              window.removeListener(event, heard);
            }),
        ),
      { discard: true },
    ),
  ).pipe(Stream.takeUntil((event) => event === WINDOW_EVENT.CLOSED));
}

/**
 * Follows one window until it closes, handing `report` each episode of its
 * page not answering, once: when it answers again, or when the window
 * closes while it still does not. Note that Electron may say `unresponsive`
 * again before it says `responsive`, which is the same episode, and that
 * the working set is read as the page stops answering, since that is the
 * page the freeze is about.
 */
export function followResponsiveness(
  window: FollowedWindow,
  report: (episode: UnresponsiveEpisode) => Effect.Effect<void>,
): Effect.Effect<void> {
  return Effect.suspend(() => {
    let since:
      | { readonly at: number; readonly document: string; readonly workingSetBytes?: number }
      | undefined;
    const ended = (recovered: boolean) =>
      Effect.gen(function* () {
        const began = since;
        if (began === undefined) return;
        since = undefined;
        const now = yield* Clock.currentTimeMillis;
        yield* report({
          document: began.document,
          unresponsiveMs: now - began.at,
          workingSetBytes: began.workingSetBytes,
          recovered,
        });
      });
    return Stream.runForEach(windowEvents(window), (event) => {
      if (event === WINDOW_EVENT.RESPONSIVE) return ended(true);
      if (event === WINDOW_EVENT.CLOSED) return ended(false);
      if (since !== undefined) return Effect.void;
      return Effect.map(Clock.currentTimeMillis, (at) => {
        const page = window.webContents;
        const workingSetBytes = workingSetOf(page.getOSProcessId());
        since = {
          at,
          document: documentOf(page),
          ...(workingSetBytes === undefined ? undefined : { workingSetBytes }),
        };
      });
    });
  });
}

/**
 * Reads every window's working set now and then, for as long as it runs,
 * handing `crossed` each window found past the bound that was not past it
 * on the sample before: one note as it crosses, not one a minute while it
 * stays there, and another only once it fell back under and crossed again.
 */
export function sampleWindowMemory(
  crossed: (crossing: WorkingSetCrossing) => void,
): Effect.Effect<void> {
  return Effect.suspend(() => {
    // The pages past the bound on the last sample, by their contents' id.
    let over = new Set<number>();
    const sample = Effect.sync(() => {
      const now = new Set<number>();
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed()) continue;
        const page = window.webContents;
        const workingSetBytes = workingSetOf(page.getOSProcessId());
        if (workingSetBytes === undefined || workingSetBytes <= WORKING_SET_BOUND_BYTES) continue;
        now.add(page.id);
        if (!over.has(page.id)) crossed({ document: documentOf(page), workingSetBytes });
      }
      over = now;
    });
    return Effect.asVoid(Effect.repeat(sample, Schedule.spaced(MEMORY_SAMPLE_INTERVAL)));
  });
}
