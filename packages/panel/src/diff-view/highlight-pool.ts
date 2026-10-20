/**
 * highlight-pool.ts -- the pool of workers Files changed highlights a list's files in, or none, where the list highlights on the window's own thread.
 *
 * Shiki colouring a pull request's files is most of what a scroll through
 * Files changed costs the window's thread, so the diff bundle hands it to
 * Pierre's own pool of workers (`@pierre/diffs/worker`). The pool is
 * started from a door that starts one worker, which the bundle makes from
 * the worker's text the build carried; with no door, as where the build
 * carried no worker, there is no pool. A pool whose workers cannot start,
 * a door that throws or a worker that fails as it loads, is told nothing
 * is wrong with the window, and Pierre highlights on the window's own
 * thread instead, so a list is never left without its colours. What the
 * pool settles in, its workers or the window's own thread, is said once it
 * has started or failed to.
 */

import { WorkerPoolManager } from "@pierre/diffs/worker";
import type { DiffLook } from "./contract.js";

/** Where a list's files are highlighted: in the pool's workers, or on the window's own thread. */
export const HIGHLIGHT_MODE = {
  POOL: "pool",
  MAIN_THREAD: "main-thread",
} as const;

type HighlightMode = (typeof HIGHLIGHT_MODE)[keyof typeof HIGHLIGHT_MODE];

/**
 * How many workers highlight at once: two, so a file scrolled into view is
 * not held behind a long one, while each worker's own copy of the grammars
 * and themes is kept to two.
 */
const HIGHLIGHT_WORKERS = 2;

/**
 * How many results the pool keeps on the window's thread, for each of its
 * file and diff caches (Pierre's `totalASTLRUCacheSize`, which defaults to
 * 100 of each). The list names every read under a counter of its own, so a
 * kept result is never asked for again; only the files drawn right now are
 * read back, so a few are all the cache is for.
 */
export const HIGHLIGHT_CACHE_ENTRIES = 16;

/**
 * What a list highlights with: the pool to hand Pierre, none for the
 * window's own thread, where it settles once started, and the door that
 * hands its workers a look, since a pool kept across lists holds the look
 * it was last handed, not the one a list is drawn in, settling once they
 * hold it.
 */
export interface Highlighting {
  readonly pool: WorkerPoolManager | undefined;
  readonly settled: Promise<HighlightMode>;
  readonly follow: (drawn: DiffLook) => Promise<void>;
}

/** What the pool's workers highlight with, read off the look: its themes and how a changed line is marked, up to the longest line marked. */
function poolRenderOptions(drawn: DiffLook, maxLineDiffLength: number) {
  return {
    theme: drawn.themes,
    lineDiffType: drawn.inlineDiff,
    maxLineDiffLength,
  } as const;
}

/**
 * The pool started through `startWorker`, in the look given, on Shiki's
 * JavaScript engine, as the window's own thread highlights; none where
 * there is no door to start a worker through.
 */
export function startHighlighting(
  startWorker: (() => Worker) | undefined,
  drawn: DiffLook,
  maxLineDiffLength: number,
): Highlighting {
  if (startWorker === undefined) {
    return {
      pool: undefined,
      settled: Promise.resolve(HIGHLIGHT_MODE.MAIN_THREAD),
      follow: () => Promise.resolve(),
    };
  }
  const pool = new WorkerPoolManager(
    {
      workerFactory: startWorker,
      poolSize: HIGHLIGHT_WORKERS,
      totalASTLRUCacheSize: HIGHLIGHT_CACHE_ENTRIES,
      // Note that a worker failing to start is no error of the window's, since the list then highlights on its own thread.
      onWorkerError: (event) => event.preventDefault(),
    },
    { ...poolRenderOptions(drawn, maxLineDiffLength), preferredHighlighter: "shiki-js" },
  );
  const settled = pool.initialize().then(
    () => (pool.isWorkingPool() ? HIGHLIGHT_MODE.POOL : HIGHLIGHT_MODE.MAIN_THREAD),
    () => HIGHLIGHT_MODE.MAIN_THREAD,
  );
  // Note that a look not taken, the pool having failed, leaves the list on the window's own thread in its own look.
  const follow = (next: DiffLook) =>
    pool.setRenderOptions(poolRenderOptions(next, maxLineDiffLength)).catch(() => undefined);
  return { pool, settled, follow };
}
