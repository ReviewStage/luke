import { canUseWASM, type HighlighterTypes } from "@pierre/diffs";
import { WorkerPoolManager } from "@pierre/diffs/worker";
import type { DiffLook } from "./contract.js";

export const HIGHLIGHT_MODE = {
  POOL: "pool",
  MAIN_THREAD: "main-thread",
} as const;

type HighlightMode = (typeof HIGHLIGHT_MODE)[keyof typeof HIGHLIGHT_MODE];

export const HIGHLIGHTER = {
  HIGHLIGHTS: "highlights",
  SHIKI_JS: "shiki-js",
} as const satisfies Record<string, HighlighterTypes>;

const HIGHLIGHT_WORKERS = 2;

export const HIGHLIGHT_CACHE_ENTRIES = 100;

const MAIN_THREAD_MAX_CHARACTERS = 100_000;

export interface Highlighting {
  readonly pool: WorkerPoolManager | undefined;
  readonly settled: Promise<HighlightMode>;
  readonly follow: (drawn: DiffLook) => Promise<void>;
}

function poolRenderOptions(drawn: DiffLook, maxLineDiffLength: number) {
  return {
    theme: drawn.themes,
    lineDiffType: drawn.inlineDiff,
    maxLineDiffLength,
  } as const;
}

export function preferredHighlighter(): HighlighterTypes {
  return canUseWASM() ? HIGHLIGHTER.HIGHLIGHTS : HIGHLIGHTER.SHIKI_JS;
}

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
      ...(preferredHighlighter() === HIGHLIGHTER.HIGHLIGHTS
        ? { mainThreadMaxCharacters: MAIN_THREAD_MAX_CHARACTERS }
        : {}),
      onWorkerError: (event) => event.preventDefault(),
    },
    {
      ...poolRenderOptions(drawn, maxLineDiffLength),
      preferredHighlighter: preferredHighlighter(),
    },
  );
  const settled = pool.initialize().then(
    () => (pool.isWorkingPool() ? HIGHLIGHT_MODE.POOL : HIGHLIGHT_MODE.MAIN_THREAD),
    () => HIGHLIGHT_MODE.MAIN_THREAD,
  );
  const follow = (next: DiffLook) =>
    pool.setRenderOptions(poolRenderOptions(next, maxLineDiffLength)).catch(() => undefined);
  return { pool, settled, follow };
}
